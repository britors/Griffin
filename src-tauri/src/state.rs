use crate::types::{Project, ProjectFolder, Track};
#[cfg(target_os = "windows")]
use keyring::Entry;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tokio::{process::Child, sync::Mutex};
use uuid::Uuid;

pub struct AppState {
    pub data: std::sync::Mutex<StateData>,
    pub separation_metrics: std::sync::Mutex<SeparationMetrics>,
    pub workers: tokio::sync::Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    pub remote_assets: std::sync::Mutex<HashMap<String, RemoteAsset>>,
    pub youtube_previews: std::sync::Mutex<HashMap<String, YoutubePreview>>,
    pub youtube_processes: tokio::sync::Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    pub youtube_cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
    pub remote_cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
    pub active_separations: std::sync::Mutex<HashSet<String>>,
    pub separation_cache_gate: tokio::sync::RwLock<()>,
    pub model_cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
    pub model_paused: Arc<std::sync::Mutex<HashSet<String>>>,
    pub model_downloading: Arc<std::sync::Mutex<Option<String>>>,
    pub export_cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
    pub yt_dlp_cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
    pub yt_dlp_paused: Arc<std::sync::Mutex<bool>>,
    pub cuda_runtime_cancelled: Arc<std::sync::Mutex<bool>>,
    pub cuda_runtime_paused: Arc<std::sync::Mutex<bool>>,
    pub cuda_runtime_installing: Arc<std::sync::Mutex<bool>>,
    pub preparation_auto_resuming: Arc<std::sync::Mutex<bool>>,
}

#[derive(Default)]
pub struct SeparationMetrics {
    pub last_duration_ms: Option<u64>,
    pub last_provider: Option<String>,
}

#[derive(Clone)]
pub struct RemoteAsset {
    pub path: PathBuf,
    pub format: String,
    pub created_at: std::time::Instant,
}

#[derive(Clone)]
pub struct YoutubePreview {
    pub url: String,
    pub title: String,
    pub created_at: std::time::Instant,
}

pub struct StateData {
    pub data_dir: PathBuf,
    pub session_marker_path: PathBuf,
    pub session_log_path: PathBuf,
    pub session_id: String,
    pub models_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub imports_dir: PathBuf,
    pub tracks: Vec<Track>,
    pub projects: Vec<Project>,
    pub project_folders: Vec<ProjectFolder>,
    pub settings: serde_json::Map<String, serde_json::Value>,
}

#[cfg(target_os = "windows")]
const SECRET_SERVICE: &str = "com.w3ti.griffinmusic";
const STEMSPLIT_API_KEY: &str = "stemSplitApiKey";

#[cfg(target_os = "windows")]
fn stem_split_entry() -> Result<Entry, String> {
    Entry::new(SECRET_SERVICE, STEMSPLIT_API_KEY)
        .map_err(|error| format!("cofre do sistema indisponível: {error}"))
}

pub fn load_stem_split_api_key(
    data_dir: &Path,
    settings: &serde_json::Map<String, serde_json::Value>,
) -> Option<String> {
    #[cfg(target_os = "windows")]
    let stored = stem_split_entry()
        .ok()
        .and_then(|entry| entry.get_password().ok());
    #[cfg(not(target_os = "windows"))]
    let stored = fs::read_to_string(secret_file(data_dir)).ok();
    stored.filter(|value| !value.trim().is_empty()).or_else(|| {
        settings
            .get(STEMSPLIT_API_KEY)
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
    })
}

