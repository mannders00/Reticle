// core/src/ssh.rs
// Runs a bash script on a remote host over the system `ssh` CLI.
//
// Server-map historically used russh but moved to plain ssh for reliability,
// SSH agent/key reuse, and Match-block support; we keep the same approach
// here. No secrets are stored — the local ssh config (keys, known_hosts,
// agent) is the single source of truth, exactly like working at a terminal.
//
// `run_action` in the frontend maps here. The script is fed over stdin to
// `ssh user@host <interpreter>` so quoting / multiline / pipes survive
// intact. `interp` defaults to `bash -s`; Windows targets can pass
// `powershell` / `pwsh` (see shell::interp_argv).

use std::io::Write;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::config::ActionResult;
use crate::shell::interp_argv;

pub fn run_ssh_command(
    host: &str,
    port: u16,
    user: &str,
    script: &str,
    interp: Option<&str>,
) -> Result<ActionResult, String> {
    let port_str = port.to_string();
    let user_host = format!("{}@{}", user, host);

    let mut args: Vec<String> = vec![
        "-o".into(),
        "ConnectTimeout=10".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
        "-p".into(),
        port_str,
        user_host,
    ];
    args.extend(interp_argv(interp));

    let mut child = Command::new("ssh")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn ssh: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(script.as_bytes());
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("failed to wait for ssh: {}", e))?;

    Ok(ActionResult {
        success: output.status.success(),
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

/// Run a command selected by Reticle itself, never command text supplied by
/// an API caller. This is the only SSH primitive used by graph collectors and
/// named actions.
pub fn run_fixed_command(
    host: &str,
    port: u16,
    user: &str,
    command: &[String],
    timeout: Duration,
) -> Result<ActionResult, String> {
    if host.trim().is_empty() || user.trim().is_empty() || command.is_empty() {
        return Err("SSH target and fixed command are required".into());
    }

    let mut child = Command::new("ssh")
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            &format!("ConnectTimeout={}", timeout.as_secs().max(1)),
            "-p",
            &port.to_string(),
            &format!("{user}@{host}"),
        ])
        .args(command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn ssh: {e}"))?;

    let started = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|e| format!("failed to poll ssh: {e}"))?
            .is_some()
        {
            let output = child
                .wait_with_output()
                .map_err(|e| format!("failed to read ssh output: {e}"))?;
            return Ok(ActionResult {
                success: output.status.success(),
                exit_code: output.status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            });
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let output = child
                .wait_with_output()
                .map_err(|e| format!("failed to stop timed-out ssh: {e}"))?;
            return Ok(ActionResult {
                success: false,
                exit_code: -1,
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: format!("timed out after {}s", timeout.as_secs()),
            });
        }
        thread::sleep(Duration::from_millis(25));
    }
}
