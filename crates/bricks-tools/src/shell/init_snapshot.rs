//! Login shell environment snapshot captured once per process.

use std::collections::HashMap;
use std::sync::{Once, OnceLock};

static LOGIN_SHELL_ENV: OnceLock<HashMap<String, String>> = OnceLock::new();
static WARM_ONCE: Once = Once::new();

#[cfg(unix)]
const CAPTURE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
#[cfg(unix)]
const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(10);

/// Parse NUL-delimited (`\0`) `KEY=VALUE` environment entries, skipping empty,
/// malformed, or multiline-key fragments (for example interactive login banners).
pub fn parse_env_nul(bytes: &[u8]) -> HashMap<String, String> {
    let mut env = HashMap::new();
    for entry in bytes.split(|&b| b == 0) {
        if entry.is_empty() {
            continue;
        }
        let Some(eq_pos) = entry.iter().position(|&b| b == b'=') else {
            continue;
        };
        let Ok(key) = std::str::from_utf8(&entry[..eq_pos]) else {
            continue;
        };
        if !is_valid_env_key(key) {
            continue;
        }
        let value = String::from_utf8_lossy(&entry[eq_pos + 1..]).into_owned();
        env.insert(key.to_string(), value);
    }
    env
}

fn is_valid_env_key(key: &str) -> bool {
    !key.is_empty()
        && !key
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '=')
}

/// Return the user's login-shell environment if already captured in this
/// process (`None` when [`warm_login_shell_env`] / [`login_shell_env`] was never
/// triggered, e.g. in CLI or test runs inheriting the caller's environment).
pub fn cached_login_shell_env() -> Option<&'static HashMap<String, String>> {
    LOGIN_SHELL_ENV.get()
}

/// Return the user's login-shell environment, captured once per process.
///
/// Falls back to an empty map on non-Unix platforms or if shell capture fails
/// or times out.
pub fn login_shell_env() -> &'static HashMap<String, String> {
    LOGIN_SHELL_ENV.get_or_init(capture_login_shell_env)
}

/// Start capturing [`login_shell_env`] on a detached background thread so GUI
/// startup does not block on login-shell initialization. Idempotent.
pub fn warm_login_shell_env() {
    if LOGIN_SHELL_ENV.get().is_some() {
        return;
    }
    WARM_ONCE.call_once(|| {
        let _ = std::thread::Builder::new()
            .name("bricks-login-shell-env".to_string())
            .spawn(|| {
                let _ = login_shell_env();
            });
    });
}

#[cfg(unix)]
fn capture_login_shell_env() -> HashMap<String, String> {
    let shell = std::env::var("SHELL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/bin/sh".to_string());
    capture_from_shell(&shell, CAPTURE_TIMEOUT)
}

#[cfg(unix)]
fn capture_from_shell(shell: &str, timeout: std::time::Duration) -> HashMap<String, String> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    let mut child = match Command::new(shell)
        .args(["-lic", "env -0"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return HashMap::new(),
    };

    // Drain stdout on a helper thread so large environments cannot block the child
    // on a full pipe before `try_wait` observes completion.
    let stdout = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut out) = stdout {
            let _ = out.read_to_end(&mut buf);
        }
        buf
    });

    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return HashMap::new();
                }
                let bytes = reader.join().unwrap_or_default();
                return parse_env_nul(&bytes);
            }
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return HashMap::new();
                }
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return HashMap::new();
            }
        }
    }
}

#[cfg(not(unix))]
fn capture_login_shell_env() -> HashMap<String, String> {
    HashMap::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_env_nul_handles_standard_entries_and_equals_in_values() {
        let input = b"HOME=/Users/alice\0PATH=/usr/local/bin:/usr/bin\0TOKEN=abc=def==\0";
        let parsed = parse_env_nul(input);
        assert_eq!(parsed.get("HOME").map(String::as_str), Some("/Users/alice"));
        assert_eq!(
            parsed.get("PATH").map(String::as_str),
            Some("/usr/local/bin:/usr/bin")
        );
        assert_eq!(parsed.get("TOKEN").map(String::as_str), Some("abc=def=="));
        assert_eq!(parsed.len(), 3);
    }

    #[test]
    fn parse_env_nul_skips_empty_malformed_and_multiline_keys() {
        let input = b"\0\0banner without equals\0=missing_key\0welcome\nFAKE=1\0line1\rFAKE2=2\0space key=3\0VALID=ok\0MULTI_VAL=line1\nline2\0";
        let parsed = parse_env_nul(input);
        assert_eq!(parsed.get("VALID").map(String::as_str), Some("ok"));
        assert_eq!(
            parsed.get("MULTI_VAL").map(String::as_str),
            Some("line1\nline2")
        );
        assert_eq!(parsed.len(), 2);
    }

    #[test]
    fn warm_login_shell_env_is_idempotent() {
        warm_login_shell_env();
        warm_login_shell_env();
        warm_login_shell_env();
    }

    #[cfg(unix)]
    #[test]
    fn capture_from_shell_parses_env_from_sh_and_handles_missing_shell() {
        let env = capture_from_shell("/bin/sh", std::time::Duration::from_secs(5));
        assert!(!env.is_empty());
        let missing = capture_from_shell(
            "/nonexistent/bricks-missing-shell",
            std::time::Duration::from_secs(1),
        );
        assert!(missing.is_empty());
    }
}
