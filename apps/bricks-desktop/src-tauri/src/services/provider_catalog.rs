//! Providers Bricks adds in one step: OpenCode Go and Zen, each through its
//! three APIs. Each plan offers a chosen list of models, the same through
//! every API (OpenCode serves every text model, and its reasoning effort,
//! through each of them). Their details come from the models.dev catalogue
//! (names, limits, inputs, prices, reasoning levels), kept to the ones the
//! gateway lists right now when its model list answers.

use crate::contract::{IpcResult, ModelPatch, PricingEdit, ProviderTemplate, ReasoningProfileEdit};
use crate::i18n::{msg, tr};
use crate::services::{error, invalid};
use serde_json::{Value, json};
use std::collections::HashSet;
use std::time::Duration;

/// The catalogue of model metadata.
const MODELS_DEV: &str = "https://models.dev/api.json";
const KEY_URL: &str = "https://opencode.ai/auth";
const FETCH_TIMEOUT: Duration = Duration::from_secs(20);

/// One OpenCode plan: its base URL, its live model list and its models.dev id.
struct Plan {
    brand: &'static str,
    slug: &'static str,
    base: &'static str,
    models_url: &'static str,
    catalog_id: &'static str,
    /// The models the plan's providers get, in this order.
    models: &'static [&'static str],
}

const GO: Plan = Plan {
    brand: "OpenCode Go",
    slug: "go",
    base: "https://opencode.ai/inference/go",
    models_url: "https://opencode.ai/inference/go/v1/models",
    catalog_id: "opencode-go",
    models: &[
        "claude-haiku-5-5",
        "deepseek-v4.1-flash",
        "glm-5.3",
        "glm-5.2",
        "glm-5.3-flash",
        "gpt-6-luna",
        "grok-4.7",
        "minimax-m3.1-flash",
        "hy4-flash-free",
        "muse-spark-1.3-contributor",
        "step-5-preview",
        "qwen4-max",
        "kimi-k3.1-pro",
    ],
};

const ZEN: Plan = Plan {
    brand: "OpenCode Zen",
    slug: "zen",
    base: "https://opencode.ai/inference",
    models_url: "https://opencode.ai/inference/v1/models",
    catalog_id: "opencode",
    models: &[
        "claude-opus-5-5",
        "glm-5.3",
        "glm-5.2",
        "glm-5.3-flash",
        "deepseek-v4.1-flash",
        "minimax-m3",
        "qwen3.8-max",
        "muse-wonder-1.0",
    ],
};

/// The three APIs: protocol, label, path after the plan's base.
const APIS: [(&str, &str, &str); 3] = [
    ("chat_completions", "Chat", "/openai/v1"),
    ("responses", "Responses", "/openai/v1"),
    ("anthropic_messages", "Anthropic", "/anthropic/v1"),
];

/// The six templates, Go first.
pub fn templates() -> Vec<ProviderTemplate> {
    [&GO, &ZEN]
        .into_iter()
        .flat_map(|plan| {
            APIS.iter()
                .map(move |(protocol, label, path)| ProviderTemplate {
                    id: format!("opencode-{}-{}", plan.slug, short(protocol)),
                    name: format!("{} ({label})", plan.brand),
                    brand: plan.brand.to_string(),
                    logo: "opencode".to_string(),
                    endpoint: format!("{}{path}", plan.base),
                    protocol: protocol.to_string(),
                    key_url: KEY_URL.to_string(),
                })
        })
        .collect()
}

fn short(protocol: &str) -> &'static str {
    match protocol {
        "responses" => "responses",
        "anthropic_messages" => "anthropic",
        _ => "chat",
    }
}

/// The brand of an endpoint whose logo the settings show.
pub fn logo_of(endpoint: &str) -> Option<&'static str> {
    let host = host_of(endpoint)?.to_ascii_lowercase();
    (host == "opencode.ai" || host.ends_with(".opencode.ai")).then_some("opencode")
}

/// The host of an http(s) URL, without parsing more than needed.
fn host_of(endpoint: &str) -> Option<String> {
    let rest = endpoint
        .trim()
        .strip_prefix("https://")
        .or_else(|| endpoint.trim().strip_prefix("http://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?.split(':').next()?;
    (!host.is_empty()).then(|| host.to_string())
}

/// The template `id`.
pub fn template(id: &str) -> IpcResult<ProviderTemplate> {
    templates()
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| invalid(tr!(msg::UNKNOWN_TEMPLATE, id = id)))
}

fn plan_of(t: &ProviderTemplate) -> &'static Plan {
    if t.brand == GO.brand { &GO } else { &ZEN }
}

