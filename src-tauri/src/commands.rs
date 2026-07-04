// src-tauri/src/commands.rs
// Thin #[tauri::command] thunks — marshalling only. Real work is delegated
// to the domain modules (config, ssh, cron, health, terminal, watcher,
// custom_layer). Keeping these tiny makes a future daemon-mode port a
// pure trait reimplementation on top of the same domain modules.

use std::fs;
use std::path::PathBuf;
use tauri::State;

use crate::state::AppState;

/* ---------- workspaces ---------- */

/// A workspace is a .yaml file the app operates on IN PLACE — it may live
/// anywhere (your git repo, ~/Documents, wherever). The list is the
/// user's recent files plus the bundled read-only samples.
#[derive(Debug, serde::Serialize)]
pub struct Workspace {
    pub name: String,
    pub path: String,
    pub active: bool,
    pub sample: bool,
    /// The file exists on disk right now (recents can go missing).
    pub exists: bool,
}

fn recents_path(state: &AppState) -> PathBuf {
    state.data_dir.join("recents.json")
}

fn read_recents(state: &AppState) -> Vec<String> {
    fs::read_to_string(recents_path(state))
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

fn write_recents(state: &AppState, recents: &[String]) {
    if let Ok(s) = serde_json::to_string_pretty(recents) {
        let _ = fs::write(recents_path(state), s);
    }
}

/// Push a path to the front of the recents list (dedup, cap at 12).
fn remember_recent(state: &AppState, path: &str) {
    let mut recents = read_recents(state);
    recents.retain(|p| p != path);
    recents.insert(0, path.to_string());
    recents.truncate(12);
    write_recents(state, &recents);
}

#[tauri::command]
pub fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<Workspace>, String> {
    let current = state.config_path.lock().unwrap().to_string_lossy().to_string();
    let mut out = Vec::new();

    // Recents — files the user has opened, wherever they live.
    for path_str in read_recents(&state) {
        let p = PathBuf::from(&path_str);
        let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or("?").to_string();
        out.push(Workspace {
            name,
            active: path_str == current,
            exists: p.is_file(),
            sample: false,
            path: path_str,
        });
    }

    // Bundled samples (read-only; opening one copies it out — see below).
    let samples = state.data_dir.join("samples");
    if samples.exists() {
        for entry in fs::read_dir(&samples).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("yaml") {
                let path_str = path.to_string_lossy().to_string();
                let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("?").to_string();
                out.push(Workspace {
                    name,
                    active: path_str == current,
                    exists: true,
                    sample: true,
                    path: path_str,
                });
            }
        }
    }
    Ok(out)
}

/// Switch the active config to a .yaml file, operating on it IN PLACE.
/// Missing files are created (with the default config) so "New workspace"
/// at a chosen path works. The path is remembered in recents.
#[tauri::command]
pub fn switch_workspace(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        crate::config::ensure_config(&p)?;
    }
    // Validate it parses before we commit to it.
    let content = fs::read_to_string(&p).map_err(|e| format!("read: {}", e))?;
    let _: serde_json::Value = serde_yaml::from_str(&content)
        .map_err(|e| format!("invalid YAML: {}", e))?;
    *state.config_path.lock().unwrap() = p;
    remember_recent(&state, &path);
    Ok(())
}

/// Remove a file from the recents list. Does NOT touch the file on disk —
/// it may be a tracked file in someone's repo. Samples can't be forgotten
/// (they're always listed).
#[tauri::command]
pub fn delete_workspace(state: State<'_, AppState>, path: String) -> Result<(), String> {
    if path == state.config_path.lock().unwrap().to_string_lossy() {
        return Err("switch to another workspace before removing this one".into());
    }
    let mut recents = read_recents(&state);
    recents.retain(|p| p != &path);
    write_recents(&state, &recents);
    Ok(())
}

/// Copy a file (a bundled sample, or any yaml) to a user-chosen path.
/// Samples are read-only templates; this is how you start from one without
/// mutating the bundled copy. The caller then switch_workspace()es to the
/// returned dest and edits it in place. `_state` unused but keeps the
/// command signature consistent with the managed-state pattern.
#[tauri::command]
pub fn import_workspace_file(src_path: String, dest_path: String) -> Result<String, String> {
    let src = PathBuf::from(&src_path);
    let dest = PathBuf::from(&dest_path);
    if !src.exists() {
        return Err(format!("file not found: {}", src_path));
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    fs::copy(&src, &dest).map_err(|e| format!("copy failed: {}", e))?;
    Ok(dest.to_string_lossy().to_string())
}

/* ---------- liveness ---------- */

#[tauri::command]
pub async fn reticle_ping() -> String {
    "ok".to_string()
}

/* ---------- export ---------- */

/// Write export bytes (PDF/SVG/PNG built by the frontend) to disk. The
/// path comes from the native save dialog, so it's user-chosen.
#[tauri::command]
pub fn save_export_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let expanded = shellexpand::tilde(&path).to_string();
    fs::write(&expanded, bytes).map_err(|e| format!("write {}: {}", expanded, e))
}

