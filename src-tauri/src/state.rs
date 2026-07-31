use crate::types::{Project, Track};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use keyring::Entry;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{AppHandle, Manager};
use tokio::{process::Child, sync::Mutex};

pub struct AppState {
    pub data: std::sync::Mutex<StateData>,
    pub workers: tokio::sync::Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    pub remote_assets: std::sync::Mutex<HashMap<String, RemoteAsset>>,
    pub youtube_previews: std::sync::Mutex<HashMap<String, YoutubePreview>>,
    pub remote_cancelled: std::sync::Mutex<HashSet<String>>,
    pub model_cancelled: std::sync::Mutex<HashSet<String>>,
    pub export_cancelled: std::sync::Mutex<HashSet<String>>,
    pub yt_dlp_cancelled: std::sync::Mutex<HashSet<String>>,
}

#[derive(Clone)]
pub struct RemoteAsset {
    pub path: PathBuf,
    pub format: String,
}

#[derive(Clone)]
pub struct YoutubePreview {
    pub url: String,
    pub title: String,
}

pub struct StateData {
    pub data_dir: PathBuf,
    pub models_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub imports_dir: PathBuf,
    pub tracks: Vec<Track>,
    pub projects: Vec<Project>,
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
        let temporary = path.with_extension("tmp");
        fs::write(&temporary, key.trim()).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?;
        }
        fs::rename(temporary, path).map_err(|error| error.to_string())
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
                settings: serde_json::Map::new(),
            }),
            workers: tokio::sync::Mutex::new(HashMap::new()),
            remote_assets: std::sync::Mutex::new(HashMap::new()),
            youtube_previews: std::sync::Mutex::new(HashMap::new()),
            remote_cancelled: std::sync::Mutex::new(HashSet::new()),
            model_cancelled: std::sync::Mutex::new(HashSet::new()),
            export_cancelled: std::sync::Mutex::new(HashSet::new()),
            yt_dlp_cancelled: std::sync::Mutex::new(HashSet::new()),
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
        let tracks = read_json(&data_dir.join("library.json")).unwrap_or_default();
        let projects = read_json(&data_dir.join("projects.json")).unwrap_or_default();
        let mut settings = read_json_map(&data_dir.join("settings.json")).unwrap_or_default();
        if let Some(legacy_key) = settings
            .get(STEMSPLIT_API_KEY)
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
        {
            if save_stem_split_api_key(&data_dir, &legacy_key).is_ok() {
                settings.remove(STEMSPLIT_API_KEY);
                let _ = fs::write(
                    data_dir.join("settings.json"),
                    serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
                );
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
            settings,
        };
        Ok(())
    }
}

fn read_json<T: serde::de::DeserializeOwned>(path: &PathBuf) -> Option<T> {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
}
fn read_json_map(path: &PathBuf) -> Option<serde_json::Map<String, serde_json::Value>> {
    read_json(path)
}
