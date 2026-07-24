use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct RuntimePaths {
    pub database: PathBuf,
    pub logs: PathBuf,
    pub skills: PathBuf,
}

impl RuntimePaths {
    pub fn prepare(
        app_data_dir: &Path,
        resource_dir: &Path,
        portable_log_root: Option<&Path>,
    ) -> io::Result<Self> {
        let data_dir = app_data_dir.join("data");
        fs::create_dir_all(&data_dir)?;
        let logs = select_log_directory(portable_log_root, &app_data_dir.join("log"))?;

        Ok(Self {
            database: std::env::var_os("ENGINE_DB")
                .map(PathBuf::from)
                .unwrap_or_else(|| data_dir.join("encorehub.db")),
            logs,
            skills: std::env::var_os("ENCOREHUB_SKILLS_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| resource_dir.join("skills")),
        })
    }
}

/// Prefer a writable `log/` beside the desktop executable on every platform.
/// System-managed installs may make that directory read-only, so retain the
/// app-data location as a lossless fallback instead of disabling file logs.
fn select_log_directory(portable_root: Option<&Path>, fallback: &Path) -> io::Result<PathBuf> {
    if let Some(root) = portable_root {
        let candidate = root.join("log");
        if ensure_writable_directory(&candidate).is_ok() {
            return Ok(candidate);
        }
    }

    ensure_writable_directory(fallback)?;
    Ok(fallback.to_path_buf())
}

fn ensure_writable_directory(directory: &Path) -> io::Result<()> {
    fs::create_dir_all(directory)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let probe = directory.join(format!(
        ".encorehub-write-test-{}-{nonce}",
        std::process::id()
    ));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)?;
    let sync_result = file.sync_all();
    drop(file);
    let remove_result = fs::remove_file(probe);
    sync_result?;
    remove_result
}

#[cfg(test)]
mod path_tests {
    use super::*;

    #[test]
    fn prefers_explicit_writable_portable_log_directory() {
        let temp = tempfile::tempdir().unwrap();
        let app_data = temp.path().join("app-data");
        let resources = temp.path().join("resources");
        let install = temp.path().join("install");
        fs::create_dir_all(&install).unwrap();

        let paths = RuntimePaths::prepare(&app_data, &resources, Some(&install)).unwrap();

        assert_eq!(paths.logs, install.join("log"));
        assert!(paths.logs.is_dir());
        assert_eq!(paths.database, app_data.join("data/encorehub.db"));
    }

    #[test]
    fn falls_back_to_app_data_when_portable_log_directory_is_not_writable() {
        let temp = tempfile::tempdir().unwrap();
        let app_data = temp.path().join("app-data");
        let resources = temp.path().join("resources");
        let install = temp.path().join("install");
        fs::create_dir_all(&install).unwrap();
        fs::write(install.join("log"), b"blocks directory creation").unwrap();

        let paths = RuntimePaths::prepare(&app_data, &resources, Some(&install)).unwrap();

        assert_eq!(paths.logs, app_data.join("log"));
        assert!(paths.logs.is_dir());
    }

    #[test]
    fn uses_app_data_when_no_portable_root_is_available() {
        let temp = tempfile::tempdir().unwrap();
        let app_data = temp.path().join("app-data");
        let resources = temp.path().join("resources");

        let paths = RuntimePaths::prepare(&app_data, &resources, None).unwrap();

        assert_eq!(paths.logs, app_data.join("log"));
        assert!(paths.logs.is_dir());
    }
}

#[cfg(any(target_os = "windows", test))]
pub(crate) mod legacy_migration {
    use super::*;
    use std::ffi::OsString;
    use std::io::{BufReader, Read};

    pub const LEGACY_MIGRATION_MARKER: &str = ".legacy-layout-v1.json";

    #[derive(Debug, Default, PartialEq, Eq)]
    pub struct MigrationReport {
        pub copied_files: usize,
        pub verified_existing_files: usize,
        pub preserved_conflicts: usize,
        pub marker_created: bool,
    }

    pub fn migrate_legacy_runtime(
        legacy_root: &Path,
        app_data_dir: &Path,
    ) -> io::Result<MigrationReport> {
        let marker = app_data_dir.join(LEGACY_MIGRATION_MARKER);
        if marker.exists() || legacy_root == app_data_dir {
            return Ok(MigrationReport::default());
        }

        fs::create_dir_all(app_data_dir)?;
        let mut report = MigrationReport::default();
        for directory in ["data", "log"] {
            let source = legacy_root.join(directory);
            if source.is_dir() {
                copy_tree_verified(&source, &app_data_dir.join(directory), &mut report)?;
            }
        }

        let marker_body = format!(
            concat!(
                "{{\n",
                "  \"version\": 1,\n",
                "  \"source\": \"executable-directory\",\n",
                "  \"cleanup\": \"pending-uninstall\",\n",
                "  \"copiedFiles\": {},\n",
                "  \"verifiedExistingFiles\": {},\n",
                "  \"preservedConflicts\": {}\n",
                "}}\n"
            ),
            report.copied_files, report.verified_existing_files, report.preserved_conflicts
        );
        let marker_temp = temporary_path(&marker);
        remove_stale_temp(&marker_temp)?;
        fs::write(&marker_temp, marker_body)?;
        fs::rename(&marker_temp, &marker)?;
        report.marker_created = true;
        Ok(report)
    }

