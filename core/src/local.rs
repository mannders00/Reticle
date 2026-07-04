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
