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
        Health { state: String::new(), last_check: None, detail: None }
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

fn default_kind() -> String { "server".into() }

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

fn default_edge_kind() -> String { "tcp".into() }

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

fn default_color() -> String { "#ff6600".into() }
fn default_opacity() -> f64 { 0.7 }

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
    pub servers: Vec<Node>,          // v0 compat (migrated to nodes on load)
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
        num.parse::<u64>().map_err(|e| format!("invalid seconds: {}", e))
    } else if let Some(num) = s.strip_suffix('m') {
        num.parse::<u64>().map(|n| n * 60).map_err(|e| format!("invalid minutes: {}", e))
    } else if let Some(num) = s.strip_suffix('h') {
        num.parse::<u64>().map(|n| n * 3600).map_err(|e| format!("invalid hours: {}", e))
    } else {
        s.parse::<u64>().map_err(|e| {
            format!("invalid interval '{}': expected e.g. 30s, 5m, 1h", e)
        })
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
#     actions:
#       - name: disk usage
#         script: df -h
#     crons:
#       - name: nginx alive
#         interval: 30s
#         script: systemctl is-active nginx
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
    let content = fs::read_to_string(path)
        .map_err(|e| format!("failed to read config: {}", e))?;
    serde_yaml::from_str(&content).map_err(|e| format!("failed to parse config: {}", e))
}

/// Write a raw JSON document back as YAML (creating the file/dirs first).
pub fn save_raw(path: &Path, config: &Value) -> Result<(), String> {
    ensure_config(path)?;
    let content = serde_yaml::to_string(config)
        .map_err(|e| format!("failed to serialize config: {}", e))?;
    fs::write(path, content).map_err(|e| format!("failed to write config: {}", e))
}

pub fn now_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}