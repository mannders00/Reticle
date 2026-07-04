// core/src/cron.rs
// Cron scheduler. Walks the config YAML on a 5s tick, runs each cron's
// script over SSH at its declared interval, persists the result, and emits
// a `cron-result` event through the shell-provided EventSink.
//
// Handles both v0 (servers array) and v1 (nodes map) config shapes. The
// v1 nodes map may contain nodes with crons; we iterate all of them.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;

use crate::config::{parse_interval, now_timestamp, CronResult, CronStatus};
use crate::events::EventSink;
use crate::ssh::run_ssh_command;

/// Per-server, per-cron latest execution result. Keyed (server, cron).
pub type CronResultsMap = Arc<Mutex<HashMap<String, HashMap<String, CronResult>>>>;

#[derive(Debug, Clone, Deserialize)]
struct CronDef {
    name: String,
    interval: String,
    #[serde(default)]
    script: String,
    /// Per-cron execution type: "ssh" | "local" | "http". Absent → the
    /// node's default target (ssh when it has host/user, local when the
    /// spec says local).
    #[serde(default)]
    exec: Option<String>,
    // http-type fields
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    jq: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct NodeDef {
    #[serde(default)]
    crons: Vec<CronDef>,
    // v0 SSH fields (used if present)
    #[serde(default)]
    host: Option<String>,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    user: Option<String>,
    // v1 spec (opaque JSON; we extract host/port/user from it)
    #[serde(default)]
    spec: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct ConfigFile {
    // v0
    #[serde(default)]
    servers: Vec<NodeDef>,
    // v1
    #[serde(default)]
    nodes: serde_json::Map<String, serde_json::Value>,
}

enum ExecTarget {
    Ssh(String, u16, String),
    Local,
}

/// Where a node's crons run: locally on the daemon/desktop host when the
/// spec says so (`local: true` or `exec: "local"` — for cloud-managed
/// nodes you can't SSH into), otherwise over SSH when a host is present.
fn exec_target(node: &NodeDef) -> Option<ExecTarget> {
    if let Some(spec) = &node.spec {
        let local = spec.get("local").and_then(|v| v.as_bool()).unwrap_or(false)
            || spec.get("exec").and_then(|v| v.as_str()) == Some("local");
        if local {
            return Some(ExecTarget::Local);
        }
        if let (Some(h), Some(u)) = (
            spec.get("host").and_then(|v| v.as_str()),
            spec.get("user").and_then(|v| v.as_str()),
        ) {
            let p = spec.get("port").and_then(|v| v.as_u64()).unwrap_or(22) as u16;
            return Some(ExecTarget::Ssh(h.to_string(), p, u.to_string()));
        }
    }
    // v0 flat fields
    if let (Some(h), Some(u)) = (node.host.as_ref(), node.user.as_ref()) {
        return Some(ExecTarget::Ssh(h.clone(), node.port.unwrap_or(22), u.clone()));
    }
    None
}

fn interp(node: &NodeDef) -> Option<String> {
    node.spec
        .as_ref()
        .and_then(|s| s.get("interpreter"))
        .and_then(|v| v.as_str())
        .map(String::from)
}

/// Cron definitions from the config joined with their latest results —
/// what the inspector's cron timeline renders. Shared by both shells'
/// `get_cron_status` commands.
pub fn status(config_path: &Path, cron_results: &CronResultsMap) -> Result<Vec<CronStatus>, String> {
    let val = crate::config::load_raw(config_path)?;
    let results = cron_results.lock().unwrap();
    let mut status = Vec::new();

    let mut push = |sname: &str, cron: &serde_json::Value| {
        let cname = cron.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let interval = cron.get("interval").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let result = results.get(sname).and_then(|m| m.get(&cname));
        status.push(CronStatus {
            server: sname.to_string(),
            name: cname,
            interval,
            last_success: result.map(|r| r.success),
            last_exit_code: result.map(|r| r.exit_code),
            last_run: result.map(|r| r.timestamp),
        });
    };

    // v0 servers array + v1 nodes map both carry cron definitions.
    if let Some(servers) = val.get("servers").and_then(|v| v.as_array()) {
        for srv in servers {
            let sname = srv.get("name").and_then(|v| v.as_str()).unwrap_or("");
            for cron in srv.get("crons").and_then(|v| v.as_array()).into_iter().flatten() {
                push(sname, cron);
            }
        }
    }
    if let Some(nodes) = val.get("nodes").and_then(|v| v.as_object()) {
        for (sname, node) in nodes {
            for cron in node.get("crons").and_then(|v| v.as_array()).into_iter().flatten() {
                push(sname, cron);
            }
        }
    }
    Ok(status)
}

pub fn scheduler(config_path: Arc<Mutex<PathBuf>>, cron_results: CronResultsMap, sink: EventSink) {
    let mut last_runs: HashMap<(String, String), Instant> = HashMap::new();

    loop {
        thread::sleep(Duration::from_secs(5));

        // Re-read the active path each tick — workspace switches retarget
        // the scheduler to the newly opened file.
        let config_path = config_path.lock().unwrap().clone();
        let content = match fs::read_to_string(&config_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let config: ConfigFile = match serde_yaml::from_str(&content) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Collect (server_name, node_def) pairs from both v0 and v1 shapes
        let mut all_nodes: Vec<(String, NodeDef)> = Vec::new();

        // v0: servers array (name comes from a `name` field or index)
        for s in &config.servers {
            // v0 Server has a `name` field; we need to parse it separately.
            // Simpler: re-deserialize the whole servers array as named.
            all_nodes.push((format!("server_{}", all_nodes.len()), s.clone()));
        }

        // v1: nodes map
        for (name, val) in &config.nodes {
            if let Ok(nd) = serde_json::from_value::<NodeDef>(val.clone()) {
                all_nodes.push((name.clone(), nd));
            }
        }

        // Also handle v0 servers with explicit name fields
        if !config.servers.is_empty() {
            // Re-parse to get names
            #[derive(Debug, Deserialize)]
            struct V0Server {
                name: String,
                #[serde(default)]
                crons: Vec<CronDef>,
                #[serde(default)]
                host: Option<String>,
                #[serde(default)]
                port: Option<u16>,
                #[serde(default)]
                user: Option<String>,
                #[serde(default)]
                spec: Option<serde_json::Value>,
            }
            #[derive(Debug, Deserialize)]
            struct V0File {
                #[serde(default)]
                servers: Vec<V0Server>,
            }
            if let Ok(v0) = serde_yaml::from_str::<V0File>(&content) {
                all_nodes.clear();
                for s in &v0.servers {
                    let nd = NodeDef {
                        crons: s.crons.clone(),
                        host: s.host.clone(),
                        port: s.port,
                        user: s.user.clone(),
                        spec: s.spec.clone(),
                    };
                    all_nodes.push((s.name.clone(), nd));
                }
                // Re-add v1 nodes if present
                for (name, val) in &config.nodes {
                    if let Ok(nd) = serde_json::from_value::<NodeDef>(val.clone()) {
                        all_nodes.push((name.clone(), nd));
                    }
                }
            }
        }

        for (server_name, node) in &all_nodes {
            // Optional: http-type crons (and explicit local/ssh overrides)
            // don't need a node-level target at all.
            let target = exec_target(node);
            let node_interp = interp(node);
            for cron in &node.crons {
                // A cron the user hasn't finished filling in isn't a failing
                // check — skip it entirely (no result, no health impact).
                // The inspector creates crons with empty url/script and the
                // scheduler would otherwise fail them within one tick.
                let incomplete = match cron.exec.as_deref() {
                    Some("http") => cron.url.as_deref().unwrap_or("").trim().is_empty(),
                    _ => cron.script.trim().is_empty(),
                };
                if incomplete {
                    continue;
                }
                let key = (server_name.clone(), cron.name.clone());
                let interval_secs = parse_interval(&cron.interval).unwrap_or(60);
                let last = last_runs
                    .entry(key.clone())
                    .or_insert_with(|| Instant::now() - Duration::from_secs(interval_secs));

                if last.elapsed() < Duration::from_secs(interval_secs) {
                    continue;
                }

                // Per-cron exec type wins over the node default.
                let ran = match cron.exec.as_deref() {
                    Some("http") => {
                        let url = cron.url.as_deref().unwrap_or("");
                        let r = crate::health::http_check(
                            url,
                            cron.status.as_deref().unwrap_or(""),
                            cron.jq.as_deref().unwrap_or(""),
                        );
                        Ok(crate::config::ActionResult {
                            success: r.ok,
                            exit_code: if r.ok { 0 } else { 1 },
                            stdout: format!("{} {}", url, r.detail),
                            stderr: String::new(),
                        })
                    }
                    Some("local") => {
                        crate::local::run_local_command(&cron.script, node_interp.as_deref())
                    }
                    Some("ssh") => match &target {
                        Some(ExecTarget::Ssh(h, p, u)) => {
                            run_ssh_command(h, *p, u, &cron.script, node_interp.as_deref())
                        }
                        _ => Err("cron wants ssh but node has no host/user".into()),
                    },
                    _ => match &target {
                        Some(ExecTarget::Ssh(h, p, u)) => {
                            run_ssh_command(h, *p, u, &cron.script, node_interp.as_deref())
                        }
                        Some(ExecTarget::Local) => {
                            crate::local::run_local_command(&cron.script, node_interp.as_deref())
                        }
                        // No target and no explicit type: nothing to run.
                        None => continue,
                    },
                };
                let result = match ran {
                    Ok(ar) => CronResult {
                        success: ar.success,
                        exit_code: ar.exit_code,
                        stdout: ar.stdout,
                        stderr: ar.stderr,
                        timestamp: now_timestamp(),
                    },
                    Err(e) => CronResult {
                        success: false,
                        exit_code: -1,
                        stdout: String::new(),
                        stderr: e,
                        timestamp: now_timestamp(),
                    },
                };

                sink(
                    "cron-result",
                    serde_json::json!({
                        "server": server_name,
                        "cron": cron.name,
                        "success": result.success,
                        "timestamp": now_timestamp(),
                    }),
                );

                {
                    let mut results = cron_results.lock().unwrap();
                    results
                        .entry(server_name.clone())
                        .or_insert_with(HashMap::new)
                        .insert(cron.name.clone(), result);
                }

                last_runs.insert(key, Instant::now());
            }
        }
    }
}