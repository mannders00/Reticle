// src-tauri/src/lib.rs
// Reticle backend. Tauri commands stay thin: marshalling only. Real logic
// lives in domain modules: `config`, `ssh`, `health`, `cron`, `terminal`,
// `watcher`. Every command here maps 1:1 to the frontend `core/api.js`
// surface so daemon-mode (future) is a trait reimpl with no signature drift.

use std::fs;
use std::sync::{Arc, Mutex};

use tauri::Manager;

/// Bundled sample topologies, copied into the app data dir on first boot.
/// The frontend discovers them via `list_workspaces` (which scans for
/// *.yaml files). Users can remove them from the workspace dropdown.
const SAMPLES: &[(&str, &str)] = &[
    ("homelab-pi.yaml", include_str!("../../src/samples/homelab-pi.yaml")),
    ("homelab-k8s.yaml", include_str!("../../src/samples/homelab-k8s.yaml")),
    ("enterprise-aws.yaml", include_str!("../../src/samples/enterprise-aws.yaml")),
    ("enterprise-gcp.yaml", include_str!("../../src/samples/enterprise-gcp.yaml")),
    ("enterprise-onprem.yaml", include_str!("../../src/samples/enterprise-onprem.yaml")),
    ("aws-mine.yaml", include_str!("../../src/samples/aws-mine.yaml")),
];

pub mod commands;
pub mod state;

// Domain modules live in reticle-core (shared with reticle-daemon, see
// DAEMON.md phases 1–2); re-export them so crate::config etc. keep working.
pub use reticle_core::{config, cron, custom_layer, health, local, ssh, terminal, watcher};

pub use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            fs::create_dir_all(&config_dir).expect("failed to create app data dir");
            let config_path = config_dir.join("config.yaml");
            config::ensure_config(&config_path).expect("failed to init config");

            // Copy bundled sample topologies into the app data dir on
            // first boot so the workspace switcher has real examples.
            let samples_dir = config_dir.join("samples");
            if !samples_dir.exists() {
                let _ = fs::create_dir_all(&samples_dir);
                for (name, content) in SAMPLES {
                    let _ = fs::write(samples_dir.join(name), content);
                }
            }

            let cron_results: state::CronResultsMap =
                Arc::new(Mutex::new(std::collections::HashMap::new()));
            let shells: state::ShellMap =
                Arc::new(Mutex::new(std::collections::HashMap::new()));

            // Shared with the watcher + cron threads: switching workspace
            // (including opening an external file in place) retargets them.
            let config_path = Arc::new(Mutex::new(config_path));

            app.manage(state::AppState {
                config_path: config_path.clone(),
                data_dir: config_dir.clone(),
                cron_results: cron_results.clone(),
                shells,
            });

            // Domain modules emit UI events through an EventSink; the
            // desktop shell's sink is a Tauri emit (the daemon's is a
            // WebSocket broadcast — same modules, different delivery).
            let sink: reticle_core::events::EventSink = {
                let handle = app.handle().clone();
                Arc::new(move |event, payload| {
                    use tauri::Emitter;
                    let _ = handle.emit(event, payload);
                })
            };

            // Cron scheduler thread — runs each cron's checks on their
            // intervals; follows the active config path across switches.
            {
                let path = config_path.clone();
                let results = cron_results.clone();
                let sink = sink.clone();
                std::thread::spawn(move || cron::scheduler(path, results, sink));
            }

            // Config file watcher — emits `config-changed` when the ACTIVE
            // YAML is edited externally (vim in your repo, git checkout…)
            // so the UI reloads.
            {
                let path = config_path.clone();
                std::thread::spawn(move || watcher::watch_config(path, sink));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::reticle_ping,
            commands::load_config,
            commands::save_config,
            commands::get_cron_status,
            commands::remove_cron_results,
            commands::run_action,
            commands::run_local,
            commands::health_check,
            commands::http_check,
            commands::get_config_path,
            commands::load_custom_layer,
            commands::open_shell,
            commands::write_shell,
            commands::resize_shell,
            commands::close_shell,
            commands::open_kubectl_shell,
            commands::list_pods,
            commands::list_workspaces,
            commands::switch_workspace,
            commands::delete_workspace,
            commands::import_workspace_file,
            commands::save_export_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}