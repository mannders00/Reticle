// core/src/config.rs
// Persisted configuration shape (mirrors the frontend store 1:1) plus YAML
// helpers and the default config fallback.
//
// v1 model: nodes carry `kind`, `x/y/w/h`, `parentId`, `spec`, `health`,
// `actions`, `crons`. Edges are first-class. This supersedes server-map's
// v0 `servers`-only array; we accept v0 files on load (migrate in the
// frontend's `normalizeNodes`) and write v1 on save.
//
// Backwards compat: the `servers` field is still accepted on load (v0
// migration) but we write `nodes` on save. `groups` and `layers` are kept
// for forward compat.

use std::fs;
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub name: String,
    pub script: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cron {
    pub name: String,
    pub interval: String,
    pub script: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Health {
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub last_check: Option<i64>,
    #[serde(default)]
    pub detail: Option<Value>,
}

impl Default for Health {
    fn default() -> Self {
        Health {
            state: String::new(),
            last_check: None,
            detail: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub w: f64,
    #[serde(default)]
    pub h: f64,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub spec: Option<Value>,
    #[serde(default)]
    pub health: Health,
    #[serde(default)]
    pub actions: Vec<Action>,
    #[serde(default)]
    pub crons: Vec<Cron>,

    // v0 compat fields (accepted on load, ignored by the canvas)
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub lat: Option<f64>,
    #[serde(default)]
    pub lng: Option<f64>,
}

fn default_kind() -> String {
    "server".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub id: String,
    #[serde(default = "default_edge_kind")]
    pub kind: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub port: Option<Value>,
    pub from: String,
    pub to: String,
}

fn default_edge_kind() -> String {
    "tcp".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomLayer {
    pub name: String,
    pub file: String,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub radius: Option<f64>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
}

fn default_color() -> String {
    "#ff6600".into()
}
fn default_opacity() -> f64 {
    0.7
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub name: String,
    #[serde(default)]
    pub collapsed: bool,
}

/// The on-disk shape. We accept both v0 (servers array) and v1 (nodes +
/// edges maps). On save we always write v1.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub servers: Vec<Node>, // v0 compat (migrated to nodes on load)
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub nodes: serde_json::Map<String, Value>,
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub edges: serde_json::Map<String, Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<Group>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub layers: Vec<CustomLayer>,
}

#[derive(Debug, Serialize)]
pub struct ActionResult {
    pub success: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CronResult {
    pub success: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timestamp: i64,
}

#[derive(Debug, Serialize)]
pub struct CronStatus {
    pub server: String,
    pub name: String,
    pub interval: String,
    pub last_success: Option<bool>,
    pub last_exit_code: Option<i32>,
    pub last_run: Option<i64>,
}

pub fn parse_interval(s: &str) -> Result<u64, String> {
    let s = s.trim();
    if let Some(num) = s.strip_suffix('s') {
        num.parse::<u64>()
            .map_err(|e| format!("invalid seconds: {}", e))
    } else if let Some(num) = s.strip_suffix('m') {
        num.parse::<u64>()
            .map(|n| n * 60)
            .map_err(|e| format!("invalid minutes: {}", e))
    } else if let Some(num) = s.strip_suffix('h') {
        num.parse::<u64>()
            .map(|n| n * 3600)
            .map_err(|e| format!("invalid hours: {}", e))
    } else {
        s.parse::<u64>()
            .map_err(|e| format!("invalid interval '{}': expected e.g. 30s, 5m, 1h", e))
    }
}

pub fn default_config_yaml() -> &'static str {
    r#"# Reticle Configuration — v1
# Edit freely; the app watches this file and reloads on save.
#
# nodes:
#   web-01:
#     kind: server
#     title: web-01
#     subtitle: "nginx · 10.0.1.4"
#     x: 80
#     y: 80
#     w: 220
#     h: 120
#     spec:
#       host: 10.0.1.4
#       port: 22
#       user: deploy
#
# collectors:
#   - id: web-http
#     nodeId: web-01
#     name: web health
#     kind: http
#     url: https://web-01.example/healthz
#     status: 2xx
#     timeoutSeconds: 8
# actions:
#   - id: diagnose-web
#     nodeId: web-01
#     name: Diagnose web
#     kind: ssh.command
#     command: curl -fsS http://127.0.0.1/health | jq -e '.status == "ok"'
#     requiresSignal: web-http
#     requiresState: err
#     requiresApproval: true
#     timeoutSeconds: 20
#
# edges:
#   e1:
#     kind: tcp
#     label: tcp/5432
#     from: web-01
#     to: db-primary
#
# groups: []
# layers: []

nodes: {}
edges: {}
groups: []
layers: []
collectors: []
actions: []
"#
}

pub fn ensure_config(path: &Path) -> Result<(), String> {
    if !path.exists() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create config dir: {}", e))?;
        }
        fs::write(path, default_config_yaml())
            .map_err(|e| format!("failed to write default config: {}", e))?;
    }
    Ok(())
}

/// Read the config YAML as raw JSON. The frontend does its own shape
/// migration (v0 → v1), so both shells pass the document through opaquely.
pub fn load_raw(path: &Path) -> Result<Value, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("failed to read config: {}", e))?;
    serde_yaml::from_str(&content).map_err(|e| format!("failed to parse config: {}", e))
}

