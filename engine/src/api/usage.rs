use crate::api::{ErrorResponse, SharedState};
use axum::{extract::Query, extract::State, http::StatusCode, Json};
use chrono::{DateTime, Duration, TimeZone, Utc};
use encorehub_storage::sqlite::UsageRecordRow;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const PROVIDER_PROFILES_CONFIG_KEY: &str = "provider_profiles";
const USAGE_EXCHANGE_RATES_CONFIG_KEY: &str = "usage_exchange_rates";
const DEFAULT_DISPLAY_CURRENCY: &str = "USD";
const DEFAULT_EXCHANGE_RATES: [(&str, f64); 3] = [("USD", 1.0), ("CNY", 7.2), ("EUR", 0.92)];

#[derive(Debug, Deserialize)]
pub struct UsageQuery {
    range: Option<String>,
    from: Option<String>,
    to: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    currency: Option<String>,
    timezone_offset_minutes: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct UsageReport {
    records: Vec<UsageRecord>,
    totals: UsageTotals,
    trend: Vec<UsageTrendBucket>,
    provider_breakdown: Vec<UsageBreakdownItem>,
    model_breakdown: Vec<UsageBreakdownItem>,
    providers: Vec<String>,
    models: Vec<String>,
    currencies: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct UsageRecord {
    id: String,
    conversation_id: String,
    conversation_title: String,
    provider: String,
    model: String,
    input_tokens: i32,
    output_tokens: i32,
    cache_creation_tokens: i32,
    cache_read_tokens: i32,
    duration_ms: i64,
    cost: Option<f64>,
    currency: String,
    status: String,
    created_at: String,
}

#[derive(Debug, Default, Serialize)]
pub struct UsageTotals {
    input: i64,
    output: i64,
    cache_creation: i64,
    cache_read: i64,
    requests: usize,
    duration_ms: i64,
    cost: Option<f64>,
    currency: String,
    priced: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct UsageTrendBucket {
    start_at: String,
    label: String,
    input: i64,
    output: i64,
    tokens: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct UsageBreakdownItem {
    name: String,
    requests: usize,
    input: i64,
    output: i64,
    tokens: i64,
    share: f64,
    cost: Option<f64>,
    currency: String,
    #[serde(skip)]
    priced: usize,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct PricingProfile {
    id: String,
    #[serde(default)]
    model_configs: Vec<PricingModelConfig>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct PricingModelConfig {
    id: String,
    currency: Option<String>,
    input_price: Option<f64>,
    output_price: Option<f64>,
    #[serde(default)]
    pricing: BTreeMap<String, Vec<PricingTier>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct PricingTier {
    value: f64,
    unit: Option<String>,
    currency: Option<String>,
    #[serde(default)]
    conditions: BTreeMap<String, PricingCondition>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct PricingCondition {
    unit: Option<String>,
    gte: Option<f64>,
    lt: Option<f64>,
}

#[derive(Debug, Clone, Default)]
struct PricingCatalog {
    profiles: Vec<PricingProfile>,
}

#[derive(Debug, Clone)]
struct PricingRate {
    per_token: f64,
    currency: String,
}

#[derive(Debug, Clone)]
struct PricingQuote {
    cost: Option<f64>,
    currency: String,
}

#[derive(Debug, Clone)]
struct CurrencyConverter {
    rates_per_usd: BTreeMap<String, f64>,
}

impl Default for CurrencyConverter {
    fn default() -> Self {
        Self {
            rates_per_usd: DEFAULT_EXCHANGE_RATES
                .into_iter()
                .map(|(currency, rate)| (currency.to_string(), rate))
                .collect(),
        }
    }
}

impl CurrencyConverter {
    fn from_json(value: &str) -> Self {
        let mut converter = Self::default();
        if let Ok(overrides) = serde_json::from_str::<BTreeMap<String, f64>>(value) {
            for (currency, rate) in overrides {
                if rate.is_finite() && rate > 0.0 {
                    converter
                        .rates_per_usd
                        .insert(normalize_currency(&currency), rate);
                }
            }
        }
        converter
    }

    fn resolve_currency(&self, requested: Option<&str>) -> String {
        let requested = requested
            .map(normalize_currency)
            .unwrap_or_else(|| DEFAULT_DISPLAY_CURRENCY.to_string());
        if self.rates_per_usd.contains_key(&requested) {
            requested
        } else if self.rates_per_usd.contains_key(DEFAULT_DISPLAY_CURRENCY) {
            DEFAULT_DISPLAY_CURRENCY.to_string()
        } else {
            self.rates_per_usd
                .keys()
                .next()
                .cloned()
                .unwrap_or_else(|| DEFAULT_DISPLAY_CURRENCY.to_string())
        }
    }

    fn convert(&self, amount: f64, from: &str, to: &str) -> Option<f64> {
        let from_rate = self.rates_per_usd.get(&normalize_currency(from))?;
        let to_rate = self.rates_per_usd.get(&normalize_currency(to))?;
        Some(amount / from_rate * to_rate)
    }

    fn currencies(&self) -> Vec<String> {
        let mut currencies = self.rates_per_usd.keys().cloned().collect::<Vec<_>>();
        currencies.sort_by_key(|currency| match currency.as_str() {
            "USD" => (0, currency.clone()),
            "CNY" => (1, currency.clone()),
            "EUR" => (2, currency.clone()),
            _ => (3, currency.clone()),
        });
        currencies
    }
}

fn normalize_currency(currency: &str) -> String {
    currency.trim().to_uppercase()
}

impl PricingCatalog {
    fn from_json(value: &str) -> Self {
        serde_json::from_str::<Vec<PricingProfile>>(value)
            .map(|profiles| Self { profiles })
            .unwrap_or_default()
    }

    fn quote(
        &self,
        converter: &CurrencyConverter,
        display_currency: &str,
        provider: &str,
        model: &str,
        input_tokens: i64,
        output_tokens: i64,
    ) -> PricingQuote {
        let Some(config) = self
            .profiles
            .iter()
            .find(|profile| profile.id == provider)
            .and_then(|profile| {
                profile
                    .model_configs
                    .iter()
                    .find(|model_config| model_config.id == model)
            })
        else {
            return PricingQuote {
                cost: None,
                currency: display_currency.to_string(),
            };
        };

        let input_rate = pricing_rate(config, "prompt", input_tokens, config.input_price);
        let output_rate = pricing_rate(config, "completion", input_tokens, config.output_price);
        let mut converted_cost = 0.0;
        let mut priced = false;
        for (tokens, rate) in [(input_tokens, input_rate), (output_tokens, output_rate)] {
            let Some(rate) = rate else {
                continue;
            };
            let Some(converted) = converter.convert(
                tokens as f64 * rate.per_token,
                &rate.currency,
                display_currency,
            ) else {
                return PricingQuote {
                    cost: None,
                    currency: display_currency.to_string(),
                };
            };
            converted_cost += converted;
            priced = true;
        }
        PricingQuote {
            cost: priced.then_some(converted_cost),
            currency: display_currency.to_string(),
        }
    }
}

fn pricing_rate(
    config: &PricingModelConfig,
    kind: &str,
    prompt_tokens: i64,
    direct_price: Option<f64>,
) -> Option<PricingRate> {
    let tier = config.pricing.get(kind).and_then(|tiers| {
        tiers
            .iter()
            .find(|tier| price_condition_matches(tier, prompt_tokens))
            .or_else(|| {
                tiers
                    .iter()
                    .find(|tier| !tier.conditions.contains_key("prompt_tokens"))
            })
            .or_else(|| tiers.first())
    });
    if let Some(tier) = tier {
        return Some(PricingRate {
            per_token: tier.value / unit_divisor(tier.unit.as_deref()),
            currency: normalize_currency(
                tier.currency
                    .as_deref()
                    .or(config.currency.as_deref())
                    .unwrap_or(DEFAULT_DISPLAY_CURRENCY),
            ),
        });
    }
    direct_price.map(|price| PricingRate {
        per_token: price / 1_000_000.0,
        currency: normalize_currency(
            config
                .currency
                .as_deref()
                .unwrap_or(DEFAULT_DISPLAY_CURRENCY),
        ),
    })
}

fn price_condition_matches(tier: &PricingTier, prompt_tokens: i64) -> bool {
    let Some(condition) = tier.conditions.get("prompt_tokens") else {
        return false;
    };
    let value = prompt_tokens as f64 / condition_unit_divisor(condition.unit.as_deref());
    (condition.gte.is_none_or(|gte| value >= gte)) && (condition.lt.is_none_or(|lt| value < lt))
}

fn condition_unit_divisor(unit: Option<&str>) -> f64 {
    if unit.is_none() || unit.is_some_and(str::is_empty) {
        1.0
    } else {
        unit_divisor(unit)
    }
}

fn unit_divisor(unit: Option<&str>) -> f64 {
    let unit = unit.unwrap_or_default().to_lowercase();
    if unit.contains("mtoken") || unit.contains("million") {
        1_000_000.0
    } else if unit.contains("ktoken") || unit.contains("thousand") {
        1_000.0
    } else if unit.contains("token") {
        1.0
    } else {
        1_000_000.0
    }
}

#[derive(Debug, Clone, Copy)]
struct ReportWindow {
    start: Option<DateTime<Utc>>,
    end: DateTime<Utc>,
    bucket_ms: i64,
}

#[derive(Debug, Clone, Copy)]
struct ReportContext<'a> {
    window: ReportWindow,
    timezone_offset_minutes: i32,
    pricing: &'a PricingCatalog,
    converter: &'a CurrencyConverter,
    display_currency: &'a str,
}

pub async fn report(
    State(state): State<SharedState>,
    Query(query): Query<UsageQuery>,
) -> Result<Json<UsageReport>, (StatusCode, Json<ErrorResponse>)> {
    let rows = state.db.list_usage_records().map_err(internal_error)?;
    let pricing = state
        .db
        .get_config(PROVIDER_PROFILES_CONFIG_KEY)
        .map_err(internal_error)?
        .map(|entry| PricingCatalog::from_json(&entry.value_json))
        .unwrap_or_default();
    let converter = state
        .db
        .get_config(USAGE_EXCHANGE_RATES_CONFIG_KEY)
        .map_err(internal_error)?
        .map(|entry| CurrencyConverter::from_json(&entry.value_json))
        .unwrap_or_default();
    let display_currency = converter.resolve_currency(query.currency.as_deref());
    let window = resolve_window(&query);
    let provider_filter = clean_filter(query.provider.as_deref());
    let model_filter = clean_filter(query.model.as_deref());

    let windowed: Vec<_> = rows
        .into_iter()
        .filter(|row| window.start.is_none_or(|start| row.created_at >= start))
        .filter(|row| row.created_at <= window.end)
        .collect();
    let providers = unique_names_from_rows(&windowed, |row| row.provider.as_str());
    let models = unique_names_from_rows(&windowed, |row| row.model.as_str());

    let filtered: Vec<_> = windowed
        .into_iter()
        .filter(|row| provider_filter.is_none_or(|provider| row.provider == provider))
        .filter(|row| model_filter.is_none_or(|model| row.model == model))
        .collect();

    Ok(Json(build_report(
        filtered,
        providers,
        models,
        ReportContext {
            window,
            timezone_offset_minutes: query.timezone_offset_minutes.unwrap_or(0),
            pricing: &pricing,
            converter: &converter,
            display_currency: &display_currency,
        },
    )))
}

fn build_report(
    rows: Vec<UsageRecordRow>,
    provider_options: Vec<String>,
    model_options: Vec<String>,
    context: ReportContext<'_>,
) -> UsageReport {
    let ReportContext {
        window,
        timezone_offset_minutes,
        pricing,
        converter,
        display_currency,
    } = context;
    let total_tokens = rows
        .iter()
        .map(|row| i64::from(row.input_tokens + row.output_tokens))
        .sum::<i64>();
    let mut totals = UsageTotals {
        requests: rows.len(),
        currency: display_currency.to_string(),
        ..UsageTotals::default()
    };
    let mut trend = BTreeMap::<i64, UsageTrendBucket>::new();
    let mut provider_breakdown = BTreeMap::<String, UsageBreakdownItem>::new();
    let mut model_breakdown = BTreeMap::<String, UsageBreakdownItem>::new();
    let mut quotes = Vec::with_capacity(rows.len());

    prefill_trend_buckets(&mut trend, window, timezone_offset_minutes);

    for row in &rows {
        let input = i64::from(row.input_tokens);
        let output = i64::from(row.output_tokens);
        totals.input += input;
        totals.output += output;
        totals.cache_creation += i64::from(row.cache_creation_input_tokens);
        totals.cache_read += i64::from(row.cache_read_input_tokens);
        totals.duration_ms += row.duration_ms;

        let quote = pricing.quote(
            converter,
            display_currency,
            &row.provider,
            &row.model,
            input,
            output,
        );
        add_quote(&mut totals.cost, &mut totals.priced, &quote);
        add_breakdown(
            &mut provider_breakdown,
            row.provider.clone(),
            input,
            output,
            &quote,
        );
        add_breakdown(
            &mut model_breakdown,
            row.model.clone(),
            input,
            output,
            &quote,
        );
        quotes.push(quote);
        let bucket_start = bucket_start_ms(
            row.created_at.timestamp_millis(),
            window.bucket_ms,
            timezone_offset_minutes,
        );
        let bucket = trend
            .entry(bucket_start)
            .or_insert_with(|| UsageTrendBucket {
                start_at: Utc
                    .timestamp_millis_opt(bucket_start)
                    .single()
                    .unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
                    .to_rfc3339(),
                label: format_bucket_label(bucket_start, window.bucket_ms, timezone_offset_minutes),
                ..UsageTrendBucket::default()
            });
        bucket.input += input;
        bucket.output += output;
        bucket.tokens += input + output;
    }

    UsageReport {
        records: rows
            .into_iter()
            .zip(quotes)
            .map(|(row, quote)| record_response(row, quote))
            .collect(),
        totals,
        trend: trend.into_values().collect(),
        provider_breakdown: finish_breakdown(provider_breakdown, total_tokens),
        model_breakdown: finish_breakdown(model_breakdown, total_tokens),
        providers: provider_options,
        models: model_options,
        currencies: converter.currencies(),
    }
}

fn add_quote(cost: &mut Option<f64>, priced: &mut usize, quote: &PricingQuote) {
    if let Some(amount) = quote.cost {
        *cost = Some(cost.unwrap_or(0.0) + amount);
        *priced += 1;
    }
}

fn add_breakdown(
    target: &mut BTreeMap<String, UsageBreakdownItem>,
    name: String,
    input: i64,
    output: i64,
    quote: &PricingQuote,
) {
    let item = target
        .entry(name.clone())
        .or_insert_with(|| UsageBreakdownItem {
            name,
            currency: quote.currency.clone(),
            ..UsageBreakdownItem::default()
        });
    item.requests += 1;
    item.input += input;
    item.output += output;
    item.tokens += input + output;
    add_quote(&mut item.cost, &mut item.priced, quote);
}

fn finish_breakdown(
    source: BTreeMap<String, UsageBreakdownItem>,
    total_tokens: i64,
) -> Vec<UsageBreakdownItem> {
    let mut values = source
        .into_values()
        .map(|mut item| {
            item.share = if total_tokens > 0 {
                item.tokens as f64 / total_tokens as f64 * 100.0
            } else {
                0.0
            };
            item
        })
        .collect::<Vec<_>>();
    values.sort_by(|a, b| {
        b.tokens
            .cmp(&a.tokens)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    values
}

fn record_response(row: UsageRecordRow, quote: PricingQuote) -> UsageRecord {
    UsageRecord {
        id: row.id,
        conversation_id: row.conversation_id,
        conversation_title: row.conversation_title,
        provider: row.provider,
        model: row.model,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        cache_creation_tokens: row.cache_creation_input_tokens,
        cache_read_tokens: row.cache_read_input_tokens,
        duration_ms: row.duration_ms,
        cost: quote.cost,
        currency: quote.currency,
        status: row.status,
        created_at: row.created_at.to_rfc3339(),
    }
}

fn resolve_window(query: &UsageQuery) -> ReportWindow {
    let mut end = query
        .to
        .as_deref()
        .and_then(parse_datetime)
        .unwrap_or_else(Utc::now);
    let range = query.range.as_deref().unwrap_or("day");
    let mut start = if range == "custom" {
        query
            .from
            .as_deref()
            .and_then(parse_datetime)
            .or_else(|| Some(end - Duration::days(1)))
    } else {
        range_duration(range).map(|duration| end - duration)
    };
    if let Some(start_at) = start {
        if start_at > end {
            start = Some(end);
            end = start_at;
        }
    }
    let bucket_ms = if range == "custom" {
        custom_bucket_duration_ms(start, end)
    } else {
        bucket_duration_ms(range)
    };
    ReportWindow {
        start,
        end,
        bucket_ms,
    }
}

fn parse_datetime(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.with_timezone(&Utc))
}

fn range_duration(range: &str) -> Option<Duration> {
    match range {
        "15m" => Some(Duration::minutes(15)),
        "30m" => Some(Duration::minutes(30)),
        "1h" => Some(Duration::hours(1)),
        "3h" => Some(Duration::hours(3)),
        "day" => Some(Duration::days(1)),
        "week" => Some(Duration::weeks(1)),
        "3w" => Some(Duration::weeks(3)),
        "month" => Some(Duration::days(31)),
        "quarter" => Some(Duration::days(92)),
        "year" => Some(Duration::days(365)),
        "all" => None,
        _ => Some(Duration::days(1)),
    }
}

fn bucket_duration_ms(range: &str) -> i64 {
    match range {
        "15m" => Duration::minutes(1),
        "30m" => Duration::minutes(5),
        "1h" => Duration::minutes(10),
        "3h" => Duration::minutes(30),
        "day" => Duration::hours(3),
        "week" => Duration::days(1),
        "3w" => Duration::days(3),
        "month" => Duration::weeks(1),
        "quarter" => Duration::days(31),
        "year" => Duration::days(31),
        _ => Duration::hours(3),
    }
    .num_milliseconds()
}

fn custom_bucket_duration_ms(start: Option<DateTime<Utc>>, end: DateTime<Utc>) -> i64 {
    let span = start
        .map(|start_at| end - start_at)
        .unwrap_or_else(|| Duration::weeks(1));
    let span_ms = span.num_milliseconds().max(0);
    if span_ms <= Duration::minutes(30).num_milliseconds() {
        Duration::minutes(1)
    } else if span_ms <= Duration::hours(1).num_milliseconds() {
        Duration::minutes(5)
    } else if span_ms <= Duration::hours(3).num_milliseconds() {
        Duration::minutes(10)
    } else if span_ms <= Duration::days(1).num_milliseconds() {
        Duration::minutes(30)
    } else if span_ms <= Duration::weeks(1).num_milliseconds() {
        Duration::days(1)
    } else if span_ms <= Duration::weeks(3).num_milliseconds() {
        Duration::days(3)
    } else if span_ms <= Duration::days(31).num_milliseconds() {
        Duration::weeks(1)
    } else {
        Duration::days(31)
    }
    .num_milliseconds()
}

fn bucket_start_ms(timestamp_ms: i64, bucket_ms: i64, timezone_offset_minutes: i32) -> i64 {
    let offset_ms = i64::from(timezone_offset_minutes) * 60_000;
    ((timestamp_ms + offset_ms).div_euclid(bucket_ms) * bucket_ms) - offset_ms
}

fn prefill_trend_buckets(
    trend: &mut BTreeMap<i64, UsageTrendBucket>,
    window: ReportWindow,
    timezone_offset_minutes: i32,
) {
    let Some(start) = window.start else {
        return;
    };
    let first_bucket = bucket_start_ms(
        start.timestamp_millis(),
        window.bucket_ms,
        timezone_offset_minutes,
    );
    let last_bucket = bucket_start_ms(
        window.end.timestamp_millis(),
        window.bucket_ms,
        timezone_offset_minutes,
    );
    let mut current = first_bucket;
    let mut emitted = 0;
    while current <= last_bucket && emitted < 400 {
        trend.entry(current).or_insert_with(|| UsageTrendBucket {
            start_at: Utc
                .timestamp_millis_opt(current)
                .single()
                .unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
                .to_rfc3339(),
            label: format_bucket_label(current, window.bucket_ms, timezone_offset_minutes),
            ..UsageTrendBucket::default()
        });
        current += window.bucket_ms;
        emitted += 1;
    }
}

fn format_bucket_label(
    bucket_start_ms: i64,
    bucket_ms: i64,
    timezone_offset_minutes: i32,
) -> String {
    let local_ms = bucket_start_ms + i64::from(timezone_offset_minutes) * 60_000;
    let date = Utc
        .timestamp_millis_opt(local_ms)
        .single()
        .unwrap_or(DateTime::<Utc>::UNIX_EPOCH);
    if bucket_ms < Duration::days(1).num_milliseconds() {
        date.format("%H:%M").to_string()
    } else if bucket_ms < Duration::days(31).num_milliseconds() {
        date.format("%b %d").to_string()
    } else {
        date.format("%b %Y").to_string()
    }
}

fn clean_filter(value: Option<&str>) -> Option<&str> {
    value.filter(|item| !item.is_empty() && *item != "all")
}

fn unique_names_from_rows<F>(rows: &[UsageRecordRow], name_for: F) -> Vec<String>
where
    F: Fn(&UsageRecordRow) -> &str,
{
    let mut values = rows
        .iter()
        .map(|row| name_for(row).to_string())
        .collect::<Vec<_>>();
    values.sort_by_key(|name| name.to_lowercase());
    values.dedup();
    values
}

fn internal_error(e: encorehub_core::EngineError) -> (StatusCode, Json<ErrorResponse>) {
    tracing::error!("usage report failed: {}", e);
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: e.to_string(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usage_row(
        id: &str,
        provider: &str,
        model: &str,
        input_tokens: i32,
        output_tokens: i32,
        created_at: DateTime<Utc>,
    ) -> UsageRecordRow {
        UsageRecordRow {
            id: id.to_string(),
            conversation_id: format!("conversation-{id}"),
            conversation_title: format!("Conversation {id}"),
            provider: provider.to_string(),
            model: model.to_string(),
            input_tokens,
            output_tokens,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            duration_ms: 1_250,
            status: "completed".to_string(),
            created_at,
        }
    }

    #[test]
    fn build_report_returns_engine_owned_breakdowns_and_filter_options() {
        let pricing = PricingCatalog::default();
        let converter = CurrencyConverter::default();
        let window = ReportWindow {
            start: Some(Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap()),
            end: Utc.with_ymd_and_hms(2026, 8, 1, 1, 0, 0).unwrap(),
            bucket_ms: Duration::minutes(15).num_milliseconds(),
        };
        let report = build_report(
            vec![
                usage_row(
                    "a",
                    "openai",
                    "gpt-test",
                    100,
                    50,
                    Utc.with_ymd_and_hms(2026, 8, 1, 0, 5, 0).unwrap(),
                ),
                usage_row(
                    "b",
                    "anthropic",
                    "claude-test",
                    25,
                    25,
                    Utc.with_ymd_and_hms(2026, 8, 1, 0, 35, 0).unwrap(),
                ),
            ],
            vec!["anthropic".to_string(), "openai".to_string()],
            vec!["claude-test".to_string(), "gpt-test".to_string()],
            ReportContext {
                window,
                timezone_offset_minutes: 0,
                pricing: &pricing,
                converter: &converter,
                display_currency: "USD",
            },
        );

        assert_eq!(report.totals.requests, 2);
        assert_eq!(report.totals.input, 125);
        assert_eq!(report.totals.output, 75);
        assert_eq!(report.providers, ["anthropic", "openai"]);
        assert_eq!(report.models, ["claude-test", "gpt-test"]);
        assert_eq!(report.totals.currency, "USD");
        assert_eq!(report.totals.priced, 0);
        assert_eq!(report.provider_breakdown[0].name, "openai");
        assert_eq!(report.provider_breakdown[0].tokens, 150);
        assert!((report.provider_breakdown[0].share - 75.0).abs() < f64::EPSILON);
    }

    #[test]
    fn build_report_prefills_fixed_window_trend_buckets() {
        let pricing = PricingCatalog::default();
        let converter = CurrencyConverter::default();
        let window = ReportWindow {
            start: Some(Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap()),
            end: Utc.with_ymd_and_hms(2026, 8, 1, 1, 0, 0).unwrap(),
            bucket_ms: Duration::minutes(15).num_milliseconds(),
        };
        let report = build_report(
            vec![usage_row(
                "a",
                "openai",
                "gpt-test",
                10,
                5,
                Utc.with_ymd_and_hms(2026, 8, 1, 0, 35, 0).unwrap(),
            )],
            vec!["openai".to_string()],
            vec!["gpt-test".to_string()],
            ReportContext {
                window,
                timezone_offset_minutes: 0,
                pricing: &pricing,
                converter: &converter,
                display_currency: "USD",
            },
        );

        assert_eq!(report.trend.len(), 5);
        assert_eq!(report.trend[0].tokens, 0);
        assert_eq!(report.trend[2].tokens, 15);
        assert_eq!(report.trend[4].tokens, 0);
    }

    #[test]
    fn build_report_aggregates_cache_creation_and_read_tokens() {
        let pricing = PricingCatalog::default();
        let converter = CurrencyConverter::default();
        let window = ReportWindow {
            start: Some(Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap()),
            end: Utc.with_ymd_and_hms(2026, 8, 1, 1, 0, 0).unwrap(),
            bucket_ms: Duration::hours(1).num_milliseconds(),
        };
        let mut row = usage_row(
            "cached",
            "anthropic",
            "claude-test",
            100,
            25,
            Utc.with_ymd_and_hms(2026, 8, 1, 0, 5, 0).unwrap(),
        );
        row.cache_creation_input_tokens = 30;
        row.cache_read_input_tokens = 60;

        let report = build_report(
            vec![row],
            vec!["anthropic".to_string()],
            vec!["claude-test".to_string()],
            ReportContext {
                window,
                timezone_offset_minutes: 0,
                pricing: &pricing,
                converter: &converter,
                display_currency: "USD",
            },
        );

        assert_eq!(report.totals.cache_creation, 30);
        assert_eq!(report.totals.cache_read, 60);
        assert_eq!(report.records[0].cache_creation_tokens, 30);
        assert_eq!(report.records[0].cache_read_tokens, 60);
    }

    #[test]
    fn build_report_prices_records_and_converts_to_display_currency() {
        let pricing = PricingCatalog::from_json(
            r#"[{"id":"deepseek","model_configs":[{"id":"deepseek-v4-flash","currency":"CNY","input_price":1.0,"output_price":2.0}]}]"#,
        );
        let converter = CurrencyConverter::default();
        let window = ReportWindow {
            start: Some(Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap()),
            end: Utc.with_ymd_and_hms(2026, 8, 1, 1, 0, 0).unwrap(),
            bucket_ms: Duration::hours(1).num_milliseconds(),
        };
        let report = build_report(
            vec![usage_row(
                "priced",
                "deepseek",
                "deepseek-v4-flash",
                1_000_000,
                1_000_000,
                Utc.with_ymd_and_hms(2026, 8, 1, 0, 5, 0).unwrap(),
            )],
            vec!["deepseek".to_string()],
            vec!["deepseek-v4-flash".to_string()],
            ReportContext {
                window,
                timezone_offset_minutes: 0,
                pricing: &pricing,
                converter: &converter,
                display_currency: "USD",
            },
        );

        assert_eq!(report.totals.priced, 1);
        assert_eq!(report.totals.currency, "USD");
        assert!((report.totals.cost.unwrap() - (3.0 / 7.2)).abs() < 1e-9);
        assert_eq!(report.records[0].currency, "USD");
        assert!((report.records[0].cost.unwrap() - (3.0 / 7.2)).abs() < 1e-9);
        assert_eq!(report.model_breakdown[0].currency, "USD");
        assert!((report.model_breakdown[0].cost.unwrap() - (3.0 / 7.2)).abs() < 1e-9);
    }

    #[test]
    fn currency_converter_accepts_configured_rates_and_normalizes_codes() {
        let converter = CurrencyConverter::from_json(r#"{"GBP":0.8,"CNY":8.0}"#);
        assert_eq!(converter.resolve_currency(Some("cny")), "CNY");
        assert!((converter.convert(8.0, "CNY", "USD").unwrap() - 1.0).abs() < 1e-9);
        assert!(converter.currencies().contains(&"GBP".to_string()));
    }

    #[test]
    fn tier_conditions_without_units_use_token_counts() {
        let pricing = PricingCatalog::from_json(
            r#"[{"id":"provider","model_configs":[{"id":"model","currency":"USD","pricing":{"prompt":[{"value":1.0,"unit":"perMTokens","conditions":{"prompt_tokens":{"gte":1000000}}},{"value":2.0,"unit":"perMTokens"}],"completion":[{"value":4.0,"unit":"perMTokens"}]}}]}]"#,
        );
        let converter = CurrencyConverter::default();

        let quote = pricing.quote(&converter, "USD", "provider", "model", 1_500_000, 0);
        assert!((quote.cost.unwrap() - 1.5).abs() < 1e-9);
    }

    #[test]
    fn custom_window_swaps_inverted_bounds_and_chooses_bucket_size() {
        let query = UsageQuery {
            range: Some("custom".to_string()),
            from: Some("2026-08-02T03:00:00Z".to_string()),
            to: Some("2026-08-02T00:00:00Z".to_string()),
            provider: None,
            model: None,
            currency: None,
            timezone_offset_minutes: None,
        };
        let window = resolve_window(&query);

        assert_eq!(
            window.start.unwrap(),
            Utc.with_ymd_and_hms(2026, 8, 2, 0, 0, 0).unwrap()
        );
        assert_eq!(
            window.end,
            Utc.with_ymd_and_hms(2026, 8, 2, 3, 0, 0).unwrap()
        );
        assert_eq!(window.bucket_ms, Duration::minutes(10).num_milliseconds());
    }

    #[test]
    fn missing_range_defaults_to_one_day() {
        let query = UsageQuery {
            range: None,
            from: None,
            to: Some("2026-08-02T00:00:00Z".to_string()),
            provider: None,
            model: None,
            currency: None,
            timezone_offset_minutes: None,
        };
        let window = resolve_window(&query);

        assert_eq!(
            window.start.unwrap(),
            Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap()
        );
        assert_eq!(window.bucket_ms, Duration::hours(3).num_milliseconds());
    }
}
