use crate::types::{Project, ProjectFolder, Track};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use keyring::Entry;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime},
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
    pub model_downloading: Arc<std::sync::Mutex<Option<String>>>,
    pub export_cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
    pub yt_dlp_cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
    pub cuda_runtime_cancelled: Arc<std::sync::Mutex<bool>>,
    pub cuda_runtime_installing: Arc<std::sync::Mutex<bool>>,
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
    pub models_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub imports_dir: PathBuf,
    pub tracks: Vec<Track>,
    pub projects: Vec<Project>,
    pub project_folders: Vec<ProjectFolder>,
    pub settings: serde_json::Map<String, serde_json::Value>,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
const SECRET_SERVICE: &str = "com.w3ti.griffinmusic";
const STEMSPLIT_API_KEY: &str = "stemSplitApiKey";

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn stem_split_entry() -> Result<Entry, String> {
    Entry::new(SECRET_SERVICE, STEMSPLIT_API_KEY)
        .map_err(|error| format!("cofre do sistema indisponível: {error}"))
}

pub fn load_stem_split_api_key(
    data_dir: &Path,
    settings: &serde_json::Map<String, serde_json::Value>,
) -> Option<String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let stored = stem_split_entry()
        .ok()
        .and_then(|entry| entry.get_password().ok());
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
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
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        return stem_split_entry()?
            .set_password(key.trim())
            .map_err(|error| {
                format!("não foi possível salvar a chave no cofre do sistema: {error}")
            });
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
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
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        if let Ok(entry) = stem_split_entry() {
            let _ = entry.delete_credential();
        }
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        match fs::remove_file(secret_file(data_dir)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn secret_file(data_dir: &Path) -> PathBuf {
    data_dir.join("secrets").join(STEMSPLIT_API_KEY)
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            data: std::sync::Mutex::new(StateData {
                data_dir: PathBuf::new(),
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
            model_downloading: Arc::new(std::sync::Mutex::new(None)),
            export_cancelled: Arc::new(std::sync::Mutex::new(HashSet::new())),
            yt_dlp_cancelled: Arc::new(std::sync::Mutex::new(HashSet::new())),
            cuda_runtime_cancelled: Arc::new(std::sync::Mutex::new(false)),
            cuda_runtime_installing: Arc::new(std::sync::Mutex::new(false)),
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
        fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&imports_dir).map_err(|e| e.to_string())?;
        let tracks: Vec<Track> = read_json(&data_dir.join("library.json"))?.unwrap_or_default();
        let projects = read_json(&data_dir.join("projects.json"))?.unwrap_or_default();
        let project_folders = read_json(&data_dir.join("project-folders.json"))?.unwrap_or_default();
        cleanup_stale_remote_imports(&imports_dir, &tracks);
        let mut settings = read_json_map(&data_dir.join("settings.json"))?.unwrap_or_default();
        if let Some(legacy_key) = settings
            .get(STEMSPLIT_API_KEY)
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
        {
            if save_stem_split_api_key(&data_dir, &legacy_key).is_ok() {
                settings.remove(STEMSPLIT_API_KEY);
                write_json_atomic(&data_dir.join("settings.json"), &settings)?;
            }
        }
        *self
            .data
            .lock()
            .map_err(|_| "estado indisponível".to_string())? = StateData {
            data_dir,
            models_dir,
            cache_dir,
            imports_dir,
            tracks,
            projects,
            project_folders,
            settings,
        };
        Ok(())
    }
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

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
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
