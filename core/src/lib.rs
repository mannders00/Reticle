// reticle-core — domain modules shared by the desktop (Tauri) and daemon
// (axum) shells. See DAEMON.md §5 phase 1.
//
// Shells differ only in transport and event delivery: everything in here
// is plain Rust plus an `events::EventSink` callback for pushing events
// to whatever UI is attached (Tauri event system / WebSocket broadcast).
// Nothing in this crate may depend on tauri or axum.

pub mod config;
pub mod cron;
pub mod custom_layer;
pub mod events;
pub mod health;
pub mod local;
pub mod shell;
pub mod ssh;
#[cfg(unix)]
pub mod terminal;
// Windows: interactive pty terminals aren't supported yet (forkpty is
// Unix); everything else — actions, crons, health, kubectl pod listing —
// works. The stub keeps the API identical so the shells compile as-is.
#[cfg(not(unix))]
#[path = "terminal_win.rs"]
pub mod terminal;
pub mod watcher;
