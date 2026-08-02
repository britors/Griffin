use crate::{
    state::{
        load_stem_split_api_key, remove_stem_split_api_key, save_stem_split_api_key,
        write_json_atomic, AppState, RemoteAsset, StateData, YoutubePreview,
    },
    types::*,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    net::{IpAddr, SocketAddr},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use symphonia::{
    core::{
        audio::SampleBuffer, codecs::DecoderOptions, errors::Error as SymphoniaError,
        formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
    },
    default::{get_codecs, get_probe},
};
use tauri::{ipc::Response, AppHandle, Emitter, Manager, State, Window};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::Mutex,
};
use ureq::unversioned::{
    resolver::{ResolvedSocketAddrs, Resolver},
    transport::{DefaultConnector, NextTimeout},
};
use url::Url;
use uuid::Uuid;

const CORE_STEMS: [&str; 4] = ["vocals", "drums", "bass", "other"];
const ALL_STEMS: [&str; 6] = ["vocals", "drums", "bass", "other", "guitar", "piano"];
const MAX_REMOTE_DURATION_SECONDS: f64 = 60.0 * 60.0;
const MAX_MODEL_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_PUBLIC_REDIRECTS: usize = 5;
const REMOTE_PREVIEW_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_REMOTE_PREVIEWS: usize = 32;
const MAX_EXTERNAL_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_EXTERNAL_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;
const LOCAL_SEPARATION_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const REMOTE_SEPARATION_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const YOUTUBE_OPERATION_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const MODEL_SHA256: &[(&str, &str)] = &[
    (
        "htdemucs.onnx",
        "d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a",
    ),
    (
        "htdemucs_ft_bass_fp16weights.onnx",
        "b533037176b14b2df31c92a5d5b3d5660d0811b9b360d3db761964768b079961",
    ),
    (
        "htdemucs_ft_drums_fp16weights.onnx",
        "047764dff888cfb87da917013377d4ec7a134f7419cbe486d9c339aa17975ddd",
    ),
    (
        "htdemucs_ft_other_fp16weights.onnx",
        "b739171a7057b3107bb0711c6222d4a619b41b13a8f04026431d30f32ad2bd71",
    ),
    (
        "htdemucs_ft_vocals_fp16weights.onnx",
        "0cbe651f535415c9d26a7bb614f7d322dd5a080fa0298f2e50f478030a994dce",
    ),
    (
        "htdemucs_6s.onnx",
        "7ce55792e2231c93fbf92de95f5fd5b3a5e6c89f7db690dfd693e8f1dce56869",
    ),
];

fn model_sha256(file_name: &str) -> Option<&'static str> {
    MODEL_SHA256
        .iter()
        .find_map(|(name, hash)| (*name == file_name).then_some(*hash))
}
const CUDNN_VERSION: &str = "9.25.0.15";
const CUDNN_MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;

struct CudaRuntimeAsset {
    url: &'static str,
    sha256: &'static str,
    archive_name: &'static str,
}

struct SeparationGuard<'a> {
    active: &'a std::sync::Mutex<HashSet<String>>,
    track_id: String,
}

struct InstallingFlagGuard(Arc<std::sync::Mutex<bool>>);

impl Drop for InstallingFlagGuard {
    fn drop(&mut self) {
        if let Ok(mut installing) = self.0.lock() {
            *installing = false;
        }
    }
}

struct DownloadingFlagGuard(Arc<std::sync::Mutex<Option<String>>>);

struct CancellationFlagGuard {
    cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
    id: String,
}

struct TemporaryFileGuard(Option<PathBuf>);

struct TemporaryDirectoryGuard(Option<PathBuf>);

impl Drop for DownloadingFlagGuard {
    fn drop(&mut self) {
        if let Ok(mut downloading) = self.0.lock() {
            *downloading = None;
        }
    }
}

impl Drop for CancellationFlagGuard {
    fn drop(&mut self) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.remove(&self.id);
        }
    }
}

impl TemporaryFileGuard {
    fn keep(mut self) {
        self.0 = None;
    }
}

impl Drop for TemporaryFileGuard {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = remove_file_if_exists(&path);
        }
    }
}

impl TemporaryDirectoryGuard {
    fn keep(mut self) {
        self.0 = None;
    }
}

impl Drop for TemporaryDirectoryGuard {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = remove_dir_if_exists(&path);
        }
    }
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Não foi possível remover o arquivo temporário {}: {error}",
            path.display()
        )),
    }
}

fn remove_dir_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Não foi possível remover o diretório temporário {}: {error}",
            path.display()
        )),
    }
}

impl Drop for SeparationGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.track_id);
        }
    }
}

fn acquire_separation<'a>(
    active: &'a std::sync::Mutex<HashSet<String>>,
    track_id: String,
) -> Result<SeparationGuard<'a>, String> {
    let mut active_tracks = active.lock().map_err(lock_error)?;
    if !active_tracks.insert(track_id.clone()) {
        return Err("Outra separação já está em andamento para esta faixa.".into());
    }
    Ok(SeparationGuard { active, track_id })
}

fn cuda_runtime_assets() -> Option<Vec<CudaRuntimeAsset>> {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Some(vec![
            CudaRuntimeAsset {
                url: "https://developer.download.nvidia.com/compute/cuda/redist/cuda_cudart/linux-x86_64/cuda_cudart-linux-x86_64-13.3.29-archive.tar.xz",
                sha256: "1e59c4888267d27ba1a9bd0f3669a6439db1334a96e754cd9013c7c73e18dc9d",
                archive_name: "cuda_cudart-linux-x86_64-13.3.29-archive.tar.xz",
            },
            CudaRuntimeAsset {
                url: "https://developer.download.nvidia.com/compute/cuda/redist/libcublas/linux-x86_64/libcublas-linux-x86_64-13.6.0.2-archive.tar.xz",
                sha256: "1794edb653adf48f5fa02d86bb738ed75888dd355aa39dadb6202d84d554c0dc",
                archive_name: "libcublas-linux-x86_64-13.6.0.2-archive.tar.xz",
            },
            CudaRuntimeAsset {
                url: "https://developer.download.nvidia.com/compute/cuda/redist/libcurand/linux-x86_64/libcurand-linux-x86_64-10.4.3.29-archive.tar.xz",
                sha256: "0218e62ab413e435dcd0274ec8e63b62214e6aba8519201061d1597e73caadbb",
                archive_name: "libcurand-linux-x86_64-10.4.3.29-archive.tar.xz",
            },
            CudaRuntimeAsset {
                url: "https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/linux-x86_64/cudnn-linux-x86_64-9.25.0.15_cuda13-archive.tar.xz",
                sha256: "bdf8c65f92dd552141d011fd7e7a1bfbafdc6239667b15c44d604597fa927745",
                archive_name: "cudnn-linux-x86_64-9.25.0.15_cuda13-archive.tar.xz",
            },
        ]);
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Some(vec![
            CudaRuntimeAsset {
                url: "https://developer.download.nvidia.com/compute/cuda/redist/cuda_cudart/windows-x86_64/cuda_cudart-windows-x86_64-13.3.29-archive.zip",
                sha256: "1feb7dd266813ffe8dbc24e115183a5ac35a4795c8d34aca0df85ab616b64d9c",
                archive_name: "cuda_cudart-windows-x86_64-13.3.29-archive.zip",
            },
            CudaRuntimeAsset {
                url: "https://developer.download.nvidia.com/compute/cuda/redist/libcublas/windows-x86_64/libcublas-windows-x86_64-13.6.0.2-archive.zip",
                sha256: "62e9fa305c8f0a28e0cdcf9d6fc1fed347bcfab8847239b9ae1fdc1d86408a",
                archive_name: "libcublas-windows-x86_64-13.6.0.2-archive.zip",
            },
            CudaRuntimeAsset {
                url: "https://developer.download.nvidia.com/compute/cuda/redist/libcurand/windows-x86_64/libcurand-windows-x86_64-10.4.3.29-archive.zip",
                sha256: "d3c518485188990666cf9ad848dab40cd0f686a6760344a52fc9eed24acc5b49",
                archive_name: "libcurand-windows-x86_64-10.4.3.29-archive.zip",
            },
            CudaRuntimeAsset {
                url: "https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/windows-x86_64/cudnn-windows-x86_64-9.25.0.15_cuda13-archive.zip",
                sha256: "1ee69c966cfd43d883d7e00e10b6e3052112a7b2abd2a9b0ef293eea1eae5f1e",
                archive_name: "cudnn-windows-x86_64-9.25.0.15_cuda13-archive.zip",
            },
        ]);
    }
    #[allow(unreachable_code)]
    None
}

fn cuda_runtime_root(data_dir: &Path) -> PathBuf {
    data_dir.join("runtimes").join("cuda").join("cudnn")
}

fn cuda_runtime_download_bytes() -> Option<u64> {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Some(1_787_316_144);
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return Some(1_720_055_937);
    #[allow(unreachable_code)]
    None
}

fn cuda_runtime_library_dir(data_dir: &Path) -> Option<PathBuf> {
    cuda_runtime_library_dir_for_root(&cuda_runtime_root(data_dir))
}

fn cuda_runtime_library_dir_for_root(root: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    let directory = root.join("lib");
    #[cfg(target_os = "windows")]
    let directory = root.join("bin");
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    let directory = root;
    directory.is_dir().then_some(directory)
}

fn cuda_runtime_library_names() -> &'static [&'static str] {
    #[cfg(target_os = "linux")]
    return &[
        "libcudart.so.13",
        "libcublas.so.13",
        "libcurand.so.10",
        "libcudnn.so.9",
    ];
    #[cfg(target_os = "windows")]
    return &[
        "cudart64_13.dll",
        "cublas64_13.dll",
        "curand64_10.dll",
        "cudnn64_9.dll",
    ];
    #[allow(unreachable_code)]
    &[]
}

fn validate_cuda_library_architecture(path: &Path) -> Result<(), String> {
    let mut file = fs::File::open(path).map_err(|error| {
        format!(
            "Não foi possível ler a biblioteca NVIDIA {}: {error}",
            path.display()
        )
    })?;
    #[cfg(target_os = "linux")]
    {
        let mut header = [0u8; 20];
        let read_ok = file.read_exact(&mut header).is_ok();
        let valid = read_ok
            && &header[0..4] == b"\x7fELF"
            && header[4] == 2
            && u16::from_le_bytes([header[18], header[19]]) == 62;
        if !valid {
            return Err(format!(
                "A biblioteca NVIDIA {} não é um binário ELF x64 compatível.",
                path.display()
            ));
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::io::{Seek, SeekFrom};
        let mut dos_header = [0u8; 0x40];
        let read_ok = file.read_exact(&mut dos_header).is_ok();
        let pe_offset = u32::from_le_bytes([
            dos_header[0x3c],
            dos_header[0x3d],
            dos_header[0x3e],
            dos_header[0x3f],
        ]) as u64;
        let seek_ok = file.seek(SeekFrom::Start(pe_offset)).is_ok();
        let mut pe_header = [0u8; 6];
        let pe_read_ok = file.read_exact(&mut pe_header).is_ok();
        let valid = read_ok
            && seek_ok
            && pe_read_ok
            && dos_header.starts_with(b"MZ")
            && pe_header.starts_with(b"PE\0\0")
            && u16::from_le_bytes([pe_header[4], pe_header[5]]) == 0x8664;
        if !valid {
            return Err(format!(
                "A biblioteca NVIDIA {} não é um binário PE x64 compatível.",
                path.display()
            ));
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    let _ = file;
    Ok(())
}

fn validate_cuda_runtime_files(data_dir: &Path) -> Result<(), String> {
    let directory = cuda_runtime_library_dir(data_dir).ok_or_else(|| {
        "Runtime NVIDIA ausente: a pasta de bibliotecas não foi encontrada.".to_string()
    })?;
    validate_cuda_runtime_directory(&directory)
}

fn validate_cuda_runtime_directory(directory: &Path) -> Result<(), String> {
    for name in cuda_runtime_library_names() {
        let path = directory.join(name);
        if !path.is_file() {
            return Err(format!(
                "Runtime NVIDIA incompleto: a biblioteca {name} não foi encontrada."
            ));
        }
        validate_cuda_library_architecture(&path)?;
    }
    Ok(())
}

fn validate_cuda_runtime_root(root: &Path) -> Result<(), String> {
    let directory = cuda_runtime_library_dir_for_root(root).ok_or_else(|| {
        "Runtime NVIDIA incompleto: a pasta de bibliotecas não foi encontrada.".to_string()
    })?;
    validate_cuda_runtime_directory(&directory)
}

fn cuda_runtime_installed(data_dir: &Path) -> bool {
    validate_cuda_runtime_files(data_dir).is_ok()
}

fn cuda_runtime_backup_paths(data_dir: &Path) -> Vec<PathBuf> {
    let destination = cuda_runtime_root(data_dir);
    let Some(parent) = destination.parent() else {
        return Vec::new();
    };
    let prefix = format!(
        "{}.backup-",
        destination
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("cudnn")
    );
    fs::read_dir(parent)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|name| name.starts_with(&prefix))
        })
        .collect()
}

fn recover_cuda_runtime_transaction(data_dir: &Path) -> Result<(), String> {
    let destination = cuda_runtime_root(data_dir);
    let staging = destination.with_extension("installing");
    let backups = cuda_runtime_backup_paths(data_dir);
    if validate_cuda_runtime_root(&destination).is_ok() {
        remove_dir_if_exists(&staging)?;
        for backup in backups {
            remove_dir_if_exists(&backup)?;
        }
        return Ok(());
    }
    let valid_backup = backups
        .iter()
        .find(|backup| validate_cuda_runtime_root(backup).is_ok())
        .cloned();
    if let Some(backup) = valid_backup {
        let failed = destination.with_extension(format!("failed-{}", Uuid::new_v4()));
        if destination.exists() {
            fs::rename(&destination, &failed).map_err(|error| {
                format!("Não foi possível preparar o runtime incompleto para recuperação: {error}")
            })?;
        }
        if let Err(error) = fs::rename(&backup, &destination) {
            if failed.exists() {
                let _ = fs::rename(&failed, &destination);
            }
            return Err(format!(
                "Não foi possível restaurar o runtime NVIDIA anterior: {error}"
            ));
        }
        remove_dir_if_exists(&failed)?;
        for other in backups {
            if other != backup {
                remove_dir_if_exists(&other)?;
            }
        }
        remove_dir_if_exists(&staging)?;
        return Ok(());
    }
    remove_dir_if_exists(&staging)?;
    for backup in backups {
        remove_dir_if_exists(&backup)?;
    }
    Ok(())
}

fn swap_cuda_runtime(data_dir: &Path, staging: &Path) -> Result<Option<PathBuf>, String> {
    let destination = cuda_runtime_root(data_dir);
    let backup = destination.with_extension(format!("backup-{}", Uuid::new_v4()));
    if destination.exists() {
        fs::rename(&destination, &backup).map_err(|error| {
            format!("Não foi possível preparar o runtime NVIDIA atual para troca: {error}")
        })?;
    }
    if let Err(error) = fs::rename(staging, &destination) {
        if backup.exists() {
            let _ = fs::rename(&backup, &destination);
        }
        return Err(format!(
            "Não foi possível ativar o novo runtime NVIDIA; a instalação anterior foi preservada: {error}"
        ));
    }
    Ok(backup.exists().then_some(backup))
}

fn restore_cuda_runtime_backup(data_dir: &Path, backup: &Path) -> Result<(), String> {
    let destination = cuda_runtime_root(data_dir);
    let failed = destination.with_extension(format!("failed-{}", Uuid::new_v4()));
    if destination.exists() {
        fs::rename(&destination, &failed)
            .map_err(|error| format!("Não foi possível retirar o runtime incompatível: {error}"))?;
    }
    if let Err(error) = fs::rename(backup, &destination) {
        if failed.exists() {
            let _ = fs::rename(&failed, &destination);
        }
        return Err(format!(
            "Não foi possível restaurar o runtime NVIDIA anterior: {error}"
        ));
    }
    remove_dir_if_exists(&failed)
}

