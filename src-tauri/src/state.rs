// src-tauri/src/state.rs
// Shared Tauri-managed state.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub use reticle_core::cron::CronResultsMap;
pub use reticle_core::terminal::{ShellHandle, ShellMap};

pub struct AppState {
    /// The ACTIVE config file — may live anywhere (e.g. inside a git
    /// repo); the app operates on it in place. Shared with the watcher
    /// and cron scheduler threads so workspace switches retarget them.
    pub config_path: Arc<Mutex<PathBuf>>,
    /// The app data dir (bundled samples, default config, recents list).
    /// Fixed at boot — NOT derived from the active config's location.
    pub data_dir: PathBuf,
    pub cron_results: CronResultsMap,
    pub shells: ShellMap,
}