/// Write a raw JSON document back as YAML (creating the file/dirs first).
pub fn save_raw(path: &Path, config: &Value) -> Result<(), String> {
    ensure_config(path)?;
    let content =
        serde_yaml::to_string(config).map_err(|e| format!("failed to serialize config: {}", e))?;
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.yaml");
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp = parent.join(format!(".{file_name}.{}.{nonce}.tmp", std::process::id()));
    let permissions = fs::metadata(path)
        .ok()
        .map(|metadata| metadata.permissions());
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| format!("failed to create temporary config: {e}"))?;
        if let Some(permissions) = permissions {
            fs::set_permissions(&temp, permissions)
                .map_err(|e| format!("failed to preserve config permissions: {e}"))?;
        }
        file.write_all(content.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("failed to write temporary config: {e}"))?;
        fs::rename(&temp, path).map_err(|e| format!("failed to replace config: {e}"))?;
        #[cfg(unix)]
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|e| format!("failed to sync config directory: {e}"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

/// Persist canvas-owned topology fields while preserving collector and named
/// action configuration that is intentionally absent from graph responses.
pub fn save_topology(path: &Path, topology: &Value) -> Result<(), String> {
    let topology = topology
        .as_object()
        .ok_or_else(|| "topology must be an object".to_string())?;
    let next_node_map = topology
        .get("nodes")
        .and_then(Value::as_object)
        .ok_or_else(|| "topology nodes must be an object".to_string())?;
    let next_edge_map = topology
        .get("edges")
        .and_then(Value::as_object)
        .ok_or_else(|| "topology edges must be an object".to_string())?;
    for (id, node) in next_node_map {
        let node = node
            .as_object()
            .ok_or_else(|| format!("node '{id}' must be an object"))?;
        if node.get("spec").is_some_and(|spec| !spec.is_object()) {
            return Err(format!("node '{id}' spec must be an object"));
        }
    }
    for (id, edge) in next_edge_map {
        let edge = edge
            .as_object()
            .ok_or_else(|| format!("edge '{id}' must be an object"))?;
        let from = edge
            .get("from")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("edge '{id}' requires from"))?;
        let to = edge
            .get("to")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("edge '{id}' requires to"))?;
        if !next_node_map.contains_key(from) || !next_node_map.contains_key(to) {
            return Err(format!("edge '{id}' references a missing node"));
        }
    }

    let mut document = load_raw(path)?;
    let previous_nodes = document
        .get("nodes")
        .and_then(Value::as_object)
        .map(|nodes| {
            nodes
                .keys()
                .cloned()
                .collect::<std::collections::HashSet<_>>()
        })
        .unwrap_or_default();
    let next_nodes = next_node_map
        .keys()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let removed_nodes = previous_nodes
        .difference(&next_nodes)
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let object = document
        .as_object_mut()
        .ok_or_else(|| "config root must be an object".to_string())?;
    for key in ["version", "nodes", "edges"] {
        if let Some(value) = topology.get(key) {
            object.insert(key.into(), value.clone());
        }
    }
    let mut removed_collectors = std::collections::HashSet::new();
    if let Some(collectors) = object.get_mut("collectors").and_then(Value::as_array_mut) {
        collectors.retain(|collector| {
            let removed = collector
                .get("nodeId")
                .and_then(Value::as_str)
                .is_some_and(|node_id| removed_nodes.contains(node_id));
            if removed {
                if let Some(id) = collector.get("id").and_then(Value::as_str) {
                    removed_collectors.insert(id.to_string());
                }
            }
            !removed
        });
    }
    if let Some(actions) = object.get_mut("actions").and_then(Value::as_array_mut) {
        actions.retain(|action| {
            let removed_node = action
                .get("nodeId")
                .and_then(Value::as_str)
                .is_some_and(|node_id| removed_nodes.contains(node_id));
            let removed_signal = action
                .get("requiresSignal")
                .and_then(Value::as_str)
                .is_some_and(|signal_id| removed_collectors.contains(signal_id));
            !removed_node && !removed_signal
        });
    }
    object.remove("servers");
    save_raw(path, &document)
}

