use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{actions, config, health, ssh};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationalGraph {
    pub schema_version: u32,
    pub version: u64,
    pub generated_at: i64,
    pub nodes: BTreeMap<String, Value>,
    pub edges: BTreeMap<String, Value>,
    pub signals: BTreeMap<String, Signal>,
    pub actions: BTreeMap<String, ActionDescriptor>,
    pub collectors: Vec<CollectorStatus>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Signal {
    pub id: String,
    pub node_id: String,
    pub name: String,
    pub state: String,
    pub observed_at: Option<i64>,
    pub detail: Option<Value>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionDescriptor {
    pub id: String,
    pub node_id: String,
    pub name: String,
    pub kind: String,
    pub target: String,
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub requires_approval: bool,
    pub requires_signal: Option<String>,
    pub requires_state: Option<String>,
    pub timeout_seconds: u64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectorStatus {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub node_id: Option<String>,
    pub state: String,
    pub detail: Option<String>,
    pub collected_at: i64,
    pub duration_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectorDefinition {
    id: String,
    node_id: String,
    #[serde(default)]
    name: String,
    kind: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    jq: String,
    #[serde(default)]
    probe: String,
    #[serde(default)]
    service: String,
    #[serde(default = "default_timeout")]
    timeout_seconds: u64,
}

fn default_timeout() -> u64 {
    10
}

/// Collect static topology, then execute only configured HTTP and fixed SSH
/// probes. The graph response never contains executable command text.
pub fn collect_yaml(path: &Path) -> Result<OperationalGraph, String> {
    let raw = config::load_raw(path)?;
    let collected_at = config::now_timestamp();
    let mut graph = collect_value(&raw, collected_at);
    collect_signals(&raw, &mut graph);
    project_actions(&raw, &mut graph)?;
    Ok(graph)
}

fn collect_value(raw: &Value, collected_at: i64) -> OperationalGraph {
    let version = raw.get("version").and_then(Value::as_u64).unwrap_or(1);
    let mut nodes = collect_nodes(raw);
    let edges = collect_edges(raw);
    let mut signals = BTreeMap::new();

    for (node_id, node) in &mut nodes {
        let Some(object) = node.as_object_mut() else {
            continue;
        };
        if let Some(health) = object.get("health").and_then(Value::as_object) {
            let id = format!("{node_id}:health");
            signals.insert(
                id.clone(),
                Signal {
                    id,
                    node_id: node_id.clone(),
                    name: "health".into(),
                    state: health
                        .get("state")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .into(),
                    observed_at: health
                        .get("lastCheck")
                        .or_else(|| health.get("last_check"))
                        .and_then(Value::as_i64),
                    detail: health
                        .get("detail")
                        .cloned()
                        .filter(|value| !value.is_null()),
                    source: "static-topology".into(),
                },
            );
        }
        object.remove("health");
    }

    OperationalGraph {
        schema_version: 1,
        version,
        generated_at: collected_at,
        nodes,
        edges,
        signals,
        actions: BTreeMap::new(),
        collectors: vec![CollectorStatus {
            id: "static-topology".into(),
            name: "Static topology".into(),
            kind: "static".into(),
            node_id: None,
            state: "ok".into(),
            detail: None,
            collected_at,
            duration_ms: 0,
        }],
    }
}

fn collect_signals(raw: &Value, graph: &mut OperationalGraph) {
    let definitions: Vec<CollectorDefinition> =
        match serde_json::from_value(raw.get("collectors").cloned().unwrap_or_else(|| json!([]))) {
            Ok(value) => value,
            Err(error) => {
                graph
                    .collectors
                    .push(failed_configuration(error.to_string(), graph.generated_at));
                return;
            }
        };

    let mut ids = HashSet::new();
    if let Some(duplicate) = definitions
        .iter()
        .find(|definition| !ids.insert(definition.id.as_str()))
    {
        graph.collectors.push(failed_configuration(
            format!("duplicate collector id '{}'", duplicate.id),
            graph.generated_at,
        ));
        return;
    }

    for definition in definitions {
        let started = Instant::now();
        let result = run_collector(raw, &definition);
        let (state, detail) = match result {
            Ok(detail) => ("ok", detail),
            Err(detail) => ("err", detail),
        };
        let name = if definition.name.trim().is_empty() {
            definition.id.clone()
        } else {
            definition.name.clone()
        };
        graph.signals.insert(
            definition.id.clone(),
            Signal {
                id: definition.id.clone(),
                node_id: definition.node_id.clone(),
                name: name.clone(),
                state: state.into(),
                observed_at: Some(graph.generated_at),
                detail: Some(json!(detail)),
                source: definition.id.clone(),
            },
        );
        graph.collectors.push(CollectorStatus {
            id: definition.id,
            name,
            kind: definition.kind,
            node_id: Some(definition.node_id),
            state: state.into(),
            detail: Some(detail),
            collected_at: graph.generated_at,
            duration_ms: started.elapsed().as_millis() as u64,
        });
    }
}

fn run_collector(raw: &Value, definition: &CollectorDefinition) -> Result<String, String> {
    if definition.id.trim().is_empty()
        || raw
            .get("nodes")
            .and_then(Value::as_object)
            .and_then(|nodes| nodes.get(&definition.node_id))
            .is_none()
    {
        return Err("collector requires a stable id and existing nodeId".into());
    }
    if !(1..=120).contains(&definition.timeout_seconds) {
        return Err("collector timeout must be between 1 and 120 seconds".into());
    }

    match definition.kind.as_str() {
        "http" => {
            let result = health::http_check_with_timeout(
                &definition.url,
                &definition.status,
                &definition.jq,
                definition.timeout_seconds,
            );
            if result.ok {
                Ok(result.detail)
            } else {
                Err(result.detail)
            }
        }
        "ssh" => {
            let node = &raw["nodes"][&definition.node_id];
            let host = node["spec"]["host"].as_str().unwrap_or("");
            let port = node["spec"]["port"].as_u64().unwrap_or(22) as u16;
            let user = node["spec"]["user"].as_str().unwrap_or("");
            let command = match definition.probe.as_str() {
                "host.uptime" => vec!["uptime".into()],
                "service.status" if valid_service(&definition.service) => vec![
                    "systemctl".into(),
                    "is-active".into(),
                    "--".into(),
                    definition.service.clone(),
                ],
                "service.status" => return Err("invalid service name".into()),
                _ => return Err("SSH probe must be host.uptime or service.status".into()),
            };
            let result = ssh::run_fixed_command(
                host,
                port,
                user,
                &command,
                Duration::from_secs(definition.timeout_seconds),
            )?;
            let detail = if result.success {
                result.stdout.trim().to_string()
            } else if !result.stderr.trim().is_empty() {
                result.stderr.trim().to_string()
            } else {
                format!("exit {}", result.exit_code)
            };
            if result.success {
                Ok(detail)
            } else {
                Err(detail)
            }
        }
        _ => Err("collector kind must be http or ssh".into()),
    }
}

fn project_actions(raw: &Value, graph: &mut OperationalGraph) -> Result<(), String> {
    let definitions = actions::parse(raw)?;
    for action in definitions {
        let unavailable_reason = actions::validate(&action).err().or_else(|| {
            (!graph.nodes.contains_key(&action.node_id)).then(|| "node does not exist".into())
        });
        graph.actions.insert(
            action.id.clone(),
            ActionDescriptor {
                id: action.id,
                node_id: action.node_id,
                name: action.name,
                kind: action.kind,
                target: action.service,
                available: unavailable_reason.is_none(),
                unavailable_reason,
                requires_approval: action.requires_approval,
                requires_signal: action.requires_signal,
                requires_state: action.requires_state,
                timeout_seconds: action.timeout_seconds,
                source: "static-topology".into(),
            },
        );
    }
    Ok(())
}

fn failed_configuration(detail: String, collected_at: i64) -> CollectorStatus {
    CollectorStatus {
        id: "collector-configuration".into(),
        name: "Collector configuration".into(),
        kind: "configuration".into(),
        node_id: None,
        state: "err".into(),
        detail: Some(detail),
        collected_at,
        duration_ms: 0,
    }
}

fn valid_service(service: &str) -> bool {
    !service.is_empty()
        && service
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "_.@-".contains(ch))
}

fn collect_nodes(raw: &Value) -> BTreeMap<String, Value> {
    if let Some(nodes) = raw.get("nodes").and_then(Value::as_object) {
        return nodes
            .iter()
            .map(|(id, node)| {
                let mut node = node.clone();
                normalize_node(id, &mut node);
                (id.clone(), node)
            })
            .collect();
    }
    let mut nodes = BTreeMap::new();
    if let Some(servers) = raw.get("servers").and_then(Value::as_array) {
        for (index, server) in servers.iter().enumerate() {
            let base = server
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty())
                .map(String::from)
                .unwrap_or_else(|| format!("server-{}", index + 1));
            let id = unique_id(&nodes, base);
            let mut node = json!({
                "id": id, "kind": "server",
                "title": server.get("name").and_then(Value::as_str).unwrap_or("server"),
                "subtitle": server.get("subtitle").and_then(Value::as_str).unwrap_or(""),
                "x": server.get("x").cloned().unwrap_or(json!(0)),
                "y": server.get("y").cloned().unwrap_or(json!(0)),
                "w": server.get("w").cloned().unwrap_or(json!(220)),
                "h": server.get("h").cloned().unwrap_or(json!(120)),
                "parentId": server.get("group").cloned().unwrap_or(Value::Null),
                "spec": {
                    "host": server.get("host").and_then(Value::as_str).unwrap_or(""),
                    "port": server.get("port").and_then(Value::as_u64).unwrap_or(22),
                    "user": server.get("user").and_then(Value::as_str).unwrap_or("")
                }
            });
            normalize_node(&id, &mut node);
            nodes.insert(id, node);
        }
    }
    nodes
}

fn collect_edges(raw: &Value) -> BTreeMap<String, Value> {
    raw.get("edges")
        .and_then(Value::as_object)
        .map(|edges| {
            edges
                .iter()
                .map(|(id, edge)| {
                    let mut edge = edge.clone();
                    if let Some(object) = edge.as_object_mut() {
                        object.retain(|key, _| {
                            matches!(key.as_str(), "kind" | "label" | "port" | "from" | "to")
                        });
                        object.insert("id".into(), json!(id));
                        object.entry("kind").or_insert_with(|| json!("tcp"));
                        object.entry("label").or_insert_with(|| json!(""));
                    }
                    (id.clone(), edge)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_node(id: &str, node: &mut Value) {
    let Some(object) = node.as_object_mut() else {
        return;
    };
    object.retain(|key, _| {
        matches!(
            key.as_str(),
            "kind"
                | "title"
                | "subtitle"
                | "x"
                | "y"
                | "w"
                | "h"
                | "parentId"
                | "spec"
                | "health"
                | "notes"
                | "addons"
        )
    });
    object.insert("id".into(), json!(id));
    object.entry("kind").or_insert_with(|| json!("server"));
    object.entry("title").or_insert_with(|| json!(id));
    object.entry("subtitle").or_insert_with(|| json!(""));
    object.entry("x").or_insert_with(|| json!(0));
    object.entry("y").or_insert_with(|| json!(0));
    object.entry("w").or_insert_with(|| json!(220));
    object.entry("h").or_insert_with(|| json!(120));
    object.entry("parentId").or_insert(Value::Null);
    object.entry("spec").or_insert_with(|| json!({}));
    if let Some(spec) = object.get_mut("spec").and_then(Value::as_object_mut) {
        for key in ["interpreter", "local", "exec", "script", "command"] {
            spec.remove(key);
        }
    }
    object.remove("actions");
    object.remove("crons");
}

fn unique_id(nodes: &BTreeMap<String, Value>, base: String) -> String {
    if !nodes.contains_key(&base) {
        return base;
    }
    let mut suffix = 2;
    loop {
        let candidate = format!("{base}-{suffix}");
        if !nodes.contains_key(&candidate) {
            return candidate;
        }
        suffix += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graph_omits_legacy_executable_fields() {
        let graph = collect_value(
            &json!({
                "nodes": { "web": {
                    "title": "Web", "health": { "state": "ok" },
                    "actions": [{ "name": "legacy", "script": "reboot" }],
                    "crons": [{ "script": "anything" }]
                }},
                "edges": { "route": { "from": "web", "to": "web" } }
            }),
            100,
        );
        assert_eq!(graph.signals["web:health"].state, "ok");
        assert!(graph.nodes["web"].get("actions").is_none());
        assert!(graph.nodes["web"].get("crons").is_none());
        assert_eq!(graph.edges["route"]["id"], "route");
    }

    #[test]
    fn migrates_v0_with_stable_unique_ids() {
        let graph = collect_value(
            &json!({
                "servers": [{ "name": "db", "host": "db.local" }, { "name": "db" }, {}]
            }),
            100,
        );
        assert!(graph.nodes.contains_key("db"));
        assert!(graph.nodes.contains_key("db-2"));
        assert!(graph.nodes.contains_key("server-3"));
    }

    #[test]
    fn service_names_cannot_contain_shell_syntax() {
        assert!(valid_service("api.service"));
        assert!(!valid_service("api; reboot"));
    }

    #[test]
    fn projects_only_named_action_policy() {
        let raw = json!({
            "nodes": { "api": { "title": "API" } },
            "actions": [{
                "id": "restart-api", "nodeId": "api", "name": "Restart API",
                "kind": "service.restart", "service": "api.service",
                "requiresApproval": true, "timeoutSeconds": 15
            }]
        });
        let mut graph = collect_value(&raw, 100);
        project_actions(&raw, &mut graph).unwrap();
        let action = &graph.actions["restart-api"];
        assert!(action.available);
        assert!(action.requires_approval);
        assert_eq!(action.timeout_seconds, 15);
        let serialized = serde_json::to_value(action).unwrap();
        assert_eq!(serialized["target"], "api.service");
        assert!(serialized.get("script").is_none());
    }

    #[test]
    fn duplicate_collector_ids_are_reported_without_running_or_overwriting() {
        let raw = json!({
            "nodes": { "api": { "title": "API" } },
            "collectors": [
                { "id": "api-health", "nodeId": "api", "kind": "http", "url": "http://127.0.0.1" },
                { "id": "api-health", "nodeId": "api", "kind": "http", "url": "http://127.0.0.1" }
            ]
        });
        let mut graph = collect_value(&raw, 100);
        collect_signals(&raw, &mut graph);
        assert!(!graph.signals.contains_key("api-health"));
        assert!(graph.collectors.iter().any(|collector| {
            collector.id == "collector-configuration"
                && collector
                    .detail
                    .as_deref()
                    .unwrap_or_default()
                    .contains("duplicate collector id")
        }));
    }

    #[test]
    fn every_bundled_sample_builds_a_non_executable_graph() {
        let samples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/samples");
        for entry in std::fs::read_dir(samples).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("yaml") {
                continue;
            }
            let raw = config::load_raw(&path)
                .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
            let graph = collect_value(&raw, 100);
            assert!(!graph.nodes.is_empty(), "{} has no nodes", path.display());
            for node in graph.nodes.values() {
                assert!(
                    node.get("actions").is_none(),
                    "{} leaked actions",
                    path.display()
                );
                assert!(
                    node.get("crons").is_none(),
                    "{} leaked crons",
                    path.display()
                );
                assert!(
                    node.get("script").is_none(),
                    "{} leaked script",
                    path.display()
                );
            }
        }
    }
}
