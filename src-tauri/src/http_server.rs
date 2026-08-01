use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::extract::{DefaultBodyLimit, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use tokio::sync::{oneshot, Semaphore};

use crate::graph;

const BODY_LIMIT: usize = 64 * 1024;
const MAX_CONCURRENT_COLLECTIONS: usize = 2;

#[derive(Clone)]
struct HttpState {
    config_path: Arc<Mutex<PathBuf>>,
    graph_slots: Arc<Semaphore>,
}

pub struct HttpServerHandle {
    shutdown: Option<oneshot::Sender<()>>,
}

impl Drop for HttpServerHandle {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

pub fn configured_port() -> Result<Option<u16>, String> {
    parse_port(std::env::var("RETICLE_DESKTOP_HTTP_PORT").ok().as_deref())
}

fn parse_port(value: Option<&str>) -> Result<Option<u16>, String> {
    let Some(value) = value else { return Ok(None) };
    let port = value
        .parse::<u16>()
        .map_err(|_| "RETICLE_DESKTOP_HTTP_PORT must be a port from 1 to 65535".to_string())?;
    if port == 0 {
        return Err("RETICLE_DESKTOP_HTTP_PORT must be a port from 1 to 65535".into());
    }
    Ok(Some(port))
}

pub fn start(config_path: Arc<Mutex<PathBuf>>, port: u16) -> Result<HttpServerHandle, String> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let listener = std::net::TcpListener::bind(addr)
        .map_err(|error| format!("cannot bind local graph API at {addr}: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("cannot configure local graph API: {error}"))?;

    let state = HttpState {
        config_path,
        graph_slots: Arc::new(Semaphore::new(MAX_CONCURRENT_COLLECTIONS)),
    };
    let app = router(state);
    let (shutdown_tx, shutdown_rx) = oneshot::channel();

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("local graph API failed to start: {error}");
                return;
            }
        };
        if let Err(error) = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await
        {
            eprintln!("local graph API stopped: {error}");
        }
    });

    println!("Reticle local graph API: http://{addr} (read-only)");
    Ok(HttpServerHandle {
        shutdown: Some(shutdown_tx),
    })
}

fn router(state: HttpState) -> Router {
    Router::new()
        .route("/api/graph", get(graph_handler))
        .route("/mcp", post(mcp_handler))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .with_state(state)
}

async fn graph_handler(State(state): State<HttpState>) -> impl IntoResponse {
    match collect_graph(&state).await {
        Ok(graph) => Json(graph).into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": error })),
        )
            .into_response(),
    }
}

async fn mcp_handler(
    State(state): State<HttpState>,
    Json(request): Json<Value>,
) -> impl IntoResponse {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let result = match request["method"].as_str().unwrap_or_default() {
        "initialize" => Ok(json!({
            "protocolVersion": "2025-03-26",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "reticle-desktop", "version": env!("CARGO_PKG_VERSION") }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": read_only_tools() })),
        "tools/call" => mcp_tool_call(&state, &request["params"]).await,
        "notifications/initialized" => Ok(Value::Null),
        method => Err(format!("method not found: {method}")),
    };

    match result {
        Ok(Value::Null) if id.is_null() => StatusCode::ACCEPTED.into_response(),
        Ok(result) => Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })).into_response(),
        Err(error) => Json(json!({
            "jsonrpc": "2.0", "id": id,
            "error": { "code": -32601, "message": error }
        }))
        .into_response(),
    }
}

fn read_only_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "reticle_get_graph",
            "description": "Return the canonical Reticle operational graph snapshot",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }),
        json!({
            "name": "reticle_get_node",
            "description": "Return one graph node and its current signals",
            "inputSchema": {
                "type": "object", "properties": { "id": { "type": "string" } },
                "required": ["id"], "additionalProperties": false
            }
        }),
    ]
}

async fn mcp_tool_call(state: &HttpState, params: &Value) -> Result<Value, String> {
    let graph = collect_graph(state).await?;
    let value = match params["name"].as_str().unwrap_or_default() {
        "reticle_get_graph" => serde_json::to_value(graph).map_err(|error| error.to_string())?,
        "reticle_get_node" => {
            let node_id = params["arguments"]["id"].as_str().unwrap_or_default();
            let node = graph
                .nodes
                .get(node_id)
                .ok_or_else(|| format!("node not found: {node_id}"))?;
            let signals: Vec<_> = graph
                .signals
                .values()
                .filter(|signal| signal.node_id == node_id)
                .collect();
            json!({ "node": node, "signals": signals })
        }
        name => return Err(format!("unknown read-only tool: {name}")),
    };
    let text = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    Ok(json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": value,
        "isError": false
    }))
}

async fn collect_graph(state: &HttpState) -> Result<graph::OperationalGraph, String> {
    let permit = state
        .graph_slots
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| "local graph API is shutting down".to_string())?;
    let path = state.config_path.lock().unwrap().clone();
    let result = tokio::task::spawn_blocking(move || graph::collect_yaml(&path))
        .await
        .map_err(|error| format!("graph collection task failed: {error}"))?;
    drop(permit);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    #[test]
    fn local_api_is_opt_in_and_rejects_invalid_ports() {
        assert_eq!(parse_port(None).unwrap(), None);
        assert_eq!(parse_port(Some("8786")).unwrap(), Some(8786));
        assert!(parse_port(Some("0")).is_err());
        assert!(parse_port(Some("not-a-port")).is_err());
    }

    #[test]
    fn desktop_mcp_has_no_execution_tools() {
        let names: Vec<_> = read_only_tools()
            .into_iter()
            .filter_map(|tool| tool["name"].as_str().map(String::from))
            .collect();
        assert_eq!(names, ["reticle_get_graph", "reticle_get_node"]);
    }

    #[tokio::test]
    async fn loopback_routes_serve_graph_and_read_only_mcp() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("reticle-http-{unique}.yaml"));
        std::fs::write(
            &path,
            "version: 1\nnodes:\n  api:\n    title: API\n    health: { state: ok }\nedges: {}\ncollectors: []\nactions: []\n",
        )
        .unwrap();
        let app = router(HttpState {
            config_path: Arc::new(Mutex::new(path.clone())),
            graph_slots: Arc::new(Semaphore::new(2)),
        });

        let graph_response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/graph")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(graph_response.status(), StatusCode::OK);
        let body = graph_response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes();
        let graph: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(graph["schemaVersion"], 1);
        assert_eq!(graph["signals"]["api:health"]["state"], "ok");

        let mcp_response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/mcp")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(mcp_response.status(), StatusCode::OK);
        let body = mcp_response.into_body().collect().await.unwrap().to_bytes();
        let response: Value = serde_json::from_slice(&body).unwrap();
        let names: Vec<_> = response["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect();
        assert_eq!(names, ["reticle_get_graph", "reticle_get_node"]);
        let _ = std::fs::remove_file(path);
    }
}
