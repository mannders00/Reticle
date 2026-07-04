// core/src/events.rs
// Event delivery abstraction. Domain modules (cron, watcher, …) push
// UI-bound events through this callback and never know who's listening:
// the desktop shell wraps a Tauri AppHandle (`app.emit`), the daemon
// wraps a broadcast channel that fans out to every connected WebSocket.

use std::sync::Arc;

pub type EventSink = Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>;
