use serde::Serialize;

#[derive(Serialize)]
pub(crate) struct AppBuildInfo {
    version: String,
    build_id: String,
    public_version: String,
    debug_build: bool,
    target_os: String,
    target_arch: String,
}

fn app_build_info(version: impl Into<String>) -> AppBuildInfo {
    let version = version.into();
    let build_id = option_env!("ENCOREHUB_BUILD_ID")
        .filter(|value| value.len() == 12)
        .unwrap_or("000000000000")
        .to_owned();
    AppBuildInfo {
        public_version: public_version(&version),
        version,
        build_id,
        debug_build: cfg!(debug_assertions),
        target_os: std::env::consts::OS.into(),
        target_arch: std::env::consts::ARCH.into(),
    }
}

fn public_version(version: &str) -> String {
    let mut parts = version.trim_start_matches('V').split('.');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(major), Some(compatibility), Some(feature)) => {
            format!("V{major}.{compatibility}.{feature}")
        }
        _ => version.to_owned(),
    }
}

#[tauri::command]
pub(crate) fn get_app_info(_app: tauri::AppHandle) -> AppBuildInfo {
    app_build_info(env!("ENCOREHUB_VERSION"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_compile_target_and_build_mode() {
        let info = app_build_info("V1.2.3.0");

        assert_eq!(info.version, "V1.2.3.0");
        assert_eq!(info.public_version, "V1.2.3");
        assert_eq!(info.target_os, std::env::consts::OS);
        assert_eq!(info.target_arch, std::env::consts::ARCH);
        assert_eq!(info.debug_build, cfg!(debug_assertions));
    }
}
