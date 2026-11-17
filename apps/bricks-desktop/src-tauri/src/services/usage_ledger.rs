//! What every model response consumed, for the « Usage » settings: one JSON
//! line per response in `<home>/desktop/usage.jsonl` (when, which provider and
//! model, tokens, cost and what a gateway said it charged). The session
//! agent's responses are recorded as its turns end, a sub-agent's as a whole
//! when it finishes, so nothing is counted twice. Read back as daily totals
//! per provider and model, in local time.

use crate::contract::{GoQuota, GoQuotaWindow, UsageRow, UsageStats};
use bricks_types::{Billing, Usage};
use chrono::{Local, TimeZone};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

/// One response, as written.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UsageEntry {
    /// Milliseconds since the Unix epoch.
    pub at: i64,
    pub session_id: String,
    pub provider: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read_input_tokens: u64,
    #[serde(default)]
    pub cache_creation_input_tokens: u64,
    /// `None`: no price was known.
    #[serde(default)]
    pub cost_usd: Option<f64>,
    #[serde(default)]
    pub billing: Option<Billing>,
}

impl UsageEntry {
    /// The entry of a response of model `selection` (`provider/model`), or
    /// `None` when it consumed nothing.
    pub fn new(at: i64, session_id: &str, selection: &str, usage: &Usage) -> Option<UsageEntry> {
        let tokens = usage.input_tokens
            + usage.output_tokens
            + usage.cache_read_input_tokens
            + usage.cache_creation_input_tokens;
        if tokens == 0 {
            return None;
        }
        let (provider, model) = selection.split_once('/').unwrap_or(("", selection));
        Some(UsageEntry {
            at,
            session_id: session_id.to_string(),
            provider: provider.to_string(),
            model: model.to_string(),
            input_tokens: usage.input_tokens,
            output_tokens: usage.output_tokens,
            cache_read_input_tokens: usage.cache_read_input_tokens,
            cache_creation_input_tokens: usage.cache_creation_input_tokens,
            cost_usd: usage.cost_usd,
            billing: usage.billing.clone(),
        })
    }
}

/// The ledger file. Appends are serialised; a line that cannot be read is
/// skipped (a write cut short leaves at most its own line unreadable).
pub struct UsageLedger {
    path: PathBuf,
    lock: parking_lot::Mutex<()>,
}

static LEDGER: OnceLock<UsageLedger> = OnceLock::new();

/// Opens the application's ledger at `path`, once.
pub fn init(path: PathBuf) {
    let _ = LEDGER.set(UsageLedger::at(path));
}

/// The application's ledger, once opened.
pub fn global() -> Option<&'static UsageLedger> {
    LEDGER.get()
}

impl UsageLedger {
    pub fn at(path: PathBuf) -> Self {
        Self {
            path,
            lock: parking_lot::Mutex::new(()),
        }
    }

    pub fn append(&self, entry: &UsageEntry) -> std::io::Result<()> {
        let mut line = serde_json::to_string(entry).map_err(std::io::Error::other)?;
        line.push('\n');
        let _guard = self.lock.lock();
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .read(true)
            .append(true)
            .open(&self.path)?;
        // A write cut short leaves a line without its end: the next entry
        // starts on a line of its own, so only the cut one is lost.
        if ends_unfinished(&mut file)? {
            line.insert(0, '\n');
        }
        file.write_all(line.as_bytes())
    }

    pub fn entries(&self) -> Vec<UsageEntry> {
        let _guard = self.lock.lock();
        let Ok(file) = std::fs::File::open(&self.path) else {
            return Vec::new();
        };
        // Line by line as bytes: a line that is not UTF-8 or not an entry is
        // skipped; a read error ends the list.
        std::io::BufReader::new(file)
            .split(b'\n')
            .map_while(Result::ok)
            .filter_map(|line| serde_json::from_slice(&line).ok())
            .collect()
    }
}

