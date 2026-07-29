use serde::Serialize;

#[derive(Serialize)]
pub(crate) struct AppBuildInfo {
    version: String,
    debug_build: bool,
    target_os: String,
    target_arch: String,
}

fn app_build_info(version: impl Into<String>) -> AppBuildInfo {
    AppBuildInfo {
        version: version.into(),
        debug_build: cfg!(debug_assertions),
        target_os: std::env::consts::OS.into(),
        target_arch: std::env::consts::ARCH.into(),
    }
}

#[tauri::command]
pub(crate) fn get_app_info(app: tauri::AppHandle) -> AppBuildInfo {
    app_build_info(app.package_info().version.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_compile_target_and_build_mode() {
        let info = app_build_info("1.2.3");

        assert_eq!(info.version, "1.2.3");
        assert_eq!(info.target_os, std::env::consts::OS);
        assert_eq!(info.target_arch, std::env::consts::ARCH);
        assert_eq!(info.debug_build, cfg!(debug_assertions));
    }
}