/* ---------- config IO ---------- */

#[tauri::command]
pub fn load_config(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let path = state.config_path.lock().unwrap().clone();
    crate::config::load_raw(&path)
}

#[tauri::command]
pub fn save_config(state: State<'_, AppState>, config: serde_json::Value) -> Result<(), String> {
    let path = state.config_path.lock().unwrap().clone();
    crate::config::save_raw(&path, &config)
}

#[tauri::command]
pub fn get_config_path(state: State<'_, AppState>) -> Result<String, String> {
    let p = state.config_path.lock().unwrap();
    p.to_str().map(|s| s.to_string()).ok_or_else(|| "invalid path".to_string())
}

/* ---------- cron status ---------- */

#[tauri::command]
pub fn get_cron_status(state: State<'_, AppState>) -> Result<Vec<crate::config::CronStatus>, String> {
    let path = state.config_path.lock().unwrap().clone();
    crate::cron::status(&path, &state.cron_results)
}

#[tauri::command]
pub fn remove_cron_results(server: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut results = state.cron_results.lock().unwrap();
    results.remove(&server);
    Ok(())
}

/* ---------- actions + health ---------- */

#[tauri::command]
pub async fn run_action(
    host: String,
    port: u16,
    user: String,
    script: String,
    interpreter: Option<String>,
) -> Result<crate::config::ActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::ssh::run_ssh_command(&host, port, &user, &script, interpreter.as_deref())
    })
    .await
    .map_err(|e| format!("task failed: {}", e))?
}

/// Run a script on THIS host (desktop machine). For cloud-managed nodes
/// you can't SSH into: `aws rds describe…`, `dig`, `curl …`.
#[tauri::command]
pub async fn run_local(
    script: String,
    interpreter: Option<String>,
) -> Result<crate::config::ActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::local::run_local_command(&script, interpreter.as_deref())
    })
    .await
    .map_err(|e| format!("task failed: {}", e))?
}

#[tauri::command]
pub async fn health_check(host: String, port: u16) -> Result<bool, String> {
    Ok(tauri::async_runtime::spawn_blocking(move || {
        crate::health::reachable(&host, port)
    })
    .await
    .map_err(|e| format!("task failed: {}", e))?)
}

#[tauri::command]
pub async fn http_check(
    url: String,
    status: Option<String>,
    jq: Option<String>,
) -> Result<crate::health::HttpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::health::http_check(&url, status.as_deref().unwrap_or(""), jq.as_deref().unwrap_or(""))
    })
    .await
    .map_err(|e| format!("task failed: {}", e))
}

/* ---------- custom layers ---------- */

#[tauri::command]
pub fn load_custom_layer(file: String, config_dir: String) -> Result<String, String> {
    crate::custom_layer::load(&file, &config_dir)
}

/* ---------- shells (interactive SSH pty) ---------- */

/// Terminal output events go through the shared EventSink abstraction —
/// here it's a Tauri emit; in the daemon it's a per-connection WS frame.
fn emit_sink(app_handle: tauri::AppHandle) -> reticle_core::events::EventSink {
    std::sync::Arc::new(move |event, payload| {
        use tauri::Emitter;
        let _ = app_handle.emit(event, payload);
    })
}

#[tauri::command]
pub fn open_shell(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    server_name: String,
    host: String,
    port: u16,
    user: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), String> {
    crate::terminal::open(
        emit_sink(app_handle),
        state.shells.clone(),
        server_name,
        host,
        port,
        user,
        cols,
        rows,
    )
}

#[tauri::command]
pub fn write_shell(state: State<'_, AppState>, server_name: String, data: String) -> Result<(), String> {
    crate::terminal::write(&state.shells, &server_name, &data)
}

#[tauri::command]
pub fn resize_shell(
    state: State<'_, AppState>,
    server_name: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    crate::terminal::resize(&state.shells, &server_name, cols, rows)
}

#[tauri::command]
pub fn close_shell(state: State<'_, AppState>, server_name: String) -> Result<(), String> {
    crate::terminal::kill(&state.shells, &server_name)
}

#[tauri::command]
pub fn open_kubectl_shell(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    context: Option<String>,
    namespace: Option<String>,
    pod: String,
    container: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), String> {
    crate::terminal::open_kubectl(
        emit_sink(app_handle),
        state.shells.clone(),
        session_id,
        context,
        namespace,
        pod,
        container,
        cols,
        rows,
    )
}

/// List pods matching a kubectl context/namespace/selector. Used by the
/// frontend pod-picker before opening a kubectl exec shell.
#[tauri::command]
pub async fn list_pods(
    context: Option<String>,
    namespace: Option<String>,
    selector: Option<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::terminal::list_pods(context, namespace, selector)
    })
    .await
    .map_err(|e| format!("task failed: {}", e))?
}