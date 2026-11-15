//! DuckDuckGo's HTML interface (`html.duckduckgo.com/html/`).
//!
//! This is a web page without JavaScript, not a contractual API: its markup
//! can change and the service can refuse automated requests. The parser
//! therefore tells apart four situations — results, an explicit "no
//! results", an anti-bot challenge (even with HTTP 200), and a page it does
//! not recognise — instead of reading the last three as an empty search.
//! Requests carry the configured, identified User-Agent; no challenge is
//! answered or worked around.

use super::{RawHit, SearchError, SearchOptions, TimeRange, parse_retry_after_ms, scoped_query};
use crate::config::{ProviderConfig, ProviderKind};
use dom_query::Document;
use url::Url;

pub(crate) async fn search(
    client: &reqwest::Client,
    p: &ProviderConfig,
    query: &str,
    opts: &SearchOptions,
) -> Result<Vec<RawHit>, SearchError> {
    search_inner(client, p, query, opts, false).await
}

pub(crate) async fn search_lite(
    client: &reqwest::Client,
    p: &ProviderConfig,
    query: &str,
    opts: &SearchOptions,
) -> Result<Vec<RawHit>, SearchError> {
    search_inner(client, p, query, opts, true).await
}

async fn search_inner(
    client: &reqwest::Client,
    p: &ProviderConfig,
    query: &str,
    opts: &SearchOptions,
    lite: bool,
) -> Result<Vec<RawHit>, SearchError> {
    let q_str = scoped_query(query, opts);
    let mut params = vec![("q", q_str)];
    if let Some(df) = ddg_df(opts.time_range) {
        params.push(("df", df.to_string()));
    }
    let resp = client
        .get(p.endpoint.clone())
        .query(&params)
        .header(reqwest::header::ACCEPT, "text/html")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                SearchError::Timeout { ms: 0 }
            } else {
                SearchError::Network(e.to_string())
            }
        })?;
    let status = resp.status().as_u16();
    let retry_after = parse_retry_after_ms(resp.headers().get("retry-after"));
    let body = read_limited_text(resp, 2_000_000).await?;
    parse_status(status, retry_after, &body, &p.endpoint, lite)
}

fn ddg_df(tr: Option<TimeRange>) -> Option<&'static str> {
    match tr? {
        TimeRange::Day => Some("d"),
        TimeRange::Week => Some("w"),
        TimeRange::Month => Some("m"),
        TimeRange::Year => Some("y"),
    }
}

