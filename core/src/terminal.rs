// core/src/terminal.rs
// Per-session interactive shells via a forked pty and the system `ssh` /
// `kubectl` binaries. stdout/stderr bytes flow back to the UI as
// `shell-output-<id>` events through the shell-provided EventSink; the UI
// writes keystrokes back via `write`. This is the same mechanism as
// opening `ssh user@host` in a real terminal, so agent forwarding, key
// auth, Match blocks, and known_hosts all behave exactly the way they do
// at the command line — using the credentials of whichever host runs this
// code (the user's laptop for the desktop shell, the daemon host for
// daemon mode).
//
// Multi-shell/per-tab handling lives in the frontend; the backend keeps
// one ShellHandle per session id (replacing any previous shell for that
// id when reopening). In daemon mode each connection owns its own
// ShellMap + sink, so terminal bytes are never shared across users and
// shells die with their connection.

use std::collections::HashMap;
use std::ffi::CString;
use std::fs::File;
use std::io::{BufReader, Read};
use std::os::fd::{AsRawFd, FromRawFd};
use std::sync::{Arc, Mutex};
use std::thread;

use nix::pty::{forkpty, ForkptyResult, Winsize};
use nix::unistd::execvp;

use crate::events::EventSink;

/// Live pty shell handles keyed by session id (node id in practice).
pub struct ShellHandle {
    pub master_fd: i32,
    pub child_pid: i32,
}
pub type ShellMap = Arc<Mutex<HashMap<String, ShellHandle>>>;

pub fn open(
    sink: EventSink,
    shells: ShellMap,
    server_name: String,
    host: String,
    port: u16,
    user: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), String> {
    let port_str = port.to_string();
    let user_host = format!("{}@{}", user, host);
    let argv = vec![
        CString::new("ssh").unwrap(),
        CString::new("-o").unwrap(),
        CString::new("ConnectTimeout=10").unwrap(),
        CString::new("-o").unwrap(),
        CString::new("StrictHostKeyChecking=accept-new").unwrap(),
        CString::new("-p").unwrap(),
        CString::new(port_str).unwrap(),
        CString::new(user_host).unwrap(),
    ];
    spawn_pty(sink, shells, server_name, argv, cols, rows)
}

/// Open a `kubectl exec -it <pod> -- /bin/sh` shell via a forked pty.
/// Uses the local KUBECONFIG for context/credentials — identical to
/// running kubectl in a terminal.
pub fn open_kubectl(
    sink: EventSink,
    shells: ShellMap,
    session_id: String,
    context: Option<String>,
    namespace: Option<String>,
    pod: String,
    container: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), String> {
    let mut argv: Vec<CString> = vec![CString::new("kubectl").unwrap()];
    if let Some(ctx) = &context {
        if !ctx.is_empty() {
            argv.push(CString::new("--context").unwrap());
            argv.push(CString::new(ctx.as_str()).unwrap());
        }
    }
    if let Some(ns) = &namespace {
        if !ns.is_empty() {
            argv.push(CString::new("-n").unwrap());
            argv.push(CString::new(ns.as_str()).unwrap());
        }
    }
    argv.push(CString::new("exec").unwrap());
    argv.push(CString::new("-it").unwrap());
    if let Some(c) = &container {
        if !c.is_empty() {
            argv.push(CString::new("-c").unwrap());
            argv.push(CString::new(c.as_str()).unwrap());
        }
    }
    argv.push(CString::new(pod.as_str()).unwrap());
    argv.push(CString::new("--").unwrap());
    argv.push(CString::new("/bin/sh").unwrap());
    spawn_pty(sink, shells, session_id, argv, cols, rows)
}

/// Fork a pty running `argv`, register the handle under `session_id`, and
/// stream output as `shell-output-<session_id>` events until EOF.
fn spawn_pty(
    sink: EventSink,
    shells: ShellMap,
    session_id: String,
    argv: Vec<CString>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), String> {
    let winsize = Winsize {
        ws_row: rows.unwrap_or(40),
        ws_col: cols.unwrap_or(120),
        ws_xpixel: 0,
        ws_ypixel: 0,
    };

    // If a previous shell for this session is still alive, kill it first
    // so reopening doesn't leak fds.
    let _ = kill(&shells, &session_id);

    let result = unsafe { forkpty(Some(&winsize), None) }
        .map_err(|e| format!("failed to fork pty: {}", e))?;

    match result {
        ForkptyResult::Child => {
            let _ = execvp(argv[0].as_ref(), &argv);
            std::process::exit(1);
        }
        ForkptyResult::Parent { child, master } => {
            let master_fd = master.as_raw_fd();
            let reader_fd = unsafe { libc::dup(master_fd) };
            if reader_fd == -1 {
                return Err("failed to dup master fd".to_string());
            }

            let event_name = format!("shell-output-{}", session_id);
            let sn_clone = session_id.clone();
            let shells_clone = shells.clone();

            thread::spawn(move || {
                let file = unsafe { File::from_raw_fd(reader_fd) };
                let mut reader = BufReader::new(file);
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let data = String::from_utf8_lossy(&buf[..n]).to_string();
                            sink(&event_name, serde_json::Value::String(data));
                        }
                        Err(_) => break,
                    }
                }
                sink(
                    &event_name,
                    serde_json::Value::String("\x1b[2J\x1b[H--- Disconnected ---\n".to_string()),
                );
                let mut sl = shells_clone.lock().unwrap();
                sl.remove(&sn_clone);
            });

            {
                let mut sl = shells.lock().unwrap();
                sl.insert(
                    session_id,
                    ShellHandle {
                        master_fd,
                        child_pid: child.as_raw() as i32,
                    },
                );
            }
            std::mem::forget(master);

            Ok(())
        }
    }
}

pub fn write(shells: &ShellMap, server_name: &str, data: &str) -> Result<(), String> {
    let sl = shells.lock().unwrap();
    if let Some(handle) = sl.get(server_name) {
        let bytes = data.as_bytes();
        let mut written = 0;
        while written < bytes.len() {
            let n = unsafe {
                libc::write(
                    handle.master_fd,
                    bytes[written..].as_ptr() as *const libc::c_void,
                    bytes.len() - written,
                )
            };
            if n < 0 {
                return Err("failed to write to pty".to_string());
            }
            written += n as usize;
        }
    }
    Ok(())
}

pub fn resize(shells: &ShellMap, server_name: &str, cols: u16, rows: u16) -> Result<(), String> {
    let sl = shells.lock().unwrap();
    if let Some(handle) = sl.get(server_name) {
        let winsize = Winsize {
            ws_row: rows,
            ws_col: cols,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        unsafe {
            libc::ioctl(handle.master_fd, libc::TIOCSWINSZ, &winsize);
        }
    }
    Ok(())
}

pub fn kill(shells: &ShellMap, server_name: &str) -> Result<(), String> {
    let mut sl = shells.lock().unwrap();
    if let Some(handle) = sl.remove(server_name) {
        unsafe {
            libc::kill(handle.child_pid, libc::SIGKILL);
            libc::close(handle.master_fd);
        }
    }
    Ok(())
}

/// Kill every shell in the map (daemon: connection closed → its shells die).
pub fn kill_all(shells: &ShellMap) {
    let mut sl = shells.lock().unwrap();
    for (_, handle) in sl.drain() {
        unsafe {
            libc::kill(handle.child_pid, libc::SIGKILL);
            libc::close(handle.master_fd);
        }
    }
}

/// List pods for a kubectl context/namespace/selector (blocking; callers
/// wrap in spawn_blocking). Used by the frontend pod-picker before
/// opening a kubectl exec shell.
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