    fn copy_tree_verified(
        source: &Path,
        destination: &Path,
        report: &mut MigrationReport,
    ) -> io::Result<()> {
        fs::create_dir_all(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            let target = destination.join(entry.file_name());
            if file_type.is_dir() {
                copy_tree_verified(&entry.path(), &target, report)?;
            } else if file_type.is_file() {
                copy_file_verified(&entry.path(), &target, report)?;
            } else {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    format!(
                        "legacy runtime entry is not a regular file: {:?}",
                        entry.path()
                    ),
                ));
            }
        }
        Ok(())
    }

    fn copy_file_verified(
        source: &Path,
        destination: &Path,
        report: &mut MigrationReport,
    ) -> io::Result<()> {
        if destination.exists() {
            if files_equal(source, destination)? {
                report.verified_existing_files += 1;
            } else {
                report.preserved_conflicts += 1;
            }
            return Ok(());
        }

        let temp = temporary_path(destination);
        remove_stale_temp(&temp)?;
        fs::copy(source, &temp)?;
        if !files_equal(source, &temp)? {
            let _ = fs::remove_file(&temp);
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("legacy runtime copy verification failed: {source:?}"),
            ));
        }
        fs::rename(&temp, destination)?;
        report.copied_files += 1;
        Ok(())
    }

    fn files_equal(left: &Path, right: &Path) -> io::Result<bool> {
        if fs::metadata(left)?.len() != fs::metadata(right)?.len() {
            return Ok(false);
        }

        let mut left = BufReader::new(fs::File::open(left)?);
        let mut right = BufReader::new(fs::File::open(right)?);
        let mut left_buf = [0_u8; 8192];
        let mut right_buf = [0_u8; 8192];
        loop {
            let left_len = left.read(&mut left_buf)?;
            let right_len = right.read(&mut right_buf)?;
            if left_len != right_len || left_buf[..left_len] != right_buf[..right_len] {
                return Ok(false);
            }
            if left_len == 0 {
                return Ok(true);
            }
        }
    }

    fn temporary_path(path: &Path) -> PathBuf {
        let mut name = path
            .file_name()
            .map(OsString::from)
            .unwrap_or_else(|| OsString::from("runtime"));
        name.push(".encorehub-migration");
        path.with_file_name(name)
    }

    fn remove_stale_temp(path: &Path) -> io::Result<()> {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn migration_copies_and_verifies_data_without_deleting_legacy_files() {
            let temp = tempfile::tempdir().unwrap();
            let legacy = temp.path().join("legacy");
            let app_data = temp.path().join("app-data");
            fs::create_dir_all(legacy.join("data/nested")).unwrap();
            fs::create_dir_all(legacy.join("log")).unwrap();
            fs::write(legacy.join("data/encorehub.db"), b"database").unwrap();
            fs::write(legacy.join("data/nested/blob.bin"), b"blob").unwrap();
            fs::write(legacy.join("log/encorehub.log"), b"log line").unwrap();

            let report = migrate_legacy_runtime(&legacy, &app_data).unwrap();

            assert_eq!(report.copied_files, 3);
            assert_eq!(report.preserved_conflicts, 0);
            assert!(report.marker_created);
            assert_eq!(
                fs::read(app_data.join("data/encorehub.db")).unwrap(),
                b"database"
            );
            assert_eq!(
                fs::read(app_data.join("data/nested/blob.bin")).unwrap(),
                b"blob"
            );
            assert_eq!(
                fs::read(app_data.join("log/encorehub.log")).unwrap(),
                b"log line"
            );
            assert!(legacy.join("data/encorehub.db").exists());
            assert!(legacy.join("log/encorehub.log").exists());
            assert!(app_data.join(LEGACY_MIGRATION_MARKER).exists());

            fs::write(legacy.join("data/encorehub.db"), b"changed legacy").unwrap();
            let second = migrate_legacy_runtime(&legacy, &app_data).unwrap();
            assert_eq!(second, MigrationReport::default());
            assert_eq!(
                fs::read(app_data.join("data/encorehub.db")).unwrap(),
                b"database"
            );
        }

        #[test]
        fn migration_preserves_preexisting_destination_conflicts() {
            let temp = tempfile::tempdir().unwrap();
            let legacy = temp.path().join("legacy");
            let app_data = temp.path().join("app-data");
            fs::create_dir_all(legacy.join("data")).unwrap();
            fs::create_dir_all(app_data.join("data")).unwrap();
            fs::write(legacy.join("data/encorehub.db"), b"legacy").unwrap();
            fs::write(app_data.join("data/encorehub.db"), b"current").unwrap();

            let report = migrate_legacy_runtime(&legacy, &app_data).unwrap();

            assert_eq!(report.copied_files, 0);
            assert_eq!(report.preserved_conflicts, 1);
            assert_eq!(
                fs::read(app_data.join("data/encorehub.db")).unwrap(),
                b"current"
            );
            assert_eq!(
                fs::read(legacy.join("data/encorehub.db")).unwrap(),
                b"legacy"
            );
            assert!(report.marker_created);
        }
    }
}
