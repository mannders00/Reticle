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

use std::io::{Read, Write};
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
    validate_target(host, user)?;
    let port_str = port.to_string();

    let mut args: Vec<String> = vec![
        "-o".into(),
        "ConnectTimeout=10".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
        "-p".into(),
        port_str,
        "-l".into(),
        user.to_string(),
        "--".into(),
        host.to_string(),
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

/// Run an argv command selected by Reticle itself, never command text supplied
/// by an API caller. Used by fixed collectors and named actions.
pub fn run_fixed_command(
    host: &str,
    port: u16,
    user: &str,
    command: &[String],
    timeout: Duration,
) -> Result<ActionResult, String> {
    if command.is_empty() {
        return Err("SSH target and fixed command are required".into());
    }
    validate_target(host, user)?;

    let mut child = Command::new("ssh")
        .args([
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            &format!("ConnectTimeout={}", timeout.as_secs().max(1)),
            "-p",
            &port.to_string(),
            "-l",
            user,
            "--",
            host,
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

/// Run a persisted custom collector command through the remote login shell.
/// The command is one SSH argument, preserving shell syntax, and no PTY or
/// stdin is available to the remote process.
pub fn run_persisted_command(
    host: &str,
    port: u16,
    user: &str,
    command: &str,
    timeout: Duration,
) -> Result<ActionResult, String> {
    if command.trim().is_empty() {
        return Err("SSH target and persisted command are required".into());
    }
    validate_target(host, user)?;
    run_ssh_process(
        host,
        port,
        user,
        std::iter::once(command.to_string()).collect::<Vec<_>>(),
        timeout,
    )
}

fn run_ssh_process(
    host: &str,
    port: u16,
    user: &str,
    command: Vec<String>,
    timeout: Duration,
) -> Result<ActionResult, String> {
    let mut child = Command::new("ssh")
        .args([
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            &format!("ConnectTimeout={}", timeout.as_secs().max(1)),
            "-p",
            &port.to_string(),
            "-l",
            user,
            "--",
            host,
        ])
        .args(command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn ssh: {e}"))?;
    let stdout = child.stdout.take().ok_or("failed to capture ssh stdout")?;
    let stderr = child.stderr.take().ok_or("failed to capture ssh stderr")?;
    let stdout_reader = thread::spawn(move || read_bounded(stdout, 4096));
    let stderr_reader = thread::spawn(move || read_bounded(stderr, 4096));
    let started = Instant::now();
    loop {
        if child
            .try_wait()
            .map_err(|e| format!("failed to poll ssh: {e}"))?
            .is_some()
        {
            let status = child
                .wait()
                .map_err(|e| format!("failed to wait for ssh: {e}"))?;
            return Ok(ActionResult {
                success: status.success(),
                exit_code: status.code().unwrap_or(-1),
                stdout: stdout_reader.join().unwrap_or_default(),
                stderr: stderr_reader.join().unwrap_or_default(),
            });
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Ok(ActionResult {
                success: false,
                exit_code: -1,
                stdout: String::new(),
                stderr: format!("timed out after {}s", timeout.as_secs()),
            });
        }
        thread::sleep(Duration::from_millis(25));
    }
}

pub fn validate_target(host: &str, user: &str) -> Result<(), String> {
    let valid_host = !host.is_empty()
        && !host.starts_with('-')
        && host.chars().all(|ch| {
            ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ':' | '[' | ']' | '%')
        });
    if !valid_host {
        return Err("SSH host contains unsupported characters".into());
    }
    let valid_user = !user.is_empty()
        && !user.starts_with('-')
        && user
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'));
    if !valid_user {
        return Err("SSH user contains unsupported characters".into());
    }
    Ok(())
}

fn read_bounded(mut reader: impl Read, max: usize) -> String {
    let mut kept = Vec::with_capacity(max);
    let mut buffer = [0_u8; 1024];
    while let Ok(read) = reader.read(&mut buffer) {
        if read == 0 {
            break;
        }
        let remaining = max.saturating_sub(kept.len());
        kept.extend_from_slice(&buffer[..read.min(remaining)]);
    }
    String::from_utf8_lossy(&kept).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_ssh_option_injection_targets() {
        assert!(validate_target("api.internal", "reticle_probe").is_ok());
        assert!(validate_target("2001:db8::1", "probe").is_ok());
        for (host, user) in [
            ("-oProxyCommand=touch /tmp/pwned", "probe"),
            ("api.internal", "-oProxyCommand=touch_pwned"),
            ("api@internal", "probe"),
            ("api.internal", "root@other"),
            ("api internal", "probe"),
        ] {
            assert!(
                validate_target(host, user).is_err(),
                "accepted {user}@{host}"
            );
        }
    }
}
