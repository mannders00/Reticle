use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{actions, config};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectorDefinition {
    pub id: String,
    pub node_id: String,
    #[serde(default)]
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub jq: String,
    #[serde(default)]
    pub probe: String,
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub command: String,
    pub enabled: bool,
    #[serde(default)]
    pub publish_output: bool,
    #[serde(default = "default_collector_timeout")]
    pub timeout_seconds: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCollectorDefinition {
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
    #[serde(default)]
    command: String,
    enabled: Option<bool>,
    #[serde(default)]
    publish_output: bool,
    #[serde(default = "default_collector_timeout")]
    timeout_seconds: u64,
}

fn default_collector_timeout() -> u64 {
    10
}

impl From<RawCollectorDefinition> for CollectorDefinition {
    fn from(raw: RawCollectorDefinition) -> Self {
        let custom = is_custom_check(&raw.kind, &raw.probe);
        Self {
            id: raw.id,
            node_id: raw.node_id,
            name: raw.name,
            kind: raw.kind,
            url: raw.url,
            status: raw.status,
            jq: raw.jq,
            probe: raw.probe,
            service: raw.service,
            command: raw.command,
            enabled: raw.enabled.unwrap_or(!custom),
            publish_output: raw.publish_output,
            timeout_seconds: raw.timeout_seconds,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditableOperations {
    pub base_revision: Option<u64>,
    pub custom_checks_enabled: bool,
    pub local_checks_enabled: bool,
    pub collectors: Vec<CollectorDefinition>,
    pub actions: Vec<actions::NamedAction>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationsInput {
    pub collectors: Vec<Value>,
    pub actions: Vec<Value>,
}

pub fn parse_collectors(raw: &Value) -> Result<Vec<CollectorDefinition>, String> {
    let values: Vec<RawCollectorDefinition> = serde_json::from_value(
        raw.get("collectors")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new())),
    )
    .map_err(|error| format!("invalid collectors: {error}"))?;
    Ok(values.into_iter().map(Into::into).collect())
}

pub fn editable(
    path: &Path,
    base_revision: Option<u64>,
    custom_checks_enabled: bool,
) -> Result<EditableOperations, String> {
    let raw = config::load_raw(path)?;
    let collectors = parse_collectors(&raw)?;
    let actions = actions::parse(&raw)?;
    Ok(EditableOperations {
        base_revision,
        custom_checks_enabled,
        local_checks_enabled: cfg!(unix),
        collectors,
        actions,
    })
}

pub fn validate_document(raw: &Value, custom_checks_enabled: bool) -> Result<(), String> {
    let collectors = parse_collectors(raw)?;
    let actions = actions::parse(raw)?;
    validate(raw, &collectors, &actions, custom_checks_enabled)
}

pub fn validate(
    raw: &Value,
    collectors: &[CollectorDefinition],
    actions: &[actions::NamedAction],
    custom_checks_enabled: bool,
) -> Result<(), String> {
    validate_collectors(raw, collectors, custom_checks_enabled)?;
    validate_actions(raw, collectors, actions, custom_checks_enabled)
}

pub fn validate_collectors(
    raw: &Value,
    collectors: &[CollectorDefinition],
    custom_checks_enabled: bool,
) -> Result<(), String> {
    if collectors.len() > 256 {
        return Err("configuration exceeds the 256 collector limit".into());
    }
    let nodes = raw
        .get("nodes")
        .and_then(Value::as_object)
        .ok_or("config nodes must be an object")?;
    let mut collector_ids = HashSet::new();
    for collector in collectors {
        if collector.id.trim().is_empty() || !collector_ids.insert(collector.id.as_str()) {
            return Err(format!(
                "duplicate collector id '{}' or empty id",
                collector.id
            ));
        }
        if !nodes.contains_key(&collector.node_id) {
            return Err(format!(
                "collector '{}' references a missing node",
                collector.id
            ));
        }
        if !(1..=120).contains(&collector.timeout_seconds) {
            return Err(format!(
                "collector '{}' timeout must be between 1 and 120 seconds",
                collector.id
            ));
        }
        match collector.kind.as_str() {
            "http" => validate_http(collector)?,
            "ssh" => validate_ssh(collector, custom_checks_enabled)?,
            "local" => validate_local(collector, custom_checks_enabled)?,
            _ => {
                return Err(format!(
                    "collector '{}' kind must be http, ssh, or local",
                    collector.id
                ))
            }
        }
    }
    Ok(())
}

fn validate_actions(
    raw: &Value,
    collectors: &[CollectorDefinition],
    actions: &[actions::NamedAction],
    custom_checks_enabled: bool,
) -> Result<(), String> {
    if actions.len() > 128 {
        return Err("configuration exceeds the 128 named action limit".into());
    }
    let nodes = raw
        .get("nodes")
        .and_then(Value::as_object)
        .ok_or("config nodes must be an object")?;
    let collector_ids = collectors
        .iter()
        .map(|collector| collector.id.as_str())
        .collect::<HashSet<_>>();
    let mut action_ids = HashSet::new();
    for action in actions {
        if !custom_checks_enabled {
            return Err("custom command actions are disabled by server policy".into());
        }
        if !action_ids.insert(action.id.as_str()) {
            return Err(format!("duplicate named action id '{}'", action.id));
        }
        actions::validate(action)?;
        if !nodes.contains_key(&action.node_id) {
            return Err(format!("action '{}' references a missing node", action.id));
        }
        actions::validate_target(raw, action)?;
        if let Some(signal) = action.requires_signal.as_deref() {
            if !collector_ids.contains(signal) {
                return Err(format!(
                    "action '{}' references missing signal '{}'",
                    action.id, signal
                ));
            }
        }
    }
    Ok(())
}

fn validate_http(collector: &CollectorDefinition) -> Result<(), String> {
    let url = reqwest::Url::parse(&collector.url)
        .map_err(|_| format!("collector '{}' has an invalid URL", collector.id))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(format!(
            "collector '{}' URL must use http or https",
            collector.id
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(format!(
            "collector '{}' URL must not contain credentials",
            collector.id
        ));
    }
    if !valid_status(&collector.status) {
        return Err(format!(
            "collector '{}' has an invalid status expression",
            collector.id
        ));
    }
    Ok(())
}

fn valid_status(status: &str) -> bool {
    let status = status.trim();
    status.is_empty()
        || status.split(',').all(|part| {
            let part = part.trim();
            if part.len() == 3
                && matches!(part.as_bytes()[0], b'1'..=b'5')
                && part[1..].eq_ignore_ascii_case("xx")
            {
                return true;
            }
            if let Some((low, high)) = part.split_once('-') {
                let low = low
                    .trim()
                    .parse::<u16>()
                    .ok()
                    .filter(|n| (100..=599).contains(n));
                let high = high
                    .trim()
                    .parse::<u16>()
                    .ok()
                    .filter(|n| (100..=599).contains(n));
                return low.zip(high).is_some_and(|(low, high)| low <= high);
            }
            part.parse::<u16>().is_ok_and(|n| (100..=599).contains(&n))
        })
}

fn validate_ssh(
    collector: &CollectorDefinition,
    custom_checks_enabled: bool,
) -> Result<(), String> {
    match collector.probe.as_str() {
        "host.uptime" => Ok(()),
        "service.status" if valid_service(&collector.service) => Ok(()),
        "service.status" => Err(format!(
            "collector '{}' has an invalid service",
            collector.id
        )),
        "ssh.command" => validate_custom_command(collector, custom_checks_enabled, false),
        _ => Err(format!(
            "collector '{}' has an invalid SSH probe",
            collector.id
        )),
    }
}

fn validate_local(
    collector: &CollectorDefinition,
    custom_checks_enabled: bool,
) -> Result<(), String> {
    if collector.probe != "shell.command" {
        return Err(format!(
            "collector '{}' has an invalid local probe",
            collector.id
        ));
    }
    if collector.enabled && !cfg!(unix) {
        return Err("local Bash checks are supported only on Unix hosts".into());
    }
    validate_custom_command(collector, custom_checks_enabled, true)
}

fn validate_custom_command(
    collector: &CollectorDefinition,
    custom_checks_enabled: bool,
    multiline: bool,
) -> Result<(), String> {
    if collector.enabled && !custom_checks_enabled {
        return Err("custom command checks are disabled by server policy".into());
    }
    if collector.command.len() > 2048 {
        return Err(format!(
            "collector '{}' command exceeds 2048 bytes",
            collector.id
        ));
    }
    if collector.command.contains('\0') || (!multiline && collector.command.contains(['\r', '\n']))
    {
        let requirement = if multiline {
            "must not contain NUL"
        } else {
            "must be one line without NUL"
        };
        return Err(format!(
            "collector '{}' command {requirement}",
            collector.id
        ));
    }
    if collector.enabled && collector.command.trim().is_empty() {
        return Err(format!(
            "collector '{}' enabled command is empty",
            collector.id
        ));
    }
    Ok(())
}

fn is_custom_check(kind: &str, probe: &str) -> bool {
    matches!(
        (kind, probe),
        ("ssh", "ssh.command") | ("local", "shell.command")
    )
}

pub fn valid_service(service: &str) -> bool {
    !service.is_empty()
        && service
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "_.@-".contains(ch))
}

pub fn save(
    path: &Path,
    input: &OperationsInput,
    custom_checks_enabled: bool,
) -> Result<(), String> {
    let mut document = config::load_raw(path)?;
    let object = document
        .as_object_mut()
        .ok_or_else(|| "config root must be an object".to_string())?;
    object.insert("collectors".into(), Value::Array(input.collectors.clone()));
    object.insert("actions".into(), Value::Array(input.actions.clone()));
    validate_document(&document, custom_checks_enabled)?;
    config::save_raw(path, &document)
}

pub fn change_summary(input: &OperationsInput) -> Value {
    let ids = |items: &[Value]| {
        items
            .iter()
            .filter_map(|item| item.get("id").and_then(Value::as_str))
            .map(String::from)
            .collect::<Vec<_>>()
    };
    json!({
        "categories": ["collectors", "actions"],
        "collectorCount": input.collectors.len(),
        "collectorIds": ids(&input.collectors),
        "actionCount": input.actions.len(),
        "actionIds": ids(&input.actions),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(collectors: Value, actions: Value) -> Value {
        json!({
            "nodes": { "api": { "spec": { "host": "api.internal", "user": "probe" } } },
            "collectors": collectors,
            "actions": actions
        })
    }

    #[test]
    fn custom_checks_default_disabled_and_fixed_checks_default_enabled() {
        let collectors = parse_collectors(&document(
            json!([
                { "id": "custom", "nodeId": "api", "kind": "ssh", "probe": "ssh.command" },
                { "id": "local", "nodeId": "api", "kind": "local", "probe": "shell.command" },
                { "id": "uptime", "nodeId": "api", "kind": "ssh", "probe": "host.uptime" }
            ]),
            json!([]),
        ))
        .unwrap();
        assert!(!collectors[0].enabled);
        assert!(!collectors[1].enabled);
        assert!(collectors[2].enabled);
    }

    #[cfg(not(unix))]
    #[test]
    fn local_check_capability_and_execution_are_disabled_off_unix() {
        let raw = document(
            json!([{
                "id": "local", "nodeId": "api", "kind": "local",
                "probe": "shell.command", "command": "true", "enabled": true
            }]),
            json!([]),
        );
        assert!(validate_document(&raw, true).unwrap_err().contains("Unix"));
    }

    #[test]
    fn validates_custom_policy_and_preserves_shell_syntax() {
        let raw = document(
            json!([{
                "id": "custom", "nodeId": "api", "kind": "ssh", "probe": "ssh.command",
                "command": "journalctl -n 1 | grep ready", "enabled": true
            }]),
            json!([]),
        );
        assert!(validate_document(&raw, false)
            .unwrap_err()
            .contains("disabled by server policy"));
        validate_document(&raw, true).unwrap();

        let local = document(
            json!([{
                "id": "local", "nodeId": "api", "kind": "local", "probe": "shell.command",
                "command": "curl -fsS http://127.0.0.1 |\njq -e .ok", "enabled": true
            }]),
            json!([]),
        );
        assert!(validate_document(&local, false)
            .unwrap_err()
            .contains("disabled by server policy"));
        validate_document(&local, true).unwrap();
    }

    #[test]
    fn disabled_policy_still_allows_editors_to_load_and_repair_definitions() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("reticle-operations-repair-{unique}.yaml"));
        std::fs::write(
            &path,
            "nodes:\n  api:\n    spec: {}\ncollectors:\n  - id: custom\n    nodeId: api\n    kind: ssh\n    probe: ssh.command\n    command: uptime\n    enabled: true\nactions: []\n",
        )
        .unwrap();
        let loaded = editable(&path, Some(4), false).unwrap();
        assert!(!loaded.custom_checks_enabled);
        assert_eq!(loaded.local_checks_enabled, cfg!(unix));
        assert!(loaded.collectors[0].enabled);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_duplicate_and_dangling_references() {
        let duplicate = document(
            json!([
                { "id": "same", "nodeId": "api", "kind": "ssh", "probe": "host.uptime" },
                { "id": "same", "nodeId": "api", "kind": "ssh", "probe": "host.uptime" }
            ]),
            json!([]),
        );
        assert!(validate_document(&duplicate, true).is_err());
        let dangling = document(
            json!([]),
            json!([{
                "id": "diagnose", "nodeId": "api", "name": "Diagnose", "kind": "ssh.command",
                "command": "true", "requiresSignal": "missing"
            }]),
        );
        assert!(validate_document(&dangling, true)
            .unwrap_err()
            .contains("missing signal"));
    }

    #[test]
    fn operations_save_preserves_unknown_root_fields() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("reticle-operations-{unique}.yaml"));
        std::fs::write(
            &path,
            "nodes:\n  api:\n    title: API\nextension:\n  owner: platform\ncollectors: []\nactions: []\n",
        )
        .unwrap();
        let input = OperationsInput {
            collectors: vec![json!({
                "id": "uptime", "nodeId": "api", "kind": "ssh", "probe": "host.uptime"
            })],
            actions: vec![],
        };
        save(&path, &input, true).unwrap();
        let saved = config::load_raw(&path).unwrap();
        assert_eq!(saved["extension"]["owner"], "platform");
        assert_eq!(saved["collectors"][0]["id"], "uptime");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn new_custom_checks_can_be_created_enabled_when_policy_allows() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("reticle-operations-gate-{unique}.yaml"));
        std::fs::write(
            &path,
            "nodes:\n  api: { spec: {} }\ncollectors: []\nactions: []\n",
        )
        .unwrap();
        let enabled = OperationsInput {
            collectors: vec![json!({
                "id": "custom", "nodeId": "api", "kind": "local",
                "probe": "shell.command", "command": "true", "enabled": true
            })],
            actions: vec![],
        };
        save(&path, &enabled, true).unwrap();
        let saved = config::load_raw(&path).unwrap();
        assert_eq!(saved["collectors"][0]["enabled"], json!(true));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn audit_summary_never_contains_commands_or_urls() {
        let input = OperationsInput {
            collectors: vec![json!({
                "id": "secret-check", "nodeId": "api", "kind": "ssh",
                "probe": "ssh.command", "command": "printf super-secret",
                "url": "https://example.test/?token=secret"
            })],
            actions: vec![json!({
                "id": "secret-action", "nodeId": "api", "name": "Secret action",
                "kind": "shell.command", "command": "printf action-secret"
            })],
        };
        let summary = change_summary(&input).to_string();
        assert!(summary.contains("secret-check"));
        assert!(!summary.contains("super-secret"));
        assert!(!summary.contains("token=secret"));
        assert!(!summary.contains("action-secret"));
    }
}
