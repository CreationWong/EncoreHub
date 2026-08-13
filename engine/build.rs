// Injects the Engine's independent version identity into every Cargo target.
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

fn build_id_now() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let days = seconds / 86_400;
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    format!(
        "{:02}{:02}{:02}{:06}",
        year % 100,
        month,
        day,
        seconds % 1_000_000
    )
}

fn main() {
    println!("cargo:rerun-if-changed=version.json");
    println!("cargo:rerun-if-env-changed=ENCOREHUB_BUILD_ID");
    let declaration = fs::read_to_string("version.json")
        .expect("engine/version.json must be available during Cargo build");
    let version = declaration
        .split("\"version\": \"")
        .nth(1)
        .and_then(|value| value.split('"').next())
        .expect("engine version declaration must contain version");
    println!("cargo:rustc-env=ENCOREHUB_ENGINE_VERSION={version}");
    println!(
        "cargo:rustc-env=ENCOREHUB_BUILD_ID={}",
        std::env::var("ENCOREHUB_BUILD_ID").unwrap_or_else(|_| build_id_now())
    );
}
