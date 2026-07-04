// core/src/shell.rs
// Maps a node's optional `interpreter` to the argv that reads a script
// from stdin. Shared by remote (ssh) and local execution, and — crucially
// — lets Windows targets pick `powershell`/`pwsh` instead of the default
// `bash -s`. The script is always fed over stdin so quoting, pipes, and
// multi-line survive intact.

/// Returns the shell invocation for `interp`, defaulting to `bash -s`.
/// For ssh this is appended after `user@host`; for local it's the command.
pub fn interp_argv(interp: Option<&str>) -> Vec<String> {
    let v: &[&str] = match interp.unwrap_or("bash").trim() {
        "" | "bash" => &["bash", "-s"],
        "sh" => &["sh", "-s"],
        "zsh" => &["zsh", "-s"],
        "powershell" => &["powershell", "-NoProfile", "-NonInteractive", "-Command", "-"],
        "pwsh" => &["pwsh", "-NoProfile", "-NonInteractive", "-Command", "-"],
        "cmd" => &["cmd", "/Q"],
        "python" | "python3" => &["python3", "-"],
        "node" => &["node", "-"],
        // Best effort: assume a POSIX-style `-s` reader.
        other => return vec![other.to_string(), "-s".to_string()],
    };
    v.iter().map(|s| s.to_string()).collect()
}
