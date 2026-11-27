//! Edits of `~/.bricks/config.json` (its `providers` array). One provider or
//! model changes while every sibling top-level section (`mcp`, `preferences`,
//! `agent`, …) is preserved untouched. The result is validated as a whole by
//! `bricks-provider` before anything is written.

use crate::contract::{
    IpcErrorCode, IpcResult, ModelPatch, PricingEdit, ProviderPatch, ReasoningProfileEdit,
};
use crate::i18n::{msg, tr};
use crate::services::{error, invalid, not_found};
use bricks_provider::Decimal;
use bricks_provider::config::{ProvidersConfig, SCHEMA_VERSION};
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;

/// One change of the providers section, addressed by ids.
#[derive(Debug, Clone)]
pub enum Edit {
    ProviderUpdate {
        provider_id: String,
        patch: ProviderPatch,
    },
    ModelUpdate {
        provider_id: String,
        model_id: String,
        patch: ModelPatch,
    },
    ProviderDelete {
        provider_id: String,
    },
    ModelDelete {
        provider_id: String,
        model_id: String,
    },
    /// A new provider object, appended after the existing ones. An empty id is
    /// made from the name (see [`slug`]), numbered when taken.
    ProviderCreate {
        provider_id: String,
        patch: ProviderPatch,
    },
    /// A new model object of `provider_id`, with its `limits`. An empty id is
    /// made from the API name (else the name), numbered when taken.
    ModelCreate {
        provider_id: String,
        model_id: String,
        patch: ModelPatch,
    },
    /// A provider and its streamed models in one go (a template), under
    /// `base_id` or, when taken, the first free `base_id-2`, `base_id-3`…
    /// (the name gets the same number).
    ProviderCreateWithModels {
        base_id: String,
        patch: ProviderPatch,
        models: Vec<(String, ModelPatch)>,
    },
    /// Every model without a price for input, output or cache read gets `"0"`
    /// for it (USD per million tokens). Prices already written are kept.
    FillMissingPrices,
    /// A provider's former key variable (`api_key_env`) goes; `key`, the
    /// value it held when set, is written as its `api_key` unless it has one.
    DropKeyVariable {
        provider_id: String,
        key: Option<String>,
    },
    /// Every model's former default level (`reasoning.default`) goes: the
    /// first level applies when none is chosen.
    StripReasoningDefaults,
}