pub fn save_stem_split_api_key(data_dir: &Path, key: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return stem_split_entry()?
            .set_password(key.trim())
            .map_err(|error| {
                format!("não foi possível salvar a chave no cofre do sistema: {error}")
            });
    }
    #[cfg(not(target_os = "windows"))]
    {
        let path = secret_file(data_dir);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let temporary = path.with_file_name(format!(
            ".{}.tmp-{}",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("secret"),
            Uuid::new_v4()
        ));
        let result = (|| {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|error| error.to_string())?;
            file.write_all(key.trim().as_bytes())
                .map_err(|error| error.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(fs::Permissions::from_mode(0o600))
                    .map_err(|error| error.to_string())?;
            }
            file.sync_all().map_err(|error| error.to_string())?;
            drop(file);
            fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
            #[cfg(unix)]
            if let Some(parent) = path.parent() {
                fs::File::open(parent)
                    .and_then(|directory| directory.sync_all())
                    .map_err(|error| error.to_string())?;
            }
            Ok::<(), String>(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
}

pub fn remove_stem_split_api_key(data_dir: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(entry) = stem_split_entry() {
            let _ = entry.delete_credential();
        }
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        match fs::remove_file(secret_file(data_dir)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn secret_file(data_dir: &Path) -> PathBuf {
    data_dir.join("secrets").join(STEMSPLIT_API_KEY)
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            data: std::sync::Mutex::new(StateData {
                data_dir: PathBuf::new(),
                session_marker_path: PathBuf::new(),
                session_log_path: PathBuf::new(),
                session_id: String::new(),
                models_dir: PathBuf::new(),
                cache_dir: PathBuf::new(),
                imports_dir: PathBuf::new(),
                tracks: Vec::new(),
                projects: Vec::new(),
                project_folders: Vec::new(),
                settings: serde_json::Map::new(),
            }),
            separation_metrics: std::sync::Mutex::new(SeparationMetrics::default()),
            workers: tokio::sync::Mutex::new(HashMap::new()),
            remote_assets: std::sync::Mutex::new(HashMap::new()),
            youtube_previews: std::sync::Mutex::new(HashMap::new()),
            youtube_processes: tokio::sync::Mutex::new(HashMap::new()),
            youtube_cancelled: Arc::new(std::sync::Mutex::new(HashSet::new())),
            remote_cancelled: Arc::new(std::sync::Mutex::new(HashSet::new())),
            active_separations: std::sync::Mutex::new(HashSet::new()),
            separation_cache_gate: tokio::sync::RwLock::new(()),
            model_cancelled: Arc::new(std::sync::Mutex::new(HashSet::new())),
            model_paused: Arc::new(std::sync::Mutex::new(HashSet::new())),
            model_downloading: Arc::new(std::sync::Mutex::new(None)),
            export_cancelled: Arc::new(std::sync::Mutex::new(HashSet::new())),
            yt_dlp_cancelled: Arc::new(std::sync::Mutex::new(HashSet::new())),
            yt_dlp_paused: Arc::new(std::sync::Mutex::new(false)),
            cuda_runtime_cancelled: Arc::new(std::sync::Mutex::new(false)),
            cuda_runtime_paused: Arc::new(std::sync::Mutex::new(false)),
            cuda_runtime_installing: Arc::new(std::sync::Mutex::new(false)),
            preparation_auto_resuming: Arc::new(std::sync::Mutex::new(false)),
        }
    }
}

impl AppState {
    pub fn initialize(&self, app: &AppHandle) -> Result<(), String> {
        // Keep the established GriffinMusic data location so existing library,
        // settings and downloaded models survive upgrades.
        let data_dir = dirs::config_dir()
            .map(|path| path.join("GriffinMusic"))
            .or_else(|| app.path().app_data_dir().ok())
            .ok_or_else(|| "Não foi possível determinar a pasta de dados.".to_string())?;
        let models_dir = data_dir.join("models");
        let cache_dir = data_dir.join("stems");
        let imports_dir = data_dir.join("imports");
        let session_marker_path = data_dir.join("session.active");
        let logs_dir = data_dir.join("logs");
        fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&imports_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
        let previous_session = fs::read_to_string(&session_marker_path).ok();
        if let Some(previous_session) = previous_session {
            let previous_log = previous_session_log(&data_dir, &previous_session);
            let report = unexpected_shutdown_report(&previous_session, previous_log.as_deref());
            let _ = fs::write(data_dir.join("unexpected-shutdown.txt"), report);
        }
        let started_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default();
        let session_id = Uuid::new_v4().to_string();
        let session_log_name = format!("session-{started_at}-{session_id}.log");
        let session_log_path = logs_dir.join(&session_log_name);
        let _ = append_session_log(
            &session_log_path,
            &session_id,
            "session.started",
            &format!(
                "version={} os={} arch={}",
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH
            ),
        );
        let _ = append_session_log(
            &session_log_path,
            &session_id,
            "startup.data_dir_ready",
            "ok",
        );
        let session = format!(
            "session_id={}\nstarted_at={}\nversion={}\nos={}\narch={}\nlog_file={}\n",
            session_id,
            started_at,
            app.package_info().version,
            std::env::consts::OS,
            std::env::consts::ARCH,
            session_log_name,
        );
        fs::write(&session_marker_path, session).map_err(|e| e.to_string())?;
        let _ = append_session_log(
            &session_log_path,
            &session_id,
            "startup.session_marker_written",
            "ok",
        );
        let tracks: Vec<Track> = match read_json(&data_dir.join("library.json")) {
            Ok(value) => value.unwrap_or_default(),
            Err(error) => {
                let _ = append_session_log(
                    &session_log_path,
                    &session_id,
                    "startup.library_read_failed",
                    &error,
                );
                return Err(error);
            }
        };
        let _ = append_session_log(
            &session_log_path,
            &session_id,
            "startup.library_loaded",
            &format!("tracks={}", tracks.len()),
        );
        let projects: Vec<Project> = match read_json(&data_dir.join("projects.json")) {
            Ok(value) => value.unwrap_or_default(),
            Err(error) => {
                let _ = append_session_log(
                    &session_log_path,
                    &session_id,
                    "startup.projects_read_failed",
                    &error,
                );
                return Err(error);
            }
        };
        let _ = append_session_log(
            &session_log_path,
            &session_id,
            "startup.projects_loaded",
            &format!("projects={}", projects.len()),
        );
        let project_folders: Vec<ProjectFolder> =
            match read_json(&data_dir.join("project-folders.json")) {
                Ok(value) => value.unwrap_or_default(),
                Err(error) => {
                    let _ = append_session_log(
                        &session_log_path,
                        &session_id,
                        "startup.project_folders_read_failed",
                        &error,
                    );
                    return Err(error);
                }
            };
        cleanup_stale_remote_imports(&imports_dir, &tracks);
        let _ = append_session_log(
            &session_log_path,
            &session_id,
            "startup.remote_imports_cleaned",
            "ok",
        );
        let mut settings = match read_json_map(&data_dir.join("settings.json")) {
            Ok(value) => value.unwrap_or_default(),
            Err(error) => {
                let _ = append_session_log(
                    &session_log_path,
                    &session_id,
                    "startup.settings_read_failed",
                    &error,
                );
                return Err(error);
            }
        };
        if let Some(legacy_key) = settings
            .get(STEMSPLIT_API_KEY)
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
        {
            if save_stem_split_api_key(&data_dir, &legacy_key).is_ok() {
                settings.remove(STEMSPLIT_API_KEY);
                write_json_atomic(&data_dir.join("settings.json"), &settings)?;
                let _ = append_session_log(
                    &session_log_path,
                    &session_id,
                    "startup.legacy_settings_migrated",
                    "ok",
                );
            }
        }
        *self
            .data
            .lock()
            .map_err(|_| "estado indisponível".to_string())? = StateData {
            data_dir,
            session_marker_path,
            session_log_path: session_log_path.clone(),
            session_id: session_id.clone(),
            models_dir,
            cache_dir,
            imports_dir,
            tracks,
            projects,
            project_folders,
            settings,
        };
        let _ = append_session_log(&session_log_path, &session_id, "startup.state_ready", "ok");
        Ok(())
    }

    pub fn record_session_event(&self, event: &str, detail: &str) {
        let Ok(data) = self.data.lock() else {
            return;
        };
        let _ = append_session_log(&data.session_log_path, &data.session_id, event, detail);
    }
}

const SESSION_LOG_MAX_BYTES: u64 = 64 * 1024;

pub fn append_session_log(
    path: &Path,
    session_id: &str,
    event: &str,
    detail: &str,
) -> Result<(), String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| format!("{}.{:03}", duration.as_secs(), duration.subsec_millis()))
        .unwrap_or_else(|_| "0.000".to_string());
    let detail = detail.replace('\r', " ").replace('\n', " ");
    let line =
        format!("timestamp={timestamp} session={session_id} event={event} detail={detail}\n");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(line.as_bytes())
        .map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())
}

