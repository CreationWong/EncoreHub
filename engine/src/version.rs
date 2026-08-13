//! Engine version identity and bilateral peer compatibility metadata.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CompatibilityRange {
    pub min: String,
    pub max_exclusive: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct VersionRecord {
    pub component: String,
    pub version: String,
    pub compatibility: std::collections::BTreeMap<String, CompatibilityRange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_id: Option<String>,
}

const DECLARATION: &str = include_str!("../version.json");

pub fn current() -> VersionRecord {
    let mut record: VersionRecord = serde_json::from_str(DECLARATION)
        .expect("engine/version.json must contain a valid Engine version declaration");
    record.version = option_env!("ENCOREHUB_ENGINE_VERSION")
        .unwrap_or(record.version.as_str())
        .to_owned();
    record.build_id = Some(
        option_env!("ENCOREHUB_BUILD_ID")
            .map(str::to_owned)
            .filter(|id| id.len() == 12)
            .unwrap_or_else(build_id_now),
    );
    record
}

pub fn verify_mutual(left: &VersionRecord, right: &VersionRecord) -> Result<(), String> {
    let left_range = left
        .compatibility
        .get(&right.component)
        .ok_or_else(|| format!("{} has no range for {}", left.component, right.component))?;
    if !in_range(&right.version, left_range) {
        return Err(format!(
            "{} {} rejects {} {}",
            left.component, left.version, right.component, right.version
        ));
    }
    let right_range = right
        .compatibility
        .get(&left.component)
        .ok_or_else(|| format!("{} has no range for {}", right.component, left.component))?;
    if !in_range(&left.version, right_range) {
        return Err(format!(
            "{} {} rejects {} {}",
            right.component, right.version, left.component, left.version
        ));
    }
    Ok(())
}

fn in_range(version: &str, range: &CompatibilityRange) -> bool {
    let Ok(version) = parse(version) else {
        return false;
    };
    let Ok(min) = parse(&range.min) else {
        return false;
    };
    let Ok(max) = parse(&range.max_exclusive) else {
        return false;
    };
    version >= min && version < max
}

fn parse(value: &str) -> Result<[u64; 4], ()> {
    let value = value.strip_prefix('V').ok_or(())?;
    let mut output = [0; 4];
    let mut parts = value.split('.');
    for slot in &mut output {
        *slot = parts.next().ok_or(())?.parse().map_err(|_| ())?;
    }
    if parts.next().is_some() {
        return Err(());
    }
    Ok(output)
}

fn build_id_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = seconds / 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{:02}{:02}{:02}{:06}",
        year % 100,
        month,
        day,
        seconds % 1_000_000
    )
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    (y + if m <= 2 { 1 } else { 0 }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_peer_outside_declared_range() {
        let left = current();
        let mut right = current();
        right.component = "gateway".into();
        right.version = "V0.2.0.0".into();
        assert!(verify_mutual(&left, &right).is_err());
    }
}
