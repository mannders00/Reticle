// core/src/health.rs
// Node health probes:
//   - reachable():  a TCP connect (the cheap green-dot pulse).
//   - http_check(): an HTTP request evaluated by status code and, if
//     given, a jq expression over the JSON body.
//
// The HTTP probe shells out to the system `curl` (TLS, redirects, and
// timeouts handled robustly with zero Rust deps — same "use the tools the
// host already has" philosophy as ssh/kubectl) and pipes the body through
// system `jq -e`, so users get real jq semantics: jq's own exit code is
// the truthiness of the last output.

use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

pub fn reachable(host: &str, port: u16) -> bool {
    let addr = format!("{}:{}", host, port);
    let socket_addrs: Vec<_> = match addr.to_socket_addrs() {
        Ok(addrs) => addrs.collect(),
        Err(_) => return false,
    };
    if socket_addrs.is_empty() {
        return false;
    }
    for sa in socket_addrs {
        if sa.ip().is_unspecified() {
            continue;
        }
        if TcpStream::connect_timeout(&sa, Duration::from_secs(2)).is_ok() {
            return true;
        }
    }
    false
}

#[derive(Debug, Serialize)]
pub struct HttpResult {
    pub ok: bool,
    pub status: Option<i64>,
    pub detail: String,
}

/// GET `url`, then judge health by status code (`status_expr`, default
/// 2xx) and, if `jq_expr` is non-empty, by a jq expression over the JSON
/// body (healthy when jq's last output is truthy). Blocking; wrap in
/// spawn_blocking.
pub fn http_check(url: &str, status_expr: &str, jq_expr: &str) -> HttpResult {
    if url.trim().is_empty() {
        return HttpResult { ok: false, status: None, detail: "no url".into() };
    }

    // Body to stdout (-o -), then curl appends the sentinel + status code
    // via -w, so stdout = "<body>\nRETICLE_HTTP_STATUS:<code>".
    let out = match Command::new("curl")
        .args([
            "-sS", "-L",
            "--max-time", "8",
            "-o", "-",
            "-w", "\nRETICLE_HTTP_STATUS:%{http_code}",
            url,
        ])
        .output()
    {
        Ok(o) => o,
        Err(e) => return HttpResult { ok: false, status: None, detail: format!("curl not available: {e}") },
    };

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let msg = err.lines().last().unwrap_or("request failed").trim();
        return HttpResult { ok: false, status: None, detail: truncate(msg, 80) };
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let (body, code) = match stdout.rfind("RETICLE_HTTP_STATUS:") {
        Some(i) => (&stdout[..i], stdout[i + "RETICLE_HTTP_STATUS:".len()..].trim()),
        None => (stdout.as_ref(), ""),
    };
    let status: Option<i64> = code.trim().parse().ok();

    let status_ok = match status {
        Some(c) => status_matches(c, status_expr),
        None => false,
    };

    // jq gate (optional). jq -e: exit 0 when last output is truthy.
    let mut detail = status.map(|c| c.to_string()).unwrap_or_else(|| "no status".into());
    let jq_ok = if jq_expr.trim().is_empty() {
        true
    } else {
        match run_jq(body, jq_expr) {
            Ok(true) => { detail.push_str(" · jq ✓"); true }
            Ok(false) => { detail.push_str(" · jq ✗"); false }
            Err(e) => { detail.push_str(&format!(" · {e}")); false }
        }
    };

    HttpResult { ok: status_ok && jq_ok, status, detail }
}

/// Pipe `body` through `jq -e <expr>`; Ok(true) if jq's last output is
/// truthy (jq exit 0), Ok(false) if falsy (exit 1). Err for jq missing /
/// parse errors (exit >1 / spawn failure).
fn run_jq(body: &str, expr: &str) -> Result<bool, String> {
    let mut child = Command::new("jq")
        .args(["-e", expr])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "jq not found".to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(body.as_bytes());
    }
    let out = child.wait_with_output().map_err(|e| format!("jq: {e}"))?;
    match out.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err("jq error".into()),
    }
}

/// Match a status code against an expression: "" or "2xx" → 200-299;
/// "200" exact; "200-204" range; "200,201,204" list; combinable.
fn status_matches(code: i64, expr: &str) -> bool {
    let expr = expr.trim();
    if expr.is_empty() {
        return (200..=299).contains(&code);
    }
    for tok in expr.split(',') {
        let tok = tok.trim();
        if tok.is_empty() {
            continue;
        }
        // "2xx" family
        if tok.len() == 3 && (tok.ends_with("xx") || tok.ends_with("XX")) {
            if let Some(first) = tok.chars().next().and_then(|c| c.to_digit(10)) {
                let lo = first as i64 * 100;
                if (lo..lo + 100).contains(&code) {
                    return true;
                }
            }
            continue;
        }
        // "200-204" range
        if let Some((a, b)) = tok.split_once('-') {
            if let (Ok(lo), Ok(hi)) = (a.trim().parse::<i64>(), b.trim().parse::<i64>()) {
                if (lo..=hi).contains(&code) {
                    return true;
                }
            }
            continue;
        }
        // exact
        if tok.parse::<i64>().ok() == Some(code) {
            return true;
        }
    }
    false
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n).collect::<String>() + "…"
    }
}