fn previous_session_log(data_dir: &Path, previous_session: &str) -> Option<String> {
    let log_file = previous_session
        .lines()
        .find_map(|line| line.strip_prefix("log_file="))?;
    let path = Path::new(log_file);
    if path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return None;
    }
    read_limited_text(&data_dir.join("logs").join(path), SESSION_LOG_MAX_BYTES)
}

fn read_limited_text(path: &Path, max_bytes: u64) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(max_bytes).read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes).trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn unexpected_shutdown_report(previous_session: &str, previous_log: Option<&str>) -> String {
    let log = previous_log
        .map(|value| format!("\n\nLog da sessão anterior:\n{value}"))
        .unwrap_or_default();
    format!(
        "O Griffin não registrou o encerramento normal da sessão anterior.\n\n{previous_session}{log}"
    )
}

const STALE_REMOTE_IMPORT_AGE: Duration = Duration::from_secs(30 * 60);

fn cleanup_stale_remote_imports(imports_dir: &Path, tracks: &[Track]) {
    let referenced = tracks
        .iter()
        .map(|track| PathBuf::from(&track.path))
        .collect::<HashSet<_>>();
    let Ok(entries) = fs::read_dir(imports_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || referenced.contains(&path) || !is_managed_remote_import(&path) {
            continue;
        }
        let old_enough = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age >= STALE_REMOTE_IMPORT_AGE);
        if old_enough {
            let _ = fs::remove_file(path);
        }
    }
}