/// The JSON text after `edit`, validated as a whole. `origin` labels errors
/// (the file's path). On error nothing is returned, so nothing is written.
pub fn apply(text: &str, edit: &Edit, origin: &str) -> IpcResult<String> {
    let mut doc: Value = serde_json::from_str(text).map_err(|e| {
        error(
            IpcErrorCode::Config,
            tr!(
                msg::INVALID_JSON,
                origin = origin,
                position = json_position(&e)
            ),
        )
    })?;
    let root = doc.as_object_mut().ok_or_else(|| {
        error(
            IpcErrorCode::Config,
            tr!(
                msg::INVALID_JSON,
                origin = origin,
                position = "root must be a JSON object"
            ),
        )
    })?;
    root.entry("schema_version".to_string())
        .or_insert_with(|| Value::from(SCHEMA_VERSION));

    match edit {
        Edit::ProviderUpdate { provider_id, patch } => {
            let providers = providers_mut(root)?;
            let index = provider_index(providers, provider_id)?;
            let table = providers[index]
                .as_object_mut()
                .ok_or_else(|| not_found(tr!(msg::UNKNOWN_PROVIDER)))?;
            apply_provider_patch(table, patch)?;
        }
        Edit::ModelUpdate {
            provider_id,
            model_id,
            patch,
        } => {
            let providers = providers_mut(root)?;
            let index = provider_index(providers, provider_id)?;
            let table = providers[index]
                .as_object_mut()
                .ok_or_else(|| not_found(tr!(msg::UNKNOWN_PROVIDER)))?;
            let models = models_mut(table)?;
            let index = model_index(models, model_id)?;
            let model = models[index]
                .as_object_mut()
                .ok_or_else(|| not_found(tr!(msg::UNKNOWN_MODEL)))?;
            apply_model_patch(model, patch)?;
        }
        Edit::DropKeyVariable { provider_id, key } => {
            let providers = providers_mut(root)?;
            let index = provider_index(providers, provider_id)?;
            let table = providers[index]
                .as_object_mut()
                .ok_or_else(|| not_found(tr!(msg::UNKNOWN_PROVIDER)))?;
            table.remove("api_key_env");
            if let Some(key) = key
                && !table.contains_key("api_key")
            {
                set_str(table, "api_key", key.trim());
            }
        }
        Edit::StripReasoningDefaults => {
            if let Some(providers) = root.get_mut("providers").and_then(Value::as_array_mut) {
                for provider in providers.iter_mut().filter_map(Value::as_object_mut) {
                    let Some(models) = provider.get_mut("models").and_then(Value::as_array_mut)
                    else {
                        continue;
                    };
                    for model in models.iter_mut().filter_map(Value::as_object_mut) {
                        if let Some(reasoning) =
                            model.get_mut("reasoning").and_then(Value::as_object_mut)
                        {
                            reasoning.remove("default");
                        }
                    }
                }
            }
        }
        Edit::ProviderDelete { provider_id } => {
            let providers = providers_mut(root)?;
            let index = provider_index(providers, provider_id)?;
            providers.remove(index);
        }
        Edit::ModelDelete {
            provider_id,
            model_id,
        } => {
            let providers = providers_mut(root)?;
            let index = provider_index(providers, provider_id)?;
            let table = providers[index]
                .as_object_mut()
                .ok_or_else(|| not_found(tr!(msg::UNKNOWN_PROVIDER)))?;
            let models = models_mut(table)?;
            let index = model_index(models, model_id)?;
            models.remove(index);
        }
        Edit::ProviderCreate { provider_id, patch } => {
            let providers = providers_array_mut(root)?;
            let id = if provider_id.is_empty() {
                let base = slug(patch.name.as_deref().unwrap_or_default(), "provider");
                free_id(&base, |id| provider_index(providers, id).is_ok())
            } else {
                let id = new_id(&tr!(msg::PROVIDER_IDENTIFIER), provider_id)?;
                if provider_index(providers, id).is_ok() {
                    return Err(invalid(tr!(msg::A_PROVIDER_ALREADY_EXISTS, id = id)));
                }
                id.to_string()
            };
            let mut table = Map::new();
            set_str(&mut table, "id", &id);
            apply_provider_patch(&mut table, patch)?;
            providers.push(Value::Object(table));
        }
        Edit::ModelCreate {
            provider_id,
            model_id,
            patch,
        } => {
            let providers = providers_mut(root)?;
            let index = provider_index(providers, provider_id)?;
            let provider = providers[index]
                .as_object_mut()
                .ok_or_else(|| not_found(tr!(msg::UNKNOWN_PROVIDER)))?;
            let models = models_array_mut(provider)?;
            let id = if model_id.is_empty() {
                let source = [patch.api_model.as_deref(), patch.name.as_deref()]
                    .into_iter()
                    .flatten()
                    .find(|s| !s.trim().is_empty())
                    .unwrap_or_default();
                free_id(&slug(source, "model"), |id| model_index(models, id).is_ok())
            } else {
                let id = new_id(&tr!(msg::MODEL_IDENTIFIER), model_id)?;
                if model_index(models, id).is_ok() {
                    return Err(invalid(tr!(msg::A_MODEL_ALREADY_EXISTS_IN_THIS, id = id)));
                }
                id.to_string()
            };
            let mut table = Map::new();
            set_str(&mut table, "id", &id);
            table.insert("limits".into(), Value::Object(Map::new()));
            apply_model_patch(&mut table, patch)?;
            models.push(Value::Object(table));
        }
        Edit::ProviderCreateWithModels {
            base_id,
            patch,
            models,
        } => {
            let base = new_id(&tr!(msg::PROVIDER_IDENTIFIER), base_id)?;
            let providers = providers_array_mut(root)?;
            let (id, number) = (1..)
                .map(|n: u32| match n {
                    1 => (base.to_string(), n),
                    _ => (format!("{base}-{n}"), n),
                })
                .find(|(id, _)| provider_index(providers, id).is_err())
                .unwrap_or_else(|| (base.to_string(), 1));
            let mut patch = patch.clone();
            if number > 1 {
                patch.name = patch.name.map(|name| format!("{name} {number}"));
            }
            let mut table = Map::new();
            set_str(&mut table, "id", &id);
            apply_provider_patch(&mut table, &patch)?;
            let list = models_array_mut(&mut table)?;
            for (model_id, model) in models {
                let model_id = new_id(&tr!(msg::MODEL_IDENTIFIER), model_id)?;
                if model_index(list, model_id).is_ok() {
                    continue;
                }
                let mut entry = Map::new();
                set_str(&mut entry, "id", model_id);
                entry.insert("limits".into(), Value::Object(Map::new()));
                apply_model_patch(&mut entry, model)?;
                entry.insert("streaming".into(), Value::Bool(true));
                list.push(Value::Object(entry));
            }
            providers.push(Value::Object(table));
        }
        Edit::FillMissingPrices => {
            if let Some(providers) = root.get_mut("providers").and_then(Value::as_array_mut) {
                for provider in providers.iter_mut().filter_map(Value::as_object_mut) {
                    let Some(models) = provider.get_mut("models").and_then(Value::as_array_mut)
                    else {
                        continue;
                    };
                    for model in models.iter_mut().filter_map(Value::as_object_mut) {
                        fill_missing_prices(model)?;
                    }
                }
            }
        }
    }

    let next = serde_json::to_string_pretty(&doc)
        .map_err(|e| error(IpcErrorCode::Internal, e.to_string()))?
        + "\n";
    // Validate the whole document as the engine reads it before anything hits disk.
    ProvidersConfig::from_json_str(&next, origin)
        .map_err(|e| invalid(tr!(msg::CHANGE_REFUSED, e = e)))?;
    Ok(next)
}