/// Whether the file's last byte is not a line end (an empty file is fine).
fn ends_unfinished(file: &mut std::fs::File) -> std::io::Result<bool> {
    use std::io::{Read, Seek, SeekFrom};
    if file.metadata()?.len() == 0 {
        return Ok(false);
    }
    file.seek(SeekFrom::End(-1))?;
    let mut last = [0u8; 1];
    file.read_exact(&mut last)?;
    Ok(last[0] != b'\n')
}

/// Daily totals per provider and model, oldest day first, in local time.
pub fn stats(entries: &[UsageEntry]) -> UsageStats {
    stats_in(entries, &Local)
}

fn stats_in<Tz: TimeZone>(entries: &[UsageEntry], tz: &Tz) -> UsageStats {
    let mut rows: BTreeMap<(String, String, String), (UsageRow, BTreeSet<String>)> =
        BTreeMap::new();
    for e in entries {
        let Some(when) = tz.timestamp_millis_opt(e.at).single() else {
            continue;
        };
        let date = when.date_naive().format("%Y-%m-%d").to_string();
        let key = (date.clone(), e.provider.clone(), e.model.clone());
        let (row, sessions) = rows.entry(key).or_insert_with(|| {
            (
                UsageRow {
                    date,
                    provider: e.provider.clone(),
                    model: e.model.clone(),
                    requests: 0,
                    sessions: 0,
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read_input_tokens: 0,
                    cache_creation_input_tokens: 0,
                    cost_usd: 0.0,
                    unpriced_requests: 0,
                },
                BTreeSet::new(),
            )
        });
        row.requests += 1;
        sessions.insert(e.session_id.clone());
        row.sessions = sessions.len() as u32;
        row.input_tokens += e.input_tokens;
        row.output_tokens += e.output_tokens;
        row.cache_read_input_tokens += e.cache_read_input_tokens;
        row.cache_creation_input_tokens += e.cache_creation_input_tokens;
        match e.cost_usd {
            Some(cost) => row.cost_usd += cost,
            None => row.unpriced_requests += 1,
        }
    }
    UsageStats {
        rows: rows.into_values().map(|(row, _)| row).collect(),
    }
}

// ─── OpenCode Go limits ─────────────────────────────────────────────────────

const GO_USAGE: &str = "https://opencode.ai/inference/go/v1/usage";

/// Whether `endpoint` is OpenCode Go (current or former base URL).
pub fn is_opencode_go(endpoint: &str) -> bool {
    let Some(rest) = endpoint.trim().strip_prefix("https://") else {
        return false;
    };
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    let host = authority.split(':').next().unwrap_or_default();
    let path = path.to_ascii_lowercase();
    !authority.contains('@')
        && host.eq_ignore_ascii_case("opencode.ai")
        && ["inference/go", "zen/go"]
            .iter()
            .any(|p| path == *p || path.starts_with(&format!("{p}/")))
}

/// How much of the Go limits is used, read with `key`. Undocumented by
/// OpenCode: any failure is `None`, and the page shows no gauge.
pub async fn go_quota(key: &str) -> Option<GoQuota> {
    let response = bricks_types::http::client()
        .get(GO_USAGE)
        .header("user-agent", bricks_provider::USER_AGENT)
        .bearer_auth(key)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let body: serde_json::Value = response.json().await.ok()?;
    quota_of(&body)
}