fn is_managed_remote_import(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    name.starts_with("remote-preview-")
        || stem
            .rsplit_once('-')
            .is_some_and(|(_, suffix)| Uuid::parse_str(suffix).is_ok())
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_file_name(format!(
        "{}.bak",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("data")
    ))
}

fn corrupt_path(path: &Path) -> PathBuf {
    path.with_file_name(format!(
        "{}.corrupt-{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("data"),
        Uuid::new_v4()
    ))
}

pub fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let temporary = path.with_file_name(format!(
        ".{}.tmp-{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("data"),
        Uuid::new_v4()
    ));
    let backup = backup_path(path);
    let mut temporary_file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
    if let Err(error) = temporary_file
        .write_all(&bytes)
        .and_then(|_| temporary_file.sync_all())
    {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    drop(temporary_file);

    let had_primary = path.exists();
    if had_primary {
        if backup.exists() {
            fs::remove_file(&backup).map_err(|error| error.to_string())?;
        }
        if let Err(error) = fs::rename(path, &backup) {
            let _ = fs::remove_file(&temporary);
            return Err(error.to_string());
        }
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if had_primary {
            let _ = fs::rename(&backup, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }

    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    let backup = backup_path(path);
    match fs::read_to_string(path) {
        Ok(text) => {
            if let Ok(value) = serde_json::from_str(&text) {
                return Ok(Some(value));
            }
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            return recover_from_backup(path, &backup, Some(error.to_string()));
        }
        Err(_) => {}
    }

    recover_from_backup(path, &backup, Some("conteúdo JSON inválido".to_string()))
}

fn recover_from_backup<T: serde::de::DeserializeOwned>(
    path: &Path,
    backup: &Path,
    primary_error: Option<String>,
) -> Result<Option<T>, String> {
    let Ok(text) = fs::read_to_string(backup) else {
        if path.exists() {
            return Err(format!(
                "não foi possível ler {}: {}",
                path.display(),
                primary_error.unwrap_or_else(|| "conteúdo JSON inválido".to_string())
            ));
        }
        return Ok(None);
    };
    let value = serde_json::from_str(&text).map_err(|error| {
        format!(
            "{} e o backup {} também está corrompido: {}",
            path.display(),
            backup.display(),
            error
        )
    })?;

    if path.exists() {
        fs::rename(path, corrupt_path(path)).map_err(|error| {
            format!(
                "não foi possível preservar o arquivo corrompido {}: {error}",
                path.display()
            )
        })?;
    }
    fs::rename(backup, path).map_err(|error| {
        format!(
            "não foi possível restaurar o backup {}: {error}",
            backup.display()
        )
    })?;
    Ok(Some(value))
}

fn read_json_map(
    path: &Path,
) -> Result<Option<serde_json::Map<String, serde_json::Value>>, String> {
    read_json(path)
}

#[cfg(test)]
mod tests {
    use super::{read_json, write_json_atomic};
    use serde::{Deserialize, Serialize};
    use std::{fs, path::PathBuf};
    use uuid::Uuid;

    #[derive(Debug, Deserialize, PartialEq, Serialize)]
    struct Fixture {
        version: u8,
    }

    fn fixture_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!("griffin-state-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create fixture directory");
        path
    }

    #[test]
    fn atomic_write_keeps_backup_and_recovers_missing_primary() {
        let directory = fixture_dir();
        let path = directory.join("library.json");
        write_json_atomic(&path, &Fixture { version: 1 }).expect("write initial value");
        write_json_atomic(&path, &Fixture { version: 2 }).expect("write updated value");
        assert_eq!(
            read_json::<Fixture>(&path).expect("read current value"),
            Some(Fixture { version: 2 })
        );
        fs::remove_file(&path).expect("remove primary");
        assert_eq!(
            read_json::<Fixture>(&path).expect("recover backup"),
            Some(Fixture { version: 1 })
        );
        assert!(path.exists());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn corrupt_primary_is_preserved_and_recovered() {
        let directory = fixture_dir();
        let path = directory.join("library.json");
        write_json_atomic(&path, &Fixture { version: 1 }).expect("write initial value");
        write_json_atomic(&path, &Fixture { version: 2 }).expect("write updated value");
        fs::write(&path, b"{").expect("corrupt primary");
        assert_eq!(
            read_json::<Fixture>(&path).expect("recover corrupt primary"),
            Some(Fixture { version: 1 })
        );
        assert!(fs::read_dir(&directory).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("library.json.corrupt-")
        }));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn corrupt_primary_without_backup_is_an_error() {
        let directory = fixture_dir();
        let path = directory.join("library.json");
        fs::write(&path, b"{").expect("corrupt primary");
        assert!(read_json::<Fixture>(&path).is_err());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn creates_a_report_for_an_unexpected_previous_session() {
        let report = super::unexpected_shutdown_report("started_at=123\nversion=1.2.2", None);
        assert!(report.contains("encerramento normal"));
        assert!(report.contains("started_at=123"));
        assert!(report.contains("version=1.2.2"));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn saves_secret_atomically_with_restricted_permissions() {
        let directory = fixture_dir();
        super::save_stem_split_api_key(&directory, "secret-value").expect("save secret");
        let path = directory.join("secrets").join(super::STEMSPLIT_API_KEY);
        assert_eq!(fs::read_to_string(&path).unwrap(), "secret-value");
        assert!(!fs::read_dir(path.parent().unwrap()).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp-")
        }));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let _ = fs::remove_dir_all(directory);
    }
}
