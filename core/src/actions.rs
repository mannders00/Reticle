use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::ActionResult;
use crate::{config, graph, local, ssh};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedAction {
    pub id: String,
    pub node_id: String,
    pub name: String,
    pub kind: String,
    pub command: String,
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
    run_with_custom_checks(path, action_id, approved, false)
}

pub fn run_with_custom_checks(
    path: &Path,
    action_id: &str,
    approved: bool,
    custom_checks_enabled: bool,
) -> Result<ActionResult, String> {
    let raw = config::load_raw(path)?;
    run_snapshot_with_custom_checks(raw, action_id, approved, custom_checks_enabled)
}

pub fn run_snapshot_with_custom_checks(
    raw: Value,
    action_id: &str,
    approved: bool,
    custom_checks_enabled: bool,
) -> Result<ActionResult, String> {
    let actions = parse(&raw)?;
    let action = actions
        .into_iter()
        .find(|action| action.id == action_id)
        .ok_or_else(|| format!("unknown named action '{action_id}'"))?;

    if !custom_checks_enabled {
        return Err("custom command actions are disabled by server policy".into());
    }
    validate(&action)?;
    if action.requires_approval && !approved {
        return Err("action requires explicit approval".into());
    }

    if let Some(signal_id) = &action.requires_signal {
        let signal = graph::collect_signal(&raw, signal_id, custom_checks_enabled)?
            .ok_or_else(|| format!("required signal '{signal_id}' is unavailable"))?;
        let expected = action.requires_state.as_deref().unwrap_or("err");
        if signal.state != expected {
            return Err(format!(
                "precondition failed: signal '{signal_id}' is '{}', expected '{expected}'",
                signal.state
            ));
        }
    }

    let timeout = Duration::from_secs(action.timeout_seconds);
    match action.kind.as_str() {
        "ssh.command" => {
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
            ssh::run_persisted_command(host, port, user, &action.command, timeout)
        }
        "shell.command" => local::run_persisted_command(&action.command, timeout),
        _ => unreachable!("named action validation runs before execution"),
    }
}

pub fn validate(action: &NamedAction) -> Result<(), String> {
    if action.id.trim().is_empty() || action.name.trim().is_empty() {
        return Err("named actions require id and name".into());
    }
    if !matches!(action.kind.as_str(), "ssh.command" | "shell.command") {
        return Err(format!("unsupported named action kind '{}'", action.kind));
    }
    if action.command.trim().is_empty() {
        return Err("named action command is required".into());
    }
    if action.command.len() > 2048 {
        return Err("named action command exceeds 2048 bytes".into());
    }
    if action.command.contains('\0') {
        return Err("named action command must not contain NUL".into());
    }
    if action.kind == "shell.command" && !cfg!(unix) {
        return Err("system-shell actions are supported only on Unix hosts".into());
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

pub fn validate_target(raw: &Value, action: &NamedAction) -> Result<(), String> {
    if action.kind != "ssh.command" {
        return Ok(());
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
    let user = spec
        .and_then(|spec| spec.get("user"))
        .and_then(Value::as_str)
        .unwrap_or("");
    ssh::validate_target(host, user)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_bounded_arbitrary_commands() {
        let action = NamedAction {
            id: "diagnose-api".into(),
            node_id: "api".into(),
            name: "Diagnose API".into(),
            kind: "ssh.command".into(),
            command: "curl -fsS http://127.0.0.1 | jq -e .ok".into(),
            requires_approval: true,
            requires_signal: None,
            requires_state: None,
            timeout_seconds: 20,
        };
        assert!(validate(&action).is_ok());
    }

    #[test]
    fn policy_defaults_require_approval_and_use_a_bounded_timeout() {
        let actions = parse(&serde_json::json!({
            "actions": [{
                "id": "diagnose-api", "nodeId": "api", "name": "Diagnose API",
                "kind": "ssh.command", "command": "curl -fsS http://127.0.0.1"
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
                { "id": "diagnose", "nodeId": "a", "name": "A", "kind": "ssh.command", "command": "true" },
                { "id": "diagnose", "nodeId": "b", "name": "B", "kind": "ssh.command", "command": "true" }
            ]
        }));
        assert!(result.unwrap_err().contains("duplicate named action id"));
    }

    #[cfg(not(unix))]
    #[test]
    fn local_shell_actions_are_rejected_off_unix() {
        let action = NamedAction {
            id: "local".into(),
            node_id: "api".into(),
            name: "Local".into(),
            kind: "shell.command".into(),
            command: "true".into(),
            requires_approval: true,
            requires_signal: None,
            requires_state: None,
            timeout_seconds: 20,
        };
        assert!(validate(&action).unwrap_err().contains("Unix"));
    }

    #[cfg(unix)]
    #[test]
    fn local_named_actions_require_policy_and_approval_then_return_exit_status() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("reticle-action-{unique}.yaml"));
        std::fs::write(
            &path,
            "nodes:\n  api:\n    spec: {}\nactions:\n  - id: inspect\n    nodeId: api\n    name: Inspect\n    kind: shell.command\n    command: printf action-ok\n    requiresApproval: true\n    timeoutSeconds: 2\n",
        )
        .unwrap();

        assert!(run_with_custom_checks(&path, "inspect", true, false)
            .unwrap_err()
            .contains("disabled by server policy"));
        assert!(run_with_custom_checks(&path, "inspect", false, true)
            .unwrap_err()
            .contains("explicit approval"));
        let result = run_with_custom_checks(&path, "inspect", true, true).unwrap();
        assert!(result.success);
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.stdout, "action-ok");
        let _ = std::fs::remove_file(path);
    }
}