pub fn now_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn topology_save_preserves_collectors_and_named_actions() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("reticle-config-{unique}.yaml"));
        fs::write(
            &path,
            "nodes: {}\nedges: {}\ncollectors:\n  - id: check\nactions:\n  - id: restart\nlayers:\n  - name: boundaries\nextension:\n  owner: platform\n",
        )
        .unwrap();

        save_topology(
            &path,
            &serde_json::json!({
                "version": 1,
                "nodes": { "api": { "title": "API" } },
                "edges": {}
            }),
        )
        .unwrap();
        let saved = load_raw(&path).unwrap();
        assert_eq!(saved["collectors"][0]["id"], "check");
        assert_eq!(saved["actions"][0]["id"], "restart");
        assert_eq!(saved["layers"][0]["name"], "boundaries");
        assert_eq!(saved["extension"]["owner"], "platform");
        assert_eq!(saved["nodes"]["api"]["title"], "API");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn topology_save_atomically_prunes_operations_for_removed_nodes() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("reticle-config-prune-{unique}.yaml"));
        fs::write(
            &path,
            "nodes:\n  api: { title: API }\n  worker: { title: Worker }\nedges: {}\ncollectors:\n  - id: api-check\n    nodeId: api\n  - id: worker-check\n    nodeId: worker\nactions:\n  - id: restart-api\n    nodeId: api\n  - id: restart-worker-from-api\n    nodeId: worker\n    requiresSignal: api-check\n",
        )
        .unwrap();

        save_topology(
            &path,
            &serde_json::json!({
                "version": 1,
                "nodes": { "worker": { "title": "Worker" } },
                "edges": {}
            }),
        )
        .unwrap();
        let saved = load_raw(&path).unwrap();
        assert_eq!(saved["collectors"].as_array().unwrap().len(), 1);
        assert_eq!(saved["collectors"][0]["id"], "worker-check");
        assert!(saved["actions"].as_array().unwrap().is_empty());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn topology_save_rejects_malformed_input_without_touching_the_file() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("reticle-config-invalid-{unique}.yaml"));
        let original = "nodes:\n  api: { title: API }\nedges: {}\ncollectors:\n  - id: api-check\n    nodeId: api\n";
        fs::write(&path, original).unwrap();

        assert!(save_topology(&path, &serde_json::json!({})).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        assert!(save_topology(
            &path,
            &serde_json::json!({ "nodes": {}, "edges": { "bad": { "from": "a", "to": "b" } } })
        )
        .is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn topology_save_refuses_to_replace_an_unreadable_document() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("reticle-config-malformed-{unique}.yaml"));
        fs::write(&path, "nodes: [unterminated").unwrap();
        assert!(save_topology(&path, &serde_json::json!({ "nodes": {}, "edges": {} })).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "nodes: [unterminated");
        let _ = fs::remove_file(path);
    }
}
