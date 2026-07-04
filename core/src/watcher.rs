// core/src/watcher.rs
// Polls the ACTIVE config file's mtime on a short cadence and emits a
// `config-changed` event whenever it changes. The path lives behind a
// shared mutex so workspace switches (desktop: open a YAML in place,
// e.g. from a git repo) retarget the watcher without a restart. A path
// change itself is adopted silently — the switch flow already reloads.
//
// This gives live-edit-in-vim semantics: hand-edit the file outside the
// app and the canvas (and, in daemon mode, every browser) follows.

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime};

use crate::events::EventSink;

pub fn watch_config(config_path: Arc<Mutex<PathBuf>>, sink: EventSink) {
    let mut last_path = config_path.lock().unwrap().clone();
    let mut last_mtime = mtime(&last_path);

    loop {
        thread::sleep(Duration::from_millis(250));
        let current_path = config_path.lock().unwrap().clone();
        if current_path != last_path {
            // Workspace switched — adopt the new file without announcing.
            last_path = current_path;
            last_mtime = mtime(&last_path);
            continue;
        }
        let current_mtime = mtime(&last_path);
        if current_mtime != last_mtime {
            last_mtime = current_mtime;
            sink("config-changed", serde_json::Value::Null);
        }
    }
}

fn mtime(path: &PathBuf) -> Option<SystemTime> {
    fs::metadata(path).and_then(|m| m.modified()).ok()
}