pub(crate) async fn read_limited_text(
    mut resp: reqwest::Response,
    max: usize,
) -> Result<String, SearchError> {
    let mut buf = Vec::new();
    while let Some(c) = resp
        .chunk()
        .await
        .map_err(|e| SearchError::Network(e.to_string()))?
    {
        buf.extend_from_slice(&c);
        if buf.len() > max {
            return Err(SearchError::Malformed(format!(
                "response larger than {max} bytes"
            )));
        }
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Classify and parse a results page.
pub fn parse(status: u16, body: &str, endpoint: &Url) -> Result<Vec<RawHit>, SearchError> {
    parse_status(status, None, body, endpoint, false)
}

/// Classify and parse a DuckDuckGo Lite results page.
pub fn parse_lite(status: u16, body: &str, endpoint: &Url) -> Result<Vec<RawHit>, SearchError> {
    parse_status(status, None, body, endpoint, true)
}

fn parse_status(
    status: u16,
    retry_after_ms: Option<u64>,
    body: &str,
    endpoint: &Url,
    lite: bool,
) -> Result<Vec<RawHit>, SearchError> {
    let lower = body.to_ascii_lowercase();
    if is_challenge(&lower) {
        return Err(SearchError::Challenge);
    }
    match status {
        200 => {}
        429 => {
            return Err(SearchError::RateLimited { retry_after_ms });
        }
        403 => {
            return Err(SearchError::Http {
                status,
                detail: "the service refused the request".into(),
            });
        }
        s => {
            return Err(SearchError::Http {
                status: s,
                detail: super::excerpt(body, None),
            });
        }
    }
    let doc = Document::from(body);
    if lite {
        return parse_lite_doc(&doc, &lower, endpoint);
    }
    let mut hits = Vec::new();
    let mut rank = 0;
    for node in doc.select("div.result, div.web-result").iter() {
        let class = node
            .attr("class")
            .map(|c| c.to_string())
            .unwrap_or_default();
        if class.contains("result--ad") || class.contains("result--no-result") {
            continue;
        }
        let link = node.select("a.result__a");
        let Some(href) = link.attr("href") else {
            continue;
        };
        rank += 1;
        let Some(url) = result_url(&href, endpoint) else {
            continue;
        };
        let title = clean(&link.text());
        let snippet = clean(&node.select(".result__snippet").text());
        hits.push(RawHit {
            title: if title.is_empty() { url.clone() } else { title },
            url,
            snippet,
            provider: ProviderKind::DuckDuckGo,
            rank,
            raw_content: None,
        });
    }
    if !hits.is_empty() {
        return Ok(hits);
    }
    let no_results = doc.select(".no-results, .result--no-result").length() > 0
        || lower.contains("no results.")
        || lower.contains("no more results");
    if no_results {
        return Ok(Vec::new());
    }
    Err(SearchError::StructureChanged)
}

fn parse_lite_doc(doc: &Document, lower: &str, endpoint: &Url) -> Result<Vec<RawHit>, SearchError> {
    let mut hits = Vec::new();
    let mut rank = 0;
    let snippets: Vec<String> = doc
        .select("td.result-snippet")
        .iter()
        .map(|n| clean(&n.text()))
        .collect();
    for (idx, link) in doc.select("a.result-link").iter().enumerate() {
        let Some(href) = link.attr("href") else {
            continue;
        };
        rank += 1;
        let Some(url) = result_url(&href, endpoint) else {
            continue;
        };
        let title = clean(&link.text());
        let snippet = snippets.get(idx).cloned().unwrap_or_default();
        hits.push(RawHit {
            title: if title.is_empty() { url.clone() } else { title },
            url,
            snippet,
            provider: ProviderKind::DdgLite,
            rank,
            raw_content: None,
        });
    }
    if !hits.is_empty() {
        return Ok(hits);
    }
    let no_results = lower.contains("no results")
        || lower.contains("no more results")
        || doc.select(".no-results").length() > 0;
    if no_results {
        return Ok(Vec::new());
    }
    Err(SearchError::StructureChanged)
}

fn is_challenge(lower: &str) -> bool {
    [
        "anomaly-modal",
        "challenge-form",
        "/anomaly.js",
        "bots use duckduckgo too",
        "please complete the following challenge",
        "select all squares containing",
    ]
    .iter()
    .any(|m| lower.contains(m))
}

/// The direct URL of a result link. `uddg` is decoded only on DuckDuckGo's
/// own redirect path (`/l/`); other DuckDuckGo links are internal and
/// dropped; relative links are resolved against the endpoint.
pub fn result_url(href: &str, endpoint: &Url) -> Option<String> {
    let u = endpoint.join(href.trim()).ok()?;
    let host = u.host_str().unwrap_or_default().to_ascii_lowercase();
    let is_ddg = host == "duckduckgo.com" || host.ends_with(".duckduckgo.com");
    let target = if is_ddg {
        if !u.path().starts_with("/l/") {
            return None;
        }
        let v = u.query_pairs().find(|(k, _)| k == "uddg")?.1.into_owned();
        Url::parse(&v).ok()?
    } else {
        u
    };
    matches!(target.scheme(), "http" | "https")
        .then(|| target.host().is_some())
        .filter(|ok| *ok)
        .map(|_| target.to_string())
}

fn clean(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ep() -> Url {
        Url::parse("https://html.duckduckgo.com/html/").unwrap()
    }

    #[test]
    fn uddg_is_decoded_only_on_the_redirect_path() {
        let e = ep();
        assert_eq!(
            result_url(
                "//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.rs%2Ftokio%3Fa%3D1%26b%3D2&rut=abc",
                &e
            )
            .as_deref(),
            Some("https://docs.rs/tokio?a=1&b=2")
        );
        assert_eq!(
            result_url("https://example.org/page?uddg=x", &e).as_deref(),
            Some("https://example.org/page?uddg=x")
        );
        assert_eq!(result_url("/html/?q=next", &e), None);
        assert_eq!(
            result_url("//duckduckgo.com/l/?uddg=javascript%3Aalert(1)", &e),
            None
        );
        assert_eq!(result_url("//duckduckgo.com/y.js?ad=1", &e), None);
    }
}
