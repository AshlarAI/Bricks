// Temporary reproduction tests for high-severity bugs (to be removed after triage).
use bricks_tools::tool_primitives::bash_safety::{is_forbidden, is_safe};
use bricks_tools::tool_primitives::replace::replace;

#[test]
fn repro_replace_overlapping_blocks_panics() {
    let content = "x  = 1\nx  = 1\nx  = 1\n";
    let r = std::panic::catch_unwind(|| replace(content, "x = 1\nx = 1", "y = 2\ny = 2", true));
    println!("replace overlapping -> panicked: {}", r.is_err());
    assert!(r.is_err(), "expected panic (bug reproduced)");
}

#[test]
fn repro_replace_edits_inside_string_literal() {
    let content = "s = \"\"\"\nfoo()\n\"\"\"\ndef g():\n    foo()\n";
    let out = replace(content, "\tfoo()", "\tbar()", false);
    println!("replace python -> {:?}", out);
}

#[test]
fn repro_env_split_string_classified_safe() {
    println!(
        "is_safe(env -S 'rm -rf ~') = {}",
        is_safe("env -S 'rm -rf ~'")
    );
    println!(
        "is_forbidden(setsid rm -rf ~) = {}",
        is_forbidden("setsid rm -rf ~")
    );
    println!(
        "is_safe(git -c core.pager=... log) = {}",
        is_safe("git -c core.pager='sh -c id' log")
    );
    println!(
        "is_safe(git log --output=~/.bashrc) = {}",
        is_safe("git log --output=/tmp/x")
    );
}

// Copy of the private percent_decode in bricks-lsp/src/client.rs:1074.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16)
        {
            out.push(v);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

#[test]
fn repro_percent_decode_panics() {
    let r = std::panic::catch_unwind(|| percent_decode("/tmp/%aé.rs"));
    println!("percent_decode -> panicked: {}", r.is_err());
    assert!(r.is_err(), "expected panic (bug reproduced)");
}