fn json_position(e: &serde_json::Error) -> String {
    let s = e.to_string();
    let kind = s.split(" at line ").next().unwrap_or("syntax error");
    format!("line {}, column {}: {kind}", e.line(), e.column())
}

fn providers_mut(root: &mut Map<String, Value>) -> IpcResult<&mut Vec<Value>> {
    match root.get_mut("providers") {
        None => Err(not_found(tr!(msg::UNKNOWN_PROVIDER))),
        Some(v) => v
            .as_array_mut()
            .ok_or_else(|| error(IpcErrorCode::Config, "providers must be a JSON array")),
    }
}

fn providers_array_mut(root: &mut Map<String, Value>) -> IpcResult<&mut Vec<Value>> {
    if !root.contains_key("providers") {
        root.insert("providers".into(), Value::Array(Vec::new()));
    }
    providers_mut(root)
}

fn models_mut(provider: &mut Map<String, Value>) -> IpcResult<&mut Vec<Value>> {
    match provider.get_mut("models") {
        None => Err(not_found(tr!(msg::UNKNOWN_MODEL))),
        Some(v) => v
            .as_array_mut()
            .ok_or_else(|| error(IpcErrorCode::Config, "models must be a JSON array")),
    }
}

fn models_array_mut(provider: &mut Map<String, Value>) -> IpcResult<&mut Vec<Value>> {
    if !provider.contains_key("models") {
        provider.insert("models".into(), Value::Array(Vec::new()));
    }
    models_mut(provider)
}

