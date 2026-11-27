//! The system prompt the `bricks` binary really sends in headless mode
//! (Sprint 13.2): the Bricks foundation, once, with the delegation bullet
//! only when the session agent has the sub-agent tools. Captured by the
//! local test server; no network beyond 127.0.0.1.

mod common;

use common::*;

const REFERENCE: &str = include_str!("../../bricks-agent/tests/fixtures/bricks_foundation.txt");

fn reference() -> String {
    REFERENCE.trim_end_matches('\n').to_string()
}

/// The system message and tool names of the first request.
fn first_request(extra: &str) -> (String, Vec<String>) {
    let m = model(vec![text("bonjour")]);
    let p = Project::new(&m.url, extra);
    let out = p.run(&["run", "--json", "--non-interactive", "Dis bonjour"], None);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let req = m.seen.lock().unwrap()[0].clone();
    let system = req["messages"][0].clone();
    assert_eq!(system["role"], "system");
    let tools = req["tools"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|t| t["function"]["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    (system["content"].as_str().unwrap_or("").to_string(), tools)
}

#[test]
fn headless_sends_the_foundation_with_the_bullets_its_tools_decide() {
    let (s, tools) = first_request("{}");
    assert!(tools.iter().any(|t| t == "Agent") && tools.iter().any(|t| t == "CodeStats"));
    assert!(!tools.iter().any(|t| t == "CodeScout" || t == "CodeSearch"));
    assert!(s.starts_with(&reference()), "{s}");
    assert_eq!(s.matches("You are Bricks").count(), 1);
    assert!(!s.contains("Cersei SDK"));
    assert!(!s.contains("## Your role"));

    let (s, tools) = first_request(r#"{"agents":{"enabled":false}}"#);
    assert!(!tools.iter().any(|t| t == "Agent" || t == "Messagent"));
    assert!(s.starts_with(&reference()), "{s}");
    assert!(!s.contains("## Delegation"));
}