fn configure_worker_library_paths(
    command: &mut Command,
    worker: &Path,
    cuda_library_directory: Option<&Path>,
) {
    #[cfg(target_os = "linux")]
    if let Some(directory) = worker.parent() {
        let mut library_paths = vec![directory.to_path_buf()];
        if let Some(cuda_directory) = cuda_library_directory {
            library_paths.insert(0, cuda_directory.to_path_buf());
        }
        if let Some(existing) = std::env::var_os("LD_LIBRARY_PATH") {
            library_paths.extend(std::env::split_paths(&existing));
        }
        if let Ok(joined) = std::env::join_paths(library_paths) {
            command.env("LD_LIBRARY_PATH", joined);
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(directory) = worker.parent() {
        let mut library_paths = vec![directory.to_path_buf()];
        if let Some(cuda_directory) = cuda_library_directory {
            library_paths.insert(0, cuda_directory.to_path_buf());
        }
        if let Some(existing) = std::env::var_os("PATH") {
            library_paths.extend(std::env::split_paths(&existing));
        }
        if let Ok(joined) = std::env::join_paths(library_paths) {
            command.env("PATH", joined);
        }
    }
}

async fn probe_cuda_runtime(app: &AppHandle, data_dir: &Path) -> Result<(), String> {
    let worker = worker_path(app);
    if !worker.is_file() {
        return Err("Runtime NVIDIA não pôde ser validado: worker ONNX não encontrado.".into());
    }
    let cuda_library_directory = cuda_runtime_library_dir(data_dir);
    let mut command = Command::new(&worker);
    command
        .arg("--probe-cuda")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_worker_library_paths(&mut command, &worker, cuda_library_directory.as_deref());
    let output = tokio::time::timeout(Duration::from_secs(15), command.output())
        .await
        .map_err(|_| "A validação do runtime NVIDIA excedeu o tempo limite.".to_string())?
        .map_err(|error| {
            format!("Não foi possível iniciar a validação do runtime NVIDIA: {error}")
        })?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = if detail.is_empty() {
        format!("processo terminou com {}", output.status)
    } else {
        detail
    };
    Err(format!(
        "Runtime NVIDIA incompatível ou não carregável: {detail}"
    ))
}

#[tauri::command]
pub async fn cuda_runtime_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let data_dir = state.data.lock().map_err(lock_error)?.data_dir.clone();
    let supported = cuda_runtime_assets().is_some();
    let downloading = *state.cuda_runtime_installing.lock().map_err(lock_error)?;
    let recovery_error = if downloading || !supported {
        None
    } else {
        recover_cuda_runtime_transaction(&data_dir).err()
    };
    let diagnostic = if !supported {
        None
    } else if let Some(error) = recovery_error.clone() {
        Some(error)
    } else {
        match validate_cuda_runtime_files(&data_dir) {
            Ok(()) => probe_cuda_runtime(&app, &data_dir).await.err(),
            Err(error) => Some(error),
        }
    };
    let installed = supported && diagnostic.is_none();
    let runtime_state = if downloading {
        "installing"
    } else if installed {
        "installed"
    } else if recovery_error.is_some() {
        "error"
    } else {
        "incomplete"
    };
    Ok(serde_json::json!({
        "supported": supported,
        "installed": installed,
        "downloading": downloading,
        "state": runtime_state,
        "downloadBytes": cuda_runtime_download_bytes(),
        "version": if supported { Some(CUDNN_VERSION) } else { None::<&str> },
        "message": if installed {
            format!("cuDNN {CUDNN_VERSION} instalado para este sistema.")
        } else if supported {
            diagnostic.clone().unwrap_or_else(|| "A aceleração NVIDIA ainda não está instalada. O Griffin pode baixar o runtime necessário.".to_string())
        } else {
            "A aceleração NVIDIA não está disponível para este sistema; o Griffin usará CPU.".to_string()
        },
        "diagnostic": diagnostic,
    }))
}

#[tauri::command]
pub async fn cuda_runtime_install(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let assets = cuda_runtime_assets()
        .ok_or_else(|| "A aceleração NVIDIA não é suportada neste sistema; use CPU.".to_string())?;
    {
        let mut installing = state.cuda_runtime_installing.lock().map_err(lock_error)?;
        if *installing {
            return Err("A instalação do runtime NVIDIA já está em andamento.".into());
        }
        *installing = true;
    }
    let data_dir = state.data.lock().map_err(lock_error)?.data_dir.clone();
    let cancelled = Arc::clone(&state.cuda_runtime_cancelled);
    let installing = Arc::clone(&state.cuda_runtime_installing);
    let _installing_guard = InstallingFlagGuard(Arc::clone(&installing));
    recover_cuda_runtime_transaction(&data_dir)?;
    if cuda_runtime_installed(&data_dir) && probe_cuda_runtime(&app, &data_dir).await.is_ok() {
        return Ok(());
    }
    *cancelled.lock().map_err(lock_error)? = false;
    let progress_app = app.clone();
    let install_data_dir = data_dir.clone();
    let backup = tokio::task::spawn_blocking(move || {
        cuda_runtime_install_blocking(progress_app, assets, install_data_dir, cancelled)
    })
    .await
    .map_err(|error| format!("Falha no instalador do runtime NVIDIA: {error}"))?;
    let backup = backup?;
    if let Err(error) = probe_cuda_runtime(&app, &data_dir).await {
        if let Some(backup) = backup {
            restore_cuda_runtime_backup(&data_dir, &backup)
                .map_err(|restore_error| format!("{error}. {restore_error}"))?;
        } else {
            let _ = remove_dir_if_exists(&cuda_runtime_root(&data_dir));
        }
        return Err(format!(
            "O novo runtime NVIDIA não pôde ser carregado; a instalação anterior foi preservada: {error}"
        ));
    }
    if let Some(backup) = backup {
        remove_dir_if_exists(&backup).map_err(|error| {
            format!("Runtime NVIDIA instalado, mas o backup antigo não pôde ser removido: {error}")
        })?;
    }
    emit_cuda_runtime_progress(&app, 1.0, "Aceleração NVIDIA instalada.");
    Ok(())
}

fn cuda_runtime_install_blocking(
    app: AppHandle,
    assets: Vec<CudaRuntimeAsset>,
    data_dir: PathBuf,
    cancelled: Arc<std::sync::Mutex<bool>>,
) -> Result<Option<PathBuf>, String> {
    let runtime_parent = data_dir.join("runtimes").join("cuda");
    fs::create_dir_all(&runtime_parent).map_err(|error| error.to_string())?;
    let staging = cuda_runtime_root(&data_dir).with_extension("installing");
    remove_dir_if_exists(&staging)?;
    let staging_guard = TemporaryDirectoryGuard(Some(staging.clone()));
    let total_assets = assets.len();
    for (index, asset) in assets.iter().enumerate() {
        if *cancelled.lock().map_err(lock_error)? {
            return Err("Download do runtime NVIDIA cancelado.".into());
        }
        let archive_path = runtime_parent.join(asset.archive_name);
        let temporary = archive_path.with_extension("download");
        let temporary_guard = TemporaryFileGuard(Some(temporary.clone()));
        let mut offset = fs::metadata(&temporary).map(|metadata| metadata.len()).unwrap_or(0);
        if offset > CUDNN_MAX_DOWNLOAD_BYTES {
            remove_file_if_exists(&temporary)?;
            offset = 0;
        }
        emit_cuda_runtime_progress(
            &app,
            (index as f64 + if offset > 0 { 0.01 } else { 0.0 }) / total_assets as f64 * 0.85,
            &format!(
                "Baixando componente NVIDIA {}/{}{}…",
                index + 1,
                total_assets,
                if offset > 0 { " · retomando" } else { "" }
            ),
        );
        let (asset_url, agent) = match public_http_agent(asset.url) {
            Ok(value) => value,
            Err(error) => {
                temporary_guard.keep();
                return Err(error);
            }
        };
        let mut request = agent.get(&asset_url);
        if offset > 0 {
            request = request.header("Range", format!("bytes={offset}-"));
        }
        let mut response = match request.call() {
            Ok(response) => response,
            Err(error) => {
                temporary_guard.keep();
                return Err(format!("Falha ao baixar o runtime NVIDIA: {error}"));
            }
        };
        let resumed = offset > 0
            && response.status().as_u16() == 206
            && response
                .headers()
                .get("content-range")
                .and_then(|value| value.to_str().ok())
                .and_then(parse_content_range)
                .is_some_and(|(start, _)| start == offset);
        if offset > 0 && !resumed {
            drop(response);
            remove_file_if_exists(&temporary)?;
            offset = 0;
            response = match agent.get(&asset_url).call() {
                Ok(response) => response,
                Err(error) => {
                    temporary_guard.keep();
                    return Err(format!("Falha ao baixar o runtime NVIDIA: {error}"));
                }
            };
        }
        let expected = if resumed {
            response
                .headers()
                .get("content-range")
                .and_then(|value| value.to_str().ok())
                .and_then(parse_content_range)
                .map(|(_, total)| total)
                .or_else(|| {
                    response
                        .headers()
                        .get("content-length")
                        .and_then(|value| value.to_str().ok())
                        .and_then(|value| value.parse::<u64>().ok())
                        .map(|remaining| offset.saturating_add(remaining))
                })
        } else {
            response
            .headers()
            .get("content-length")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
        };
        if expected.is_some_and(|size| size > CUDNN_MAX_DOWNLOAD_BYTES) {
            return Err(
                "Um pacote do runtime NVIDIA excede o limite de segurança do Griffin.".into(),
            );
        }
        let mut reader = response.into_body().into_reader();
        let mut file = if resumed {
            fs::OpenOptions::new()
                .append(true)
                .open(&temporary)
                .map_err(|error| error.to_string())?
        } else {
            fs::File::create(&temporary).map_err(|error| error.to_string())?
        };
        let copy_result = copy_with_progress(&mut reader, &mut file, expected, |received| {
            let received_total = offset.saturating_add(received);
            if received_total > CUDNN_MAX_DOWNLOAD_BYTES {
                return Err(
                    "Um pacote do runtime NVIDIA excede o limite de segurança do Griffin.".into(),
                );
            }
            if *cancelled.lock().map_err(lock_error)? {
                return Err("Download do runtime NVIDIA cancelado.".into());
            }
            let fraction = expected
                .map(|total| (received_total as f64 / total.max(1) as f64).min(1.0))
                .unwrap_or(0.0);
            let progress = (index as f64 + fraction) / total_assets as f64 * 0.85;
            emit_cuda_runtime_progress(
                &app,
                progress,
                &format!(
                    "Baixando componente NVIDIA · {}%",
                    (fraction * 100.0) as u32
                ),
            );
            Ok(())
        });
        if let Err(error) = copy_result {
            temporary_guard.keep();
            return Err(error);
        }
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        if sha256_file(&temporary)? != asset.sha256 {
            return Err("A verificação de integridade do runtime NVIDIA falhou.".into());
        }
        emit_cuda_runtime_progress(
            &app,
            (index as f64 + 0.9) / total_assets as f64 * 0.85,
            "Instalando componente NVIDIA…",
        );
        extract_cuda_runtime(&temporary, &staging)?;
        remove_file_if_exists(&temporary)?;
        temporary_guard.keep();
    }
    if *cancelled.lock().map_err(lock_error)? {
        return Err("Download do runtime NVIDIA cancelado.".into());
    }
    if validate_cuda_runtime_root(&staging).is_err() {
        return Err("O pacote cuDNN não contém uma biblioteca compatível com este sistema.".into());
    }
    let backup = swap_cuda_runtime(&data_dir, &staging)?;
    staging_guard.keep();
    Ok(backup)
}

#[tauri::command]
pub fn cuda_runtime_cancel(state: State<'_, AppState>) -> Result<(), String> {
    *state.cuda_runtime_cancelled.lock().map_err(lock_error)? = true;
    Ok(())
}

fn emit_cuda_runtime_progress(app: &AppHandle, progress: f64, stage: &str) {
    let _ = app.emit(
        "cuda-runtime:progress",
        serde_json::json!({ "progress": progress.clamp(0.0, 1.0), "stage": stage }),
    );
}

#[cfg(target_os = "linux")]
fn extract_cuda_runtime(archive_path: &Path, staging: &Path) -> Result<(), String> {
    use tar::Archive;
    use xz2::read::XzDecoder;
    let file = fs::File::open(archive_path).map_err(|error| error.to_string())?;
    let decoder = XzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    fs::create_dir_all(staging).map_err(|error| error.to_string())?;
    for entry in archive.entries().map_err(|error| error.to_string())? {
        let mut entry = entry.map_err(|error| error.to_string())?;
        let path = entry
            .path()
            .map_err(|error| error.to_string())?
            .into_owned();
        let Some(relative) = runtime_archive_path(&path, "lib") else {
            continue;
        };
        entry
            .unpack(staging.join(relative))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn extract_cuda_runtime(archive_path: &Path, staging: &Path) -> Result<(), String> {
    use std::io::Write;
    use zip::ZipArchive;
    let file = fs::File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let Some(path) = entry.enclosed_name() else {
            return Err("O pacote cuDNN contém um caminho inválido.".into());
        };
        let Some(relative) = runtime_archive_path(&path, "bin") else {
            continue;
        };
        let destination = staging.join(relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output = fs::File::create(destination).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
        output.flush().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn extract_cuda_runtime(_archive_path: &Path, _staging: &Path) -> Result<(), String> {
    Err("A aceleração NVIDIA não é suportada neste sistema.".into())
}

fn runtime_archive_path(path: &Path, marker: &str) -> Option<PathBuf> {
    let components = path.components().collect::<Vec<_>>();
    let marker_index = components.iter().position(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|value| value == marker)
    })?;
    if components[marker_index..].iter().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return None;
    }
    let relative = components[marker_index..]
        .iter()
        .map(|component| component.as_os_str())
        .collect::<PathBuf>();
    (!relative.file_name()?.to_str()?.is_empty()).then_some(relative)
}

#[tauri::command]
pub fn window_minimize(window: Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_toggle_maximize(window: Window) -> Result<bool, String> {
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
pub fn window_close(window: Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn library_list(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    Ok(state.data.lock().map_err(lock_error)?.tracks.clone())
}

#[tauri::command(rename_all = "camelCase")]
pub fn library_import(
    state: State<'_, AppState>,
    file_path: Option<String>,
) -> Result<Option<Track>, String> {
    let source = match file_path.or_else(pick_audio) {
        Some(value) => PathBuf::from(value),
        None => return Ok(None),
    };
    if !is_supported_audio(&source) {
        return Ok(None);
    }
    let mut data = state.data.lock().map_err(lock_error)?;
    if let Some(existing) = data
        .tracks
        .iter()
        .find(|track| same_path(&track.path, &source.to_string_lossy()))
    {
        return Ok(Some(existing.clone()));
    }
    let path = import_audio_into_managed_storage(&data, &source)?;
    let path_string = path.to_string_lossy().to_string();
    if let Some(existing) = data
        .tracks
        .iter()
        .find(|track| same_path(&track.path, &path_string))
    {
        return Ok(Some(existing.clone()));
    }
    let track = Track {
        id: Uuid::new_v4().to_string(),
        name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Áudio")
            .to_string(),
        path: path_string,
        imported_at: now(),
        duration: wav_duration(&path),
        stems: None,
        analysis: None,
        lyrics: None,
    };
    data.tracks.insert(0, track.clone());
    save_tracks_locked(&data)?;
    Ok(Some(track))
}

#[tauri::command(rename_all = "camelCase")]
pub fn library_import_many(
    state: State<'_, AppState>,
    file_paths: Option<Vec<String>>,
) -> Result<Vec<Track>, String> {
    let paths = match file_paths {
        Some(paths) => paths,
        None => rfd::FileDialog::new()
            .add_filter("Áudio", &["wav", "mp3", "flac", "webm", "m4a"])
            .pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
    };
    let mut imported = Vec::new();
    for path in paths {
        if let Some(track) = library_import(state.clone(), Some(path))? {
            imported.push(track);
        }
    }
    Ok(imported)
}

#[tauri::command(rename_all = "camelCase")]
pub fn library_read(state: State<'_, AppState>, file_path: String) -> Result<Response, String> {
    let data = state.data.lock().map_err(lock_error)?;
    let requested = fs::canonicalize(&file_path)
        .map_err(|_| "Arquivo de áudio não pertence à biblioteca.".to_string())?;
    let allowed = data.tracks.iter().any(|track| {
        track.path == file_path
            || track
                .stems
                .as_ref()
                .is_some_and(|stems| stems.values().any(|path| path == &file_path))
    });
    if !allowed {
        return Err("Arquivo de áudio não pertence à biblioteca.".into());
    }
    fs::read(requested)
        .map(Response::new)
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn library_remove(state: State<'_, AppState>, track_id: String) -> Result<(), String> {
    let mut data = state.data.lock().map_err(lock_error)?;
    let Some(index) = data.tracks.iter().position(|track| track.id == track_id) else {
        return Ok(());
    };
    let removed = data.tracks.remove(index);
    let remaining = data.tracks.clone();
    let projects_changed = remove_track_references_from_projects(&mut data, &track_id);
    save_tracks_locked(&data)?;
    if projects_changed {
        save_projects_locked(&data)?;
    }
    let imports_dir = data.imports_dir.clone();
    let cache_dir = data.cache_dir.clone();
    drop(data);
    cleanup_removed_track_files(&removed, &remaining, &imports_dir, &cache_dir)
}

#[tauri::command]
pub fn library_choose_file(state: State<'_, AppState>) -> Result<Option<Track>, String> {
    library_import(state, None)
}

#[tauri::command]
pub fn library_choose_files(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    library_import_many(state, None)
}

#[tauri::command]
pub async fn library_preview_url(
    state: State<'_, AppState>,
    url: String,
) -> Result<serde_json::Value, String> {
    let _ = cleanup_remote_preview_state(&state);
    let id = Uuid::new_v4().to_string();
    let file_stem = format!("remote-preview-{id}");
    let temporary_stem = file_stem.clone();
    let (imports_dir, input_url) = {
        let data = state.data.lock().map_err(lock_error)?;
        (data.imports_dir.clone(), url)
    };
    let result = tokio::task::spawn_blocking(move || {
        let extension_hint = Path::new(&input_url)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("audio");
        let temporary = imports_dir.join(format!("{temporary_stem}.{extension_hint}"));
        download_remote_preview_blocking(&input_url, &temporary)
            .map(|(url, format, size)| (url, format, size, temporary))
    })
    .await
    .map_err(|error| format!("Falha ao consultar a fonte remota: {error}"))??;
    let (url, format, size, path) = result;
    let file_name = format!("{file_stem}.{format}");
    state.remote_assets.lock().map_err(lock_error)?.insert(
        id.clone(),
        RemoteAsset {
            path,
            format: format.clone(),
            created_at: Instant::now(),
        },
    );
    let _ = cleanup_remote_preview_state(&state);
    Ok(
        serde_json::json!({ "id": id, "url": url, "fileName": file_name, "format": format, "sizeBytes": size }),
    )
}

fn download_remote_preview_blocking(
    value: &str,
    path: &Path,
) -> Result<(String, String, u64), String> {
    let (url, agent) = public_http_agent(value)?;
    let response = agent
        .get(&url)
        .call()
        .map_err(|error| format!("Falha ao baixar a fonte: {error}"))?;
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let format = audio_extension(&url, &content_type).ok_or_else(|| {
        "A URL não aponta para WAV, MP3, FLAC, M4A ou WebM suportado.".to_string()
    })?;
    let mut reader = response.into_body().into_reader();
    remove_file_if_exists(path)?;
    let temporary_guard = TemporaryFileGuard(Some(path.to_path_buf()));
    let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
    let size = copy_with_limit(&mut reader, &mut file, 200 * 1024 * 1024)?;
    file.sync_all().map_err(|error| error.to_string())?;
    temporary_guard.keep();
    Ok((url, format.to_string(), size))
}
#[tauri::command]
pub fn library_import_url(state: State<'_, AppState>, asset_id: String) -> Result<Track, String> {
    let _ = cleanup_remote_preview_state(&state);
    let asset = state
        .remote_assets
        .lock()
        .map_err(lock_error)?
        .remove(&asset_id)
        .ok_or_else(|| "A prévia remota expirou. Solicite uma nova prévia.".to_string())?;
    let path = {
        let data = state.data.lock().map_err(lock_error)?;
        data.imports_dir
            .join(format!("remote-{asset_id}.{}", asset.format))
    };
    fs::rename(&asset.path, &path).map_err(|error| error.to_string())?;
    library_import(state, Some(path.to_string_lossy().to_string()))?
        .ok_or_else(|| "O áudio remoto não pôde ser importado.".to_string())
}
#[tauri::command]
pub fn library_cancel_remote_import(
    state: State<'_, AppState>,
    asset_id: String,
) -> Result<(), String> {
    let _ = cleanup_remote_preview_state(&state);
    if let Some(asset) = state
        .remote_assets
        .lock()
        .map_err(lock_error)?
        .remove(&asset_id)
    {
        let _ = fs::remove_file(asset.path);
    }
    Ok(())
}
#[tauri::command]
pub async fn youtube_preview(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<serde_json::Value, String> {
    let _ = cleanup_remote_preview_state(&state);
    let _ = cleanup_youtube_cancelled(&state).await;
    let preview_id = Uuid::new_v4().to_string();
    let _cancelled_guard = CancellationFlagGuard {
        cancelled: Arc::clone(&state.youtube_cancelled),
        id: preview_id.clone(),
    };
    emit_youtube_progress(&app, &preview_id, 0.02, "downloading", "Consultando vídeo…");
    let result = match tokio::time::timeout(YOUTUBE_OPERATION_TIMEOUT, async {
        let url = tokio::task::spawn_blocking(move || validate_youtube_url(&url))
            .await
            .map_err(|error| format!("Falha ao validar o link do YouTube: {error}"))??;
        if youtube_cancel_requested(&state.youtube_cancelled, &preview_id) {
            return Err("Consulta do YouTube cancelada.".into());
        }
        let mut command = yt_dlp_command(&state);
        command
            .args([
                "--dump-single-json",
                "--skip-download",
                "--no-playlist",
                &url,
            ])
            .args(yt_dlp_runtime_args().await)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let child = command.spawn().map_err(normalize_yt_dlp_error)?;
        let process = register_youtube_process(&state.youtube_processes, &preview_id, child).await;
        if youtube_cancel_requested(&state.youtube_cancelled, &preview_id) {
            terminate_youtube_process(&process).await?;
            unregister_youtube_process(&state.youtube_processes, &preview_id, &process).await;
            return Err("Consulta do YouTube cancelada.".into());
        }
        let (mut stdout, mut stderr) = {
            let mut child = process.lock().await;
            let stdout = child.stdout.take().ok_or_else(|| {
                "Não foi possível ler os metadados do YouTube.".to_string()
            })?;
            let stderr = child.stderr.take().ok_or_else(|| {
                "Não foi possível ler os erros do YouTube.".to_string()
            })?;
            (stdout, stderr)
        };
        let collect_output = async {
            let (stdout_result, stderr_result) = tokio::join!(
                read_async_to_end_limited(&mut stdout, MAX_EXTERNAL_OUTPUT_BYTES),
                read_async_to_end_limited(&mut stderr, MAX_EXTERNAL_OUTPUT_BYTES),
            );
            let stdout_bytes = stdout_result
                .map_err(|error| format!("Falha ao ler os metadados do YouTube: {error}"))?;
            let stderr_bytes = stderr_result
                .map_err(|error| format!("Falha ao ler os erros do YouTube: {error}"))?;
            Ok::<_, String>((stdout_bytes, stderr_bytes))
        };
        tokio::pin!(collect_output);
        let (stdout, stderr) = tokio::select! {
            output = &mut collect_output => output?,
            _ = wait_for_youtube_cancel(Arc::clone(&state.youtube_cancelled), preview_id.clone()) => {
                return Err("Consulta do YouTube cancelada.".into());
            }
        };
        let status = process
            .lock()
            .await
            .wait()
            .await
            .map_err(|error| format!("Falha ao finalizar a consulta do YouTube: {error}"))?;
        unregister_youtube_process(&state.youtube_processes, &preview_id, &process).await;
        if !status.success() {
            return Err(yt_dlp_process_error(
                "Não foi possível consultar o YouTube.",
                &stderr,
                &stdout,
            ));
        }
        let metadata: serde_json::Value = serde_json::from_slice(&stdout)
            .map_err(|_| "O YouTube não retornou metadados válidos.".to_string())?;
        let title = metadata
            .get("title")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Áudio do YouTube")
            .to_string();
        let duration = metadata.get("duration").and_then(|value| value.as_f64());
        state.youtube_cancelled.lock().map_err(lock_error)?.remove(&preview_id);
        state.youtube_previews.lock().map_err(lock_error)?.insert(
            preview_id.clone(),
            YoutubePreview {
                url: url.clone(),
                title: title.clone(),
                created_at: Instant::now(),
            },
        );
        let _ = cleanup_remote_preview_state(&state);
        emit_youtube_progress(&app, &preview_id, 1.0, "importing", "Vídeo encontrado.");
        Ok(
            serde_json::json!({ "id": preview_id, "url": url, "title": title, "duration": duration, "format": "wav" }),
        )
    })
    .await
    {
        Ok(result) => result,
        Err(_) => Err("A consulta do YouTube excedeu o tempo limite.".into()),
    };
    cleanup_youtube_process(&state.youtube_processes, &preview_id).await;
    result
}
#[tauri::command(rename_all = "camelCase")]
pub async fn youtube_import(
    app: AppHandle,
    state: State<'_, AppState>,
    preview_id: String,
    fallback_url: Option<String>,
) -> Result<Track, String> {
    let _ = cleanup_remote_preview_state(&state);
    let _ = cleanup_youtube_cancelled(&state).await;
    let _cancelled_guard = CancellationFlagGuard {
        cancelled: Arc::clone(&state.youtube_cancelled),
        id: preview_id.clone(),
    };
    let result = match tokio::time::timeout(YOUTUBE_OPERATION_TIMEOUT, async {
    let preview = state
        .youtube_previews
        .lock()
        .map_err(lock_error)?
        .remove(&preview_id)
        .or_else(|| {
            fallback_url.map(|url| YoutubePreview {
                url,
                title: "Áudio do YouTube".into(),
                created_at: Instant::now(),
            })
        })
        .ok_or_else(|| "A prévia do YouTube expirou. Consulte o link novamente.".to_string())?;
    let preview_url = tokio::task::spawn_blocking({
        let url = preview.url.clone();
        move || validate_youtube_url(&url)
    })
    .await
    .map_err(|error| format!("Falha ao validar o link do YouTube: {error}"))??;
    let preview = YoutubePreview {
        url: preview_url,
        ..preview
    };
    if youtube_cancel_requested(&state.youtube_cancelled, &preview_id) {
        return Err("Download do YouTube cancelado.".into());
    }
    let (imports_dir, file_prefix) = {
        let data = state.data.lock().map_err(lock_error)?;
        (
            data.imports_dir.clone(),
            format!(
                "{}-{}",
                sanitize_file_name(&preview.title, "audio-do-youtube"),
                preview_id
            ),
        )
    };
    let template = imports_dir.join(format!("{file_prefix}.%(ext)s"));
    emit_youtube_progress(&app, &preview_id, 0.0, "downloading", "Preparando download…");
    let mut command = yt_dlp_command(&state);
    command
        .args([
            "--format",
            "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
            "--no-playlist",
            "--no-part",
            "--no-overwrites",
            "--output",
            &template.to_string_lossy(),
            &preview.url,
        ])
        .args(yt_dlp_runtime_args().await)
        .args(["--newline", "--progress-template", "download:%(progress._percent_str)s"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let child = command.spawn().map_err(normalize_yt_dlp_error)?;
    let process = register_youtube_process(&state.youtube_processes, &preview_id, child).await;
    if youtube_cancel_requested(&state.youtube_cancelled, &preview_id) {
        terminate_youtube_process(&process).await?;
        unregister_youtube_process(&state.youtube_processes, &preview_id, &process).await;
        cleanup_youtube_download(&imports_dir, &file_prefix);
        return Err("Download do YouTube cancelado.".into());
    }
    let stderr = match process.lock().await.stderr.take() {
        Some(stderr) => stderr,
        None => {
            cleanup_youtube_download(&imports_dir, &file_prefix);
            return Err("Não foi possível acompanhar o download do YouTube.".into());
        }
    };
    let mut error_output = Vec::new();
    let mut lines = BufReader::new(stderr.take(MAX_EXTERNAL_OUTPUT_BYTES as u64 + 1)).lines();
    let cancel_wait = wait_for_youtube_cancel(
        Arc::clone(&state.youtube_cancelled),
        preview_id.clone(),
    );
    tokio::pin!(cancel_wait);
    loop {
        tokio::select! {
            line = lines.next_line() => match line {
                Ok(Some(line)) => {
                    if let Some(percent) = youtube_download_percent(&line) {
                        let progress = (percent / 100.0 * 0.88).clamp(0.01, 0.88);
                        emit_youtube_progress(
                            &app,
                            &preview_id,
                            progress,
                            "downloading",
                            &format!("Baixando áudio · {percent:.0}%"),
                        );
                    } else {
                        if error_output.len().saturating_add(line.len() + 1)
                            > MAX_EXTERNAL_OUTPUT_BYTES
                        {
                            cleanup_youtube_download(&imports_dir, &file_prefix);
                            return Err("A saída de erro do YouTube excedeu o limite de segurança.".into());
                        }
                        error_output.extend_from_slice(line.as_bytes());
                        error_output.push(b'\n');
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    cleanup_youtube_download(&imports_dir, &file_prefix);
                    return Err(format!("Falha ao acompanhar o download: {error}"));
                }
            },
            _ = &mut cancel_wait => {
                cleanup_youtube_download(&imports_dir, &file_prefix);
                return Err("Download do YouTube cancelado.".into());
            }
        }
    }
    let status = match process.lock().await.wait().await {
        Ok(status) => status,
        Err(error) => {
            cleanup_youtube_download(&imports_dir, &file_prefix);
            return Err(format!("Falha ao finalizar o download: {error}"));
        }
    };
    unregister_youtube_process(&state.youtube_processes, &preview_id, &process).await;
    if !status.success() {
        cleanup_youtube_download(&imports_dir, &file_prefix);
        return Err(yt_dlp_process_error(
            "Não foi possível baixar o áudio do YouTube.",
            &error_output,
            &[],
        ));
    }
    emit_youtube_progress(&app, &preview_id, 0.92, "importing", "Importando áudio para a biblioteca…");
    let path = {
        fs::read_dir(&imports_dir)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| {
                path.is_file()
                    && path
                        .file_stem()
                        .and_then(|value| value.to_str())
                        .is_some_and(|stem| stem == file_prefix)
                    && is_supported_audio(path)
            })
    };
    let Some(path) = path else {
        cleanup_youtube_download(&imports_dir, &file_prefix);
        return Err("Não foi possível baixar o áudio do YouTube.".into());
    };
    let track = match library_import(state.clone(), Some(path.to_string_lossy().to_string())) {
        Ok(Some(track)) => track,
        Ok(None) => {
            cleanup_youtube_download(&imports_dir, &file_prefix);
            return Err("O áudio do YouTube não pôde ser importado.".into());
        }
        Err(error) => {
            cleanup_youtube_download(&imports_dir, &file_prefix);
            return Err(error);
        }
    };
    state.youtube_cancelled.lock().map_err(lock_error)?.remove(&preview_id);
    emit_youtube_progress(&app, &preview_id, 1.0, "importing", "Importação concluída.");
    Ok(track)
    })
    .await
    {
        Ok(result) => result,
        Err(_) => Err("O download do YouTube excedeu o tempo limite.".into()),
    };
    cleanup_youtube_process(&state.youtube_processes, &preview_id).await;
    result
}
#[tauri::command]
pub async fn youtube_cancel(state: State<'_, AppState>, preview_id: String) -> Result<(), String> {
    let _ = cleanup_remote_preview_state(&state);
    let _ = cleanup_youtube_cancelled(&state).await;
    state
        .youtube_previews
        .lock()
        .map_err(lock_error)?
        .remove(&preview_id);
    state
        .youtube_cancelled
        .lock()
        .map_err(lock_error)?
        .insert(preview_id.clone());
    let process = state
        .youtube_processes
        .lock()
        .await
        .get(&preview_id)
        .cloned();
    if let Some(process) = process {
        terminate_youtube_process(&process).await?;
        unregister_youtube_process(&state.youtube_processes, &preview_id, &process).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn yt_dlp_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let path = managed_yt_dlp_path(&state);
    let (asset, _) = yt_dlp_release_asset();
    if !path.is_file() {
        return Ok(serde_json::json!({
            "installed": false,
            "downloading": false,
            "asset": asset,
            "message": "yt-dlp não está instalado. Baixe-o para habilitar a importação do YouTube."
        }));
    }
    let version = Command::new(&path)
        .arg("--version")
        .output()
        .await
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Ok(serde_json::json!({
        "installed": true,
        "downloading": false,
        "asset": asset,
        "version": version,
        "path": path,
        "message": version.as_deref().map(|value| format!("yt-dlp {value} pronto para uso.")).unwrap_or_else(|| "yt-dlp instalado, mas a versão não pôde ser consultada.".into())
    }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn yt_dlp_download(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    const DOWNLOAD_ID: &str = "yt-dlp";
    state
        .yt_dlp_cancelled
        .lock()
        .map_err(lock_error)?
        .remove(DOWNLOAD_ID);
    let cancelled = Arc::clone(&state.yt_dlp_cancelled);
    let _cancelled_guard = CancellationFlagGuard {
        cancelled: Arc::clone(&cancelled),
        id: DOWNLOAD_ID.into(),
    };
    let (asset, checksum_asset) = yt_dlp_release_asset();
    let (tools_dir, destination) = {
        let data = state.data.lock().map_err(lock_error)?;
        let tools_dir = data.data_dir.join("tools");
        let name = if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        };
        (tools_dir.clone(), tools_dir.join(name))
    };
    let asset = asset.to_string();
    let checksum_asset = checksum_asset.to_string();
    tokio::task::spawn_blocking(move || {
        yt_dlp_download_blocking(
            app,
            cancelled,
            tools_dir,
            destination,
            &asset,
            &checksum_asset,
        )
    })
    .await
    .map_err(|error| format!("Falha no download do yt-dlp: {error}"))?
}

fn yt_dlp_download_blocking(
    app: AppHandle,
    cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
    tools_dir: PathBuf,
    destination: PathBuf,
    asset: &str,
    checksum_asset: &str,
) -> Result<(), String> {
    const DOWNLOAD_ID: &str = "yt-dlp";
    fs::create_dir_all(&tools_dir).map_err(|e| e.to_string())?;
    let temporary = destination.with_extension("download");
    remove_file_if_exists(&temporary)?;
    let temporary_guard = TemporaryFileGuard(Some(temporary.clone()));
    let _ = app.emit("yt-dlp:progress", serde_json::json!({ "progress": 0.0, "stage": "downloading", "message": "Baixando yt-dlp…" }));
    let (asset_url, agent) = public_http_agent(asset)?;
    let response = agent
        .get(&asset_url)
        .call()
        .map_err(|e| format!("Falha ao baixar o yt-dlp: {e}"))?;
    let expected = response
        .headers()
        .get("content-length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    if expected.is_some_and(|size| size > 100 * 1024 * 1024) {
        return Err("O download do yt-dlp excede o limite de segurança.".into());
    }
    let mut reader = response.into_body().into_reader();
    let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
    let copy_result = copy_with_progress(&mut reader, &mut file, expected, |received| {
        if received > 100 * 1024 * 1024 {
            return Err("O download do yt-dlp excede o limite de segurança.".into());
        }
        if cancelled.lock().map_err(lock_error)?.contains(DOWNLOAD_ID) {
            return Err("Download do yt-dlp cancelado.".into());
        }
        let progress = expected
            .map(|total| (received as f64 / total.max(1) as f64).min(1.0))
            .unwrap_or(0.0);
        let _ = app.emit("yt-dlp:progress", serde_json::json!({ "progress": progress * 0.9, "stage": "downloading", "message": format!("Baixando yt-dlp · {}%", (progress * 100.0) as u32) }));
        Ok(())
    });
    copy_result?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    let expected_hash = download_checksum(checksum_asset, asset)?;
    let actual_hash = sha256_file(&temporary)?;
    if expected_hash != actual_hash {
        return Err("A verificação de integridade do yt-dlp falhou.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
    temporary_guard.keep();
    let _ = app.emit("yt-dlp:progress", serde_json::json!({ "progress": 1.0, "stage": "ready", "message": "yt-dlp instalado e verificado." }));
    Ok(())
}

#[tauri::command]
pub fn yt_dlp_cancel(state: State<'_, AppState>) -> Result<(), String> {
    state
        .yt_dlp_cancelled
        .lock()
        .map_err(lock_error)?
        .insert("yt-dlp".into());
    Ok(())
}

#[tauri::command]
pub fn projects_list(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    Ok(state.data.lock().map_err(lock_error)?.projects.clone())
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_folders_list(
    state: State<'_, AppState>,
) -> Result<Vec<ProjectFolder>, String> {
    Ok(state.data.lock().map_err(lock_error)?.project_folders.clone())
}

#[tauri::command]
pub fn projects_create(state: State<'_, AppState>, name: String) -> Result<Project, String> {
    let mut data = state.data.lock().map_err(lock_error)?;
    let project = Project {
        id: Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        created_at: now(),
        updated_at: now(),
        track_ids: Vec::new(),
        folder_id: None,
        file_path: None,
        file_saved_at: None,
        snapshots: Some(Vec::new()),
        player_state: None,
    };
    data.projects.push(project.clone());
    save_projects_locked(&data)?;
    Ok(project)
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_rename(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
) -> Result<Project, String> {
    mutate_project(&state, &project_id, |project| {
        project.name = name.trim().to_string()
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_remove(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    let mut data = state.data.lock().map_err(lock_error)?;
    data.projects.retain(|project| project.id != project_id);
    save_projects_locked(&data)
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_folder_create(
    state: State<'_, AppState>,
    name: String,
    parent_id: Option<String>,
) -> Result<ProjectFolder, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("A pasta precisa ter um nome.".into());
    }
    let mut data = state.data.lock().map_err(lock_error)?;
    if let Some(parent_id) = parent_id.as_ref() {
        if !data.project_folders.iter().any(|folder| &folder.id == parent_id) {
            return Err("Pasta pai não encontrada.".into());
        }
    }
    let folder = ProjectFolder {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        parent_id,
        created_at: now(),
        updated_at: now(),
    };
    data.project_folders.push(folder.clone());
    save_project_folders_locked(&data)?;
    Ok(folder)
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_folder_rename(
    state: State<'_, AppState>,
    folder_id: String,
    name: String,
) -> Result<ProjectFolder, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("A pasta precisa ter um nome.".into());
    }
    let mut data = state.data.lock().map_err(lock_error)?;
    let folder = data
        .project_folders
        .iter_mut()
        .find(|folder| folder.id == folder_id)
        .ok_or_else(|| "Pasta não encontrada.".to_string())?;
    folder.name = name.to_string();
    folder.updated_at = now();
    let result = folder.clone();
    save_project_folders_locked(&data)?;
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_folder_remove(
    state: State<'_, AppState>,
    folder_id: String,
) -> Result<(), String> {
    let mut data = state.data.lock().map_err(lock_error)?;
    let parent_id = data
        .project_folders
        .iter()
        .find(|folder| folder.id == folder_id)
        .ok_or_else(|| "Pasta não encontrada.".to_string())?
        .parent_id
        .clone();
    if data
        .project_folders
        .iter()
        .any(|folder| folder.parent_id.as_deref() == Some(folder_id.as_str()))
    {
        return Err("Remova ou mova as subpastas antes de remover esta pasta.".into());
    }
    for project in &mut data.projects {
        if project.folder_id.as_deref() == Some(folder_id.as_str()) {
            project.folder_id = parent_id.clone();
            project.updated_at = now();
        }
    }
    data.project_folders.retain(|folder| folder.id != folder_id);
    save_projects_locked(&data)?;
    save_project_folders_locked(&data)
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_move(
    state: State<'_, AppState>,
    project_id: String,
    folder_id: Option<String>,
) -> Result<Project, String> {
    let mut data = state.data.lock().map_err(lock_error)?;
    if let Some(folder_id) = folder_id.as_ref() {
        if !data.project_folders.iter().any(|folder| &folder.id == folder_id) {
            return Err("Pasta não encontrada.".into());
        }
    }
    let project = data
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "Projeto não encontrado.".to_string())?;
    project.folder_id = folder_id;
    project.updated_at = now();
    let result = project.clone();
    save_projects_locked(&data)?;
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_add_track(
    state: State<'_, AppState>,
    project_id: String,
    track_id: String,
) -> Result<Project, String> {
    mutate_project(&state, &project_id, |project| {
        if !project.track_ids.contains(&track_id) {
            project.track_ids.push(track_id.clone())
        }
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_remove_track(
    state: State<'_, AppState>,
    project_id: String,
    track_id: String,
) -> Result<Project, String> {
    mutate_project(&state, &project_id, |project| {
        project.track_ids.retain(|id| id != &track_id)
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_move_track(
    state: State<'_, AppState>,
    project_id: String,
    track_id: String,
    direction: String,
) -> Result<Project, String> {
    mutate_project(&state, &project_id, |project| {
        if let Some(index) = project.track_ids.iter().position(|id| id == &track_id) {
            let target = if direction == "up" {
                index.checked_sub(1)
            } else if index + 1 < project.track_ids.len() {
                Some(index + 1)
            } else {
                None
            };
            if let Some(target) = target {
                project.track_ids.swap(index, target);
            }
        }
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_create_snapshot(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
    player: PlayerSnapshot,
) -> Result<Project, String> {
    mutate_project(&state, &project_id, |project| {
        project
            .snapshots
            .get_or_insert_default()
            .push(ProjectSnapshot {
                id: Uuid::new_v4().to_string(),
                name: name.trim().to_string(),
                created_at: now(),
                track_ids: project.track_ids.clone(),
                player: player.clone(),
            })
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_restore_snapshot(
    state: State<'_, AppState>,
    project_id: String,
    snapshot_id: String,
) -> Result<ProjectSnapshot, String> {
    let data = state.data.lock().map_err(lock_error)?;
    data.projects
        .iter()
        .find(|project| project.id == project_id)
        .and_then(|project| project.snapshots.as_ref())
        .and_then(|snapshots| snapshots.iter().find(|snapshot| snapshot.id == snapshot_id))
        .cloned()
        .ok_or_else(|| "Snapshot não encontrado.".into())
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_remove_snapshot(
    state: State<'_, AppState>,
    project_id: String,
    snapshot_id: String,
) -> Result<Project, String> {
    mutate_project(&state, &project_id, |project| {
        if let Some(snapshots) = project.snapshots.as_mut() {
            snapshots.retain(|snapshot| snapshot.id != snapshot_id);
        }
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_update_player_state(
    state: State<'_, AppState>,
    project_id: String,
    player: PlayerSnapshot,
) -> Result<Project, String> {
    mutate_project(&state, &project_id, |project| {
        project.player_state = Some(player.clone())
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_save_as(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Option<Project>, String> {
    let path = {
        let data = state.data.lock().map_err(lock_error)?;
        let project = data
            .projects
            .iter()
            .find(|project| project.id == project_id)
            .ok_or_else(|| "Projeto não encontrado.".to_string())?;
        let suggested_name = format!("{}.gfn", sanitize_file_name(&project.name, "projeto"));
        rfd::FileDialog::new()
            .add_filter("Projeto Griffin", &["gfn"])
            .set_file_name(&suggested_name)
            .save_file()
            .map(ensure_gfn_extension)
    };
    let Some(path) = path else { return Ok(None) };
    save_project_file(&state, &project_id, &path).map(Some)
}

#[tauri::command(rename_all = "camelCase")]
pub fn projects_save(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Project, String> {
    let path = {
        let data = state.data.lock().map_err(lock_error)?;
        data.projects
            .iter()
            .find(|project| project.id == project_id)
            .and_then(|project| project.file_path.clone())
            .ok_or_else(|| "Este projeto ainda não possui um arquivo .gfn.".to_string())?
    };
    save_project_file(&state, &project_id, Path::new(&path))
}

#[tauri::command]
pub fn projects_open(state: State<'_, AppState>) -> Result<Option<ProjectOpenResult>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Projeto Griffin", &["gfn"])
        .pick_file()
    else {
        return Ok(None);
    };
    let bytes = fs::read(&path).map_err(|error| format!("Não foi possível abrir o projeto: {error}"))?;
    let mut document: GriffinProjectFile = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Arquivo .gfn inválido: {error}"))?;
    if document.format != "griffin-project" || document.version != 1 {
        return Err("Versão de projeto .gfn não suportada.".into());
    }
    document.project.file_path = Some(path.to_string_lossy().to_string());
    let missing_tracks = document
        .tracks
        .iter()
        .filter(|track| track_files_missing(track))
        .map(|track| track.name.clone())
        .collect::<Vec<_>>();
    let mut data = state.data.lock().map_err(lock_error)?;
    data.project_folders = document.folders.clone();
    data.tracks.retain(|track| {
        !document
            .tracks
            .iter()
            .any(|imported| imported.id == track.id)
    });
    data.tracks.extend(document.tracks.clone());
    if let Some(existing) = data
        .projects
        .iter_mut()
        .find(|project| project.id == document.project.id)
    {
        *existing = document.project.clone();
    } else {
        data.projects.push(document.project.clone());
    }
    save_tracks_locked(&data)?;
    save_projects_locked(&data)?;
    save_project_folders_locked(&data)?;
    Ok(Some(ProjectOpenResult {
        project: document.project,
        folders: document.folders,
        tracks: document.tracks,
        missing_tracks,
    }))
}

fn save_project_file(
    state: &State<'_, AppState>,
    project_id: &str,
    path: &Path,
) -> Result<Project, String> {
    let mut data = state.data.lock().map_err(lock_error)?;
    let project_index = data
        .projects
        .iter()
        .position(|project| project.id == project_id)
        .ok_or_else(|| "Projeto não encontrado.".to_string())?;
    let mut project = data.projects[project_index].clone();
    // Older versions could leave a project pointing at a track that was
    // removed from the library. Keep the project saveable and repair those
    // stale references while preserving the rest of its state.
    let missing_track_ids = remove_missing_track_references(&mut project, &data.tracks);
    let tracks = project
        .track_ids
        .iter()
        .filter_map(|track_id| data.tracks.iter().find(|track| &track.id == track_id))
        .cloned()
        .collect::<Vec<_>>();
    if !missing_track_ids.is_empty() {
        project.updated_at = now();
    }
    let saved_at = now();
    project.file_path = Some(path.to_string_lossy().to_string());
    project.updated_at = saved_at.clone();
    project.file_saved_at = Some(saved_at.clone());
    let document = GriffinProjectFile {
        format: "griffin-project".into(),
        version: 1,
        saved_at,
        project: project.clone(),
        folders: data.project_folders.clone(),
        tracks,
    };
    write_json_atomic(path, &document)?;
    data.projects[project_index] = project.clone();
    save_projects_locked(&data)?;
    Ok(project)
}

fn remove_track_references_from_projects(data: &mut crate::state::StateData, track_id: &str) -> bool {
    let mut changed = false;
    for project in &mut data.projects {
        let project_changed = project.track_ids.iter().any(|id| id == track_id)
            || project
                .snapshots
                .as_ref()
                .is_some_and(|snapshots| snapshots.iter().any(|snapshot| {
                    snapshot.track_ids.iter().any(|id| id == track_id)
                        || snapshot.player.selected_track_id.as_deref() == Some(track_id)
                }))
            || project
                .player_state
                .as_ref()
                .is_some_and(|player| player.selected_track_id.as_deref() == Some(track_id));
        if !project_changed {
            continue;
        }
        project.track_ids.retain(|id| id != track_id);
        if let Some(snapshots) = project.snapshots.as_mut() {
            for snapshot in snapshots {
                snapshot.track_ids.retain(|id| id != track_id);
                if snapshot.player.selected_track_id.as_deref() == Some(track_id) {
                    snapshot.player.selected_track_id = None;
                }
            }
        }
        if project
            .player_state
            .as_ref()
            .is_some_and(|player| player.selected_track_id.as_deref() == Some(track_id))
        {
            if let Some(player) = project.player_state.as_mut() {
                player.selected_track_id = None;
            }
        }
        project.updated_at = now();
        changed = true;
    }
    changed
}

fn remove_missing_track_references(project: &mut Project, tracks: &[Track]) -> Vec<String> {
    let available = tracks
        .iter()
        .map(|track| track.id.as_str())
        .collect::<HashSet<_>>();
    let missing = project
        .track_ids
        .iter()
        .filter(|id| !available.contains(id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    project
        .track_ids
        .retain(|id| available.contains(id.as_str()));
    if let Some(snapshots) = project.snapshots.as_mut() {
        for snapshot in snapshots {
            snapshot
                .track_ids
                .retain(|id| available.contains(id.as_str()));
            if snapshot
                .player
                .selected_track_id
                .as_ref()
                .is_some_and(|id| !available.contains(id.as_str()))
            {
                snapshot.player.selected_track_id = None;
            }
        }
    }
    if project
        .player_state
        .as_ref()
        .and_then(|player| player.selected_track_id.as_ref())
        .is_some_and(|id| !available.contains(id.as_str()))
    {
        if let Some(player) = project.player_state.as_mut() {
            player.selected_track_id = None;
        }
    }
    missing
}

fn save_project_folders_locked(data: &crate::state::StateData) -> Result<(), String> {
    write_json(&data.data_dir.join("project-folders.json"), &data.project_folders)
}

fn track_files_missing(track: &Track) -> bool {
    !Path::new(&track.path).is_file()
        || track
            .stems
            .as_ref()
            .is_some_and(|stems| stems.values().any(|path| !Path::new(path).is_file()))
}

fn ensure_gfn_extension(path: PathBuf) -> PathBuf {
    if path.extension().and_then(|value| value.to_str()) == Some("gfn") {
        path
    } else {
        path.with_extension("gfn")
    }
}

#[tauri::command]
pub fn settings_get(
    state: State<'_, AppState>,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let mut settings = state.data.lock().map_err(lock_error)?.settings.clone();
    settings.remove("stemSplitApiKey");
    Ok(settings)
}

#[tauri::command(rename_all = "camelCase")]
pub fn settings_set(
    state: State<'_, AppState>,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    if key == "stemSplitApiKey" {
        if let Some(secret) = value.as_str().filter(|value| !value.trim().is_empty()) {
            let data_dir = state.data.lock().map_err(lock_error)?.data_dir.clone();
            save_stem_split_api_key(&data_dir, secret)?;
        } else {
            let data_dir = state.data.lock().map_err(lock_error)?.data_dir.clone();
            remove_stem_split_api_key(&data_dir)?;
        }
        let mut data = state.data.lock().map_err(lock_error)?;
        data.settings.remove("stemSplitApiKey");
        return save_settings_locked(&data);
    }
    let mut data = state.data.lock().map_err(lock_error)?;
    data.settings.insert(key, value);
    save_settings_locked(&data)
}

#[tauri::command]
pub fn resources_summary(state: State<'_, AppState>) -> Result<LocalResourcesSummary, String> {
    let data = state.data.lock().map_err(lock_error)?;
    Ok(LocalResourcesSummary {
        cache_path: data.cache_dir.to_string_lossy().to_string(),
        cache_bytes: directory_size(&data.cache_dir),
        model_path: data.models_dir.to_string_lossy().to_string(),
        model_bytes: directory_size(&data.models_dir),
    })
}

#[tauri::command]
pub async fn resources_clear_cache(
    state: State<'_, AppState>,
) -> Result<LocalResourcesSummary, String> {
    let _cache_gate = state.separation_cache_gate.try_write().map_err(|_| {
        "Não é possível limpar o cache enquanto há uma separação ativa ou outra limpeza em andamento. Aguarde a operação terminar.".to_string()
    })?;
    ensure_cache_clear_allowed(&state.active_separations)?;
    let (cache_dir, models_dir) = {
        let data = state.data.lock().map_err(lock_error)?;
        (data.cache_dir.clone(), data.models_dir.clone())
    };
    tokio::task::spawn_blocking(move || {
        clear_cache_directory(&cache_dir)?;
        Ok(LocalResourcesSummary {
            cache_path: cache_dir.to_string_lossy().to_string(),
            cache_bytes: 0,
            model_path: models_dir.to_string_lossy().to_string(),
            model_bytes: directory_size(&models_dir),
        })
    })
    .await
    .map_err(|error| format!("Falha ao limpar o cache: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub fn lyrics_get(state: State<'_, AppState>, track_id: String) -> Result<Vec<LyricsLine>, String> {
    let data = state.data.lock().map_err(lock_error)?;
    data.tracks
        .iter()
        .find(|track| track.id == track_id)
        .map(|track| track.lyrics.clone().unwrap_or_default())
        .ok_or_else(|| "Faixa não encontrada.".into())
}

#[tauri::command(rename_all = "camelCase")]
pub fn lyrics_update(
    state: State<'_, AppState>,
    track_id: String,
    lines: Vec<LyricsLine>,
) -> Result<Track, String> {
    let mut data = state.data.lock().map_err(lock_error)?;
    let track = data
        .tracks
        .iter_mut()
        .find(|track| track.id == track_id)
        .ok_or_else(|| "Faixa não encontrada.".to_string())?;
    track.lyrics = Some(
        lines
            .into_iter()
            .enumerate()
            .map(|(index, line)| LyricsLine {
                id: if line.id.is_empty() {
                    format!("line-{}", index + 1)
                } else {
                    line.id
                },
                text: line.text.trim().to_string(),
                start: line.start.clamp(0.0, 1.0),
                end: line.end.clamp(0.0, 1.0),
            })
            .filter(|line| !line.text.is_empty() && line.end > line.start)
            .collect(),
    );
    let result = track.clone();
    save_tracks_locked(&data)?;
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn analysis_analyze(state: State<'_, AppState>, track_id: String) -> Result<Track, String> {
    let (path, existing) = {
        let data = state.data.lock().map_err(lock_error)?;
        let track = data
            .tracks
            .iter()
            .find(|track| track.id == track_id)
            .ok_or_else(|| "Faixa não encontrada.".to_string())?;
        (track.path.clone(), track.analysis.clone())
    };
    if existing.is_some() {
        let data = state.data.lock().map_err(lock_error)?;
        return data
            .tracks
            .iter()
            .find(|track| track.id == track_id)
            .cloned()
            .ok_or_else(|| "Faixa não encontrada.".to_string());
    }
    let analysis = analyze_audio(Path::new(&path))?;
    let mut data = state.data.lock().map_err(lock_error)?;
    let track = data
        .tracks
        .iter_mut()
        .find(|track| track.id == track_id)
        .ok_or_else(|| "Faixa não encontrada.".to_string())?;
    track.analysis = Some(analysis);
    let result = track.clone();
    save_tracks_locked(&data)?;
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
pub fn analysis_update(
    state: State<'_, AppState>,
    track_id: String,
    changes: serde_json::Value,
) -> Result<Track, String> {
    let mut data = state.data.lock().map_err(lock_error)?;
    let track = data
        .tracks
        .iter_mut()
        .find(|track| track.id == track_id)
        .ok_or_else(|| "Faixa não encontrada.".to_string())?;
    let mut analysis = track.analysis.clone().unwrap_or_else(default_analysis);
    if let Some(value) = changes.get("bpm").and_then(|value| value.as_f64()) {
        analysis.bpm = value.clamp(30.0, 300.0);
    }
    if let Some(value) = changes.get("key").and_then(|value| value.as_str()) {
        if !value.trim().is_empty() {
            analysis.key = value.trim().to_string();
        }
    }
    if let Some(value) = changes.get("tuningHz").and_then(|value| value.as_f64()) {
        analysis.tuning_hz = value.clamp(430.0, 450.0);
    }
    track.analysis = Some(analysis);
    let result = track.clone();
    save_tracks_locked(&data)?;
    Ok(result)
}

#[tauri::command]
pub async fn separation_status(state: State<'_, AppState>) -> Result<SeparationStatus, String> {
    let (models_dir, configured_provider, runtime_available, selected_model_profile, profile) = {
        let data = state.data.lock().map_err(lock_error)?;
        let configured_provider = data
            .settings
            .get("executionProvider")
            .and_then(|value| value.as_str())
            .unwrap_or("auto")
            .to_string();
        let selected_model_profile = data
            .settings
            .get("modelProfile")
            .and_then(|value| value.as_str())
            .filter(|profile| matches!(*profile, "four-stem" | "six-stem"))
            .unwrap_or("four-stem")
            .to_string();
        let profile = data
            .settings
            .get("processingProfile")
            .and_then(|value| value.as_str())
            .filter(|profile| matches!(*profile, "quality" | "balanced" | "speed"))
            .unwrap_or("quality")
            .to_string();
        (
            data.models_dir.clone(),
            configured_provider,
            cuda_runtime_available(&data.data_dir),
            selected_model_profile,
            profile,
        )
    };
    let (standard, six) =
        tokio::task::spawn_blocking(move || model_installation_status(&models_dir))
            .await
            .map_err(|error| format!("Falha ao validar os modelos ONNX: {error}"))?;
    let metrics = state.separation_metrics.lock().map_err(lock_error)?;
    let provider = if configured_provider == "cpu" {
        "cpu"
    } else if let Some(last_provider) = metrics.last_provider.as_deref() {
        if last_provider == "cuda" && !runtime_available {
            "cpu"
        } else {
            last_provider
        }
    } else if runtime_available {
        // Only a real worker run can confirm that the driver and CUDA EP are
        // usable. The runtime files alone are not enough to claim GPU usage.
        "cpu"
    } else {
        "cpu"
    };
    let effective_model_profile = if selected_model_profile == "six-stem" && six {
        "six-stem"
    } else {
        "four-stem"
    };
    let available = if effective_model_profile == "six-stem" {
        six
    } else {
        standard
    };
    Ok(SeparationStatus {
        available,
        message: if available {
            "Modelo ONNX nativo pronto.".into()
        } else if six && !standard {
            "O modelo estendido está instalado, mas o modelo padrão de quatro stems ainda é necessário.".into()
        } else {
            "Modelo ONNX não encontrado. Baixe-o em Preferências.".into()
        },
        provider: Some(provider.into()),
        profile: Some(profile),
        memory_bytes: Some(current_rss()),
        last_duration_ms: metrics.last_duration_ms,
        model_profile: Some(effective_model_profile.into()),
        six_stem_available: Some(six),
    })
}

fn cuda_runtime_available(data_dir: &Path) -> bool {
    // The actual provider is loaded by the external worker with a runtime
    // specific library path. Checking EP registration in this process can
    // report a false positive because it does not see userData/runtimes/cuda.
    cuda_runtime_installed(data_dir)
}

#[derive(Debug)]
enum WorkerOutput {
    Progress(serde_json::Value),
    Done(Stems),
}

fn parse_worker_output(line: &str) -> Result<WorkerOutput, String> {
    let message: serde_json::Value = serde_json::from_str(line)
        .map_err(|error| format!("Resposta inválida do worker ONNX: {error}"))?;
    match message.get("type").and_then(|value| value.as_str()) {
        Some("progress") => message
            .get("progress")
            .filter(|value| value.is_object())
            .cloned()
            .map(WorkerOutput::Progress)
            .ok_or_else(|| "O worker ONNX enviou progresso inválido.".to_string()),
        Some("done") => {
            let raw_stems = message
                .get("stems")
                .cloned()
                .ok_or_else(|| "O worker não retornou stems.".to_string())?;
            let stems: Stems = serde_json::from_value(raw_stems)
                .map_err(|error| format!("O worker retornou stems inválidos: {error}"))?;
            if stems.is_empty() {
                return Err("O worker não retornou stems.".into());
            }
            Ok(WorkerOutput::Done(stems))
        }
        Some("error") => Err(message
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("A separação ONNX falhou.")
            .to_string()),
        Some(kind) => Err(format!(
            "O worker ONNX retornou uma mensagem desconhecida: {kind}."
        )),
        None => Err("O worker ONNX retornou uma mensagem sem tipo.".into()),
    }
}

async fn read_worker_output<R, F>(
    lines: &mut tokio::io::Lines<R>,
    mut on_progress: F,
) -> Result<(Stems, Option<String>), String>
where
    R: tokio::io::AsyncBufRead + Unpin,
    F: FnMut(&serde_json::Value),
{
    let mut active_provider = None;
    loop {
        let line = lines
            .next_line()
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "O worker ONNX terminou sem resultado.".to_string())?;
        match parse_worker_output(&line)? {
            WorkerOutput::Progress(progress) => {
                if let Some(provider) = progress.get("provider").and_then(|value| value.as_str()) {
                    active_provider = Some(provider.to_string());
                }
                on_progress(&progress);
            }
            WorkerOutput::Done(stems) => return Ok((stems, active_provider)),
        }
    }
}

async fn terminate_worker(
    workers: &tokio::sync::Mutex<
        std::collections::HashMap<String, Arc<Mutex<tokio::process::Child>>>,
    >,
    track_id: &str,
    child: &Arc<Mutex<tokio::process::Child>>,
) {
    let _ = child.lock().await.kill().await;
    workers.lock().await.remove(track_id);
}

#[tauri::command(rename_all = "camelCase")]
pub async fn separation_start(
    app: AppHandle,
    state: State<'_, AppState>,
    track: Track,
    target: Option<String>,
    provider: Option<String>,
) -> Result<Track, String> {
    if target
        .as_deref()
        .is_some_and(|value| !ALL_STEMS.contains(&value))
    {
        return Err("Stem de destino inválido.".into());
    }
    let track = {
        let data = state.data.lock().map_err(lock_error)?;
        data.tracks
            .iter()
            .find(|item| item.id == track.id)
            .cloned()
            .ok_or_else(|| "Faixa não encontrada na biblioteca.".to_string())?
    };
    let _separation_cache_guard = state.separation_cache_gate.read().await;
    let _separation_guard = acquire_separation(&state.active_separations, track.id.clone())?;
    state
        .remote_cancelled
        .lock()
        .map_err(lock_error)?
        .remove(&track.id);
    let _cancelled_guard = CancellationFlagGuard {
        cancelled: Arc::clone(&state.remote_cancelled),
        id: track.id.clone(),
    };
    if provider.as_deref() == Some("remote") {
        let stems = tokio::time::timeout(
            REMOTE_SEPARATION_TIMEOUT,
            separate_remote(&app, &state, &track, target.as_deref()),
        )
        .await
        .map_err(|_| "A separação remota excedeu o tempo limite.".to_string())??;
        let mut data = state.data.lock().map_err(lock_error)?;
        let stored = data
            .tracks
            .iter_mut()
            .find(|item| item.id == track.id)
            .ok_or_else(|| "Faixa não encontrada na biblioteca.".to_string())?;
        let mut merged_stems = stored.stems.clone().unwrap_or_default();
        merged_stems.extend(stems);
        stored.stems = Some(merged_stems);
        let result = stored.clone();
        save_tracks_locked(&data)?;
        return Ok(result);
    }
    let (
        models_dir,
        cache_dir,
        execution_provider,
        processing_threads,
        processing_profile,
        model_profile,
        cuda_runtime_available,
    ) = {
        let data = state.data.lock().map_err(lock_error)?;
        let execution_provider = data
            .settings
            .get("executionProvider")
            .and_then(|value| value.as_str())
            .filter(|value| matches!(*value, "auto" | "cpu" | "cuda"))
            .unwrap_or("auto")
            .to_string();
        let processing_threads = data
            .settings
            .get("processingThreads")
            .and_then(|value| value.as_u64())
            .map(|threads| threads.clamp(0, 8) as usize)
            .unwrap_or(0);
        let processing_profile = data
            .settings
            .get("processingProfile")
            .and_then(|value| value.as_str())
            .filter(|profile| matches!(*profile, "quality" | "balanced" | "speed"))
            .unwrap_or("quality")
            .to_string();
        let model_profile = data
            .settings
            .get("modelProfile")
            .and_then(|value| value.as_str())
            .filter(|value| matches!(*value, "four-stem" | "six-stem"))
            .unwrap_or("four-stem")
            .to_string();
        let cuda_runtime_available = cuda_runtime_installed(&data.data_dir);
        (
            data.models_dir.clone(),
            data.cache_dir.clone(),
            execution_provider,
            processing_threads,
            processing_profile,
            model_profile,
            cuda_runtime_available,
        )
    };
    if !state.workers.lock().await.is_empty() {
        return Err("Outra separação já está em andamento. Aguarde ela terminar para preservar a memória RAM.".into());
    }
    let track_id = track.id.clone();
    let started_at = Instant::now();
    let request = serde_json::json!({ "type": "separate", "track": track.clone(), "target": target, "modelsDir": models_dir, "cacheDir": cache_dir, "executionProvider": execution_provider, "processingThreads": processing_threads, "processingProfile": processing_profile, "modelProfile": model_profile, "cudaRuntimeAvailable": cuda_runtime_available });
    let worker = worker_path(&app);
    let cuda_library_directory = state
        .data
        .lock()
        .map_err(lock_error)
        .ok()
        .and_then(|data| cuda_runtime_library_dir(&data.data_dir));
    let mut worker_command = Command::new(&worker);
    // The CUDA provider is shipped beside the external worker. ONNX Runtime
    // loads it by filename, so make that directory visible to the dynamic
    // loader in bundled installations as well as in local development.
    configure_worker_library_paths(
        &mut worker_command,
        &worker,
        cuda_library_directory.as_deref(),
    );
    let mut child = worker_command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Não foi possível iniciar o processo ONNX nativo: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(error) = stdin.write_all(format!("{}\n", request).as_bytes()).await {
            let _ = child.kill().await;
            return Err(error.to_string());
        }
        if let Err(error) = stdin.shutdown().await {
            let _ = child.kill().await;
            return Err(error.to_string());
        }
    }
    let child = Arc::new(Mutex::new(child));
    let mut workers = state.workers.lock().await;
    if !workers.is_empty() {
        drop(workers);
        terminate_worker(&state.workers, &track_id, &child).await;
        return Err("Outra separação começou enquanto o worker era iniciado.".into());
    }
    workers.insert(track_id.clone(), child.clone());
    drop(workers);
    let stdout = match child.lock().await.stdout.take() {
        Some(stdout) => stdout,
        None => {
            terminate_worker(&state.workers, &track_id, &child).await;
            return Err("O worker ONNX não abriu a saída.".into());
        }
    };
    let mut lines = BufReader::new(stdout.take(MAX_EXTERNAL_OUTPUT_BYTES as u64 + 1)).lines();
    if state
        .remote_cancelled
        .lock()
        .map_err(lock_error)?
        .contains(&track_id)
    {
        terminate_worker(&state.workers, &track_id, &child).await;
        return Err("Separação cancelada.".into());
    }
    let read_output = read_worker_output(&mut lines, |progress| {
        let _ = app.emit("separation:progress", progress);
    });
    tokio::pin!(read_output);
    let worker_result = tokio::select! {
        result = &mut read_output => result,
        _ = wait_for_separation_cancel(Arc::clone(&state.remote_cancelled), track_id.clone()) => {
            Err("Separação cancelada.".into())
        }
        _ = tokio::time::sleep(LOCAL_SEPARATION_TIMEOUT) => {
            Err("A separação ONNX excedeu o tempo limite.".into())
        }
    };
    terminate_worker(&state.workers, &track_id, &child).await;
    let (stems, active_provider) = worker_result?;
    state
        .separation_metrics
        .lock()
        .map_err(lock_error)?
        .last_duration_ms = Some(started_at.elapsed().as_millis().min(u64::MAX as u128) as u64);
    state
        .separation_metrics
        .lock()
        .map_err(lock_error)?
        .last_provider = active_provider;
    let mut data = state.data.lock().map_err(lock_error)?;
    let stored = data
        .tracks
        .iter_mut()
        .find(|item| item.id == track.id)
        .ok_or_else(|| "Faixa não encontrada na biblioteca.".to_string())?;
    let mut merged_stems = stored.stems.clone().unwrap_or_default();
    merged_stems.extend(stems);
    stored.stems = Some(merged_stems);
    let result = stored.clone();
    save_tracks_locked(&data)?;
    Ok(result)
}

async fn separate_remote(
    app: &AppHandle,
    state: &State<'_, AppState>,
    track: &Track,
    target: Option<&str>,
) -> Result<Stems, String> {
    let (key, cache_dir, output_type, quality) = {
        let data = state.data.lock().map_err(lock_error)?;
        let key = load_stem_split_api_key(&data.data_dir, &data.settings).ok_or_else(|| {
            "Configure uma chave de API do StemSplit em Preferências antes de separar na nuvem."
                .to_string()
        })?;
        let profile = data
            .settings
            .get("processingProfile")
            .and_then(|value| value.as_str())
            .unwrap_or("quality");
        let model_profile = data
            .settings
            .get("modelProfile")
            .and_then(|value| value.as_str())
            .unwrap_or("four-stem");
        let output_type =
            if matches!(target, Some("guitar" | "piano")) || model_profile == "six-stem" {
                "SIX_STEMS"
            } else {
                "FOUR_STEMS"
            };
        let quality = match profile {
            "speed" => "FAST",
            "balanced" => "BALANCED",
            _ => "BEST",
        };
        (key, data.cache_dir.join("remote"), output_type, quality)
    };
    if remote_cancel_requested(state, &track.id)? {
        return Err("Separação remota cancelada antes do envio.".into());
    }
    let size = fs::metadata(&track.path).map_err(|e| e.to_string())?.len();
    if size > 100 * 1024 * 1024 {
        return Err("O arquivo excede o limite de 100 MB do StemSplit.".into());
    }
    let duration = match track
        .duration
        .filter(|value| value.is_finite() && *value >= 0.0)
    {
        Some(value) => Some(value),
        None => audio_duration_seconds(Path::new(&track.path))?,
    };
    if duration.is_none() {
        return Err(
            "Não foi possível confirmar a duração da faixa para processamento remoto.".into(),
        );
    }
    if duration.is_some_and(|value| value > MAX_REMOTE_DURATION_SECONDS) {
        return Err("A faixa excede o limite de 60 minutos do StemSplit.".into());
    }
    let file_name = Path::new(&track.path)
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "O nome do arquivo de áudio não é válido para upload remoto.".to_string())?;
    let content_type = audio_content_type(Path::new(file_name)).ok_or_else(|| {
        "O formato da faixa não é compatível com o processamento remoto.".to_string()
    })?;
    let upload = remote_post_json_async(
        "https://stemsplit.io/api/v1/upload",
        &key,
        serde_json::json!({ "filename": file_name, "contentType": content_type }),
    )
    .await?;
    if remote_cancel_requested(state, &track.id)? {
        return Err("Separação remota cancelada antes do upload.".into());
    }
    let upload_url = upload
        .get("uploadUrl")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "O StemSplit não retornou uma URL de upload.".to_string())?;
    let upload_key = upload
        .get("uploadKey")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "O StemSplit não retornou a chave de upload.".to_string())?;
    remote_upload_audio(upload_url, content_type, Path::new(&track.path)).await?;
    if remote_cancel_requested(state, &track.id)? {
        return Err("Upload cancelado antes de criar o job remoto.".into());
    }
    let job = remote_post_json_async(
        "https://stemsplit.io/api/v1/jobs",
        &key,
        serde_json::json!({ "uploadKey": upload_key, "fileName": file_name, "outputType": output_type, "quality": quality, "outputFormat": "WAV" }),
    )
    .await?;
    let job_id = job
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "O StemSplit não retornou o identificador do job.".to_string())?;
    if remote_cancel_requested(state, &track.id)? {
        return Err(
            "Separação remota cancelada após criar o job; o StemSplit pode cobrar o processamento já iniciado."
                .into(),
        );
    }
    let stem_names: Vec<&str> = match target {
        Some(stem) => vec![stem],
        None if output_type == "SIX_STEMS" => {
            vec!["vocals", "drums", "bass", "other", "guitar", "piano"]
        }
        None => vec!["vocals", "drums", "bass", "other"],
    };
    let output_dir = cache_dir.join(format!(
        "{}-{}",
        cache_component(&track.id),
        target.unwrap_or("all")
    ));
    let staging_dir = cache_dir.join(format!(
        ".{}-partial-{}",
        cache_component(&track.id),
        Uuid::new_v4()
    ));
    fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;
    let staging_guard = TemporaryDirectoryGuard(Some(staging_dir.clone()));
    let poll_started = Instant::now();
    loop {
        if poll_started.elapsed() > Duration::from_secs(10 * 60) {
            return Err("O StemSplit demorou mais de 10 minutos para concluir.".into());
        }
        if remote_cancel_requested(state, &track.id)? {
            return Err("Separação cancelada.".into());
        }
        let status =
            remote_get_json_async(&format!("https://stemsplit.io/api/v1/jobs/{job_id}"), &key)
                .await?;
        let raw_status = status
            .get("status")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if !matches!(
            raw_status,
            "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "EXPIRED"
        ) {
            return Err(format!(
                "O StemSplit retornou um status desconhecido: {raw_status}."
            ));
        }
        let raw_progress = status
            .get("progress")
            .and_then(|value| value.as_f64())
            .unwrap_or(0.0);
        let _ = app.emit(
            "separation:progress",
            serde_json::json!({ "trackId": track.id, "progress": (0.05 + raw_progress / 100.0 * 0.9).min(0.95), "stage": if raw_status == "PROCESSING" { "Separando na nuvem" } else { "Aguardando na fila do StemSplit" } }),
        );
        if raw_status == "FAILED" {
            return Err(status
                .get("errorMessage")
                .and_then(|value| value.as_str())
                .unwrap_or("O StemSplit falhou ao separar a faixa.")
                .to_string());
        }
        if raw_status == "EXPIRED" {
            return Err("O job do StemSplit expirou antes de concluir.".into());
        }
        if raw_status == "COMPLETED" {
            let outputs = status
                .get("outputs")
                .and_then(|value| value.as_object())
                .ok_or_else(|| "O StemSplit não retornou os arquivos separados.".to_string())?;
            let mut stems = Stems::new();
            for stem in stem_names {
                let url = outputs
                    .get(stem)
                    .and_then(|value| value.get("url"))
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| format!("O StemSplit não retornou o stem {stem}."))?;
                let path = staging_dir.join(format!("{stem}.wav"));
                remote_download_stem(
                    url,
                    &path,
                    Arc::clone(&state.remote_cancelled),
                    track.id.clone(),
                )
                .await?;
                stems.insert(
                    stem.to_string(),
                    output_dir
                        .join(format!("{stem}.wav"))
                        .to_string_lossy()
                        .to_string(),
                );
            }
            remove_dir_if_exists(&output_dir)?;
            fs::rename(&staging_dir, &output_dir).map_err(|error| error.to_string())?;
            staging_guard.keep();
            let _ = app.emit(
                "separation:progress",
                serde_json::json!({ "trackId": track.id, "progress": 1.0, "stage": "Stems prontos" }),
            );
            return Ok(stems);
        }
        tokio::time::sleep(Duration::from_millis(2500)).await;
    }
}

fn remote_cancel_requested(state: &State<'_, AppState>, track_id: &str) -> Result<bool, String> {
    Ok(state
        .remote_cancelled
        .lock()
        .map_err(lock_error)?
        .contains(track_id))
}

async fn remote_post_json_async(
    url: &str,
    key: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let url = url.to_string();
    let key = key.to_string();
    tokio::task::spawn_blocking(move || remote_post_json_blocking(&url, &key, body))
        .await
        .map_err(|error| format!("Falha na requisição do StemSplit: {error}"))?
}

fn remote_post_json_blocking(
    url: &str,
    key: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (url, agent) = public_http_agent(url)?;
    let response = agent
        .post(&url)
        .header("Authorization", format!("Bearer {key}"))
        .send_json(body)
        .map_err(|error| format!("Falha na API do StemSplit: {error}"))?;
    let text = read_to_string_limited(
        response.into_body().into_reader(),
        MAX_EXTERNAL_RESPONSE_BYTES,
    )?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

async fn remote_get_json_async(url: &str, key: &str) -> Result<serde_json::Value, String> {
    let url = url.to_string();
    let key = key.to_string();
    tokio::task::spawn_blocking(move || remote_get_json_blocking(&url, &key))
        .await
        .map_err(|error| format!("Falha na requisição do StemSplit: {error}"))?
}

fn remote_get_json_blocking(url: &str, key: &str) -> Result<serde_json::Value, String> {
    let (url, agent) = public_http_agent(url)?;
    let response = agent
        .get(&url)
        .header("Authorization", format!("Bearer {key}"))
        .call()
        .map_err(|error| format!("Falha na API do StemSplit: {error}"))?;
    let text = read_to_string_limited(
        response.into_body().into_reader(),
        MAX_EXTERNAL_RESPONSE_BYTES,
    )?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

async fn remote_upload_audio(
    upload_url: &str,
    content_type: &str,
    path: &Path,
) -> Result<(), String> {
    let upload_url = upload_url.to_string();
    let content_type = content_type.to_string();
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let audio = fs::File::open(path).map_err(|error| error.to_string())?;
        let (upload_url, agent) = public_http_agent(&upload_url)?;
        agent
            .put(&upload_url)
            .header("Content-Type", content_type)
            .send(audio)
            .map_err(|error| format!("Falha ao enviar áudio para o StemSplit: {error}"))?;
        Ok(())
    })
    .await
    .map_err(|error| format!("Falha no upload para o StemSplit: {error}"))?
}

async fn remote_download_stem(
    url: &str,
    path: &Path,
    cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
    track_id: String,
) -> Result<(), String> {
    let url = url.to_string();
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let (url, agent) = public_http_agent(&url)?;
        let response = agent
            .get(&url)
            .call()
            .map_err(|error| format!("Falha ao baixar stem remoto: {error}"))?;
        let mut reader = response.into_body().into_reader();
        let temporary = path.with_extension("download");
        remove_file_if_exists(&temporary)?;
        let temporary_guard = TemporaryFileGuard(Some(temporary.clone()));
        let mut file = fs::File::create(&temporary).map_err(|error| error.to_string())?;
        let size = copy_with_limit_cancelled(&mut reader, &mut file, 200 * 1024 * 1024, || {
            if cancelled.lock().map_err(lock_error)?.contains(&track_id) {
                return Err("Separação cancelada.".into());
            }
            Ok(())
        })?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        if cancelled.lock().map_err(lock_error)?.contains(&track_id) {
            return Err("Separação cancelada.".into());
        }
        remove_file_if_exists(&path)?;
        fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
        temporary_guard.keep();
        Ok(size)
    })
    .await
    .map_err(|error| format!("Falha no download do stem remoto: {error}"))?
    .map(|_| ())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn separation_cancel(state: State<'_, AppState>, track_id: String) -> Result<(), String> {
    state
        .remote_cancelled
        .lock()
        .map_err(lock_error)?
        .insert(track_id.clone());
    if let Some(child) = state.workers.lock().await.remove(&track_id) {
        let _ = child.lock().await.kill().await;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn export_audio(
    app: AppHandle,
    state: State<'_, AppState>,
    track_id: String,
    options: AudioExportOptions,
) -> Result<AudioExportResult, String> {
    let track = state
        .data
        .lock()
        .map_err(lock_error)?
        .tracks
        .iter()
        .find(|track| track.id == track_id)
        .cloned()
        .ok_or_else(|| "Faixa não encontrada na biblioteca.".to_string())?;
    let request_id = options
        .request_id
        .clone()
        .unwrap_or_else(|| track_id.clone());
    state
        .export_cancelled
        .lock()
        .map_err(lock_error)?
        .remove(&request_id);
    let stems = track
        .stems
        .as_ref()
        .ok_or_else(|| "Separe os stems antes de exportar uma mixagem.".to_string())?;
    if options.format != "wav" {
        return Err("Use WAV PCM.".into());
    }
    let selected: Vec<_> = ALL_STEMS
        .iter()
        .filter(|stem| {
            options.stems.iter().any(|item| item == **stem)
                && stems.contains_key(**stem)
                && options.solo.as_deref().is_none_or(|solo| solo == **stem)
                && !options.muted.get(**stem).copied().unwrap_or(false)
        })
        .map(|stem| (*stem, stems.get(*stem).unwrap().clone()))
        .collect();
    if selected.is_empty() {
        return Err("Selecione ao menos um stem audível para exportar.".into());
    }
    let destination = if options.mode.as_deref() == Some("individual") {
        rfd::FileDialog::new()
            .pick_folder()
            .ok_or_else(|| "Exportação cancelada.".to_string())?
    } else {
        rfd::FileDialog::new()
            .set_file_name(format!(
                "{} - Griffin Mix.wav",
                track.name.trim_end_matches(".wav")
            ))
            .save_file()
            .ok_or_else(|| "Exportação cancelada.".to_string())?
    };
    let cancelled = Arc::clone(&state.export_cancelled);
    tokio::task::spawn_blocking(move || {
        export_audio_blocking(
            app,
            cancelled,
            request_id,
            track,
            selected,
            options,
            destination,
        )
    })
    .await
    .map_err(|error| format!("Falha no exportador de áudio: {error}"))?
}

fn export_audio_blocking(
    app: AppHandle,
    cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
    request_id: String,
    track: Track,
    selected: Vec<(&'static str, String)>,
    options: AudioExportOptions,
    destination: PathBuf,
) -> Result<AudioExportResult, String> {
    if options.mode.as_deref() == Some("individual") {
        let mut paths = Vec::new();
        let selected_count = selected.len();
        for (index, (stem, path)) in selected.into_iter().enumerate() {
            export_progress(
                &app,
                &request_id,
                index as f64 / selected_count.max(1) as f64,
                &format!("Mixando {stem}"),
            );
            let target = unique_export_path(
                &destination,
                &format!("{} - {}.wav", track.name.trim_end_matches(".wav"), stem),
            );
            let stem_options = AudioExportOptions {
                stems: vec![stem.to_string()],
                solo: None,
                mode: Some("mix".into()),
                ..options.clone()
            };
            let temporary = target.with_extension("exporting");
            remove_file_if_exists(&temporary)?;
            let temporary_guard = TemporaryFileGuard(Some(temporary.clone()));
            let mut check_cancelled = || export_is_cancelled(&cancelled, &request_id);
            mix_wav(
                &[(stem, path)],
                &stem_options,
                &temporary,
                &mut check_cancelled,
            )?;
            fs::rename(&temporary, &target).map_err(|error| error.to_string())?;
            temporary_guard.keep();
            paths.push(target.to_string_lossy().to_string());
        }
        export_progress(&app, &request_id, 1.0, "Arquivos individuais concluídos");
        clear_export_cancelled(&cancelled, &request_id);
        let first = paths.first().cloned().unwrap_or_default();
        return Ok(AudioExportResult {
            path: first,
            paths,
            duration: track.duration.unwrap_or(0.0),
            format: "wav".into(),
            sample_rate: options.sample_rate,
            bit_depth: options.bit_depth,
        });
    }
    let path = destination;
    export_progress(&app, &request_id, 0.1, "Mixando stems");
    let mut check_cancelled = || export_is_cancelled(&cancelled, &request_id);
    let duration = mix_wav(&selected, &options, &path, &mut check_cancelled)?;
    export_progress(&app, &request_id, 1.0, "WAV exportado");
    clear_export_cancelled(&cancelled, &request_id);
    let path_string = path.to_string_lossy().to_string();
    Ok(AudioExportResult {
        path: path_string.clone(),
        paths: vec![path_string],
        duration,
        format: "wav".into(),
        sample_rate: options.sample_rate,
        bit_depth: options.bit_depth,
    })
}

fn unique_export_path(directory: &Path, file_name: &str) -> PathBuf {
    let initial = directory.join(file_name);
    if !initial.exists() {
        return initial;
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("export");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("wav");
    (2..1000)
        .map(|index| directory.join(format!("{stem} ({index}).{extension}")))
        .find(|candidate| !candidate.exists())
        .unwrap_or(initial)
}

#[tauri::command(rename_all = "camelCase")]
pub fn export_cancel(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    state
        .export_cancelled
        .lock()
        .map_err(lock_error)?
        .insert(request_id);
    Ok(())
}

#[tauri::command]
pub async fn models_status(state: State<'_, AppState>) -> Result<ModelDownloadStatus, String> {
    let models_dir = state.data.lock().map_err(lock_error)?.models_dir.clone();
    let (standard_installed, extended_installed) =
        tokio::task::spawn_blocking(move || model_installation_status(&models_dir))
            .await
            .map_err(|error| format!("Falha ao validar os modelos ONNX: {error}"))?;
    let downloading = state.model_downloading.lock().map_err(lock_error)?.clone();
    Ok(ModelDownloadStatus {
        standard_installed,
        extended_installed,
        downloading,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn models_download(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: String,
) -> Result<(), String> {
    if !matches!(kind.as_str(), "standard" | "extended") {
        return Err("Tipo de modelo inválido.".into());
    }
    {
        let mut downloading = state.model_downloading.lock().map_err(lock_error)?;
        if downloading.is_some() {
            return Err("Outro download de modelo já está em andamento.".into());
        }
        *downloading = Some(kind.clone());
    }
    let cancelled = Arc::clone(&state.model_cancelled);
    let downloading = Arc::clone(&state.model_downloading);
    let _downloading_guard = DownloadingFlagGuard(Arc::clone(&downloading));
    cancelled.lock().map_err(lock_error)?.remove(&kind);
    let _cancelled_guard = CancellationFlagGuard {
        cancelled: Arc::clone(&cancelled),
        id: kind.clone(),
    };
    let models_dir = state.data.lock().map_err(lock_error)?.models_dir.clone();
    tokio::task::spawn_blocking(move || models_download_blocking(app, kind, models_dir, cancelled))
        .await
        .map_err(|error| format!("Falha no instalador dos modelos ONNX: {error}"))?
}

fn models_download_blocking(
    app: AppHandle,
    kind: String,
    models_dir: PathBuf,
    cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
) -> Result<(), String> {
    let cleanup_dir = models_dir.clone();
    models_download_blocking_inner(app, kind, models_dir, cancelled)
        .map_err(|error| cleanup_models_after_download_failure(&cleanup_dir, error))
}

fn models_download_blocking_inner(
    app: AppHandle,
    kind: String,
    models_dir: PathBuf,
    cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
) -> Result<(), String> {
    fs::create_dir_all(models_dir.join("htdemucs-ft")).map_err(|e| e.to_string())?;
    let base = "https://huggingface.co/StemSplitio";
    let mut files: Vec<(PathBuf, String, &'static str)> = vec![(
        models_dir.join("htdemucs.onnx"),
        format!("{base}/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx"),
        model_sha256("htdemucs.onnx").unwrap(),
    )];
    for stem in CORE_STEMS {
        let file_name = format!("htdemucs_ft_{stem}_fp16weights.onnx");
        files.push((
            models_dir.join("htdemucs-ft").join(&file_name),
            format!(
                "{base}/htdemucs-ft-{stem}-onnx/resolve/main/htdemucs_ft_{stem}_fp16weights.onnx"
            ),
            model_sha256(&file_name).unwrap(),
        ));
    }
    if kind == "extended" {
        files = vec![(
            models_dir.join("htdemucs_6s.onnx"),
            format!("{base}/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx"),
            model_sha256("htdemucs_6s.onnx").unwrap(),
        )];
    }
    let total = files.len();
    for (index, (path, url, expected_hash)) in files.into_iter().enumerate() {
        if cancelled.lock().map_err(lock_error)?.contains(&kind) {
            return Err("Download cancelado.".into());
        }
        if path.is_file() {
            if sha256_file(&path).ok().as_deref() == Some(expected_hash) {
                continue;
            }
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        let _ = app.emit(
            "models:progress",
            serde_json::json!({ "kind": kind, "progress": index as f64 / total.max(1) as f64, "stage": format!("Baixando {} ({}/{})", path.file_name().and_then(|value| value.to_str()).unwrap_or("modelo"), index + 1, total) }),
        );
        let response = public_http_get_following_redirects(&url)
            .map_err(|e| format!("Falha ao baixar modelo: {e}"))?;
        let expected = response
            .headers()
            .get("content-length")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok());
        if expected.is_some_and(|size| size > MAX_MODEL_DOWNLOAD_BYTES) {
            return Err("O modelo excede o limite de segurança do Griffin.".into());
        }
        let mut reader = response.into_body().into_reader();
        let temporary = path.with_extension("download");
        remove_file_if_exists(&temporary)?;
        let temporary_guard = TemporaryFileGuard(Some(temporary.clone()));
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        let copy_result = copy_with_progress(&mut reader, &mut file, expected, |received| {
            if received > MAX_MODEL_DOWNLOAD_BYTES {
                return Err("O modelo excede o limite de segurança do Griffin.".into());
            }
            if cancelled.lock().map_err(lock_error)?.contains(&kind) {
                return Err("Download cancelado.".into());
            }
            let fraction = expected
                .map(|total_bytes| (received as f64 / total_bytes.max(1) as f64).min(1.0))
                .unwrap_or(0.0);
            let _ = app.emit(
                "models:progress",
                serde_json::json!({ "kind": kind, "progress": (index as f64 + fraction) / total.max(1) as f64, "stage": format!("Baixando {} · {}%", path.file_name().and_then(|value| value.to_str()).unwrap_or("modelo"), (fraction * 100.0) as u32) }),
            );
            Ok(())
        });
        copy_result?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        if sha256_file(&temporary).map_err(|e| e.to_string())? != expected_hash {
            return Err(format!(
                "A verificação de integridade do modelo {} falhou.",
                path.display()
            ));
        }
        if cancelled.lock().map_err(lock_error)?.contains(&kind) {
            return Err("Download cancelado.".into());
        }
        fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
        temporary_guard.keep();
    }
    let _ = app.emit(
        "models:progress",
        serde_json::json!({ "kind": kind, "progress": 1.0, "stage": "Modelo instalado" }),
    );
    Ok(())
}

fn cleanup_models_after_download_failure(models_dir: &Path, error: String) -> String {
    match remove_dir_if_exists(models_dir) {
        Ok(()) => error,
        Err(cleanup_error) => {
            format!("{error}. A limpeza dos modelos também falhou: {cleanup_error}")
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn models_cancel(state: State<'_, AppState>, kind: String) -> Result<(), String> {
    state
        .model_cancelled
        .lock()
        .map_err(lock_error)?
        .insert(kind);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn performance_save(name: String, bytes: Vec<u8>) -> Result<serde_json::Value, String> {
    if bytes.is_empty() {
        return Err("A gravação não contém áudio.".into());
    }
    let normalized = sanitize_file_name(&name, "take");
    let path = rfd::FileDialog::new()
        .add_filter("Gravação WebM", &["webm"])
        .set_file_name(format!("{normalized}.webm"))
        .save_file()
        .ok_or_else(|| "Salvamento cancelado.".to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": path, "name": normalized }))
}
#[tauri::command(rename_all = "camelCase")]
pub fn chords_export(
    state: State<'_, AppState>,
    track_id: String,
    format: String,
) -> Result<serde_json::Value, String> {
    if format != "midi" && format != "pdf" {
        return Err("Formato de acordes inválido.".into());
    }
    let data = state.data.lock().map_err(lock_error)?;
    let track = data
        .tracks
        .iter()
        .find(|track| track.id == track_id)
        .ok_or_else(|| "Faixa não encontrada na biblioteca.".to_string())?;
    let analysis = track
        .analysis
        .as_ref()
        .ok_or_else(|| "Analise a faixa e confirme os acordes antes de exportar.".to_string())?;
    let chords = analysis
        .chords
        .as_ref()
        .filter(|chords| !chords.is_empty())
        .ok_or_else(|| "Analise a faixa e confirme os acordes antes de exportar.".to_string())?;
    let base = track
        .name
        .rsplit_once('.')
        .map(|(name, _)| name)
        .unwrap_or(&track.name);
    let base = sanitize_file_name(base, "griffin-chords");
    let (extension, bytes) = if format == "midi" {
        (
            "mid",
            render_midi(chords, analysis.bpm, track.duration.unwrap_or(60.0)),
        )
    } else {
        (
            "pdf",
            render_chord_pdf(chords, track.duration.unwrap_or(60.0)),
        )
    };
    let path = rfd::FileDialog::new()
        .add_filter(format.to_uppercase(), &[extension])
        .set_file_name(format!("{base} - acordes.{extension}"))
        .save_file()
        .ok_or_else(|| "Exportação cancelada.".to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": path, "format": format }))
}

fn sanitize_file_name(value: &str, fallback: &str) -> String {
    let normalized: String = value
        .chars()
        .map(|character| {
            if matches!(
                character,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            ) {
                '-'
            } else {
                character
            }
        })
        .collect();
    let normalized = normalized.trim();
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized.to_string()
    }
}

fn is_path_within(path: &Path, root: &Path) -> bool {
    let Ok(root) = fs::canonicalize(root) else {
        return false;
    };
    path.starts_with(root)
}

fn cleanup_removed_track_files(
    removed: &Track,
    remaining: &[Track],
    imports_dir: &Path,
    cache_dir: &Path,
) -> Result<(), String> {
    let referenced = remaining
        .iter()
        .flat_map(track_file_paths)
        .filter_map(|path| fs::canonicalize(path).ok())
        .collect::<HashSet<_>>();
    let roots = [imports_dir, cache_dir];
    let mut first_error = None;
    for path in track_file_paths(removed) {
        let Ok(metadata) = fs::symlink_metadata(path) else {
            continue;
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        let Ok(canonical) = fs::canonicalize(path) else {
            continue;
        };
        if referenced.contains(&canonical)
            || !roots.iter().any(|root| is_path_within(&canonical, root))
        {
            continue;
        }
        if let Err(error) = fs::remove_file(path) {
            first_error.get_or_insert_with(|| {
                format!("não foi possível remover o áudio gerenciado {path}: {error}")
            });
        }
    }
    first_error.map_or(Ok(()), Err)
}

fn track_file_paths(track: &Track) -> impl Iterator<Item = &str> {
    std::iter::once(track.path.as_str()).chain(
        track
            .stems
            .as_ref()
            .into_iter()
            .flat_map(|stems| stems.values().map(String::as_str)),
    )
}

fn import_audio_into_managed_storage(data: &StateData, source: &Path) -> Result<PathBuf, String> {
    let source = fs::canonicalize(source)
        .map_err(|error| format!("Não foi possível acessar o áudio selecionado: {error}"))?;
    if !source.is_file() {
        return Err("O caminho selecionado não é um arquivo de áudio.".into());
    }
    let imports_dir = fs::canonicalize(&data.imports_dir).map_err(|error| error.to_string())?;
    if source.starts_with(&imports_dir) {
        return Ok(source);
    }

    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "O arquivo de áudio não possui uma extensão válida.".to_string())?;
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| sanitize_file_name(value, "audio"))
        .unwrap_or_else(|| "audio".into());
    let destination = data
        .imports_dir
        .join(format!("{stem}-{}.{}", Uuid::new_v4(), extension));
    let temporary = destination.with_extension(format!("{extension}.importing"));
    remove_file_if_exists(&temporary)?;
    let temporary_guard = TemporaryFileGuard(Some(temporary.clone()));
    let mut input = fs::File::open(&source).map_err(|error| error.to_string())?;
    let mut output = fs::File::create(&temporary).map_err(|error| error.to_string())?;
    copy_with_limit(&mut input, &mut output, 200 * 1024 * 1024)?;
    output.sync_all().map_err(|error| error.to_string())?;
    drop(output);
    fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;
    temporary_guard.keep();
    Ok(destination)
}

fn render_midi(chords: &[ChordEvent], bpm: f64, duration: f64) -> Vec<u8> {
    let ticks_per_beat = 480i64;
    let ticks_per_second = ticks_per_beat as f64 * bpm.max(1.0) / 60.0;
    let mut events: Vec<(i64, u8, Vec<u8>)> = vec![(
        0,
        0,
        [
            vec![0xff, 0x51, 0x03],
            number_bytes((60_000_000.0 / bpm.max(1.0)) as u64, 3),
        ]
        .concat(),
    )];
    for chord in chords {
        let start = (chord.start.max(0.0) * duration.max(0.0) * ticks_per_second).round() as i64;
        let end = ((chord.end.max(0.0) * duration.max(0.0) * ticks_per_second).round() as i64)
            .max(start + 1);
        for tone in chord_tones(&chord.name) {
            events.push((start, 1, vec![0x90, tone, 88]));
            events.push((end, 0, vec![0x80, tone, 0]));
        }
    }
    events.sort_by_key(|(tick, order, _)| (*tick, *order));
    let mut track = Vec::new();
    let mut previous = 0i64;
    for (tick, _, bytes) in events {
        track.extend(variable_length((tick - previous).max(0) as u64));
        track.extend(bytes);
        previous = tick;
    }
    track.extend([0, 0xff, 0x2f, 0]);
    [
        b"MThd".to_vec(),
        number_bytes(6, 4),
        vec![0, 0, 0, 1],
        number_bytes(ticks_per_beat as u64, 2),
        b"MTrk".to_vec(),
        number_bytes(track.len() as u64, 4),
        track,
    ]
    .concat()
}

fn render_chord_pdf(chords: &[ChordEvent], duration: f64) -> Vec<u8> {
    let mut lines = vec![
        "Griffin Music - Acordes".to_string(),
        String::new(),
        format!("Duracao: {:.1} s", duration),
        String::new(),
    ];
    lines.extend(chords.iter().map(|chord| {
        format!(
            "{}  {}  {}",
            format_time(chord.start * duration),
            chord.name,
            format_time(chord.end * duration)
        )
    }));
    let mut content = format!(
        "BT /F1 14 Tf 50 760 Td ({}) Tj /F1 10 Tf 0 -24 Td ",
        escape_pdf(&lines[0])
    );
    for line in lines.iter().skip(1) {
        content.push_str(&format!("({}) Tj 0 -16 Td ", escape_pdf(line)));
    }
    content.push_str("ET");
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".to_string(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        format!("<< /Length {} >>\nstream\n{}\nendstream", content.len(), content),
    ];
    let mut pdf = "%PDF-1.4\n".to_string();
    let mut offsets = vec![0usize];
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{}\nendobj\n", index + 1, object));
    }
    let xref = pdf.len();
    pdf.push_str(&format!(
        "xref\n0 {}\n0000000000 65535 f \n",
        objects.len() + 1
    ));
    for offset in offsets.iter().skip(1) {
        pdf.push_str(&format!("{:010} 00000 n \n", offset));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF",
        objects.len() + 1,
        xref
    ));
    pdf.into_bytes()
}

fn chord_tones(name: &str) -> [u8; 3] {
    let mut parts = name.split_whitespace();
    let root = parts.next().unwrap_or("C");
    let root_number = match root.to_ascii_lowercase().as_str() {
        "c" => 0,
        "c#" | "db" => 1,
        "d" => 2,
        "d#" | "eb" => 3,
        "e" => 4,
        "f" => 5,
        "f#" | "gb" => 6,
        "g" => 7,
        "g#" | "ab" => 8,
        "a" => 9,
        "a#" | "bb" => 10,
        "b" => 11,
        _ => 0,
    };
    let minor = parts.any(|part| part.eq_ignore_ascii_case("menor"));
    [
        48 + root_number,
        48 + root_number + if minor { 3 } else { 4 },
        48 + root_number + 7,
    ]
}

fn number_bytes(value: u64, length: usize) -> Vec<u8> {
    (0..length)
        .map(|index| (value >> ((length - index - 1) * 8)) as u8)
        .collect()
}

fn variable_length(mut value: u64) -> Vec<u8> {
    let mut bytes = vec![(value & 0x7f) as u8];
    while {
        value >>= 7;
        value > 0
    } {
        bytes.push(((value & 0x7f) as u8) | 0x80);
    }
    bytes.reverse();
    bytes
}

fn escape_pdf(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| {
            if matches!(character, '\\' | '(' | ')') {
                vec!['\\', character]
            } else {
                vec![character]
            }
        })
        .collect()
}

fn format_time(seconds: f64) -> String {
    format!(
        "{}:{:02}",
        (seconds.max(0.0) / 60.0) as u64,
        (seconds.max(0.0) as u64) % 60
    )
}

#[tauri::command]
pub async fn remote_provider_status(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let key = {
        let data = state.data.lock().map_err(lock_error)?;
        load_stem_split_api_key(&data.data_dir, &data.settings)
    };
    remote_provider_status_for_key(key).await
}

async fn remote_provider_status_for_key(key: Option<String>) -> Result<serde_json::Value, String> {
    let Some(key) = key else {
        return Ok(
            serde_json::json!({ "configured": false, "verified": false, "message": "Nenhuma chave de API configurada." }),
        );
    };
    tokio::task::spawn_blocking(move || remote_provider_status_blocking(&key))
        .await
        .map_err(|error| format!("Falha ao verificar o StemSplit: {error}"))
}

fn remote_provider_status_blocking(key: &str) -> serde_json::Value {
    let response =
        public_http_agent("https://stemsplit.io/api/v1/balance").and_then(|(url, agent)| {
            agent
                .get(&url)
                .header("Authorization", format!("Bearer {key}"))
                .header("Accept", "application/json")
                .call()
                .map_err(|error| error.to_string())
        });
    match response {
        Ok(response) => {
            let body_text = match read_to_string_limited(
                response.into_body().into_reader(),
                MAX_EXTERNAL_RESPONSE_BYTES,
            ) {
                Ok(body_text) => body_text,
                Err(error) => {
                    return serde_json::json!({
                        "configured": true,
                        "verified": false,
                        "message": format!("Resposta do StemSplit excedeu o limite de segurança: {error}")
                    });
                }
            };
            let body: serde_json::Value = serde_json::from_str(&body_text).unwrap_or_default();
            let balance = body
                .get("balanceFormatted")
                .and_then(|value| value.as_str())
                .unwrap_or("saldo disponível");
            serde_json::json!({ "configured": true, "verified": true, "balanceFormatted": balance, "message": format!("Conectado ao StemSplit — saldo: {balance}.") })
        }
        Err(error) => serde_json::json!({
            "configured": true,
            "verified": false,
            "message": if error.to_string().contains("401") { "Chave de API inválida ou revogada." } else { "Não foi possível verificar a chave agora. Tente novamente." }
        }),
    }
}
#[tauri::command]
pub async fn remote_provider_save_api_key(
    state: State<'_, AppState>,
    key: String,
) -> Result<serde_json::Value, String> {
    if key.trim().is_empty() {
        return Err("Informe uma chave de API válida.".into());
    }
    let data_dir = state.data.lock().map_err(lock_error)?.data_dir.clone();
    save_stem_split_api_key(&data_dir, key.trim())?;
    {
        let mut data = state.data.lock().map_err(lock_error)?;
        data.settings.remove("stemSplitApiKey");
        save_settings_locked(&data)?;
    }
    remote_provider_status_for_key(Some(key.trim().to_string())).await
}
#[tauri::command]
pub async fn remote_provider_clear_api_key(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    {
        let mut data = state.data.lock().map_err(lock_error)?;
        let data_dir = data.data_dir.clone();
        remove_stem_split_api_key(&data_dir)?;
        data.settings.remove("stemSplitApiKey");
        save_settings_locked(&data)?;
    }
    remote_provider_status_for_key(None).await
}
#[tauri::command(rename_all = "camelCase")]
pub async fn remote_provider_estimate_cost(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<serde_json::Value, String> {
    let (duration, path) = {
        let data = state.data.lock().map_err(lock_error)?;
        let track = data
            .tracks
            .iter()
            .find(|track| track.id == track_id)
            .ok_or_else(|| "Faixa não encontrada.".to_string())?;
        (track.duration, PathBuf::from(&track.path))
    };
    let duration = match duration.filter(|value| value.is_finite() && *value >= 0.0) {
        Some(value) => value,
        None => tokio::task::spawn_blocking(move || audio_duration_seconds(&path))
            .await
            .map_err(|error| format!("Falha ao estimar a duração da faixa: {error}"))??
            .ok_or_else(|| "Não foi possível determinar a duração da faixa.".to_string())?,
    };
    Ok(serde_json::json!({ "durationSeconds": duration, "estimatedUsd": duration / 60.0 * 0.1 }))
}

fn mutate_project(
    state: &State<'_, AppState>,
    project_id: &str,
    change: impl FnOnce(&mut Project),
) -> Result<Project, String> {
    let mut data = state.data.lock().map_err(lock_error)?;
    let project = data
        .projects
        .iter_mut()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "Projeto não encontrado.".to_string())?;
    change(project);
    project.updated_at = now();
    let result = project.clone();
    save_projects_locked(&data)?;
    Ok(result)
}
fn save_tracks_locked(data: &crate::state::StateData) -> Result<(), String> {
    write_json(&data.data_dir.join("library.json"), &data.tracks)
}
fn save_projects_locked(data: &crate::state::StateData) -> Result<(), String> {
    write_json(&data.data_dir.join("projects.json"), &data.projects)
}
fn save_settings_locked(data: &crate::state::StateData) -> Result<(), String> {
    write_json(&data.data_dir.join("settings.json"), &data.settings)
}
fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    write_json_atomic(path, value)
}
fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "estado indisponível".into()
}

fn cleanup_remote_preview_state(state: &AppState) -> Result<(), String> {
    let now = Instant::now();
    let mut asset_paths = Vec::new();
    {
        let mut assets = state.remote_assets.lock().map_err(lock_error)?;
        let expired = assets
            .iter()
            .filter(|(_, asset)| preview_expired(asset.created_at, now))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in expired {
            if let Some(asset) = assets.remove(&id) {
                asset_paths.push(asset.path);
            }
        }
        while assets.len() > MAX_REMOTE_PREVIEWS {
            let oldest = assets
                .iter()
                .min_by_key(|(_, asset)| asset.created_at)
                .map(|(id, _)| id.clone());
            let Some(oldest) = oldest else { break };
            if let Some(asset) = assets.remove(&oldest) {
                asset_paths.push(asset.path);
            }
        }
    }
    for path in asset_paths {
        let _ = fs::remove_file(path);
    }
    {
        let mut previews = state.youtube_previews.lock().map_err(lock_error)?;
        let expired = previews
            .iter()
            .filter(|(_, preview)| preview_expired(preview.created_at, now))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in expired {
            previews.remove(&id);
        }
        while previews.len() > MAX_REMOTE_PREVIEWS {
            let oldest = previews
                .iter()
                .min_by_key(|(_, preview)| preview.created_at)
                .map(|(id, _)| id.clone());
            let Some(oldest) = oldest else { break };
            previews.remove(&oldest);
        }
    }
    let active_separations = state.active_separations.lock().map_err(lock_error)?.clone();
    state
        .remote_cancelled
        .lock()
        .map_err(lock_error)?
        .retain(|id| active_separations.contains(id));
    let downloading = state.model_downloading.lock().map_err(lock_error)?.clone();
    state
        .model_cancelled
        .lock()
        .map_err(lock_error)?
        .retain(|kind| downloading.as_deref() == Some(kind.as_str()));
    Ok(())
}

async fn cleanup_youtube_cancelled(state: &AppState) -> Result<(), String> {
    let active = state
        .youtube_processes
        .lock()
        .await
        .keys()
        .cloned()
        .collect::<HashSet<_>>();
    let previews = state
        .youtube_previews
        .lock()
        .map_err(lock_error)?
        .keys()
        .cloned()
        .collect::<HashSet<_>>();
    state
        .youtube_cancelled
        .lock()
        .map_err(lock_error)?
        .retain(|id| active.contains(id) || previews.contains(id));
    Ok(())
}

fn preview_expired(created_at: Instant, now: Instant) -> bool {
    now.checked_duration_since(created_at)
        .is_some_and(|age| age >= REMOTE_PREVIEW_TTL)
}

fn now() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{seconds}")
}
fn is_supported_audio(path: &Path) -> bool {
    audio_content_type(path).is_some()
}

fn audio_content_type(path: &Path) -> Option<&'static str> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .and_then(|extension| match extension.to_ascii_lowercase().as_str() {
            "wav" => Some("audio/wav"),
            "mp3" => Some("audio/mpeg"),
            "flac" => Some("audio/flac"),
            "m4a" => Some("audio/mp4"),
            "webm" => Some("audio/webm"),
            _ => None,
        })
}

fn read_to_string_limited<R: Read>(mut reader: R, limit: u64) -> Result<String, String> {
    let mut bytes = Vec::new();
    copy_with_limit(&mut reader, &mut bytes, limit)?;
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

fn copy_with_limit<R: Read, W: std::io::Write>(
    reader: &mut R,
    writer: &mut W,
    limit: u64,
) -> Result<u64, String> {
    copy_with_limit_cancelled(reader, writer, limit, || Ok(()))
}
fn copy_with_limit_cancelled<R: Read, W: std::io::Write, F: FnMut() -> Result<(), String>>(
    reader: &mut R,
    writer: &mut W,
    limit: u64,
    mut check_cancelled: F,
) -> Result<u64, String> {
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        check_cancelled()?;
        let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            return Ok(total);
        }
        total = total.saturating_add(read as u64);
        if total > limit {
            return Err(format!(
                "O arquivo remoto excede o limite de {} MB.",
                limit / 1024 / 1024
            ));
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|e| e.to_string())?;
    }
}
fn copy_with_progress<R: Read, W: std::io::Write, F: FnMut(u64) -> Result<(), String>>(
    reader: &mut R,
    writer: &mut W,
    expected: Option<u64>,
    mut report: F,
) -> Result<u64, String> {
    let mut buffer = [0u8; 1024 * 1024];
    let mut total = 0u64;
    loop {
        let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            return Ok(total);
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|e| e.to_string())?;
        total = total.saturating_add(read as u64);
        report(total)?;
        if expected.is_some_and(|size| total > size) {
            return Err(
                "Download incompleto ou maior que o tamanho informado pelo servidor.".into(),
            );
        }
    }
}
fn parse_content_range(value: &str) -> Option<(u64, u64)> {
    let (unit, range) = value.split_once(' ')?;
    if unit != "bytes" {
        return None;
    }
    let (bounds, total) = range.split_once('/')?;
    let (start, _) = bounds.split_once('-')?;
    Some((start.parse().ok()?, total.parse().ok()?))
}
fn audio_extension(url: &str, content_type: &str) -> Option<&'static str> {
    let path = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    if path.ends_with(".wav") || matches!(content_type, "audio/wav" | "audio/x-wav") {
        Some("wav")
    } else if path.ends_with(".mp3") || content_type == "audio/mpeg" {
        Some("mp3")
    } else if path.ends_with(".flac") || matches!(content_type, "audio/flac" | "audio/x-flac") {
        Some("flac")
    } else if path.ends_with(".m4a") || matches!(content_type, "audio/mp4" | "audio/x-m4a") {
        Some("m4a")
    } else if path.ends_with(".webm") || matches!(content_type, "audio/webm" | "video/webm") {
        Some("webm")
    } else {
        None
    }
}

#[derive(Clone, Debug)]
struct PinnedResolver {
    addresses: Vec<SocketAddr>,
}

impl Resolver for PinnedResolver {
    fn resolve(
        &self,
        _uri: &ureq::http::Uri,
        _config: &ureq::config::Config,
        _timeout: NextTimeout,
    ) -> Result<ResolvedSocketAddrs, ureq::Error> {
        let mut resolved = self.empty();
        for address in self.addresses.iter().take(16) {
            resolved.push(*address);
        }
        Ok(resolved)
    }
}

fn public_http_agent(value: &str) -> Result<(String, ureq::Agent), String> {
    let url = parse_public_url(value)?;
    let addresses = resolve_public_addresses(&url)?;
    let config = ureq::Agent::config_builder()
        .max_redirects(0)
        .max_redirects_will_error(true)
        .build();
    let agent = ureq::Agent::with_parts(
        config,
        DefaultConnector::default(),
        PinnedResolver { addresses },
    );
    Ok((url.to_string(), agent))
}

fn public_http_get_following_redirects(
    value: &str,
) -> Result<ureq::http::Response<ureq::Body>, String> {
    let mut current = parse_public_url(value)?;
    for redirect_count in 0..=MAX_PUBLIC_REDIRECTS {
        let (url, agent) = public_http_agent(current.as_str())?;
        let response = agent
            .get(url.as_str())
            .call()
            .map_err(|error| error.to_string())?;
        let status = response.status().as_u16();
        if !matches!(status, 301 | 302 | 303 | 307 | 308) {
            return Ok(response);
        }
        if redirect_count == MAX_PUBLIC_REDIRECTS {
            return Err("limite de redirecionamentos excedido".into());
        }
        let location = response
            .headers()
            .get("location")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| "redirecionamento sem destino".to_string())?;
        current = public_redirect_target(&current, location)?;
    }
    unreachable!("redirect loop has a fixed upper bound")
}

fn public_redirect_target(current: &Url, location: &str) -> Result<Url, String> {
    let next = current
        .join(location)
        .map_err(|error| format!("destino de redirecionamento inválido: {error}"))?;
    if current.scheme() == "https" && next.scheme() != "https" {
        return Err("redirecionamento inseguro para HTTP".into());
    }
    parse_public_url(next.as_str())
}

fn parse_public_url(value: &str) -> Result<Url, String> {
    let value = value.trim();
    let url = Url::parse(value)
        .map_err(|_| "Use uma URL HTTP/HTTPS pública sem credenciais.".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host().is_none()
    {
        return Err("Use uma URL HTTP/HTTPS pública sem credenciais.".into());
    }
    if let Some(host) = url.host_str() {
        let normalized = host.to_ascii_lowercase();
        if matches!(normalized.as_str(), "localhost" | "localhost.")
            || normalized.ends_with(".localhost")
            || normalized.ends_with(".local")
        {
            return Err("Fontes locais ou privadas não são permitidas.".into());
        }
    }
    Ok(url)
}

fn resolve_public_addresses(url: &Url) -> Result<Vec<SocketAddr>, String> {
    let addresses = url
        .socket_addrs(|| None)
        .map_err(|_| "Não foi possível resolver o host da URL.".to_string())?;
    if addresses.is_empty() || addresses.iter().any(|address| is_private_ip(address.ip())) {
        return Err("Fontes locais ou privadas não são permitidas.".into());
    }
    Ok(addresses)
}

fn validate_youtube_url(value: &str) -> Result<String, String> {
    let parsed = parse_public_url(value)?;
    let host = parsed
        .host_str()
        .unwrap_or_default()
        .trim_end_matches('.')
        .trim_start_matches("www.")
        .to_ascii_lowercase();
    if parsed.scheme() != "https" || !youtube_host_allowed(&host) {
        return Err("Use uma URL HTTPS pública do YouTube, sem playlists.".into());
    }
    resolve_public_addresses(&parsed)?;
    Ok(remove_youtube_playlist_params(parsed.as_str()))
}
fn youtube_host_allowed(host: &str) -> bool {
    matches!(host, "youtube.com" | "m.youtube.com" | "youtu.be")
}
fn remove_youtube_playlist_params(url: &str) -> String {
    let (without_fragment, fragment) = url.split_once('#').unwrap_or((url, ""));
    let Some((base, query)) = without_fragment.split_once('?') else {
        return url.to_string();
    };
    let kept = query
        .split('&')
        .filter(|parameter| {
            let name = parameter
                .split('=')
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            !matches!(name.as_str(), "list" | "index" | "start_radio" | "shuffle")
        })
        .collect::<Vec<_>>();
    let mut normalized = if kept.is_empty() {
        base.to_string()
    } else {
        format!("{base}?{}", kept.join("&"))
    };
    if !fragment.is_empty() {
        normalized.push('#');
        normalized.push_str(fragment);
    }
    normalized
}
fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let value = u32::from_be_bytes(ip.octets());
            (value & 0xff00_0000) == 0x0a00_0000
                || (value & 0xfff0_0000) == 0xac10_0000
                || (value & 0xffff_0000) == 0xc0a8_0000
                || (value & 0xffff_0000) == 0xa9fe_0000
                || (value & 0xffc0_0000) == 0x6440_0000
                || (value & 0xff00_0000) == 0x7f00_0000
                || (value & 0xf000_0000) == 0xe000_0000
                || (value & 0xff00_0000) == 0x0000_0000
                || value == 0xffff_ffff
                || (value & 0xffff_ff00) == 0xc000_0000
                || (value & 0xffff_ff00) == 0xc000_0200
                || (value & 0xffff_ff00) == 0xc633_6400
                || (value & 0xffff_0000) == 0xc612_0000
                || (value & 0xffff_ff00) == 0xcb00_7100
                || (value & 0xf000_0000) == 0xf000_0000
        }
        IpAddr::V6(ip) => {
            if let Some(ipv4) = ip.to_ipv4() {
                return is_private_ip(IpAddr::V4(ipv4));
            }
            let segments = ip.segments();
            ip.is_unspecified()
                || ip.is_loopback()
                || ip.is_multicast()
                || (segments[0] & 0xfe00) == 0xfc00
                || (segments[0] & 0xffc0) == 0xfe80
                || (segments[0] & 0xffc0) == 0xfec0
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        }
    }
}
fn normalize_yt_dlp_error(error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        "yt-dlp não está instalado. Abra Preferências > Processamento para baixá-lo pelo Griffin."
            .into()
    } else {
        format!("Não foi possível executar o yt-dlp: {error}")
    }
}
fn yt_dlp_process_error(action: &str, stderr: &[u8], stdout: &[u8]) -> String {
    let detail = String::from_utf8_lossy(stderr).trim().to_string();
    let detail = if detail.is_empty() {
        String::from_utf8_lossy(stdout).trim().to_string()
    } else {
        detail
    };
    let detail = detail
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if detail.is_empty() {
        return action.to_string();
    }
    let detail = if detail.chars().count() > 1200 {
        format!("{}…", detail.chars().take(1200).collect::<String>())
    } else {
        detail
    };
    format!("{action} Detalhes: {detail}")
}
async fn yt_dlp_runtime_args() -> Vec<String> {
    if command_available("deno").await {
        Vec::new()
    } else if command_available("node").await {
        vec!["--js-runtimes".into(), "node".into()]
    } else {
        Vec::new()
    }
}
fn emit_youtube_progress(app: &AppHandle, id: &str, progress: f64, stage: &str, message: &str) {
    let _ = app.emit(
        "library:youtube-progress",
        serde_json::json!({
            "id": id,
            "progress": progress.clamp(0.0, 1.0),
            "stage": stage,
            "message": message,
        }),
    );
}
fn youtube_download_percent(line: &str) -> Option<f64> {
    let value = line
        .strip_prefix("download:")?
        .trim()
        .trim_end_matches('%')
        .trim();
    let percent = value.parse::<f64>().ok()?;
    percent.is_finite().then_some(percent.clamp(0.0, 100.0))
}

async fn read_async_to_end_limited<R: AsyncRead + Unpin>(
    reader: &mut R,
    limit: usize,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut limited = reader.take(limit as u64 + 1);
    limited
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| error.to_string())?;
    if bytes.len() > limit {
        return Err(format!(
            "A saída do processo excedeu o limite de {} MiB.",
            limit / (1024 * 1024)
        ));
    }
    Ok(bytes)
}

type YoutubeProcess = Arc<Mutex<tokio::process::Child>>;

async fn register_youtube_process(
    processes: &tokio::sync::Mutex<HashMap<String, YoutubeProcess>>,
    operation_id: &str,
    child: tokio::process::Child,
) -> YoutubeProcess {
    let process = Arc::new(Mutex::new(child));
    processes
        .lock()
        .await
        .insert(operation_id.to_string(), Arc::clone(&process));
    process
}

async fn unregister_youtube_process(
    processes: &tokio::sync::Mutex<HashMap<String, YoutubeProcess>>,
    operation_id: &str,
    process: &YoutubeProcess,
) {
    let mut processes = processes.lock().await;
    if processes
        .get(operation_id)
        .is_some_and(|registered| Arc::ptr_eq(registered, process))
    {
        processes.remove(operation_id);
    }
}

async fn terminate_youtube_process(process: &YoutubeProcess) -> Result<(), String> {
    let mut child = process.lock().await;
    if child
        .try_wait()
        .map_err(|error| format!("Falha ao consultar o processo do YouTube: {error}"))?
        .is_some()
    {
        return Ok(());
    }
    if let Err(error) = child.kill().await {
        if error.kind() != std::io::ErrorKind::NotFound {
            return Err(format!("Falha ao encerrar o processo do YouTube: {error}"));
        }
    }
    child
        .wait()
        .await
        .map(|_| ())
        .map_err(|error| format!("Falha ao aguardar o processo do YouTube: {error}"))
}

async fn cleanup_youtube_process(
    processes: &tokio::sync::Mutex<HashMap<String, YoutubeProcess>>,
    operation_id: &str,
) {
    let process = processes.lock().await.remove(operation_id);
    if let Some(process) = process {
        let _ = terminate_youtube_process(&process).await;
    }
}

fn youtube_cancel_requested(
    cancelled: &std::sync::Mutex<HashSet<String>>,
    operation_id: &str,
) -> bool {
    cancelled
        .lock()
        .map(|values| values.contains(operation_id))
        .unwrap_or(true)
}

async fn wait_for_youtube_cancel(
    cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
    operation_id: String,
) {
    loop {
        if youtube_cancel_requested(&cancelled, &operation_id) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn wait_for_separation_cancel(
    cancelled: Arc<std::sync::Mutex<HashSet<String>>>,
    track_id: String,
) {
    loop {
        let requested = cancelled
            .lock()
            .map(|values| values.contains(&track_id))
            .unwrap_or(true);
        if requested {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn cleanup_youtube_download(imports_dir: &Path, file_prefix: &str) {
    if let Ok(entries) = fs::read_dir(imports_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let matches = path.is_file()
                && path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .is_some_and(|stem| stem == file_prefix);
            if matches {
                let _ = fs::remove_file(path);
            }
        }
    }
}

async fn command_available(name: &str) -> bool {
    Command::new(name)
        .arg("--version")
        .output()
        .await
        .is_ok_and(|output| output.status.success())
}
fn managed_yt_dlp_path(state: &State<'_, AppState>) -> PathBuf {
    let data_dir = state
        .data
        .lock()
        .map(|data| data.data_dir.clone())
        .unwrap_or_default();
    data_dir.join("tools").join(if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    })
}
fn yt_dlp_command(state: &State<'_, AppState>) -> Command {
    let path = managed_yt_dlp_path(state);
    if path.is_file() {
        Command::new(path)
    } else {
        Command::new(if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        })
    }
}
fn yt_dlp_release_asset() -> (&'static str, &'static str) {
    #[cfg(windows)]
    {
        (
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
            "yt-dlp.exe",
        )
    }
    #[cfg(target_os = "macos")]
    {
        (
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
            "yt-dlp_macos",
        )
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        (
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64",
            "yt-dlp_linux_aarch64",
        )
    }
    #[cfg(all(target_os = "linux", not(target_arch = "aarch64")))]
    {
        (
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
            "yt-dlp_linux",
        )
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        (
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
            "yt-dlp",
        )
    }
}
fn download_checksum(url: &str, asset_url: &str) -> Result<String, String> {
    let (checksum_url, agent) = public_http_agent(
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS",
    )?;
    let body = agent
        .get(&checksum_url)
        .call()
        .map_err(|e| format!("Não foi possível obter a assinatura do yt-dlp: {e}"))?
        .into_body()
        .into_reader();
    let body = read_to_string_limited(body, MAX_EXTERNAL_RESPONSE_BYTES)?;
    let asset = asset_url.rsplit('/').next().unwrap_or(url);
    body.lines()
        .find_map(|line| {
            let mut fields = line.split_whitespace();
            let hash = fields.next()?;
            let name = fields.next()?.trim_start_matches('*');
            (name == asset).then(|| hash.to_ascii_lowercase())
        })
        .filter(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| "A assinatura do yt-dlp não contém o arquivo esperado.".into())
}
fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}
fn pick_audio() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Áudio", &["wav", "mp3", "flac", "webm", "m4a"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}
fn same_path(left: &str, right: &str) -> bool {
    fs::canonicalize(left).ok() == fs::canonicalize(right).ok()
}
fn wav_duration(path: &Path) -> Option<f64> {
    hound::WavReader::open(path).ok().map(|reader| {
        reader.duration() as f64 / reader.spec().sample_rate as f64 / reader.spec().channels as f64
    })
}

fn audio_duration_seconds(path: &Path) -> Result<Option<f64>, String> {
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    let source = MediaSourceStream::new(Box::new(file), Default::default());
    let probe = get_probe()
        .format(
            &hint,
            source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| error.to_string())?;
    let track = probe
        .format
        .default_track()
        .ok_or_else(|| "Nenhuma faixa de áudio encontrada.".to_string())?;
    Ok(track
        .codec_params
        .n_frames
        .zip(track.codec_params.sample_rate)
        .map(|(frames, rate)| frames as f64 / rate as f64))
}

fn cache_component(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())[..24].to_string()
}

fn clear_cache_directory(cache_dir: &Path) -> Result<(), String> {
    if !cache_dir.exists() {
        return fs::create_dir_all(cache_dir).map_err(|error| error.to_string());
    }
    let temporary = cache_dir.with_file_name(format!(
        ".{}-cleanup-{}",
        cache_dir
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("cache"),
        Uuid::new_v4()
    ));
    fs::rename(cache_dir, &temporary)
        .map_err(|error| format!("Não foi possível preparar o cache para limpeza: {error}"))?;
    if let Err(error) = fs::create_dir_all(cache_dir) {
        let restore = fs::rename(&temporary, cache_dir);
        return Err(match restore {
            Ok(()) => format!("Não foi possível recriar o cache: {error}"),
            Err(restore_error) => format!(
                "Não foi possível recriar o cache ({error}) nem restaurar os arquivos ({restore_error})."
            ),
        });
    }
    fs::remove_dir_all(&temporary)
        .map_err(|error| format!("Não foi possível remover o cache antigo: {error}"))
}

fn ensure_cache_clear_allowed(active: &std::sync::Mutex<HashSet<String>>) -> Result<(), String> {
    if active.lock().map_err(lock_error)?.is_empty() {
        Ok(())
    } else {
        Err(
            "Não é possível limpar o cache enquanto há separações ativas. Aguarde-as terminar."
                .into(),
        )
    }
}

fn directory_size(path: &Path) -> u64 {
    fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| {
            if entry.path().is_dir() {
                directory_size(&entry.path())
            } else {
                entry.metadata().map(|metadata| metadata.len()).unwrap_or(0)
            }
        })
        .sum()
}
fn current_rss() -> u64 {
    #[cfg(target_os = "linux")]
    {
        fs::read_to_string("/proc/self/statm")
            .ok()
            .and_then(|value| {
                value
                    .split_whitespace()
                    .next()
                    .and_then(|pages| pages.parse::<u64>().ok())
            })
            .unwrap_or(0)
            * 4096
    }
    #[cfg(not(target_os = "linux"))]
    {
        0
    }
}
fn worker_path(app: &AppHandle) -> PathBuf {
    let base_name = if cfg!(windows) {
        "griffin-onnx-worker.exe"
    } else {
        "griffin-onnx-worker"
    };
    if let Ok(resource_dir) = app.path().resource_dir() {
        let binaries_dir = resource_dir.join("binaries");
        let direct = binaries_dir.join(base_name);
        if direct.is_file() {
            return direct;
        }
        if let Ok(entries) = fs::read_dir(&binaries_dir) {
            if let Some(path) = entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .find(|path| {
                    path.is_file()
                        && path
                            .file_name()
                            .and_then(|name| name.to_str())
                            .is_some_and(|name| name.starts_with(base_name))
                })
            {
                return path;
            }
        }
    }
    let candidates = [
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|parent| parent.join(base_name))),
        Some(PathBuf::from("src-tauri/binaries").join(base_name)),
        Some(PathBuf::from("src-tauri/target/debug").join(base_name)),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from(base_name))
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;
    use std::{
        fs,
        io::Cursor,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let suffix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock before epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "griffin-commands-{label}-{}-{suffix}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temporary directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn accepts_supported_audio_extensions_case_insensitively() {
        for (extension, content_type) in [
            ("wav", "audio/wav"),
            ("MP3", "audio/mpeg"),
            ("flac", "audio/flac"),
            ("webm", "audio/webm"),
            ("m4a", "audio/mp4"),
        ] {
            let path = PathBuf::from(format!("track.{extension}"));
            assert!(is_supported_audio(&path));
            assert_eq!(audio_content_type(&path), Some(content_type));
        }
        assert!(!is_supported_audio(Path::new("track.txt")));
        assert_eq!(audio_content_type(Path::new("track.txt")), None);
        assert_eq!(audio_content_type(Path::new("track")), None);
    }

    #[test]
    fn removes_only_unreferenced_managed_track_files() {
        let temp = TempDir::new("library-remove");
        let imports = temp.path().join("imports");
        let cache = temp.path().join("cache");
        fs::create_dir_all(&imports).unwrap();
        fs::create_dir_all(&cache).unwrap();
        let orphan = imports.join("orphan.wav");
        let shared = cache.join("shared.wav");
        let external = temp.path().join("external.wav");
        fs::write(&orphan, b"orphan").unwrap();
        fs::write(&shared, b"shared").unwrap();
        fs::write(&external, b"external").unwrap();
        let track = |id: &str, path: &Path| Track {
            id: id.into(),
            name: id.into(),
            path: path.to_string_lossy().into_owned(),
            imported_at: "0".into(),
            duration: None,
            stems: None,
            analysis: None,
            lyrics: None,
        };
        let mut removed = track("removed", &orphan);
        removed.stems = Some(HashMap::from([
            ("shared".into(), shared.to_string_lossy().into_owned()),
            ("external".into(), external.to_string_lossy().into_owned()),
        ]));
        let remaining = vec![track("remaining", &shared)];
        cleanup_removed_track_files(&removed, &remaining, &imports, &cache).unwrap();
        assert!(!orphan.exists());
        assert!(shared.exists());
        assert!(external.exists());
    }

    #[test]
    fn repairs_project_references_to_missing_library_tracks() {
        let mut project = Project {
            id: "project".into(),
            name: "Projeto".into(),
            created_at: "0".into(),
            updated_at: "0".into(),
            track_ids: vec!["available".into(), "missing".into()],
            folder_id: None,
            file_path: None,
            file_saved_at: None,
            snapshots: None,
            player_state: None,
        };
        let available = Track {
            id: "available".into(),
            name: "Faixa disponível".into(),
            path: "/tmp/available.wav".into(),
            imported_at: "0".into(),
            duration: None,
            stems: None,
            analysis: None,
            lyrics: None,
        };

        let missing = remove_missing_track_references(&mut project, &[available]);

        assert_eq!(missing, vec!["missing"]);
        assert_eq!(project.track_ids, vec!["available"]);
    }

    #[test]
    fn maps_remote_audio_formats_and_rejects_unknown_formats() {
        assert_eq!(
            audio_extension("https://example.test/song.wav", ""),
            Some("wav")
        );
        assert_eq!(
            audio_extension("https://example.test/song", "audio/x-wav"),
            Some("wav")
        );
        assert_eq!(
            audio_extension("https://example.test/song.mp3", ""),
            Some("mp3")
        );
        assert_eq!(
            audio_extension("https://example.test/song", "audio/mpeg"),
            Some("mp3")
        );
        assert_eq!(
            audio_extension("https://example.test/song.flac", ""),
            Some("flac")
        );
        assert_eq!(
            audio_extension("https://example.test/song", "audio/x-flac"),
            Some("flac")
        );
        assert_eq!(
            audio_extension("https://example.test/song.m4a", ""),
            Some("m4a")
        );
        assert_eq!(
            audio_extension("https://example.test/song", "audio/mp4"),
            Some("m4a")
        );
        assert_eq!(
            audio_extension("https://example.test/song.webm", ""),
            Some("webm")
        );
        assert_eq!(
            audio_extension("https://example.test/song", "audio/webm"),
            Some("webm")
        );
        assert_eq!(
            audio_extension("https://example.test/song.txt", "text/plain"),
            None
        );
    }

    #[test]
    fn rejects_private_and_credentialed_urls() {
        assert!(public_http_agent("http://127.0.0.1/audio.wav").is_err());
        assert!(public_http_agent("http://192.168.1.20/audio.wav").is_err());
        assert!(public_http_agent("http://[::1]/audio.wav").is_err());
        assert!(public_http_agent("http://[::ffff:127.0.0.1]/audio.wav").is_err());
        assert!(public_http_agent("http://localhost/audio.wav").is_err());
        assert!(parse_public_url("https://user:pass@example.test/audio.wav").is_err());
        assert!(public_http_agent("http://2130706433/audio.wav").is_err());
        assert!(public_http_agent("http://8.8.8.8:8080/audio.wav").is_ok());
    }

    #[test]
    fn follows_only_public_https_redirect_targets() {
        let source = Url::parse("https://huggingface.co/StemSplitio/model/file.onnx").unwrap();
        assert_eq!(
            public_redirect_target(&source, "https://cdn.example.test/file.onnx")
                .unwrap()
                .as_str(),
            "https://cdn.example.test/file.onnx"
        );
        assert_eq!(
            public_redirect_target(&source, "/resolve/main/file.onnx")
                .unwrap()
                .as_str(),
            "https://huggingface.co/resolve/main/file.onnx"
        );
        assert!(public_redirect_target(&source, "http://127.0.0.1/file.onnx").is_err());
    }

    #[test]
    fn rejects_private_ip_ranges_and_ipv6_variants() {
        for value in [
            "10.0.0.1",
            "172.16.0.1",
            "192.168.0.1",
            "169.254.1.1",
            "100.64.0.1",
            "127.0.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "192.0.0.1",
            "198.18.0.1",
            "198.51.100.1",
            "::",
            "::1",
            "::ffff:192.168.0.1",
            "fc00::1",
            "fe80::1",
            "ff02::1",
            "2001:db8::1",
        ] {
            assert!(is_private_ip(value.parse().unwrap()), "{value}");
        }
        assert!(!is_private_ip("8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn restricts_youtube_urls_and_removes_playlist_parameters() {
        let normalized =
            remove_youtube_playlist_params("https://www.youtube.com/watch?v=abc&list=playlist");
        assert_eq!(normalized, "https://www.youtube.com/watch?v=abc");
        assert!(youtube_host_allowed("youtube.com"));
        assert!(youtube_host_allowed("m.youtube.com"));
        assert!(youtube_host_allowed("youtu.be"));
        assert!(!youtube_host_allowed("youtube.com.evil.test"));
        assert!(validate_youtube_url("https://example.test/watch?v=abc").is_err());
    }

    #[test]
    fn enforces_copy_limits_and_reports_progress_overruns() {
        let mut reader = Cursor::new(b"12345".to_vec());
        let mut output = Vec::new();
        assert!(copy_with_limit(&mut reader, &mut output, 4).is_err());

        let mut reader = Cursor::new(b"12345".to_vec());
        let mut output = Vec::new();
        let mut reports = Vec::new();
        let result = copy_with_progress(&mut reader, &mut output, Some(4), |received| {
            reports.push(received);
            Ok(())
        });
        assert!(result.is_err());
        assert_eq!(reports, vec![5]);
    }

    #[test]
    fn temporary_guards_cleanup_checksum_disk_and_cancellation_failures() {
        struct DiskFullWriter;
        impl std::io::Write for DiskFullWriter {
            fn write(&mut self, _buffer: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::new(
                    std::io::ErrorKind::StorageFull,
                    "disk full",
                ))
            }

            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }

        let temp = TempDir::new("temporary-guards");

        let checksum_file = temp.path().join("checksum.download");
        fs::write(&checksum_file, b"invalid").unwrap();
        {
            let _guard = TemporaryFileGuard(Some(checksum_file.clone()));
            assert_ne!(sha256_file(&checksum_file).unwrap(), "expected");
        }
        assert!(!checksum_file.exists());

        let disk_file = temp.path().join("disk-full.download");
        fs::write(&disk_file, b"partial").unwrap();
        {
            let _guard = TemporaryFileGuard(Some(disk_file.clone()));
            let mut reader = Cursor::new(b"audio".to_vec());
            assert!(
                copy_with_progress(&mut reader, &mut DiskFullWriter, None, |_| Ok(())).is_err()
            );
        }
        assert!(!disk_file.exists());

        let cancelled_file = temp.path().join("cancelled.download");
        fs::write(&cancelled_file, b"partial").unwrap();
        {
            let _guard = TemporaryFileGuard(Some(cancelled_file.clone()));
            let mut reader = Cursor::new(b"audio".to_vec());
            let mut output = Vec::new();
            assert!(
                copy_with_limit_cancelled(&mut reader, &mut output, 1024, || {
                    Err("Download cancelado.".into())
                })
                .is_err()
            );
        }
        assert!(!cancelled_file.exists());

        let staging = temp.path().join("runtime.installing");
        fs::create_dir_all(staging.join("lib")).unwrap();
        {
            let _guard = TemporaryDirectoryGuard(Some(staging.clone()));
        }
        assert!(!staging.exists());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn validates_cuda_runtime_presence_and_x64_architecture() {
        let temp = TempDir::new("cuda-runtime-validation");
        assert!(validate_cuda_runtime_files(temp.path()).is_err());

        let directory = cuda_runtime_root(temp.path()).join("lib");
        fs::create_dir_all(&directory).unwrap();
        for name in cuda_runtime_library_names() {
            fs::write(directory.join(name), b"incomplete").unwrap();
        }
        let error = validate_cuda_runtime_files(temp.path()).unwrap_err();
        assert!(error.contains("ELF x64"));

        let mut valid_elf = vec![0_u8; 64];
        valid_elf[0..4].copy_from_slice(b"\x7fELF");
        valid_elf[4] = 2;
        valid_elf[18..20].copy_from_slice(&62_u16.to_le_bytes());
        for name in cuda_runtime_library_names() {
            fs::write(directory.join(name), &valid_elf).unwrap();
        }
        assert!(validate_cuda_runtime_files(temp.path()).is_ok());
        assert!(cuda_runtime_installed(temp.path()));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn swaps_runtime_with_backup_and_recovers_previous_installation() {
        let temp = TempDir::new("cuda-runtime-transaction");
        let destination = cuda_runtime_root(temp.path());
        let mut valid_elf = vec![0_u8; 64];
        valid_elf[0..4].copy_from_slice(b"\x7fELF");
        valid_elf[4] = 2;
        valid_elf[18..20].copy_from_slice(&62_u16.to_le_bytes());
        let write_runtime = |root: &Path| {
            let directory = root.join("lib");
            fs::create_dir_all(&directory).unwrap();
            for name in cuda_runtime_library_names() {
                fs::write(directory.join(name), &valid_elf).unwrap();
            }
        };
        write_runtime(&destination);
        let staging = destination.with_extension("installing");
        write_runtime(&staging);

        let backup = swap_cuda_runtime(temp.path(), &staging).unwrap().unwrap();
        assert!(validate_cuda_runtime_root(&destination).is_ok());
        assert!(validate_cuda_runtime_root(&backup).is_ok());

        restore_cuda_runtime_backup(temp.path(), &backup).unwrap();
        assert!(validate_cuda_runtime_root(&destination).is_ok());
        assert!(!backup.exists());

        let stale_backup = destination.with_extension("backup-crash");
        fs::rename(&destination, &stale_backup).unwrap();
        fs::create_dir_all(destination.join("lib")).unwrap();
        fs::write(destination.join("lib").join("partial"), b"incomplete").unwrap();
        recover_cuda_runtime_transaction(temp.path()).unwrap();
        assert!(validate_cuda_runtime_root(&destination).is_ok());
        assert!(!stale_backup.exists());
    }

    #[test]
    fn normalizes_download_progress_and_process_errors() {
        assert_eq!(youtube_download_percent("download: 42.5%"), Some(42.5));
        assert_eq!(youtube_download_percent("other output"), None);
        assert_eq!(youtube_download_percent("download: 200%"), Some(100.0));
        let error = yt_dlp_process_error("Falha", b"linha 1\nlinha 2", b"");
        assert_eq!(error, "Falha Detalhes: linha 1 linha 2");
    }

    #[test]
    fn rejects_invalid_worker_responses_before_accepting_done() {
        assert!(parse_worker_output("not-json").is_err());
        assert!(parse_worker_output(r#"{"type":"done"}"#).is_err());
        assert!(parse_worker_output(r#"{"type":"done","stems":{}}"#).is_err());
        assert!(parse_worker_output(r#"{"type":"done","stems":"invalid"}"#).is_err());
        assert!(parse_worker_output(r#"{"type":"progress"}"#).is_err());
        assert!(parse_worker_output(r#"{"type":"progress","progress":"invalid"}"#).is_err());
        assert!(parse_worker_output(r#"{"type":"unknown"}"#).is_err());
        assert_eq!(
            parse_worker_output(r#"{"type":"error","message":"worker failed"}"#).unwrap_err(),
            "worker failed"
        );

        match parse_worker_output(r#"{"type":"done","stems":{"vocals":"/tmp/vocals.wav"}}"#)
            .unwrap()
        {
            WorkerOutput::Done(stems) => {
                assert_eq!(
                    stems.get("vocals").map(String::as_str),
                    Some("/tmp/vocals.wav")
                );
            }
            WorkerOutput::Progress(_) => panic!("expected done output"),
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn worker_reader_rejects_eof_and_invalid_sequences() {
        for input in [
            "",
            "not-json\n",
            "{\"type\":\"done\"}\n",
            "{\"type\":\"error\",\"message\":\"failed\"}\n",
        ] {
            let mut lines = BufReader::new(input.as_bytes()).lines();
            assert!(read_worker_output(&mut lines, |_| {}).await.is_err());
        }

        let input = concat!(
            "{\"type\":\"progress\",\"progress\":{\"provider\":\"cpu\"}}\n",
            "{\"type\":\"done\",\"stems\":{\"vocals\":\"/tmp/vocals.wav\"}}\n"
        );
        let mut lines = BufReader::new(input.as_bytes()).lines();
        let (stems, provider) = read_worker_output(&mut lines, |_| {}).await.unwrap();
        assert_eq!(provider.as_deref(), Some("cpu"));
        assert!(stems.contains_key("vocals"));
    }

    #[test]
    fn worker_child_fixture() {
        if std::env::var_os("GRIFFIN_TEST_ORPHAN_WORKER").is_some() {
            std::thread::sleep(Duration::from_secs(30));
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn terminate_worker_kills_process_and_removes_registration() {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "commands::tests::worker_child_fixture"])
            .env("GRIFFIN_TEST_ORPHAN_WORKER", "1")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = Arc::new(Mutex::new(command.spawn().unwrap()));
        let workers = tokio::sync::Mutex::new(std::collections::HashMap::from([(
            String::from("track-1"),
            Arc::clone(&child),
        )]));

        terminate_worker(&workers, "track-1", &child).await;

        assert!(workers.lock().await.is_empty());
        assert!(child.lock().await.try_wait().unwrap().is_some());
    }

    #[test]
    fn youtube_process_fixture() {
        if std::env::var_os("GRIFFIN_TEST_YOUTUBE_PROCESS").is_some() {
            println!("download: 12.5%");
            std::thread::sleep(Duration::from_secs(30));
        }
    }

    #[tokio::test(flavor = "current_thread")]
    async fn youtube_process_registry_terminates_fake_download() {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "commands::tests::youtube_process_fixture"])
            .env("GRIFFIN_TEST_YOUTUBE_PROCESS", "1")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let processes = tokio::sync::Mutex::new(HashMap::new());
        let process =
            register_youtube_process(&processes, "preview-1", command.spawn().unwrap()).await;

        assert!(processes.lock().await.contains_key("preview-1"));
        terminate_youtube_process(&process).await.unwrap();
        unregister_youtube_process(&processes, "preview-1", &process).await;

        assert!(processes.lock().await.is_empty());
        assert!(process.lock().await.try_wait().unwrap().is_some());
    }

    #[test]
    fn guards_release_active_state_when_dropped() {
        let active = std::sync::Mutex::new(HashSet::from([String::from("track-1")]));
        {
            let _guard = SeparationGuard {
                active: &active,
                track_id: "track-1".into(),
            };
        }
        assert!(active.lock().unwrap().is_empty());

        let installing = Arc::new(std::sync::Mutex::new(true));
        {
            let _guard = InstallingFlagGuard(installing.clone());
        }
        assert!(!*installing.lock().unwrap());

        let downloading = Arc::new(std::sync::Mutex::new(Some(String::from("models"))));
        {
            let _guard = DownloadingFlagGuard(downloading.clone());
        }
        assert!(downloading.lock().unwrap().is_none());
    }

    #[test]
    fn shares_one_lock_between_local_and_remote_separations() {
        let active = std::sync::Mutex::new(HashSet::new());
        let local = acquire_separation(&active, "track-1".into()).unwrap();
        assert!(acquire_separation(&active, "track-1".into()).is_err());
        assert!(acquire_separation(&active, "track-2".into()).is_ok());
        drop(local);
        assert!(acquire_separation(&active, "track-1".into()).is_ok());

        let remote = acquire_separation(&active, "track-3".into()).unwrap();
        assert!(acquire_separation(&active, "track-3".into()).is_err());
        drop(remote);
        assert!(acquire_separation(&active, "track-3".into()).is_ok());
    }

    #[test]
    fn refuses_cache_cleanup_during_local_or_remote_separation() {
        for track_id in ["local-track", "remote-track"] {
            let active = std::sync::Mutex::new(HashSet::from([track_id.to_string()]));
            let error = ensure_cache_clear_allowed(&active).unwrap_err();
            assert!(error.contains("separações ativas"));
        }
        assert!(ensure_cache_clear_allowed(&std::sync::Mutex::new(HashSet::new())).is_ok());
    }

    #[test]
    fn expires_remote_previews_and_bounds_their_count() {
        let state = AppState::default();
        let temp = TempDir::new("remote-preview-cleanup");
        let stale_path = temp.path().join("remote-preview-stale.wav");
        fs::write(&stale_path, b"stale").unwrap();
        let stale_created_at = Instant::now()
            .checked_sub(REMOTE_PREVIEW_TTL + Duration::from_secs(1))
            .unwrap();
        state.remote_assets.lock().unwrap().insert(
            "stale".into(),
            RemoteAsset {
                path: stale_path.clone(),
                format: "wav".into(),
                created_at: stale_created_at,
            },
        );
        state.youtube_previews.lock().unwrap().insert(
            "stale-youtube".into(),
            YoutubePreview {
                url: "https://youtube.test/video".into(),
                title: "Stale".into(),
                created_at: stale_created_at,
            },
        );
        for index in 0..=MAX_REMOTE_PREVIEWS {
            state.youtube_previews.lock().unwrap().insert(
                format!("fresh-{index}"),
                YoutubePreview {
                    url: "https://youtube.test/video".into(),
                    title: format!("Fresh {index}"),
                    created_at: Instant::now(),
                },
            );
        }

        cleanup_remote_preview_state(&state).unwrap();

        assert!(!stale_path.exists());
        assert!(!state.remote_assets.lock().unwrap().contains_key("stale"));
        let previews = state.youtube_previews.lock().unwrap();
        assert!(!previews.contains_key("stale-youtube"));
        assert_eq!(previews.len(), MAX_REMOTE_PREVIEWS);
    }

    #[test]
    fn cancellation_flag_guard_removes_finished_operation_state() {
        let cancelled = Arc::new(std::sync::Mutex::new(HashSet::from([String::from("job")])));
        {
            let _guard = CancellationFlagGuard {
                cancelled: Arc::clone(&cancelled),
                id: "job".into(),
            };
        }
        assert!(cancelled.lock().unwrap().is_empty());
    }

    #[test]
    fn moves_old_cache_before_recreating_it() {
        let temp = TempDir::new("cache-cleanup");
        let cache = temp.path().join("stems");
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("in-progress.wav"), b"partial").unwrap();

        clear_cache_directory(&cache).unwrap();

        assert!(cache.is_dir());
        assert!(!cache.join("in-progress.wav").exists());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn cache_cleanup_gate_rejects_concurrent_operation() {
        let state = AppState::default();
        let _read = state.separation_cache_gate.read().await;
        assert!(state.separation_cache_gate.try_write().is_err());
    }

    #[test]
    fn detects_standard_model_layouts() {
        let temp = TempDir::new("models");
        assert!(!model_installation_status(temp.path()).0);
        let model = temp.path().join("htdemucs.onnx");
        fs::write(&model, b"model").unwrap();
        assert!(!model_installation_status(temp.path()).0);
        assert!(model_file_matches_hash(
            &model,
            "9372c470eeadd5ecd9c3c74c2b3cb633f8e2f2fad799250a0f70d652b6b825e4"
        ));
    }

    #[test]
    fn removes_model_directory_after_download_failure() {
        let temp = TempDir::new("failed-model-download");
        let models = temp.path().join("models");
        fs::create_dir_all(models.join("htdemucs-ft")).unwrap();
        fs::write(models.join("htdemucs.onnx.download"), b"partial").unwrap();
        fs::write(models.join("htdemucs-ft").join("partial.onnx"), b"partial").unwrap();

        let error = cleanup_models_after_download_failure(&models, "download failed".into());

        assert_eq!(error, "download failed");
        assert!(!models.exists());
    }

    #[test]
    fn cache_component_is_stable_and_bounded() {
        let first = cache_component("track-1");
        assert_eq!(first, cache_component("track-1"));
        assert_eq!(first.len(), 24);
        assert_ne!(first, cache_component("track-2"));
    }
}

const ANALYSIS_RATE: u32 = 11_025;
const ANALYSIS_MAX_SECONDS: usize = 60;
const MAJOR_PROFILE: [f64; 12] = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const MINOR_PROFILE: [f64; 12] = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];
const NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

fn analyze_audio(path: &Path) -> Result<TrackAnalysis, String> {
    let samples = decode_analysis_audio(path)?;
    Ok(TrackAnalysis {
        bpm: detect_bpm(&samples),
        key: detect_key(&samples),
        tuning_hz: detect_tuning(&samples),
        confidence: estimate_analysis_confidence(&samples),
        sections: Some(detect_sections(&samples)),
        chords: Some(detect_chords(&samples)),
    })
}

fn decode_analysis_audio(path: &Path) -> Result<Vec<f32>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    let source = MediaSourceStream::new(Box::new(file), Default::default());
    let probe = get_probe()
        .format(
            &hint,
            source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| e.to_string())?;
    let mut format = probe.format;
    let track = format
        .default_track()
        .ok_or_else(|| "Nenhuma faixa de áudio encontrada.".to_string())?;
    let source_rate = track.codec_params.sample_rate.unwrap_or(ANALYSIS_RATE);
    let max_source_samples = source_rate as usize * ANALYSIS_MAX_SECONDS;
    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| e.to_string())?;
    let mut mono = Vec::with_capacity((ANALYSIS_RATE as usize) * ANALYSIS_MAX_SECONDS);
    while let Ok(packet) = format.next_packet() {
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                let channels = spec.channels.count().max(1);
                let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                samples.copy_interleaved_ref(decoded);
                for frame in samples.samples().chunks(channels) {
                    let sum: f32 = frame.iter().copied().sum();
                    mono.push(sum / channels as f32);
                    if mono.len() >= max_source_samples {
                        break;
                    }
                }
                if mono.len() >= max_source_samples {
                    break;
                }
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    if source_rate == ANALYSIS_RATE {
        mono.truncate(ANALYSIS_RATE as usize * ANALYSIS_MAX_SECONDS);
        return Ok(mono);
    }
    if mono.is_empty() {
        return Err("O arquivo de áudio está vazio.".into());
    }
    let output_length = ((mono.len() as u64 * ANALYSIS_RATE as u64) / source_rate as u64)
        .min((ANALYSIS_RATE as usize * ANALYSIS_MAX_SECONDS) as u64)
        as usize;
    Ok((0..output_length)
        .map(|index| {
            let source = ((index as u64 * source_rate as u64) / ANALYSIS_RATE as u64) as usize;
            mono[source.min(mono.len().saturating_sub(1))]
        })
        .collect())
}

fn detect_bpm(samples: &[f32]) -> f64 {
    let hop = 256usize;
    let frame = 512usize;
    let mut envelope = Vec::new();
    let mut previous = 0.0f64;
    let mut start = 0usize;
    while start + frame < samples.len() {
        let energy: f64 = samples[start..start + frame]
            .iter()
            .map(|sample| (*sample as f64).powi(2))
            .sum();
        let rms = (energy / frame as f64).sqrt();
        envelope.push((rms - previous).max(0.0));
        previous = rms;
        start += hop;
    }
    if envelope.len() < 8 {
        return 120.0;
    }
    let samples_per_beat = ANALYSIS_RATE as f64 / hop as f64;
    let mut best_bpm = 120;
    let mut best_score = f64::NEG_INFINITY;
    for bpm in 60..=180 {
        let lag = ((60.0 / bpm as f64) * samples_per_beat).round().max(1.0) as usize;
        let score: f64 = envelope
            .iter()
            .enumerate()
            .skip(lag)
            .map(|(index, value)| value * envelope[index - lag])
            .sum();
        if score > best_score {
            best_score = score;
            best_bpm = bpm;
        }
    }
    best_bpm as f64
}

fn detect_key(samples: &[f32]) -> String {
    let frame = 4096usize;
    let limit = samples.len().min(ANALYSIS_RATE as usize * 30);
    let mut chroma = [0.0f64; 12];
    let mut start = 0usize;
    while start + frame < limit {
        for midi in 36..=84 {
            let frequency = 440.0 * 2f64.powf((midi as f64 - 69.0) / 12.0);
            chroma[midi as usize % 12] += goertzel(samples, start, frame, frequency);
        }
        start += frame;
    }
    let total: f64 = chroma.iter().sum();
    if total == 0.0 {
        return "C maior".into();
    }
    let mut best_score = f64::NEG_INFINITY;
    let mut best = "C maior".to_string();
    for tonic in 0..12 {
        for (mode, profile) in [("maior", &MAJOR_PROFILE), ("menor", &MINOR_PROFILE)] {
            let score: f64 = (0..12)
                .map(|offset| chroma[(tonic + offset) % 12] * profile[offset])
                .sum();
            if score > best_score {
                best_score = score;
                best = format!("{} {mode}", NOTE_NAMES[tonic]);
            }
        }
    }
    best
}

fn detect_tuning(samples: &[f32]) -> f64 {
    let limit = samples.len().min(ANALYSIS_RATE as usize * 20);
    let mut best_frequency = 440.0;
    let mut best_energy = 0.0;
    for frequency in 430..=450 {
        let energy = goertzel(samples, 0, limit, frequency as f64);
        if energy > best_energy {
            best_energy = energy;
            best_frequency = frequency as f64;
        }
    }
    best_frequency
}

fn goertzel(samples: &[f32], start: usize, size: usize, frequency: f64) -> f64 {
    let coefficient = 2.0 * (2.0 * std::f64::consts::PI * frequency / ANALYSIS_RATE as f64).cos();
    let mut previous = 0.0;
    let mut previous_previous = 0.0;
    let end = samples.len().min(start.saturating_add(size));
    for sample in &samples[start.min(end)..end] {
        let current = *sample as f64 + coefficient * previous - previous_previous;
        previous_previous = previous;
        previous = current;
    }
    previous_previous.powi(2) + previous.powi(2) - coefficient * previous * previous_previous
}

fn estimate_analysis_confidence(samples: &[f32]) -> f64 {
    let energy: f64 = samples.iter().map(|sample| (*sample as f64).powi(2)).sum();
    ((energy / samples.len().max(1) as f64).sqrt() * 8.0).clamp(0.0, 1.0)
}

fn detect_sections(samples: &[f32]) -> Vec<TrackSection> {
    if samples.is_empty() {
        return Vec::new();
    }
    let window = (samples.len() / 12).max(1);
    let energies: Vec<f64> = samples
        .chunks(window)
        .map(|chunk| {
            (chunk
                .iter()
                .map(|sample| (*sample as f64).powi(2))
                .sum::<f64>()
                / chunk.len() as f64)
                .sqrt()
        })
        .collect();
    let peak = energies.iter().copied().fold(0.001, f64::max);
    let mut boundaries = vec![0.0];
    for index in 1..energies.len() {
        let change = (energies[index] - energies[index - 1]).abs() / peak;
        let position = index as f64 / energies.len() as f64;
        if change > 0.18 && position - boundaries.last().copied().unwrap_or(0.0) >= 0.08 {
            boundaries.push(position);
        }
    }
    if boundaries.len() < 3 {
        boundaries.extend([0.25, 0.5, 0.75]);
    }
    boundaries.push(1.0);
    boundaries.sort_by(|left, right| left.total_cmp(right));
    boundaries.dedup_by(|left, right| (*left - *right).abs() < f64::EPSILON);
    let highest = energies
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| left.total_cmp(right))
        .map(|(index, _)| index)
        .unwrap_or(0);
    boundaries
        .windows(2)
        .enumerate()
        .map(|(index, range)| {
            let segment = ((range[0] * energies.len() as f64) as usize).min(energies.len() - 1);
            let name = if index == 0 {
                "Intro"
            } else if segment == highest {
                "Refrão"
            } else if index == boundaries.len() - 2 {
                "Outro"
            } else if index % 2 == 0 {
                "Verso"
            } else {
                "Ponte"
            };
            TrackSection {
                id: format!("section-{}", index + 1),
                name: name.into(),
                start: range[0].clamp(0.0, 1.0),
                end: range[1].clamp(0.0, 1.0),
                confidence: 0.55,
            }
        })
        .collect()
}

fn detect_chords(samples: &[f32]) -> Vec<ChordEvent> {
    let window = ANALYSIS_RATE as usize * 4;
    let mut chords: Vec<ChordEvent> = Vec::new();
    for (index, chunk) in samples.chunks(window).enumerate() {
        let start = index * window;
        let chroma = calculate_chroma(chunk);
        let (name, confidence) = classify_chord(&chroma);
        let start_position = start as f64 / samples.len().max(1) as f64;
        let end_position = (start + chunk.len()) as f64 / samples.len().max(1) as f64;
        if let Some(previous) = chords.last_mut() {
            if previous.name == name {
                previous.end = end_position;
                continue;
            }
        }
        chords.push(ChordEvent {
            id: format!("chord-{}", chords.len() + 1),
            name,
            start: start_position,
            end: end_position,
            confidence,
        });
    }
    chords
}

fn calculate_chroma(samples: &[f32]) -> [f64; 12] {
    let mut chroma = [0.0f64; 12];
    for midi in 36..=84 {
        let frequency = 440.0 * 2f64.powf((midi as f64 - 69.0) / 12.0);
        chroma[midi as usize % 12] += goertzel(samples, 0, samples.len(), frequency);
    }
    let total: f64 = chroma.iter().sum();
    if total > 0.0 {
        chroma.iter_mut().for_each(|value| *value /= total);
    }
    chroma
}

fn classify_chord(chroma: &[f64; 12]) -> (String, f64) {
    let mut best_score = f64::NEG_INFINITY;
    let mut best_name = "C maior".to_string();
    for tonic in 0..12 {
        for (mode, profile) in [("maior", &MAJOR_PROFILE), ("menor", &MINOR_PROFILE)] {
            let score: f64 = (0..12)
                .map(|offset| chroma[(tonic + offset) % 12] * profile[offset])
                .sum();
            if score > best_score {
                best_score = score;
                best_name = format!("{} {mode}", NOTE_NAMES[tonic]);
            }
        }
    }
    (best_name, (best_score / 6.0).clamp(0.0, 1.0))
}

fn default_analysis() -> TrackAnalysis {
    TrackAnalysis {
        bpm: 120.0,
        key: "C maior".into(),
        tuning_hz: 440.0,
        confidence: 0.0,
        sections: None,
        chords: None,
    }
}
fn model_file_matches_hash(path: &Path, expected_hash: &str) -> bool {
    path.is_file() && sha256_file(path).ok().as_deref() == Some(expected_hash)
}

fn model_file_is_valid(path: &Path, file_name: &str) -> bool {
    model_sha256(file_name)
        .is_some_and(|expected_hash| model_file_matches_hash(path, expected_hash))
}

fn model_installation_status(models: &Path) -> (bool, bool) {
    let standard = model_file_is_valid(&models.join("htdemucs.onnx"), "htdemucs.onnx")
        || CORE_STEMS.iter().all(|stem| {
            let file_name = format!("htdemucs_ft_{stem}_fp16weights.onnx");
            model_file_is_valid(&models.join("htdemucs-ft").join(&file_name), &file_name)
        });
    let extended = model_file_is_valid(&models.join("htdemucs_6s.onnx"), "htdemucs_6s.onnx");
    (standard, extended)
}

fn mix_wav<F: FnMut() -> Result<(), String>>(
    selected: &[(&str, String)],
    options: &AudioExportOptions,
    destination: &Path,
    check_cancelled: &mut F,
) -> Result<f64, String> {
    let mut mixed: Vec<f32> = Vec::new();
    let sample_rate = options.sample_rate.max(1);
    let mut frames = usize::MAX;
    for (stem, path) in selected {
        check_cancelled()?;
        let mut reader = hound::WavReader::open(path)
            .map_err(|e| format!("Não foi possível ler o stem {stem}: {e}"))?;
        let spec = reader.spec();
        let channels = spec.channels.max(1) as usize;
        let values: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Float => reader
                .samples::<f32>()
                .collect::<Result<_, _>>()
                .map_err(|e| e.to_string())?,
            hound::SampleFormat::Int => {
                let scale = 2.0f32.powi(spec.bits_per_sample.saturating_sub(1) as i32);
                reader
                    .samples::<i32>()
                    .map(|sample| sample.map(|value| value as f32 / scale))
                    .collect::<Result<_, _>>()
                    .map_err(|e| e.to_string())?
            }
        };
        let source_left: Vec<f32> = values.iter().step_by(channels).copied().collect();
        let source_right: Vec<f32> = if channels > 1 {
            values.iter().skip(1).step_by(channels).copied().collect()
        } else {
            source_left.clone()
        };
        let left = resample_channel(&source_left, spec.sample_rate, sample_rate);
        let right = resample_channel(&source_right, spec.sample_rate, sample_rate);
        let stem_frames = left.len().min(right.len());
        let mut left = left;
        let mut right = right;
        if let Some(gains) = options.equalizer.get(*stem) {
            apply_equalizer(&mut left, &mut right, gains, sample_rate);
        }
        frames = frames.min(stem_frames);
        if mixed.is_empty() {
            mixed.resize(stem_frames * 2, 0.0);
        }
        let volume = options
            .volumes
            .get(*stem)
            .copied()
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);
        let pan = if options.routes.get(*stem).map(String::as_str) == Some("left") {
            -1.0
        } else if options.routes.get(*stem).map(String::as_str) == Some("right") {
            1.0
        } else {
            options
                .pans
                .get(*stem)
                .copied()
                .unwrap_or(0.0)
                .clamp(-1.0, 1.0)
        };
        let angle = (pan + 1.0) * std::f64::consts::PI / 4.0;
        for frame in 0..stem_frames {
            if frame % 8192 == 0 {
                check_cancelled()?;
            }
            mixed[frame * 2] += left[frame] * volume as f32 * angle.cos() as f32;
            mixed[frame * 2 + 1] += right[frame] * volume as f32 * angle.sin() as f32;
        }
        drop(values);
        drop(source_left);
        drop(source_right);
        drop(left);
        drop(right);
    }
    if frames == 0 || mixed.is_empty() {
        return Err("Os stems selecionados estão vazios.".into());
    }
    let start = (options
        .loop_range
        .as_ref()
        .map(|range| range.start)
        .unwrap_or(0.0)
        .clamp(0.0, 1.0)
        * frames as f64) as usize;
    let end = ((options
        .loop_range
        .as_ref()
        .map(|range| range.end)
        .unwrap_or(1.0)
        .clamp(0.0, 1.0)
        * frames as f64)
        .ceil() as usize)
        .max(start + 1)
        .min(frames);
    let processed = if start == 0
        && end == frames
        && options.pitch == 0.0
        && (options.tempo - 1.0).abs() < f64::EPSILON
    {
        mixed
    } else {
        apply_pitch_and_tempo(
            &mixed[start * 2..end * 2],
            end.saturating_sub(start),
            sample_rate,
            options.pitch,
            options.tempo,
            check_cancelled,
        )?
    };
    let spec = hound::WavSpec {
        channels: 2,
        sample_rate,
        bits_per_sample: options.bit_depth,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(destination, spec).map_err(|e| e.to_string())?;
    let output_scale = ((1u64 << options.bit_depth.saturating_sub(1)) - 1) as f32;
    for (frame, channels) in processed.chunks_exact(2).enumerate() {
        if frame % 8192 == 0 {
            check_cancelled()?;
        }
        let left = (channels[0].clamp(-1.0, 1.0) * output_scale) as i32;
        let right = (channels[1].clamp(-1.0, 1.0) * output_scale) as i32;
        writer.write_sample(left).map_err(|e| e.to_string())?;
        writer.write_sample(right).map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())?;
    Ok((processed.len() / 2) as f64 / sample_rate as f64)
}

/// Bounded native pitch/tempo processing for exported audio.
///
/// Pitch is shifted with a linear resampler and the resulting signal is
/// brought back to the requested duration with a Hann-window overlap/add
/// stretcher. It intentionally keeps a small, fixed processing window so an
/// export does not create a second full-size SoundTouch/JS runtime buffer.
fn apply_pitch_and_tempo<F: FnMut() -> Result<(), String>>(
    input: &[f32],
    input_frames: usize,
    sample_rate: u32,
    pitch: f64,
    tempo: f64,
    check_cancelled: &mut F,
) -> Result<Vec<f32>, String> {
    let normalized_pitch = pitch.clamp(-12.0, 12.0);
    let normalized_tempo = if tempo.is_finite() {
        tempo.clamp(0.5, 1.5)
    } else {
        1.0
    };
    if normalized_pitch == 0.0 && (normalized_tempo - 1.0).abs() < f64::EPSILON {
        return Ok(input.to_vec());
    }
    let pitch_rate = 2.0f64.powf(normalized_pitch / 12.0);
    let pitched = resample_interleaved(input, input_frames, pitch_rate, check_cancelled)?;
    let target_frames = ((input_frames as f64 / normalized_tempo).round() as usize).max(1);
    if pitched.len() / 2 == target_frames {
        return Ok(pitched);
    }
    stretch_interleaved(
        &pitched,
        pitched.len() / 2,
        target_frames,
        sample_rate,
        check_cancelled,
    )
}

fn resample_interleaved<F: FnMut() -> Result<(), String>>(
    input: &[f32],
    input_frames: usize,
    rate: f64,
    check_cancelled: &mut F,
) -> Result<Vec<f32>, String> {
    let output_frames = ((input_frames as f64 / rate).round() as usize).max(1);
    let mut output = vec![0.0; output_frames * 2];
    for frame in 0..output_frames {
        if frame % 8192 == 0 {
            check_cancelled()?;
        }
        let source = frame as f64 * rate;
        let lower = source.floor() as usize;
        let upper = (lower + 1).min(input_frames.saturating_sub(1));
        let fraction = (source - lower as f64) as f32;
        let lower = lower.min(input_frames.saturating_sub(1));
        for channel in 0..2 {
            let first = input[lower * 2 + channel];
            let second = input[upper * 2 + channel];
            output[frame * 2 + channel] = first + (second - first) * fraction;
        }
    }
    Ok(output)
}

fn stretch_interleaved<F: FnMut() -> Result<(), String>>(
    input: &[f32],
    input_frames: usize,
    target_frames: usize,
    sample_rate: u32,
    check_cancelled: &mut F,
) -> Result<Vec<f32>, String> {
    const CHANNELS: usize = 2;
    let window = ((sample_rate as f64 * 0.046) as usize).clamp(512, 4096);
    let window = window - (window % 2);
    let synthesis_hop = (window / 2).max(1);
    let ratio = target_frames as f64 / input_frames.max(1) as f64;
    let mut output = vec![0.0f32; target_frames * CHANNELS];
    let mut weights = vec![0.0f32; target_frames];
    let mut output_start = 0usize;
    while output_start < target_frames {
        check_cancelled()?;
        let source_start =
            ((output_start as f64 / ratio).round() as usize).min(input_frames.saturating_sub(1));
        let available = window.min(input_frames.saturating_sub(source_start));
        for offset in 0..window {
            let output_frame = output_start + offset;
            if output_frame >= target_frames {
                break;
            }
            let weight = if window <= 1 {
                1.0
            } else {
                0.5 - 0.5 * (2.0 * std::f64::consts::PI * offset as f64 / (window - 1) as f64).cos()
            } as f32;
            let source_frame = source_start + offset.min(available.saturating_sub(1));
            if available == 0 {
                continue;
            }
            for channel in 0..CHANNELS {
                output[output_frame * CHANNELS + channel] +=
                    input[source_frame * CHANNELS + channel] * weight;
            }
            weights[output_frame] += weight;
        }
        output_start = output_start.saturating_add(synthesis_hop);
    }
    for frame in 0..target_frames {
        if frame % 8192 == 0 {
            check_cancelled()?;
        }
        if weights[frame] > 1e-6 {
            for channel in 0..CHANNELS {
                output[frame * CHANNELS + channel] /= weights[frame];
            }
        }
    }
    Ok(output)
}

fn export_is_cancelled(
    cancelled: &Arc<std::sync::Mutex<HashSet<String>>>,
    request_id: &str,
) -> Result<(), String> {
    if cancelled
        .lock()
        .map_err(lock_error)?
        .contains(request_id)
    {
        Err("Exportação cancelada.".into())
    } else {
        Ok(())
    }
}

fn clear_export_cancelled(
    cancelled: &Arc<std::sync::Mutex<HashSet<String>>>,
    request_id: &str,
) {
    if let Ok(mut cancelled) = cancelled.lock() {
        cancelled.remove(request_id);
    }
}

fn export_progress(app: &AppHandle, request_id: &str, progress: f64, stage: &str) {
    let _ = app.emit(
        "export:progress",
        serde_json::json!({ "requestId": request_id, "progress": progress.clamp(0.0, 1.0), "stage": stage }),
    );
}

fn resample_channel(input: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if input.is_empty() || source_rate == target_rate {
        return input.to_vec();
    }
    let length = ((input.len() as u64 * target_rate as u64) / source_rate as u64) as usize;
    (0..length)
        .map(|index| {
            let source = (index as f64 * source_rate as f64 / target_rate as f64) as usize;
            input[source.min(input.len() - 1)]
        })
        .collect()
}

fn apply_equalizer(left: &mut [f32], right: &mut [f32], gains: &[f64], sample_rate: u32) {
    const FREQUENCIES: [f64; 12] = [
        32.0, 63.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 12000.0, 16000.0, 20000.0,
    ];
    for (index, frequency) in FREQUENCIES.into_iter().enumerate() {
        let gain = gains.get(index).copied().unwrap_or(0.0);
        if gain == 0.0 || frequency >= sample_rate as f64 / 2.0 {
            continue;
        }
        apply_peaking_filter(left, frequency, gain, sample_rate);
        apply_peaking_filter(right, frequency, gain, sample_rate);
    }
}

fn apply_peaking_filter(samples: &mut [f32], frequency: f64, gain_db: f64, sample_rate: u32) {
    let omega = 2.0 * std::f64::consts::PI * frequency / sample_rate as f64;
    let alpha = omega.sin() / 2.0;
    let amplitude = 10f64.powf(gain_db / 40.0);
    let b0 = 1.0 + alpha * amplitude;
    let b1 = -2.0 * omega.cos();
    let b2 = 1.0 - alpha * amplitude;
    let a0 = 1.0 + alpha / amplitude;
    let a1 = -2.0 * omega.cos();
    let a2 = 1.0 - alpha / amplitude;
    let mut x1 = 0.0;
    let mut x2 = 0.0;
    let mut y1 = 0.0;
    let mut y2 = 0.0;
    for sample in samples {
        let x0 = *sample as f64;
        let y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
        *sample = y0 as f32;
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;
    }
}