fn entry_id(v: &Value) -> Option<&str> {
    v.as_object()?.get("id")?.as_str()
}

fn provider_index(providers: &[Value], id: &str) -> IpcResult<usize> {
    providers
        .iter()
        .position(|v| entry_id(v) == Some(id))
        .ok_or_else(|| not_found(tr!(msg::UNKNOWN_PROVIDER)))
}

fn model_index(models: &[Value], id: &str) -> IpcResult<usize> {
    models
        .iter()
        .position(|v| entry_id(v) == Some(id))
        .ok_or_else(|| not_found(tr!(msg::UNKNOWN_MODEL)))
}

/// An id made from `text` (a name, an API name): lower case, accented Latin
/// letters without their accent, each run of other characters than letters,
/// digits, `.` and `_` turned into one `-`, at most 64 characters, with no
/// `-`, `.` or `_` at either end; `fallback` when nothing is left.
pub fn slug(text: &str, fallback: &str) -> String {
    let mut out = String::new();
    for c in text.trim().chars().flat_map(char::to_lowercase) {
        let plain = unaccent(c);
        if !plain.is_empty() {
            out.push_str(plain);
        } else if c.is_ascii_alphanumeric() || matches!(c, '.' | '_') {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let edge = |c: char| matches!(c, '-' | '.' | '_');
    let out: String = out.trim_matches(edge).chars().take(64).collect();
    let out = out.trim_matches(edge);
    if out.is_empty() {
        fallback.to_string()
    } else {
        out.to_string()
    }
}

fn unaccent(c: char) -> &'static str {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => "a",
        'æ' => "ae",
        'ç' | 'ć' | 'č' => "c",
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ę' | 'ě' => "e",
        'ì' | 'í' | 'î' | 'ï' | 'ī' => "i",
        'ñ' | 'ń' | 'ň' => "n",
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' => "o",
        'œ' => "oe",
        'ß' => "ss",
        'ś' | 'š' => "s",
        'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' => "u",
        'ý' | 'ÿ' => "y",
        'ź' | 'ż' | 'ž' => "z",
        'ł' => "l",
        'ř' => "r",
        'ť' => "t",
        'ď' => "d",
        _ => "",
    }
}

fn free_id(base: &str, taken: impl Fn(&str) -> bool) -> String {
    (1u32..)
        .map(|n| match n {
            1 => base.to_string(),
            _ => format!("{base}-{n}"),
        })
        .find(|id| !taken(id))
        .unwrap_or_else(|| base.to_string())
}

fn new_id<'a>(field: &str, id: &'a str) -> IpcResult<&'a str> {
    let mut chars = id.chars();
    let valid = matches!(chars.next(), Some(c) if c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if !valid {
        return Err(invalid(tr!(msg::INVALID_ID_CHARACTERS, field = field)));
    }
    Ok(id)
}

fn set_str(table: &mut Map<String, Value>, key: &str, value: &str) {
    table.insert(key.into(), Value::String(value.to_string()));
}

fn set_or_remove(table: &mut Map<String, Value>, key: &str, value: &str) {
    if value.is_empty() {
        table.remove(key);
    } else {
        set_str(table, key, value);
    }
}

fn filled<'a>(field: &str, value: &'a str) -> IpcResult<&'a str> {
    if value.trim().is_empty() {
        return Err(invalid(tr!(msg::FIELD_CANT_BE_EMPTY, field = field)));
    }
    Ok(value)
}

