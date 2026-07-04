// core/src/terminal_win.rs
// Windows stand-in for terminal.rs. Interactive shells need forkpty
// (Unix); on Windows every session-open call returns a clear error and
// the UI keeps working — actions, crons, health, and PDF export are all
// fully functional. `list_pods` is real (plain kubectl subprocess).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::events::EventSink;

const UNSUPPORTED: &str =
    "interactive terminals aren't supported on Windows yet — actions, crons, and health checks all work";

pub struct ShellHandle {
    pub master_fd: i32,
    pub child_pid: i32,
}
pub type ShellMap = Arc<Mutex<HashMap<String, ShellHandle>>>;

#[allow(clippy::too_many_arguments)]
pub fn open(
    _sink: EventSink,
    _shells: ShellMap,
    _server_name: String,
    _host: String,
    _port: u16,
    _user: String,
    _cols: Option<u16>,
    _rows: Option<u16>,
) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

#[allow(clippy::too_many_arguments)]
pub fn open_kubectl(
    _sink: EventSink,
    _shells: ShellMap,
    _session_id: String,
    _context: Option<String>,
    _namespace: Option<String>,
    _pod: String,
    _container: Option<String>,
    _cols: Option<u16>,
    _rows: Option<u16>,
) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

pub fn write(_shells: &ShellMap, _server_name: &str, _data: &str) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

pub fn resize(_shells: &ShellMap, _server_name: &str, _cols: u16, _rows: u16) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

pub fn kill(_shells: &ShellMap, _server_name: &str) -> Result<(), String> {
    Ok(()) // nothing can be open
}

pub fn kill_all(_shells: &ShellMap) {}

/// Real implementation — kubectl is a plain subprocess, works everywhere.
pub fn list_pods(
    context: Option<String>,
    namespace: Option<String>,
    selector: Option<String>,
) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = Vec::new();
    if let Some(ctx) = &context {
        if !ctx.is_empty() {
            args.push("--context".into());
            args.push(ctx.clone());
        }
    }
    if let Some(ns) = &namespace {
        if !ns.is_empty() {
            args.push("-n".into());
            args.push(ns.clone());
        }
    }
    args.push("get".into());
    args.push("pods".into());
    if let Some(sel) = &selector {
        if !sel.is_empty() {
            args.push("-l".into());
            args.push(sel.clone());
        }
    }
    args.push("-o".into());
    args.push("jsonpath={.items[*].metadata.name}".into());

    let output = std::process::Command::new("kubectl")
        .args(&args)
        .output()
        .map_err(|e| format!("failed to run kubectl: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .map(|s| s.to_string())
        .collect())
}