/// One model of a template, ready to write.
#[derive(Debug, Clone)]
pub struct TemplateModel {
    pub id: String,
    pub patch: ModelPatch,
}

/// The models of template `t`: models.dev, kept to the live list when the
/// gateway answers. An unreachable catalogue is an error; an unreachable live
/// list only means no filter.
pub async fn models_for(t: &ProviderTemplate) -> IpcResult<Vec<TemplateModel>> {
    let plan = plan_of(t);
    let client = bricks_types::http::client();
    let fetch = |url: &'static str| {
        let request = client
            .get(url)
            .header("user-agent", bricks_provider::USER_AGENT)
            .timeout(FETCH_TIMEOUT)
            .send();
        async move {
            let response = request.await.map_err(|e| e.to_string())?;
            let response = response.error_for_status().map_err(|e| e.to_string())?;
            response.json::<Value>().await.map_err(|e| e.to_string())
        }
    };
    let (catalog, live) = tokio::join!(fetch(MODELS_DEV), fetch(plan.models_url));
    let catalog = catalog.map_err(|e| {
        error(
            crate::contract::IpcErrorCode::Io,
            tr!(msg::CATALOG_UNREACHABLE, e = e),
        )
    })?;
    let live = live.ok().map(|v| live_ids(&v));
    let models = from_catalog(
        &catalog,
        plan.catalog_id,
        plan.models,
        &t.protocol,
        live.as_ref(),
    );
    if models.is_empty() {
        return Err(invalid(tr!(msg::CATALOG_HAS_NO_MODEL, name = &t.name)));
    }
    Ok(models)
}

/// The ids of an OpenAI-style model list (`{"data": [{"id": …}]}`).
fn live_ids(list: &Value) -> HashSet<String> {
    list["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m["id"].as_str().map(str::to_string))
        .collect()
}

/// The `wanted` models of `catalog_id` in a models.dev catalogue, in that
/// order, as models of `protocol`: current ones only, and only those the live
/// list names when there is one.
pub fn from_catalog(
    catalog: &Value,
    catalog_id: &str,
    wanted: &[&str],
    protocol: &str,
    live: Option<&HashSet<String>>,
) -> Vec<TemplateModel> {
    let models = &catalog[catalog_id]["models"];
    wanted
        .iter()
        .filter(|id| live.is_none_or(|ids| ids.contains(**id)))
        .filter_map(|id| {
            let m = models.get(*id)?;
            if m["status"].as_str() == Some("deprecated") {
                return None;
            }
            model_patch(id, m, protocol).map(|patch| TemplateModel {
                id: id.to_string(),
                patch,
            })
        })
        .collect()
}

/// A models.dev model as a model of the providers file. `None` without
/// usable limits.
fn model_patch(id: &str, m: &Value, protocol: &str) -> Option<ModelPatch> {
    let context = m["limit"]["context"].as_u64().filter(|n| *n > 0)?;
    let output = m["limit"]["output"].as_u64().filter(|n| *n > 0)?;
    // The prompt budget: the declared input limit, else what the window
    // leaves once the output is reserved.
    let (input, output) = match m["limit"]["input"].as_u64().filter(|n| *n > 0) {
        Some(input) => (input, output),
        None if context > output => (context - output, output),
        None => (context - context / 4, context / 4),
    };
    Some(ModelPatch {
        name: Some(m["name"].as_str().unwrap_or(id).to_string()),
        api_model: Some(id.to_string()),
        max_input_tokens: Some(input),
        max_output_tokens: Some(output.max(1)),
        input_modalities: Some(modalities(&m["modalities"]["input"])),
        pricing: pricing(&m["cost"]),
        profiles: Some(profiles(&m["reasoning_options"], protocol)),
        async_tool_calls: None,
        enabled: None,
    })
}

/// Input kinds Bricks knows, text always first.
fn modalities(input: &Value) -> Vec<String> {
    let mut out = vec!["text".to_string()];
    for kind in input
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        let kind = match kind {
            "pdf" => "document",
            "image" | "audio" | "video" => kind,
            _ => continue,
        };
        if !out.iter().any(|k| k == kind) {
            out.push(kind.to_string());
        }
    }
    out
}