fn apply_provider_patch(table: &mut Map<String, Value>, patch: &ProviderPatch) -> IpcResult<()> {
    if let Some(v) = &patch.name {
        set_str(table, "name", filled("name", v)?);
    }
    if let Some(v) = &patch.endpoint {
        set_str(table, "endpoint", filled("endpoint", v)?);
    }
    if let Some(v) = &patch.protocol {
        set_str(table, "protocol", filled("protocol", v)?);
    }
    if let Some(v) = &patch.auth {
        set_str(table, "auth", filled("auth", v)?);
    }
    if let Some(v) = &patch.auth_header {
        set_or_remove(table, "auth_header", v);
    }
    if let Some(v) = &patch.api_key {
        set_or_remove(table, "api_key", v.trim());
    }
    Ok(())
}

fn apply_model_patch(table: &mut Map<String, Value>, patch: &ModelPatch) -> IpcResult<()> {
    if let Some(v) = &patch.name {
        set_str(table, "name", filled("name", v)?);
    }
    if let Some(v) = &patch.api_model {
        set_str(table, "api_model", filled("api_model", v)?);
    }
    if let Some(mods) = &patch.input_modalities {
        table.insert(
            "input_modalities".into(),
            Value::Array(mods.iter().cloned().map(Value::String).collect()),
        );
        if mods.iter().any(|m| m == "document") {
            table.insert("document_mime_types".into(), json!(["*/*"]));
        } else {
            table.remove("document_mime_types");
        }
    }
    if let Some(prices) = &patch.pricing {
        write_prices(table, prices)?;
    }
    match patch.async_tool_calls {
        Some(false) => {
            table.insert("async_tool_calls".into(), Value::Bool(false));
        }
        Some(true) => {
            table.remove("async_tool_calls");
        }
        None => {}
    }
    match patch.enabled {
        Some(false) => {
            table.insert("enabled".into(), Value::Bool(false));
        }
        Some(true) => {
            table.remove("enabled");
        }
        None => {}
    }
    if patch.max_input_tokens.is_some() || patch.max_output_tokens.is_some() {
        let limits = table
            .get_mut("limits")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                error(
                    IpcErrorCode::Config,
                    tr!(msg::THIS_MODEL_HAS_NO_LIMITS_TABLE),
                )
            })?;
        if let Some(v) = patch.max_input_tokens {
            limits.insert("max_input_tokens".into(), Value::from(v));
        }
        if let Some(v) = patch.max_output_tokens {
            limits.insert("max_output_tokens".into(), Value::from(v));
        }
        // Fold a legacy shared window into `max_input_tokens` when untouched.
        if let Some(window) = limits.remove("context_window_tokens")
            && patch.max_input_tokens.is_none()
            && let (Some(window), Some(input), Some(output)) = (
                window.as_u64(),
                limits.get("max_input_tokens").and_then(Value::as_u64),
                limits.get("max_output_tokens").and_then(Value::as_u64),
            )
        {
            limits.insert(
                "max_input_tokens".into(),
                Value::from(input.min(window.saturating_sub(output))),
            );
        }
    }
    if let Some(profiles) = &patch.profiles {
        check_profiles(profiles)?;
        write_profiles(table, profiles)?;
        if let Some(reasoning) = table.get_mut("reasoning").and_then(Value::as_object_mut) {
            reasoning.remove("default");
        }
    }
    Ok(())
}

const PRICE_CURRENCY: &str = "USD";
const PRICE_PER_TOKENS: u64 = 1_000_000;

fn price<'a>(field: &str, value: &'a str) -> IpcResult<&'a str> {
    let value = filled(field, value.trim())?;
    Decimal::parse(value)
        .map_err(|_| invalid(tr!(msg::A_POSITIVE_NUMBER_OR_ZERO_IS, field = field)))?;
    Ok(value)
}

fn pricing_table(model: &mut Map<String, Value>) -> IpcResult<&mut Map<String, Value>> {
    if !model.contains_key("pricing") {
        model.insert("pricing".into(), Value::Object(Map::new()));
    }
    let pricing = model
        .get_mut("pricing")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            error(
                IpcErrorCode::Config,
                tr!(msg::THIS_MODEL_PRICING_ISNT_A_TABLE),
            )
        })?;
    set_str(pricing, "currency", PRICE_CURRENCY);
    pricing.insert("per_tokens".into(), Value::from(PRICE_PER_TOKENS));
    Ok(pricing)
}

