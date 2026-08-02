use std::collections::BTreeMap;
use std::path::Path;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::operations::CollectorDefinition;
use crate::{actions, config, health, local, operations, ssh};

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

/// Collect static topology, then execute configured HTTP, SSH, and local probes.
/// The graph response never contains executable command text.
pub fn collect_yaml(path: &Path) -> Result<OperationalGraph, String> {
    collect_yaml_with_custom_checks(path, false)
}

pub fn collect_yaml_with_custom_checks(
    path: &Path,
    custom_checks_enabled: bool,
) -> Result<OperationalGraph, String> {
    let raw = config::load_raw(path)?;
    let collected_at = config::now_timestamp();
    let mut graph = collect_value(&raw, collected_at);
    collect_signals(&raw, &mut graph, custom_checks_enabled);
    project_actions(&raw, &mut graph, custom_checks_enabled);
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
                    state: match health
                        .get("state")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                    {
                        "ok" => "ok",
                        "warn" => "warn",
                        "err" => "err",
                        _ => "unknown",
                    }
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

fn collect_signals(raw: &Value, graph: &mut OperationalGraph, custom_checks_enabled: bool) {
    let mut definitions = match operations::parse_collectors(raw) {
        Ok(value) => value,
        Err(error) => {
            graph
                .collectors
                .push(failed_configuration(error, graph.generated_at));
            return;
        }
    };
    if !custom_checks_enabled {
        for definition in &mut definitions {
            if matches!(
                (definition.kind.as_str(), definition.probe.as_str()),
                ("ssh", "ssh.command") | ("local", "shell.command")
            ) {
                definition.enabled = false;
            }
        }
    }
    if let Err(error) = operations::validate_collectors(raw, &definitions, custom_checks_enabled) {
        graph
            .collectors
            .push(failed_configuration(error, graph.generated_at));
        return;
    }

    let collection_started = Instant::now();
    let collection_budget = Duration::from_secs(120);
    for definition in definitions {
        let name = if definition.name.trim().is_empty() {
            definition.id.clone()
        } else {
            definition.name.clone()
        };
        if !definition.enabled {
            graph.collectors.push(CollectorStatus {
                id: definition.id,
                name,
                kind: definition.kind,
                node_id: Some(definition.node_id),
                state: "disabled".into(),
                detail: None,
                collected_at: graph.generated_at,
                duration_ms: 0,
            });
            continue;
        }
        let remaining = collection_budget.saturating_sub(collection_started.elapsed());
        if remaining.is_zero() {
            graph.collectors.push(failed_configuration(
                "collector execution budget exhausted".into(),
                graph.generated_at,
            ));
            break;
        }
        let mut effective_definition = definition.clone();
        effective_definition.timeout_seconds = effective_definition
            .timeout_seconds
            .min(remaining.as_secs().max(1));
        let started = Instant::now();
        let result = run_collector(raw, &effective_definition);
        let (state, detail) = match result {
            Ok(detail) => ("ok", detail),
            Err(detail) => ("err", detail),
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
            if definition.probe == "ssh.command" {
                let result = ssh::run_persisted_command(
                    host,
                    port,
                    user,
                    &definition.command,
                    Duration::from_secs(definition.timeout_seconds),
                )?;
                let detail = custom_command_detail(&result, definition.publish_output);
                return if result.success {
                    Ok(detail)
                } else {
                    Err(detail)
                };
            }
            let command = match definition.probe.as_str() {
                "host.uptime" => vec!["uptime".into()],
                "service.status" if operations::valid_service(&definition.service) => vec![
                    "systemctl".into(),
                    "is-active".into(),
                    "--".into(),
                    definition.service.clone(),
                ],
                _ => unreachable!("collector validation runs before execution"),
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
        "local" => {
            let result = local::run_persisted_command(
                &definition.command,
                Duration::from_secs(definition.timeout_seconds),
            )?;
            let detail = custom_command_detail(&result, definition.publish_output);
            if result.success {
                Ok(detail)
            } else {
                Err(detail)
            }
        }
        _ => Err("collector kind must be http, ssh, or local".into()),
    }
}

pub fn collect_signal(
    raw: &Value,
    signal_id: &str,
    custom_checks_enabled: bool,
) -> Result<Option<Signal>, String> {
    let definitions = operations::parse_collectors(raw)?;
    operations::validate_collectors(raw, &definitions, custom_checks_enabled)?;
    let Some(definition) = definitions.into_iter().find(|item| item.id == signal_id) else {
        return Ok(None);
    };
    if !definition.enabled {
        return Ok(None);
    }
    let observed_at = config::now_timestamp();
    let name = if definition.name.trim().is_empty() {
        definition.id.clone()
    } else {
        definition.name.clone()
    };
    let (state, detail) = match run_collector(raw, &definition) {
        Ok(detail) => ("ok", detail),
        Err(detail) => ("err", detail),
    };
    Ok(Some(Signal {
        id: definition.id.clone(),
        node_id: definition.node_id,
        name,
        state: state.into(),
        observed_at: Some(observed_at),
        detail: Some(json!(detail)),
        source: definition.id,
    }))
}

fn project_actions(raw: &Value, graph: &mut OperationalGraph, custom_checks_enabled: bool) {
    let definitions = match actions::parse(raw) {
        Ok(actions) => actions,
        Err(error) => {
            graph.collectors.push(CollectorStatus {
                id: "action-configuration".into(),
                name: "Action configuration".into(),
                kind: "configuration".into(),
                node_id: None,
                state: "err".into(),
                detail: Some(error),
                collected_at: graph.generated_at,
                duration_ms: 0,
            });
            return;
        }
    };
    for action in definitions {
        let target = if action.kind == "ssh.command" {
            "SSH"
        } else {
            "Reticle host"
        };
        let unavailable_reason = (!custom_checks_enabled)
            .then(|| "custom command actions are disabled by server policy".into())
            .or_else(|| actions::validate(&action).err())
            .or_else(|| actions::validate_target(raw, &action).err())
            .or_else(|| {
                (!graph.nodes.contains_key(&action.node_id)).then(|| "node does not exist".into())
            })
            .or_else(|| {
                let signal_id = action.requires_signal.as_deref()?;
                let signal = graph.signals.get(signal_id)?;
                let expected = action.requires_state.as_deref().unwrap_or("err");
                (signal.state != expected).then(|| {
                    format!(
                        "required signal is '{}', expected '{expected}'",
                        signal.state
                    )
                })
            })
            .or_else(|| {
                action.requires_signal.as_ref().and_then(|signal_id| {
                    (!graph.signals.contains_key(signal_id))
                        .then(|| format!("required signal '{signal_id}' is unavailable"))
                })
            });
        graph.actions.insert(
            action.id.clone(),
            ActionDescriptor {
                id: action.id,
                node_id: action.node_id,
                name: action.name,
                kind: action.kind,
                target: target.into(),
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

fn custom_command_detail(result: &config::ActionResult, publish_output: bool) -> String {
    if !publish_output {
        return format!("exit {}", result.exit_code);
    }
    let detail = if result.success || result.stderr.trim().is_empty() {
        result.stdout.trim()
    } else {
        result.stderr.trim()
    };
    truncate_bytes(detail, 4096)
}

fn truncate_bytes(value: &str, max: usize) -> String {
    if value.len() <= max {
        return value.to_string();
    }
    let mut end = max;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_string()
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
        spec.retain(|key, value| {
            matches!(
                key.as_str(),
                "host"
                    | "port"
                    | "user"
                    | "kubeContext"
                    | "namespace"
                    | "name"
                    | "pod"
                    | "container"
                    | "selector"
            ) && !value.is_object()
                && !value.is_array()
        });
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
                    "spec": { "host": "web.internal", "token": "graph-secret", "environment": { "KEY": "secret" } },
                    "actions": [{ "name": "legacy", "script": "reboot" }],
                    "crons": [{ "script": "anything" }]
                }},
                "edges": { "route": { "from": "web", "to": "web" } }
            }),
            100,
        );
        assert_eq!(graph.signals["web:health"].state, "ok");
        assert_eq!(graph.nodes["web"]["spec"]["host"], "web.internal");
        assert!(graph.nodes["web"]["spec"].get("token").is_none());
        assert!(graph.nodes["web"]["spec"].get("environment").is_none());
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
        assert!(operations::valid_service("api.service"));
        assert!(!operations::valid_service("api; reboot"));
    }

    #[test]
    fn projects_only_named_action_policy() {
        let raw = json!({
            "nodes": { "api": { "title": "API", "spec": { "host": "api.internal", "user": "probe" } } },
            "actions": [{
                "id": "diagnose-api", "nodeId": "api", "name": "Diagnose API",
                "kind": "ssh.command", "command": "curl -fsS http://127.0.0.1",
                "requiresApproval": true, "timeoutSeconds": 15
            }]
        });
        let mut graph = collect_value(&raw, 100);
        project_actions(&raw, &mut graph, true);
        let action = &graph.actions["diagnose-api"];
        assert!(action.available);
        assert!(action.requires_approval);
        assert_eq!(action.timeout_seconds, 15);
        let serialized = serde_json::to_value(action).unwrap();
        assert_eq!(serialized["target"], "SSH");
        assert!(serialized.get("script").is_none());
        assert!(serialized.get("command").is_none());
    }

    #[test]
    fn action_is_unavailable_when_its_required_collector_is_disabled() {
        let raw = json!({
            "nodes": { "api": { "title": "API", "spec": {} } },
            "collectors": [{
                "id": "api-check", "nodeId": "api", "kind": "local",
                "probe": "shell.command", "command": "true", "enabled": false
            }],
            "actions": [{
                "id": "diagnose-api", "nodeId": "api", "name": "Diagnose API",
                "kind": "shell.command", "command": "true",
                "requiresSignal": "api-check", "requiresState": "err"
            }]
        });
        let mut graph = collect_value(&raw, 100);
        collect_signals(&raw, &mut graph, true);
        project_actions(&raw, &mut graph, true);
        let action = &graph.actions["diagnose-api"];
        assert!(!action.available);
        assert_eq!(
            action.unavailable_reason.as_deref(),
            Some("required signal 'api-check' is unavailable")
        );
    }

    #[test]
    fn command_policy_does_not_disable_fixed_collectors() {
        let raw = json!({
            "nodes": { "api": { "title": "API", "spec": {} } },
            "collectors": [{
                "id": "uptime", "nodeId": "api", "kind": "ssh", "probe": "host.uptime"
            }, {
                "id": "custom", "nodeId": "api", "kind": "local",
                "probe": "shell.command", "command": "false", "enabled": true
            }],
            "actions": [{
                "id": "diagnose", "nodeId": "api", "name": "Diagnose",
                "kind": "shell.command", "command": "true"
            }]
        });
        let mut graph = collect_value(&raw, 100);
        collect_signals(&raw, &mut graph, false);
        project_actions(&raw, &mut graph, false);
        assert!(graph.signals.contains_key("uptime"));
        assert!(!graph.signals.contains_key("custom"));
        assert!(graph
            .collectors
            .iter()
            .any(|collector| { collector.id == "custom" && collector.state == "disabled" }));
        assert!(!graph.actions["diagnose"].available);
        assert!(graph.actions["diagnose"]
            .unavailable_reason
            .as_deref()
            .unwrap()
            .contains("disabled by server policy"));
    }

    #[test]
    fn malformed_actions_do_not_take_down_topology_or_collectors() {
        let raw = json!({
            "nodes": { "api": { "title": "API", "spec": {} } },
            "actions": [{
                "id": "legacy", "nodeId": "api", "name": "Legacy", "kind": "service.restart"
            }]
        });
        let mut graph = collect_value(&raw, 100);
        collect_signals(&raw, &mut graph, false);
        project_actions(&raw, &mut graph, false);
        assert!(graph.nodes.contains_key("api"));
        assert!(graph.actions.is_empty());
        assert!(graph.collectors.iter().any(|collector| {
            collector.id == "action-configuration" && collector.state == "err"
        }));
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
        collect_signals(&raw, &mut graph, true);
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
    fn custom_output_is_private_and_bounded() {
        let result = config::ActionResult {
            success: false,
            exit_code: 7,
            stdout: "secret".into(),
            stderr: "x".repeat(5000),
        };
        assert_eq!(custom_command_detail(&result, false), "exit 7");
        assert_eq!(custom_command_detail(&result, true).len(), 4096);
    }

    #[test]
    fn disabled_custom_collector_has_no_signal() {
        let raw = json!({
            "nodes": { "api": { "spec": {} } },
            "collectors": [{
                "id": "custom", "nodeId": "api", "kind": "ssh", "probe": "ssh.command"
            }]
        });
        let mut graph = collect_value(&raw, 100);
        collect_signals(&raw, &mut graph, true);
        assert!(!graph.signals.contains_key("custom"));
        assert_eq!(graph.collectors.last().unwrap().state, "disabled");
    }

    #[test]
    fn custom_command_text_never_appears_in_graph_responses() {
        let raw = json!({
            "nodes": { "api": { "spec": { "host": "api", "user": "probe" } } },
            "collectors": [{
                "id": "custom", "nodeId": "api", "kind": "ssh",
                "probe": "ssh.command", "command": "printf graph-secret", "enabled": false
            }],
            "actions": [{
                "id": "diagnose", "nodeId": "api", "name": "Diagnose",
                "kind": "shell.command", "command": "printf action-graph-secret"
            }]
        });
        let mut graph = collect_value(&raw, 100);
        collect_signals(&raw, &mut graph, true);
        project_actions(&raw, &mut graph, true);
        let serialized = serde_json::to_string(&graph).unwrap();
        assert!(!serialized.contains("graph-secret"));
        assert!(!serialized.contains("action-graph-secret"));
    }

    #[test]
    fn local_command_exit_code_sets_collector_status() {
        let raw = json!({
            "nodes": { "api": { "spec": {} } },
            "collectors": [{
                "id": "local", "nodeId": "api", "kind": "local",
                "probe": "shell.command", "command": "exit 7", "enabled": true
            }]
        });
        let definition = operations::parse_collectors(&raw).unwrap().remove(0);
        assert_eq!(run_collector(&raw, &definition), Err("exit 7".into()));
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