/// Prices per million tokens, or `None` when the catalogue has none.
fn pricing(cost: &Value) -> Option<PricingEdit> {
    let price = |key: &str| cost[key].as_f64().filter(|v| *v >= 0.0).map(decimal);
    Some(PricingEdit {
        input: price("input")?,
        output: price("output")?,
        cache_read: price("cache_read").unwrap_or_else(|| "0".to_string()),
    })
}

/// A price as the providers file reads it: plain decimal, at most 12 places.
fn decimal(value: f64) -> String {
    let text = format!("{value:.12}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text.is_empty() || text == "-" {
        "0".to_string()
    } else {
        text.to_string()
    }
}

/// The levels a model offers, as request parameters of `protocol`. The
/// first applies when none is chosen, so `medium` leads, else `high`, else
/// the catalogue's first.
fn profiles(options: &Value, protocol: &str) -> Vec<ReasoningProfileEdit> {
    // Effort levels when the model has them, else its on/off switch.
    let all = options.as_array().map(Vec::as_slice).unwrap_or_default();
    let Some(option) = all
        .iter()
        .find(|o| o["type"] == "effort")
        .or_else(|| all.iter().find(|o| o["type"] == "toggle"))
    else {
        return Vec::new();
    };
    let level = |id: &str, parameters: Value| ReasoningProfileEdit {
        id: id.to_string(),
        label: None,
        parameters,
        remove: Vec::new(),
    };
    match option["type"].as_str() {
        Some("effort") => {
            let mut values: Vec<&str> = option["values"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            if let Some(lead) = ["medium", "high"]
                .iter()
                .find_map(|v| values.iter().position(|x| x == v))
            {
                let v = values.remove(lead);
                values.insert(0, v);
            }
            values
                .into_iter()
                .map(|v| level(v, effort_parameters(v, protocol)))
                .collect()
        }
        Some("toggle") if protocol == "chat_completions" => vec![
            level("on", json!({ "thinking": { "type": "enabled" } })),
            level("off", json!({ "thinking": { "type": "disabled" } })),
        ],
        _ => Vec::new(),
    }
}

fn effort_parameters(effort: &str, protocol: &str) -> Value {
    match protocol {
        "responses" => json!({ "reasoning": { "effort": effort } }),
        "anthropic_messages" => json!({
            "thinking": { "type": "adaptive" },
            "output_config": { "effort": effort }
        }),
        _ => json!({ "reasoning_effort": effort }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog() -> Value {
        json!({
            "opencode-go": {
                "npm": "@ai-sdk/openai-compatible",
                "models": {
                    "kimi": {
                        "name": "Kimi", "limit": { "context": 1000, "output": 200 },
                        "modalities": { "input": ["text", "image", "pdf", "weird"] },
                        "cost": { "input": 0.5, "output": 2.0 },
                        "reasoning_options": [{ "type": "effort", "values": ["low", "medium", "high"] }]
                    },
                    "gpt": {
                        "name": "GPT", "provider": { "npm": "@ai-sdk/openai" },
                        "limit": { "context": 1000, "input": 900, "output": 100 },
                        "reasoning_options": [{ "type": "effort", "values": ["low", "high"] }]
                    },
                    "claude": {
                        "name": "Claude", "provider": { "npm": "@ai-sdk/anthropic" },
                        "limit": { "context": 1000, "output": 100 },
                        "reasoning_options": [{ "type": "toggle" }, { "type": "effort", "values": ["low", "high"] }]
                    },
                    "old": {
                        "name": "Old", "status": "deprecated",
                        "limit": { "context": 1000, "output": 100 }
                    },
                    "nolimits": { "name": "No limits" }
                }
            }
        })
    }

    #[test]
    fn six_templates_go_first_with_the_documented_bases() {
        let all = templates();
        let ids: Vec<&str> = all.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "opencode-go-chat",
                "opencode-go-responses",
                "opencode-go-anthropic",
                "opencode-zen-chat",
                "opencode-zen-responses",
                "opencode-zen-anthropic"
            ]
        );
        assert_eq!(
            all[0].endpoint,
            "https://opencode.ai/inference/go/openai/v1"
        );
        assert_eq!(
            all[2].endpoint,
            "https://opencode.ai/inference/go/anthropic/v1"
        );
        assert_eq!(all[4].endpoint, "https://opencode.ai/inference/openai/v1");
        assert_eq!(all[5].protocol, "anthropic_messages");
        assert_eq!(all[3].name, "OpenCode Zen (Chat)");
    }

    #[test]
    fn the_logo_follows_the_host() {
        assert_eq!(
            logo_of("https://opencode.ai/inference/go/openai/v1"),
            Some("opencode")
        );
        assert_eq!(logo_of("https://api.opencode.ai/v1"), Some("opencode"));
        assert_eq!(logo_of("https://notopencode.ai/v1"), None);
        assert_eq!(logo_of("https://opencode.ai.example.com/v1"), None);
        assert_eq!(logo_of("not a url"), None);
    }

    const WANTED: &[&str] = &["claude", "kimi", "old", "missing", "nolimits", "gpt"];

    #[test]
    fn only_the_chosen_current_models_in_their_order_under_every_api() {
        let c = catalog();
        for protocol in ["chat_completions", "responses", "anthropic_messages"] {
            let ids: Vec<String> = from_catalog(&c, "opencode-go", WANTED, protocol, None)
                .into_iter()
                .map(|m| m.id)
                .collect();
            assert_eq!(ids, ["claude", "kimi", "gpt"], "{protocol}");
        }
    }

    #[test]
    fn the_live_list_filters_when_it_answers() {
        let live: HashSet<String> = ["gpt".to_string()].into();
        let ids: Vec<String> = from_catalog(
            &catalog(),
            "opencode-go",
            WANTED,
            "chat_completions",
            Some(&live),
        )
        .into_iter()
        .map(|m| m.id)
        .collect();
        assert_eq!(ids, ["gpt"]);
    }

    #[test]
    fn every_chosen_model_is_named_once_per_plan() {
        for plan in [&GO, &ZEN] {
            let unique: HashSet<&&str> = plan.models.iter().collect();
            assert_eq!(unique.len(), plan.models.len(), "{}", plan.brand);
        }
        assert_eq!(GO.models.len(), 13);
        assert_eq!(ZEN.models.len(), 8);
    }

    #[test]
    fn a_model_gets_limits_inputs_prices_and_levels() {
        let m = from_catalog(
            &catalog(),
            "opencode-go",
            &["kimi"],
            "chat_completions",
            None,
        )
        .remove(0);
        let p = m.patch;
        assert_eq!(p.max_input_tokens, Some(800));
        assert_eq!(p.max_output_tokens, Some(200));
        assert_eq!(p.input_modalities.unwrap(), ["text", "image", "document"]);
        let price = p.pricing.unwrap();
        assert_eq!(
            (
                price.input.as_str(),
                price.output.as_str(),
                price.cache_read.as_str()
            ),
            ("0.5", "2", "0")
        );
        assert_eq!(decimal(0.0000000000001), "0");
        assert_eq!(decimal(1.0 / 3.0), "0.333333333333");
        let levels = p.profiles.unwrap();
        let ids: Vec<&str> = levels.iter().map(|l| l.id.as_str()).collect();
        assert_eq!(ids, ["medium", "low", "high"]);
        assert_eq!(
            levels[0].parameters,
            json!({ "reasoning_effort": "medium" })
        );
    }

    #[test]
    fn levels_follow_the_protocol() {
        let gpt = from_catalog(&catalog(), "opencode-go", &["gpt"], "responses", None)
            .remove(0)
            .patch;
        assert_eq!(gpt.max_input_tokens, Some(900));
        let levels = gpt.profiles.unwrap();
        assert_eq!(levels[0].id, "high");
        assert_eq!(
            levels[0].parameters,
            json!({ "reasoning": { "effort": "high" } })
        );
        assert_eq!(
            effort_parameters("max", "anthropic_messages"),
            json!({ "thinking": { "type": "adaptive" }, "output_config": { "effort": "max" } })
        );
        let claude = from_catalog(
            &catalog(),
            "opencode-go",
            &["claude"],
            "anthropic_messages",
            None,
        )
        .remove(0)
        .patch;
        assert!(claude.pricing.is_none());
        // The effort levels win over the on/off switch listed first.
        let levels = claude.profiles.unwrap();
        assert_eq!(levels[0].id, "high");
        assert_eq!(
            levels[0].parameters,
            json!({ "thinking": { "type": "adaptive" }, "output_config": { "effort": "high" } })
        );
    }
}