fn write_prices(model: &mut Map<String, Value>, prices: &PricingEdit) -> IpcResult<()> {
    let input = price(&tr!(msg::INPUT_COST), &prices.input)?;
    let output = price(&tr!(msg::OUTPUT_COST), &prices.output)?;
    let cache_read = price(&tr!(msg::CACHE_COST), &prices.cache_read)?;
    let pricing = pricing_table(model)?;
    set_str(pricing, "input", input);
    set_str(pricing, "output", output);
    set_str(pricing, "cache_read", cache_read);
    Ok(())
}

fn fill_missing_prices(model: &mut Map<String, Value>) -> IpcResult<()> {
    let missing = |key: &str, model: &Map<String, Value>| {
        model
            .get("pricing")
            .and_then(Value::as_object)
            .and_then(|p| p.get(key))
            .is_none()
    };
    let keys: Vec<&str> = ["input", "output", "cache_read"]
        .into_iter()
        .filter(|k| missing(k, model))
        .collect();
    if keys.is_empty() {
        return Ok(());
    }
    let pricing = pricing_table(model)?;
    for key in keys {
        set_str(pricing, key, "0");
    }
    Ok(())
}

fn check_profiles(profiles: &[ReasoningProfileEdit]) -> IpcResult<()> {
    let mut seen = BTreeSet::new();
    for profile in profiles {
        if profile.id.trim().is_empty() {
            return Err(invalid(tr!(msg::A_REASONING_PROFILE_HAS_AN_EMPTY)));
        }
        if !seen.insert(profile.id.as_str()) {
            return Err(invalid(tr!(msg::DUPLICATE_PROFILE_ID, id = profile.id)));
        }
        if !profile.parameters.is_object() {
            return Err(invalid(tr!(
                msg::PROFILE_PARAMETERS_MUST_BE_A_JSON,
                id = profile.id
            )));
        }
        for pointer in &profile.remove {
            check_pointer(pointer)
                .map_err(|m| invalid(format!("profil « {} » : {m}", profile.id)))?;
        }
    }
    Ok(())
}

fn check_pointer(pointer: &str) -> Result<(), String> {
    if pointer.is_empty() {
        return Err(tr!(msg::AN_EMPTY_POINTER_WOULD_REMOVE_THE));
    }
    if !pointer.starts_with('/') {
        return Err(tr!(msg::ISNT_A_JSON_POINTER_IT_MUST, pointer = pointer));
    }
    let mut chars = pointer.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '~' && !matches!(chars.peek(), Some('0' | '1')) {
            return Err(tr!(msg::THE_CHARACTER_MUST_BE_WRITTEN_0, pointer = pointer));
        }
    }
    Ok(())
}

fn write_profiles(
    model: &mut Map<String, Value>,
    profiles: &[ReasoningProfileEdit],
) -> IpcResult<()> {
    if profiles.is_empty() {
        if let Some(reasoning) = model.get_mut("reasoning").and_then(Value::as_object_mut) {
            reasoning.remove("profiles");
        }
        return Ok(());
    }
    if !model.contains_key("reasoning") {
        model.insert("reasoning".into(), Value::Object(Map::new()));
    }
    let reasoning = model
        .get_mut("reasoning")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            error(
                IpcErrorCode::Config,
                tr!(msg::THIS_MODEL_REASONING_ISNT_A_TABLE),
            )
        })?;
    let mut list = Vec::with_capacity(profiles.len());
    for profile in profiles {
        let mut entry = Map::new();
        set_str(&mut entry, "id", &profile.id);
        if let Some(label) = profile
            .label
            .as_deref()
            .map(str::trim)
            .filter(|l| !l.is_empty())
        {
            set_str(&mut entry, "label", label);
        }
        if let Some(params) = profile.parameters.as_object()
            && !params.is_empty()
        {
            entry.insert("parameters".into(), Value::Object(params.clone()));
        }
        if !profile.remove.is_empty() {
            entry.insert(
                "remove".into(),
                Value::Array(profile.remove.iter().cloned().map(Value::String).collect()),
            );
        }
        list.push(Value::Object(entry));
    }
    reasoning.insert("profiles".into(), Value::Array(list));
    Ok(())
}

