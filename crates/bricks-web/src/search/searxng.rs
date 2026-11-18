//! SearXNG JSON search API (`?q=...&format=json`).
//!
//! Targets a user-configured (typically local or private) SearXNG instance.

use super::{
    RawHit, SearchError, SearchOptions, TimeRange, excerpt, parse_retry_after_ms, scoped_query,
};
use crate::config::{ProviderConfig, ProviderKind};
use serde_json::Value;

pub(crate) async fn search(
    client: &reqwest::Client,
    p: &ProviderConfig,
    query: &str,
    count: usize,
    opts: &SearchOptions,
) -> Result<Vec<RawHit>, SearchError> {
    let q_str = scoped_query(query, opts);
    let mut params = vec![("q", q_str), ("format", "json".to_string())];
    if let Some(tr) = opts.time_range {
        let v = match tr {
            TimeRange::Day => "day",
            TimeRange::Week => "week",
            TimeRange::Month => "month",
            TimeRange::Year => "year",
        };
        params.push(("time_range", v.to_string()));
    }
    if let Some(mode) = &p.mode
        && !mode.trim().is_empty()
    {
        params.push(("categories", mode.trim().to_string()));
    }
    let resp = client
        .get(p.endpoint.clone())
        .query(&params)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                SearchError::Timeout { ms: 0 }
            } else {
                SearchError::Network(e.without_url().to_string())
            }
        })?;
    let status = resp.status().as_u16();
    let headers = resp.headers().clone();
    let body = super::ddg::read_limited_text(resp, 4_000_000).await?;
    if !(200..300).contains(&status) {
        return Err(match status {
            401 | 403 => SearchError::Auth { status },
            429 => SearchError::RateLimited {
                retry_after_ms: parse_retry_after_ms(headers.get("retry-after")),
            },
            500..=599 => SearchError::Unavailable(format!("HTTP {status} from searxng")),
            _ => SearchError::Http {
                status,
                detail: excerpt(&body, None),
            },
        });
    }
    let v: Value = serde_json::from_str(&body)
        .map_err(|e| SearchError::Malformed(format!("searxng returned invalid JSON: {e}")))?;
    parse(&v, count)
}

pub fn parse(v: &Value, count: usize) -> Result<Vec<RawHit>, SearchError> {
    let list = v
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(|| SearchError::Malformed("searxng: no result list in the response".into()))?;
    let mut out = Vec::new();
    for (i, r) in list.iter().enumerate() {
        if out.len() >= count.clamp(1, 20) {
            break;
        }
        let Some(url) = r.get("url").and_then(Value::as_str) else {
            continue;
        };
        let Ok(parsed) = url::Url::parse(url) else {
            continue;
        };
        if !matches!(parsed.scheme(), "http" | "https") {
            continue;
        }
        let title = r
            .get("title")
            .and_then(Value::as_str)
            .map(clean)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| url.to_string());
        let snippet = r
            .get("content")
            .and_then(Value::as_str)
            .map(clean)
            .unwrap_or_default();
        out.push(RawHit {
            title,
            url: url.to_string(),
            snippet: snippet.chars().take(500).collect(),
            provider: ProviderKind::Searxng,
            rank: i + 1,
            raw_content: None,
        });
    }
    Ok(out)
}

fn clean(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_searxng_json_results() {
        let v = serde_json::json!({
            "query": "tokio",
            "results": [
                {"title": "Tokio  docs", "url": "https://docs.rs/tokio", "content": "Async\n runtime"},
                {"title": "bad", "url": "javascript:alert(1)"}
            ]
        });
        let hits = parse(&v, 5).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Tokio docs");
        assert_eq!(hits[0].snippet, "Async runtime");
        assert_eq!(hits[0].provider, ProviderKind::Searxng);
    }
}
