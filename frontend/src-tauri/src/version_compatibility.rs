//! Verifies packaged component versions before any backend component starts.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
struct CompatibilityRange {
    min: String,
    max_exclusive: String,
}

#[derive(Clone, Debug, Deserialize)]
struct VersionRecord {
    #[serde(alias = "module")]
    component: String,
    version: String,
    #[serde(default)]
    build_id: String,
    compatibility: BTreeMap<String, CompatibilityRange>,
}

/// Validate the Frontend, Gateway, and Engine declarations before launching peers.
pub(crate) fn verify_packaged_components(resource_dir: &Path) -> Result<(), String> {
    let mut frontend: VersionRecord = serde_json::from_str(include_str!("../../version.json"))
        .map_err(|error| format!("invalid embedded Frontend version declaration: {error}"))?;
    frontend.build_id = env!("ENCOREHUB_BUILD_ID").to_owned();

    let mut engine = read_manifest(resource_dir, "engine-runtime.json")?;
    engine.component = "engine".to_owned();
    let mut gateway = read_manifest(resource_dir, "gateway-runtime.json")?;
    gateway.component = "gateway".to_owned();

    for (left, right) in [
        (&frontend, &gateway),
        (&frontend, &engine),
        (&gateway, &engine),
    ] {
        verify_mutual(left, right)?;
    }
    Ok(())
}

/// Read a runtime manifest from packaged resources or the development binaries.
fn read_manifest(resource_dir: &Path, name: &str) -> Result<VersionRecord, String> {
    let candidates = [
        resource_dir.join("lib").join(name),
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(name),
    ];
    let path = candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .cloned()
        .ok_or_else(|| format!("component version manifest {name} was not found"))?;
    let body = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&body)
        .map_err(|error| format!("invalid component manifest {}: {error}", path.display()))
}

/// Require both components to accept one another's exact four-part version.
fn verify_mutual(left: &VersionRecord, right: &VersionRecord) -> Result<(), String> {
    let left_range = left.compatibility.get(&right.component).ok_or_else(|| {
        format!(
            "{} has no compatibility range for {}",
            identity(left),
            identity(right)
        )
    })?;
    if !in_range(&right.version, left_range) {
        return Err(format!("{} rejects {}", identity(left), identity(right)));
    }
    let right_range = right.compatibility.get(&left.component).ok_or_else(|| {
        format!(
            "{} has no compatibility range for {}",
            identity(right),
            identity(left)
        )
    })?;
    if !in_range(&left.version, right_range) {
        return Err(format!("{} rejects {}", identity(right), identity(left)));
    }
    Ok(())
}

/// Format the diagnostic identity with a mandatory Build ID.
fn identity(record: &VersionRecord) -> String {
    let build_id = if record.build_id.len() == 12
        && record.build_id.bytes().all(|byte| byte.is_ascii_digit())
    {
        record.build_id.as_str()
    } else {
        "invalid-build-id"
    };
    format!(
        "{} {} (Build {})",
        record.component, record.version, build_id
    )
}

/// Check membership in a half-open four-part version range.
fn in_range(version: &str, range: &CompatibilityRange) -> bool {
    let (Ok(version), Ok(min), Ok(max)) = (
        parse_version(version),
        parse_version(&range.min),
        parse_version(&range.max_exclusive),
    ) else {
        return false;
    };
    version >= min && version < max
}

/// Parse the repository's strict Vmajor.compatibility.feature.patch notation.
fn parse_version(value: &str) -> Result<[u64; 4], ()> {
    let mut parts = value.strip_prefix('V').ok_or(())?.split('.');
    let mut version = [0_u64; 4];
    for slot in &mut version {
        *slot = parts.next().ok_or(())?.parse().map_err(|_| ())?;
    }
    if parts.next().is_some() {
        return Err(());
    }
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(component: &str, version: &str, peer: &str, min: &str, max: &str) -> VersionRecord {
        VersionRecord {
            component: component.to_owned(),
            version: version.to_owned(),
            build_id: "260813600474".to_owned(),
            compatibility: BTreeMap::from([(
                peer.to_owned(),
                CompatibilityRange {
                    min: min.to_owned(),
                    max_exclusive: max.to_owned(),
                },
            )]),
        }
    }

    #[test]
    fn accepts_bilateral_half_open_ranges() {
        let frontend = record("frontend", "V0.1.1.0", "gateway", "V0.1.0.0", "V0.2.0.0");
        let gateway = record("gateway", "V0.1.1.0", "frontend", "V0.1.0.0", "V0.2.0.0");
        assert!(verify_mutual(&frontend, &gateway).is_ok());
    }

    #[test]
    fn rejection_reports_full_versions_and_build_ids() {
        let frontend = record("frontend", "V0.1.1.0", "gateway", "V0.1.0.0", "V0.2.0.0");
        let gateway = record("gateway", "V0.2.0.0", "frontend", "V0.2.0.0", "V0.3.0.0");
        let error = verify_mutual(&frontend, &gateway).unwrap_err();
        assert!(error.contains("frontend V0.1.1.0 (Build 260813600474)"));
        assert!(error.contains("gateway V0.2.0.0 (Build 260813600474)"));
    }
}