/// Test fixtures shared with command and engine tests.
#[cfg(test)]
pub(crate) mod fixtures {
    pub const PROVIDERS: &str = r#"{
  "schema_version": 1,
  "providers": [
    {
      "id": "local",
      "name": "Local",
      "endpoint": "http://127.0.0.1:9/v1",
      "protocol": "chat_completions",
      "auth": "none",
      "models": [
        {
          "id": "small",
          "name": "Small",
          "api_model": "small-1",
          "streaming": true,
          "limits": {
            "max_input_tokens": 8000,
            "max_output_tokens": 1000
          },
          "reasoning": {
            "default": "fast",
            "profiles": [
              {
                "id": "fast",
                "label": "Rapide"
              }
            ]
          }
        },
        {
          "id": "big",
          "name": "Big",
          "api_model": "big-1",
          "limits": {
            "max_input_tokens": 32000,
            "max_output_tokens": 4000
          }
        }
      ]
    },
    {
      "id": "cloud",
      "name": "Cloud",
      "endpoint": "https://api.example.invalid/v1",
      "protocol": "anthropic_messages",
      "auth": "api_key_header",
      "auth_header": "x-api-key",
      "api_key_env": "BRICKS_TEST_CLOUD_KEY",
      "models": [
        {
          "id": "m1",
          "name": "M1",
          "api_model": "m1",
          "limits": {
            "max_input_tokens": 1000,
            "max_output_tokens": 100
          }
        }
      ]
    },
    {
      "id": "inline",
      "name": "Inline",
      "endpoint": "https://inline.example.invalid/v1",
      "protocol": "chat_completions",
      "auth": "bearer",
      "api_key": "SECRET-KEY-VALUE",
      "headers": {
        "X-Tenant": "HEADER-SECRET-VALUE"
      },
      "models": [
        {
          "id": "i1",
          "name": "I1",
          "api_model": "i1",
          "limits": {
            "max_input_tokens": 1000,
            "max_output_tokens": 100
          }
        }
      ]
    }
  ]
}
"#;
}

#[cfg(test)]
mod tests {
    use super::fixtures::PROVIDERS;
    use super::*;

    fn model_update(provider: &str, model: &str, patch: ModelPatch) -> Edit {
        Edit::ModelUpdate {
            provider_id: provider.into(),
            model_id: model.into(),
            patch,
        }
    }

    fn provider_update(provider: &str, patch: ProviderPatch) -> Edit {
        Edit::ProviderUpdate {
            provider_id: provider.into(),
            patch,
        }
    }

    #[test]
    fn sibling_top_level_sections_survive_provider_edits() {
        let mut doc: Value = serde_json::from_str(PROVIDERS).unwrap();
        doc["preferences"] = json!({ "theme": "dark" });
        doc["mcp"] = json!({ "servers": [{ "name": "files", "command": "npx" }] });
        let input = serde_json::to_string_pretty(&doc).unwrap();
        let next = apply(
            &input,
            &provider_update(
                "local",
                ProviderPatch {
                    name: Some("Local Renamed".into()),
                    ..Default::default()
                },
            ),
            "config.json",
        )
        .unwrap();
        let parsed: Value = serde_json::from_str(&next).unwrap();
        assert_eq!(parsed["preferences"]["theme"], "dark");
        assert_eq!(parsed["mcp"]["servers"][0]["name"], "files");
        assert_eq!(parsed["providers"][0]["name"], "Local Renamed");
    }