fn quota_of(body: &serde_json::Value) -> Option<GoQuota> {
    let usage = body.get("usage").unwrap_or(body);
    let windows: Vec<GoQuotaWindow> = ["rolling", "weekly", "monthly"]
        .into_iter()
        .filter_map(|id| {
            let w = usage.get(id)?;
            Some(GoQuotaWindow {
                id: id.to_string(),
                percent: w.get("percent")?.as_f64()?.clamp(0.0, 100.0),
                resets_at: w
                    .get("resetsAt")
                    .or_else(|| w.get("resets_at"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                status: w.get("status").and_then(|v| v.as_str()).map(str::to_string),
            })
        })
        .collect();
    (!windows.is_empty()).then_some(GoQuota { windows })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;
    use serde_json::json;

    fn usage(input: u64, output: u64, cost: Option<f64>) -> Usage {
        Usage {
            input_tokens: input,
            output_tokens: output,
            cost_usd: cost,
            ..Default::default()
        }
    }

    #[test]
    fn an_entry_splits_the_selection_and_skips_empty_responses() {
        let e =
            UsageEntry::new(1, "s", "opencode-go-chat/kimi-k3", &usage(10, 5, Some(0.1))).unwrap();
        assert_eq!(
            (e.provider.as_str(), e.model.as_str()),
            ("opencode-go-chat", "kimi-k3")
        );
        let bare = UsageEntry::new(1, "s", "mystery", &usage(1, 0, None)).unwrap();
        assert_eq!(
            (bare.provider.as_str(), bare.model.as_str()),
            ("", "mystery")
        );
        assert!(UsageEntry::new(1, "s", "p/m", &usage(0, 0, None)).is_none());
    }

    #[test]
    fn the_ledger_appends_and_reads_back_skipping_broken_lines() {
        let dir = tempfile::tempdir().unwrap();
        let ledger = UsageLedger::at(dir.path().join("desktop/usage.jsonl"));
        assert!(ledger.entries().is_empty());
        let e = UsageEntry::new(5, "s", "p/m", &usage(3, 4, None)).unwrap();
        ledger.append(&e).unwrap();
        std::fs::OpenOptions::new()
            .append(true)
            .open(dir.path().join("desktop/usage.jsonl"))
            .unwrap()
            .write_all(b"{cut short")
            .unwrap();
        ledger.append(&e).unwrap();
        assert_eq!(ledger.entries(), vec![e.clone(), e]);
    }

    #[test]
    fn days_are_local_and_rows_add_up() {
        // 2026-11-16 23:30 UTC is already the 17th at UTC+1.
        let late = 1_794_871_800_000;
        let tz = FixedOffset::east_opt(3600).unwrap();
        let mut go = usage(100, 50, Some(0.0));
        go.billing = Some(Billing {
            source: "go".into(),
            charged_usd: 0.0,
            list_usd: Some(0.2),
            allowance_usd: Some(0.05),
            estimated: false,
        });
        let entries = vec![
            UsageEntry::new(late, "a", "p/m", &go).unwrap(),
            UsageEntry::new(late + 1000, "b", "p/m", &go).unwrap(),
            UsageEntry::new(late, "a", "p/other", &usage(1, 1, None)).unwrap(),
        ];
        let rows = stats_in(&entries, &tz).rows;
        assert_eq!(rows.len(), 2);
        let m = &rows[0];
        assert_eq!((m.date.as_str(), m.model.as_str()), ("2026-11-17", "m"));
        assert_eq!(
            (m.requests, m.sessions, m.input_tokens, m.output_tokens),
            (2, 2, 200, 100)
        );
        assert_eq!(rows[1].unpriced_requests, 1);
    }

    #[test]
    fn go_is_recognised_by_its_base_url() {
        assert!(is_opencode_go("https://opencode.ai/inference/go/openai/v1"));
        assert!(is_opencode_go("https://opencode.ai/zen/go/v1"));
        assert!(!is_opencode_go("https://opencode.ai/inference/openai/v1"));
        assert!(!is_opencode_go(
            "https://proxy.example.com/opencode.ai/inference/go/v1"
        ));
        assert!(!is_opencode_go("http://opencode.ai/inference/go/v1"));
        assert!(!is_opencode_go("https://opencode.ai/inference/gopher/v1"));
    }

    #[test]
    fn the_quota_reads_the_three_windows_and_nothing_else() {
        let body = json!({ "usage": {
            "rolling": { "status": "ok", "percent": 12.5, "resetsAt": "2026-11-17T20:00:00Z" },
            "weekly": { "percent": 140 },
            "monthly": { "percent": "bad" }
        }});
        let q = quota_of(&body).unwrap();
        assert_eq!(q.windows.len(), 2);
        assert_eq!(
            q.windows[0].resets_at.as_deref(),
            Some("2026-11-17T20:00:00Z")
        );
        assert_eq!(q.windows[1].percent, 100.0);
        assert!(quota_of(&json!({ "error": "nope" })).is_none());
    }
}
