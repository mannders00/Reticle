use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use crate::config::ActionResult;
use crate::{config, graph, ssh};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedAction {
    pub id: String,
    pub node_id: String,
    pub name: String,
    pub kind: String,
    pub service: String,
    #[serde(default = "default_approval")]
    pub requires_approval: bool,
    #[serde(default)]
    pub requires_signal: Option<String>,
    #[serde(default)]
    pub requires_state: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
}

fn default_timeout() -> u64 {
    20
}

fn default_approval() -> bool {
    true
}

pub fn load(path: &Path) -> Result<Vec<NamedAction>, String> {
    let raw = config::load_raw(path)?;
    parse(&raw)
}

pub fn parse(raw: &Value) -> Result<Vec<NamedAction>, String> {
    let actions: Vec<NamedAction> = serde_json::from_value(
        raw.get("actions")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new())),
    )
    .map_err(|e| format!("invalid named actions: {e}"))?;
    let mut ids = HashSet::new();
    for action in &actions {
        if !ids.insert(action.id.as_str()) {
            return Err(format!("duplicate named action id '{}'", action.id));
        }
    }
    Ok(actions)
}

pub fn run(path: &Path, action_id: &str, approved: bool) -> Result<ActionResult, String> {
    let raw = config::load_raw(path)?;
    let actions = parse(&raw)?;
    let action = actions
        .into_iter()
        .find(|action| action.id == action_id)
        .ok_or_else(|| format!("unknown named action '{action_id}'"))?;

    validate(&action)?;
    if action.requires_approval && !approved {
        return Err("action requires explicit approval".into());
    }

    if let Some(signal_id) = &action.requires_signal {
        let snapshot = graph::collect_yaml(path)?;
        let signal = snapshot
            .signals
            .get(signal_id)
            .ok_or_else(|| format!("required signal '{signal_id}' is unavailable"))?;
        let expected = action.requires_state.as_deref().unwrap_or("err");
        if signal.state != expected {
            return Err(format!(
                "precondition failed: signal '{signal_id}' is '{}', expected '{expected}'",
                signal.state
            ));
        }
    }

    let node = raw
        .get("nodes")
        .and_then(Value::as_object)
        .and_then(|nodes| nodes.get(&action.node_id))
        .ok_or_else(|| format!("action node '{}' does not exist", action.node_id))?;
    let spec = node.get("spec").and_then(Value::as_object);
    let host = spec
        .and_then(|spec| spec.get("host"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let port = spec
        .and_then(|spec| spec.get("port"))
        .and_then(Value::as_u64)
        .unwrap_or(22) as u16;
    let user = spec
        .and_then(|spec| spec.get("user"))
        .and_then(Value::as_str)
        .unwrap_or("");

    let verb = match action.kind.as_str() {
        "service.restart" => "restart",
        "service.reload" => "reload",
        _ => return Err(format!("unsupported named action kind '{}'", action.kind)),
    };
    let command = vec!["systemctl".into(), verb.into(), "--".into(), action.service];
    ssh::run_fixed_command(
        host,
        port,
        user,
        &command,
        Duration::from_secs(action.timeout_seconds),
    )
}

pub fn validate(action: &NamedAction) -> Result<(), String> {
    if action.id.trim().is_empty() || action.name.trim().is_empty() {
        return Err("named actions require id and name".into());
    }
    if !matches!(action.kind.as_str(), "service.restart" | "service.reload") {
        return Err(format!("unsupported named action kind '{}'", action.kind));
    }
    if action.service.is_empty()
        || !action
            .service
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "_.@-".contains(ch))
    {
        return Err("service must contain only letters, numbers, _, ., @, or -".into());
    }
    if !(1..=120).contains(&action.timeout_seconds) {
        return Err("action timeout must be between 1 and 120 seconds".into());
    }
    if action.requires_signal.is_none() && action.requires_state.is_some() {
        return Err("requiresState needs requiresSignal".into());
    }
    if let Some(state) = action.requires_state.as_deref() {
        if !matches!(state, "unknown" | "ok" | "warn" | "err") {
            return Err("requiresState must be unknown, ok, warn, or err".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_shell_metacharacters_in_service_names() {
        let action = NamedAction {
            id: "restart-api".into(),
            node_id: "api".into(),
            name: "Restart API".into(),
            kind: "service.restart".into(),
            service: "api; reboot".into(),
            requires_approval: true,
            requires_signal: None,
            requires_state: None,
            timeout_seconds: 20,
        };
        assert!(validate(&action).is_err());
    }

    #[test]
    fn policy_defaults_require_approval_and_use_a_bounded_timeout() {
        let actions = parse(&serde_json::json!({
            "actions": [{
                "id": "reload-api", "nodeId": "api", "name": "Reload API",
                "kind": "service.reload", "service": "api.service"
            }]
        }))
        .unwrap();
        assert!(actions[0].requires_approval);
        assert_eq!(actions[0].timeout_seconds, 20);
        assert!(validate(&actions[0]).is_ok());
    }

    #[test]
    fn duplicate_action_ids_are_rejected() {
        let result = parse(&serde_json::json!({
            "actions": [
                { "id": "restart", "nodeId": "a", "name": "A", "kind": "service.restart", "service": "a" },
                { "id": "restart", "nodeId": "b", "name": "B", "kind": "service.restart", "service": "b" }
            ]
        }));
        assert!(result.unwrap_err().contains("duplicate named action id"));
    }
}
