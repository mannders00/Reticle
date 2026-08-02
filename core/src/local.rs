// core/src/local.rs
// Runs a script on the host where Reticle itself runs — the desktop
// user's machine, or the daemon box. This is what lets cloud-managed
// nodes (RDS, ELB, managed Redis — nothing you can SSH into) be first
// class on the living map: their actions/crons are `aws rds describe…`,
// `dig`, `curl …`, run locally with the host's own credentials and CLIs.
//
// Same ActionResult contract as ssh::run_ssh_command, so the frontend and
// cron scheduler treat local and remote execution identically.

use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Duration;

#[cfg(unix)]
use std::io::Read;
#[cfg(unix)]
use std::os::fd::AsRawFd;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(unix)]
use std::thread;
#[cfg(unix)]
use std::time::Instant;

use crate::config::ActionResult;
use crate::shell::interp_argv;

pub fn run_local_command(script: &str, interp: Option<&str>) -> Result<ActionResult, String> {
    let argv = interp_argv(interp);
    let mut child = Command::new(&argv[0])
        .args(&argv[1..])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {}", argv[0], e))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(script.as_bytes());
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("failed to wait for {}: {}", argv[0], e))?;

    Ok(ActionResult {
        success: output.status.success(),
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

/// Run a persisted local Bash collector without stdin or an interactive shell.
/// `pipefail` makes checks such as `curl -fsS ... | jq -e ...` fail when either
/// the HTTP request or the JSON predicate fails.
#[cfg(unix)]
pub fn run_persisted_command(command: &str, timeout: Duration) -> Result<ActionResult, String> {
    if command.trim().is_empty() {
        return Err("persisted local command is required".into());
    }
    let mut process = Command::new("bash");
    process
        .args(["--noprofile", "--norc", "-o", "pipefail", "-c", command])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    process.process_group(0);
    let mut child = process
        .spawn()
        .map_err(|error| format!("failed to spawn bash: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("failed to capture local stdout")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("failed to capture local stderr")?;
    let started = Instant::now();
    let deadline = started + timeout;
    let stdout_reader = thread::spawn(move || read_bounded_until(stdout, 4096, deadline));
    let stderr_reader = thread::spawn(move || read_bounded_until(stderr, 4096, deadline));
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("failed to poll bash: {error}"))?
        {
            // Bash may exit after backgrounding a child that still owns the
            // output pipes. Stop the remaining process group before joining
            // readers so collection cannot outlive its timeout contract.
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            return Ok(ActionResult {
                success: status.success(),
                exit_code: status.code().unwrap_or(-1),
                stdout: stdout_reader.join().unwrap_or_default(),
                stderr: stderr_reader.join().unwrap_or_default(),
            });
        }
        if started.elapsed() >= timeout {
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
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

#[cfg(not(unix))]
pub fn run_persisted_command(_command: &str, _timeout: Duration) -> Result<ActionResult, String> {
    Err("local Bash checks are supported only on Unix hosts".into())
}

#[cfg(unix)]
fn read_bounded_until(mut reader: impl Read + AsRawFd, max: usize, deadline: Instant) -> String {
    let fd = reader.as_raw_fd();
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFL);
        if flags >= 0 {
            libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
        }
    }
    let mut kept = Vec::with_capacity(max);
    let mut buffer = [0_u8; 1024];
    while Instant::now() < deadline {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                let remaining = max.saturating_sub(kept.len());
                kept.extend_from_slice(&buffer[..read.min(remaining)]);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&kept).to_string()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn persisted_commands_report_exit_status_and_bound_output() {
        let failed =
            run_persisted_command("printf failure >&2; exit 7", Duration::from_secs(2)).unwrap();
        assert!(!failed.success);
        assert_eq!(failed.exit_code, 7);
        assert_eq!(failed.stderr, "failure");

        let bounded = run_persisted_command("printf '%05000d' 0", Duration::from_secs(2)).unwrap();
        assert!(bounded.success);
        assert_eq!(bounded.stdout.len(), 4096);
    }

    #[test]
    fn persisted_commands_enable_pipefail() {
        let result = run_persisted_command("false | true", Duration::from_secs(2)).unwrap();
        assert!(!result.success);
    }

    #[test]
    fn persisted_command_timeout_stops_pipeline_children() {
        let started = Instant::now();
        let result = run_persisted_command("sleep 5 | cat", Duration::from_millis(50)).unwrap();
        assert!(!result.success);
        assert_eq!(result.exit_code, -1);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn persisted_command_stops_background_children_after_bash_exits() {
        let started = Instant::now();
        let result = run_persisted_command("sleep 5 &", Duration::from_millis(200)).unwrap();
        assert!(result.success);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn persisted_command_deadline_survives_an_escaped_descendant() {
        if Command::new("python3").arg("--version").output().is_err() {
            return;
        }
        let started = Instant::now();
        let result = run_persisted_command(
            "python3 -c 'import os,time; os.setsid(); time.sleep(2)' &",
            Duration::from_millis(100),
        )
        .unwrap();
        assert!(result.success);
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}

#[cfg(all(test, not(unix)))]
mod non_unix_tests {
    use super::*;

    #[test]
    fn persisted_local_commands_are_rejected() {
        assert!(run_persisted_command("true", Duration::from_secs(1))
            .unwrap_err()
            .contains("Unix"));
    }
}