    #[test]
    fn a_model_is_disabled_by_writing_enabled_false() {
        let set = |value| {
            model_update(
                "local",
                "small",
                ModelPatch {
                    enabled: Some(value),
                    ..Default::default()
                },
            )
        };
        let off = apply(PROVIDERS, &set(false), "test").unwrap();
        let parsed: Value = serde_json::from_str(&off).unwrap();
        assert_eq!(parsed["providers"][0]["models"][0]["enabled"], false);
        let back = apply(&off, &set(true), "test").unwrap();
        let parsed_back: Value = serde_json::from_str(&back).unwrap();
        assert!(
            parsed_back["providers"][0]["models"][0]
                .get("enabled")
                .is_none()
        );
    }

    #[test]
    fn async_tool_calls_is_written_when_off_and_removed_when_on() {
        let on = |value| {
            model_update(
                "local",
                "small",
                ModelPatch {
                    async_tool_calls: Some(value),
                    ..Default::default()
                },
            )
        };
        let off = apply(PROVIDERS, &on(false), "test").unwrap();
        assert!(off.contains("\"async_tool_calls\": false"), "{off}");
        let back = apply(&off, &on(true), "test").unwrap();
        assert!(!back.contains("async_tool_calls"), "{back}");
    }

    #[test]
    fn slug_normalizes_names_and_accents() {
        assert_eq!(slug("Mon Fournisseur #1!", "provider"), "mon-fournisseur-1");
        assert_eq!(slug("Été à Paris", "provider"), "ete-a-paris");
        assert_eq!(slug("   ---   ", "fallback"), "fallback");
    }

    #[test]
    fn fill_missing_prices_adds_zero_and_keeps_existing_prices() {
        let priced = apply(
            PROVIDERS,
            &model_update(
                "local",
                "small",
                ModelPatch {
                    pricing: Some(PricingEdit {
                        input: "1.50".into(),
                        output: "3.00".into(),
                        cache_read: "0.25".into(),
                    }),
                    ..Default::default()
                },
            ),
            "test",
        )
        .unwrap();
        let filled = apply(&priced, &Edit::FillMissingPrices, "test").unwrap();
        let cfg = ProvidersConfig::from_json_str(&filled, "test").unwrap();
        let small = cfg.providers[0].models[0].pricing.as_ref().unwrap();
        assert_eq!(small.input.unwrap().to_string(), "1.5");
        let big = cfg.providers[0].models[1].pricing.as_ref().unwrap();
        assert_eq!(big.input.unwrap().to_string(), "0");
        assert_eq!(big.output.unwrap().to_string(), "0");
        assert_eq!(big.cache_read.unwrap().to_string(), "0");
    }

    #[test]
    fn profiles_edit_validates_and_strips_legacy_default() {
        let next = apply(
            PROVIDERS,
            &model_update(
                "local",
                "small",
                ModelPatch {
                    profiles: Some(vec![
                        ReasoningProfileEdit {
                            id: "low".into(),
                            label: Some("Low".into()),
                            parameters: json!({ "reasoning_effort": "low" }),
                            remove: vec!["/temperature".into()],
                        },
                        ReasoningProfileEdit {
                            id: "high".into(),
                            label: None,
                            parameters: json!({ "reasoning_effort": "high" }),
                            remove: vec![],
                        },
                    ]),
                    ..Default::default()
                },
            ),
            "test",
        )
        .unwrap();
        let parsed: Value = serde_json::from_str(&next).unwrap();
        let reasoning = &parsed["providers"][0]["models"][0]["reasoning"];
        assert!(reasoning.get("default").is_none());
        assert_eq!(reasoning["profiles"].as_array().unwrap().len(), 2);
        assert_eq!(reasoning["profiles"][0]["remove"][0], "/temperature");
    }
}
