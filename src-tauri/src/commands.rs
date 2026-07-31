use crate::{
    state::{
        load_stem_split_api_key, remove_stem_split_api_key, save_stem_split_api_key, AppState,
        RemoteAsset, YoutubePreview,
    },
    types::*,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufRead, BufReader as StdBufReader, Read},
    path::{Path, PathBuf},
    process::Command as StdCommand,
    process::Stdio,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
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
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::Mutex,
};
use uuid::Uuid;

const CORE_STEMS: [&str; 4] = ["vocals", "drums", "bass", "other"];
const ALL_STEMS: [&str; 6] = ["vocals", "drums", "bass", "other", "guitar", "piano"];

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
    let path = match file_path.or_else(pick_audio) {
        Some(value) => PathBuf::from(value),
        None => return Ok(None),
    };
    if !is_supported_audio(&path) {
        return Ok(None);
    }
    let path_string = path.to_string_lossy().to_string();
    let mut data = state.data.lock().map_err(lock_error)?;
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
    fs::read(file_path)
        .map(Response::new)
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn library_remove(state: State<'_, AppState>, track_id: String) -> Result<(), String> {
    let mut data = state.data.lock().map_err(lock_error)?;
    data.tracks.retain(|track| track.id != track_id);
    save_tracks_locked(&data)
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
pub fn library_preview_url(
    state: State<'_, AppState>,
    url: String,
) -> Result<serde_json::Value, String> {
    let url = validate_public_url(&url)?;
    let response = ureq::get(&url)
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
    let format = audio_extension(&url, &content_type)
        .ok_or_else(|| "A URL não aponta para WAV, MP3 ou FLAC suportado.".to_string())?;
    let id = Uuid::new_v4().to_string();
    let file_name = format!("remote-preview-{id}.{format}");
    let path = {
        let data = state.data.lock().map_err(lock_error)?;
        data.imports_dir.join(&file_name)
    };
    let mut reader = response.into_body().into_reader();
    let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;
    let size = match copy_with_limit(&mut reader, &mut file, 200 * 1024 * 1024) {
        Ok(size) => size,
        Err(error) => {
            let _ = fs::remove_file(&path);
            return Err(error);
        }
    };
    state.remote_assets.lock().map_err(lock_error)?.insert(
        id.clone(),
        RemoteAsset {
            path,
            format: format.to_string(),
        },
    );
    Ok(
        serde_json::json!({ "id": id, "url": url, "fileName": file_name, "format": format, "sizeBytes": size }),
    )
}
#[tauri::command]
pub fn library_import_url(state: State<'_, AppState>, asset_id: String) -> Result<Track, String> {
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
pub fn youtube_preview(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<serde_json::Value, String> {
    emit_youtube_progress(&app, "", 0.02, "downloading", "Consultando vídeo…");
    let url = validate_youtube_url(&url)?;
    let output = yt_dlp_command(&state)
        .args([
            "--dump-single-json",
            "--skip-download",
            "--no-playlist",
            &url,
        ])
        .args(yt_dlp_runtime_args())
        .output()
        .map_err(normalize_yt_dlp_error)?;
    if !output.status.success() {
        return Err(yt_dlp_process_error(
            "Não foi possível consultar o YouTube.",
            &output.stderr,
            &output.stdout,
        ));
    }
    let metadata: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "O YouTube não retornou metadados válidos.".to_string())?;
    let id = Uuid::new_v4().to_string();
    let title = metadata
        .get("title")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Áudio do YouTube")
        .to_string();
    let duration = metadata.get("duration").and_then(|value| value.as_f64());
    state.youtube_previews.lock().map_err(lock_error)?.insert(
        id.clone(),
        YoutubePreview {
            url: url.clone(),
            title: title.clone(),
        },
    );
    emit_youtube_progress(&app, &id, 1.0, "importing", "Vídeo encontrado.");
    Ok(
        serde_json::json!({ "id": id, "url": url, "title": title, "duration": duration, "format": "wav" }),
    )
}
#[tauri::command(rename_all = "camelCase")]
pub fn youtube_import(
    app: AppHandle,
    state: State<'_, AppState>,
    preview_id: String,
    fallback_url: Option<String>,
) -> Result<Track, String> {
    let preview = state
        .youtube_previews
        .lock()
        .map_err(lock_error)?
        .remove(&preview_id)
        .or_else(|| {
            fallback_url.map(|url| YoutubePreview {
                url,
                title: "Áudio do YouTube".into(),
            })
        })
        .ok_or_else(|| "A prévia do YouTube expirou. Consulte o link novamente.".to_string())?;
    let preview = YoutubePreview {
        url: validate_youtube_url(&preview.url)?,
        ..preview
    };
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
        .args(yt_dlp_runtime_args())
        .args(["--newline", "--progress-template", "download:%(progress._percent_str)s"])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(normalize_yt_dlp_error)?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Não foi possível acompanhar o download do YouTube.".to_string())?;
    let mut error_output = Vec::new();
    for line in StdBufReader::new(stderr).lines() {
        let line = line.map_err(|error| format!("Falha ao acompanhar o download: {error}"))?;
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
            error_output.extend_from_slice(line.as_bytes());
            error_output.push(b'\n');
        }
    }
    let status = child.wait().map_err(|error| format!("Falha ao finalizar o download: {error}"))?;
    if !status.success() {
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
        return Err("Não foi possível baixar o áudio do YouTube.".into());
    };
    let track = library_import(state, Some(path.to_string_lossy().to_string()))?
        .ok_or_else(|| "O áudio do YouTube não pôde ser importado.".to_string())
        ?;
    emit_youtube_progress(&app, &preview_id, 1.0, "importing", "Importação concluída.");
    Ok(track)
}
#[tauri::command]
pub fn youtube_cancel(state: State<'_, AppState>, preview_id: String) -> Result<(), String> {
    state
        .youtube_previews
        .lock()
        .map_err(lock_error)?
        .remove(&preview_id);
    Ok(())
}

#[tauri::command]
pub fn yt_dlp_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
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
    let version = StdCommand::new(&path)
        .arg("--version")
        .output()
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
pub fn yt_dlp_download(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    const DOWNLOAD_ID: &str = "yt-dlp";
    state
        .yt_dlp_cancelled
        .lock()
        .map_err(lock_error)?
        .remove(DOWNLOAD_ID);
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
    fs::create_dir_all(&tools_dir).map_err(|e| e.to_string())?;
    let temporary = destination.with_extension("download");
    let _ = app.emit("yt-dlp:progress", serde_json::json!({ "progress": 0.0, "stage": "downloading", "message": "Baixando yt-dlp…" }));
    let response = ureq::get(asset)
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
        if state
            .yt_dlp_cancelled
            .lock()
            .map_err(lock_error)?
            .contains(DOWNLOAD_ID)
        {
            return Err("Download do yt-dlp cancelado.".into());
        }
        let progress = expected
            .map(|total| (received as f64 / total.max(1) as f64).min(1.0))
            .unwrap_or(0.0);
        let _ = app.emit("yt-dlp:progress", serde_json::json!({ "progress": progress * 0.9, "stage": "downloading", "message": format!("Baixando yt-dlp · {}%", (progress * 100.0) as u32) }));
        Ok(())
    });
    if let Err(error) = copy_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    file.sync_all().map_err(|e| e.to_string())?;
    let expected_hash = download_checksum(checksum_asset, asset)?;
    let actual_hash = sha256_file(&temporary)?;
    if expected_hash != actual_hash {
        let _ = fs::remove_file(&temporary);
        return Err("A verificação de integridade do yt-dlp falhou.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn projects_create(state: State<'_, AppState>, name: String) -> Result<Project, String> {
    let mut data = state.data.lock().map_err(lock_error)?;
    let project = Project {
        id: Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        created_at: now(),
        updated_at: now(),
        track_ids: Vec::new(),
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
pub fn resources_clear_cache(state: State<'_, AppState>) -> Result<LocalResourcesSummary, String> {
    let data = state.data.lock().map_err(lock_error)?;
    if data.cache_dir.exists() {
        fs::remove_dir_all(&data.cache_dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&data.cache_dir).map_err(|e| e.to_string())?;
    Ok(LocalResourcesSummary {
        cache_path: data.cache_dir.to_string_lossy().to_string(),
        cache_bytes: 0,
        model_path: data.models_dir.to_string_lossy().to_string(),
        model_bytes: directory_size(&data.models_dir),
    })
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
pub fn separation_status(state: State<'_, AppState>) -> Result<SeparationStatus, String> {
    let data = state.data.lock().map_err(lock_error)?;
    let standard = standard_models_installed(&data.models_dir);
    let six = data.models_dir.join("htdemucs_6s.onnx").exists();
    Ok(SeparationStatus {
        available: standard || six,
        message: if standard || six {
            "Modelo ONNX nativo pronto.".into()
        } else {
            "Modelo ONNX não encontrado. Baixe-o em Preferências.".into()
        },
        provider: Some("cpu".into()),
        profile: Some("quality".into()),
        memory_bytes: Some(current_rss()),
        last_duration_ms: None,
        model_profile: Some(if six { "six-stem" } else { "four-stem" }.into()),
        six_stem_available: Some(six),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn separation_start(
    app: AppHandle,
    state: State<'_, AppState>,
    track: Track,
    target: Option<String>,
    provider: Option<String>,
) -> Result<Track, String> {
    if provider.as_deref() == Some("remote") {
        state
            .remote_cancelled
            .lock()
            .map_err(lock_error)?
            .remove(&track.id);
        let stems = separate_remote(&app, &state, &track, target.as_deref()).await?;
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
    let (models_dir, cache_dir) = {
        let data = state.data.lock().map_err(lock_error)?;
        (data.models_dir.clone(), data.cache_dir.clone())
    };
    if !state.workers.lock().await.is_empty() {
        return Err("Outra separação já está em andamento. Aguarde ela terminar para preservar a memória RAM.".into());
    }
    let track_id = track.id.clone();
    let request = serde_json::json!({ "type": "separate", "track": track.clone(), "target": target, "modelsDir": models_dir, "cacheDir": cache_dir });
    let mut child = Command::new(worker_path(&app))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Não foi possível iniciar o processo ONNX nativo: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(format!("{}\n", request).as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        stdin.shutdown().await.map_err(|e| e.to_string())?;
    }
    let child = Arc::new(Mutex::new(child));
    let mut workers = state.workers.lock().await;
    if !workers.is_empty() {
        let _ = child.lock().await.kill().await;
        return Err("Outra separação começou enquanto o worker era iniciado.".into());
    }
    workers.insert(track_id.clone(), child.clone());
    drop(workers);
    let stdout = child
        .lock()
        .await
        .stdout
        .take()
        .ok_or_else(|| "O worker ONNX não abriu a saída.".to_string())?;
    let mut lines = BufReader::new(stdout).lines();
    let mut stems: Option<Stems> = None;
    while let Some(line) = match lines.next_line().await {
        Ok(line) => line,
        Err(error) => {
            state.workers.lock().await.remove(&track_id);
            return Err(error.to_string());
        }
    } {
        let message: serde_json::Value = match serde_json::from_str(&line) {
            Ok(message) => message,
            Err(error) => {
                state.workers.lock().await.remove(&track_id);
                return Err(format!("Resposta inválida do worker ONNX: {error}"));
            }
        };
        match message.get("type").and_then(|value| value.as_str()) {
            Some("progress") => {
                if let Some(progress) = message.get("progress") {
                    let _ = app.emit("separation:progress", progress);
                }
            }
            Some("done") => {
                stems = serde_json::from_value(
                    message
                        .get("stems")
                        .cloned()
                        .ok_or_else(|| "O worker não retornou stems.".to_string())?,
                )
                .ok();
                break;
            }
            Some("error") => {
                state.workers.lock().await.remove(&track_id);
                return Err(message
                    .get("message")
                    .and_then(|value| value.as_str())
                    .unwrap_or("A separação ONNX falhou.")
                    .into());
            }
            _ => {}
        }
    }
    state.workers.lock().await.remove(&track_id);
    let mut data = state.data.lock().map_err(lock_error)?;
    let stored = data
        .tracks
        .iter_mut()
        .find(|item| item.id == track.id)
        .ok_or_else(|| "Faixa não encontrada na biblioteca.".to_string())?;
    let mut merged_stems = stored.stems.clone().unwrap_or_default();
    merged_stems.extend(stems.ok_or_else(|| "O worker ONNX terminou sem resultado.".to_string())?);
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
    let size = fs::metadata(&track.path).map_err(|e| e.to_string())?.len();
    if size > 100 * 1024 * 1024 {
        return Err("O arquivo excede o limite de 100 MB do StemSplit.".into());
    }
    let file_name = Path::new(&track.path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("audio.wav");
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let content_type = match extension.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        _ => "audio/wav",
    };
    let upload = remote_post_json(
        "https://stemsplit.io/api/v1/upload",
        &key,
        serde_json::json!({ "filename": file_name, "contentType": content_type }),
    )?;
    let upload_url = upload
        .get("uploadUrl")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "O StemSplit não retornou uma URL de upload.".to_string())?;
    let upload_key = upload
        .get("uploadKey")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "O StemSplit não retornou a chave de upload.".to_string())?;
    let audio = fs::read(&track.path).map_err(|e| e.to_string())?;
    ureq::put(upload_url)
        .header("Content-Type", content_type)
        .send(audio)
        .map_err(|error| format!("Falha ao enviar áudio para o StemSplit: {error}"))?;
    let job = remote_post_json(
        "https://stemsplit.io/api/v1/jobs",
        &key,
        serde_json::json!({ "uploadKey": upload_key, "fileName": file_name, "outputType": output_type, "quality": quality, "outputFormat": "WAV" }),
    )?;
    let job_id = job
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "O StemSplit não retornou o identificador do job.".to_string())?;
    let stem_names: Vec<&str> = match target {
        Some(stem) => vec![stem],
        None if output_type == "SIX_STEMS" => {
            vec!["vocals", "drums", "bass", "other", "guitar", "piano"]
        }
        None => vec!["vocals", "drums", "bass", "other"],
    };
    let output_dir = cache_dir.join(format!("{}-{}", track.id, target.unwrap_or("all")));
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    loop {
        if state
            .remote_cancelled
            .lock()
            .map_err(lock_error)?
            .contains(&track.id)
        {
            return Err("Separação cancelada.".into());
        }
        let status = remote_get_json(&format!("https://stemsplit.io/api/v1/jobs/{job_id}"), &key)?;
        let raw_status = status
            .get("status")
            .and_then(|value| value.as_str())
            .unwrap_or("");
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
                let response = ureq::get(url)
                    .call()
                    .map_err(|error| format!("Falha ao baixar o stem {stem}: {error}"))?;
                let path = output_dir.join(format!("{stem}.wav"));
                let mut reader = response.into_body().into_reader();
                let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;
                copy_with_limit(&mut reader, &mut file, 200 * 1024 * 1024)?;
                stems.insert(stem.to_string(), path.to_string_lossy().to_string());
            }
            let _ = app.emit(
                "separation:progress",
                serde_json::json!({ "trackId": track.id, "progress": 1.0, "stage": "Stems prontos" }),
            );
            return Ok(stems);
        }
        tokio::time::sleep(Duration::from_millis(2500)).await;
    }
}

fn remote_post_json(
    url: &str,
    key: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let response = ureq::post(url)
        .header("Authorization", format!("Bearer {key}"))
        .send_json(body)
        .map_err(|error| format!("Falha na API do StemSplit: {error}"))?;
    let text = response
        .into_body()
        .read_to_string()
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

fn remote_get_json(url: &str, key: &str) -> Result<serde_json::Value, String> {
    let response = ureq::get(url)
        .header("Authorization", format!("Bearer {key}"))
        .call()
        .map_err(|error| format!("Falha na API do StemSplit: {error}"))?;
    let text = response
        .into_body()
        .read_to_string()
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn separation_cancel(state: State<'_, AppState>, track_id: String) -> Result<(), String> {
    if let Some(child) = state.workers.lock().await.remove(&track_id) {
        let _ = child.lock().await.kill().await;
    }
    state
        .remote_cancelled
        .lock()
        .map_err(lock_error)?
        .insert(track_id);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn export_audio(
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
    if options.mode.as_deref() == Some("individual") {
        let mut paths = Vec::new();
        for (index, (stem, path)) in selected.into_iter().enumerate() {
            export_progress(
                &app,
                &request_id,
                index as f64 / options.stems.len().max(1) as f64,
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
            let mut check_cancelled = || export_is_cancelled(&state, &request_id);
            mix_wav(
                &[(stem, path)],
                &stem_options,
                &target,
                &mut check_cancelled,
            )?;
            paths.push(target.to_string_lossy().to_string());
        }
        export_progress(&app, &request_id, 1.0, "Arquivos individuais concluídos");
        clear_export_cancelled(&state, &request_id);
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
    let mut check_cancelled = || export_is_cancelled(&state, &request_id);
    let duration = mix_wav(&selected, &options, &path, &mut check_cancelled)?;
    export_progress(&app, &request_id, 1.0, "WAV exportado");
    clear_export_cancelled(&state, &request_id);
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
pub fn models_status(state: State<'_, AppState>) -> Result<ModelDownloadStatus, String> {
    let data = state.data.lock().map_err(lock_error)?;
    Ok(ModelDownloadStatus {
        standard_installed: standard_models_installed(&data.models_dir),
        extended_installed: data.models_dir.join("htdemucs_6s.onnx").is_file(),
        downloading: None,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn models_download(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: String,
) -> Result<(), String> {
    state
        .model_cancelled
        .lock()
        .map_err(lock_error)?
        .remove(&kind);
    let models_dir = state.data.lock().map_err(lock_error)?.models_dir.clone();
    fs::create_dir_all(models_dir.join("htdemucs-ft")).map_err(|e| e.to_string())?;
    let base = "https://huggingface.co/StemSplitio";
    let mut files = vec![(
        models_dir.join("htdemucs.onnx"),
        format!("{base}/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx"),
    )];
    for stem in CORE_STEMS {
        files.push((
            models_dir
                .join("htdemucs-ft")
                .join(format!("htdemucs_ft_{stem}_fp16weights.onnx")),
            format!(
                "{base}/htdemucs-ft-{stem}-onnx/resolve/main/htdemucs_ft_{stem}_fp16weights.onnx"
            ),
        ));
    }
    if kind == "extended" {
        files = vec![(
            models_dir.join("htdemucs_6s.onnx"),
            format!("{base}/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx"),
        )];
    }
    let total = files.len();
    for (index, (path, url)) in files.into_iter().enumerate() {
        if path.is_file() {
            continue;
        }
        let _ = app.emit(
            "models:progress",
            serde_json::json!({ "kind": kind, "progress": index as f64 / total.max(1) as f64, "stage": format!("Baixando {} ({}/{})", path.file_name().and_then(|value| value.to_str()).unwrap_or("modelo"), index + 1, total) }),
        );
        let response = ureq::get(url)
            .call()
            .map_err(|e| format!("Falha ao baixar modelo: {e}"))?;
        let expected = response
            .headers()
            .get("content-length")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok());
        let mut reader = response.into_body().into_reader();
        let temporary = path.with_extension("download");
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        let copy_result = copy_with_progress(&mut reader, &mut file, expected, |received| {
            if state
                .model_cancelled
                .lock()
                .map_err(lock_error)?
                .contains(&kind)
            {
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
        if let Err(error) = copy_result {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
        fs::rename(temporary, path).map_err(|e| e.to_string())?;
    }
    let _ = app.emit(
        "models:progress",
        serde_json::json!({ "kind": kind, "progress": 1.0, "stage": "Modelo instalado" }),
    );
    Ok(())
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
        .add_filter(&format.to_uppercase(), &[extension])
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
pub fn remote_provider_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let key = {
        let data = state.data.lock().map_err(lock_error)?;
        load_stem_split_api_key(&data.data_dir, &data.settings)
    };
    let Some(key) = key else {
        return Ok(
            serde_json::json!({ "configured": false, "verified": false, "message": "Nenhuma chave de API configurada." }),
        );
    };
    let response = ureq::get("https://stemsplit.io/api/v1/balance")
        .header("Authorization", format!("Bearer {key}"))
        .header("Accept", "application/json")
        .call();
    match response {
        Ok(response) => {
            let body_text = response.into_body().read_to_string().unwrap_or_default();
            let body: serde_json::Value = serde_json::from_str(&body_text).unwrap_or_default();
            let balance = body
                .get("balanceFormatted")
                .and_then(|value| value.as_str())
                .unwrap_or("saldo disponível");
            Ok(
                serde_json::json!({ "configured": true, "verified": true, "balanceFormatted": balance, "message": format!("Conectado ao StemSplit — saldo: {balance}.") }),
            )
        }
        Err(error) => Ok(serde_json::json!({
            "configured": true,
            "verified": false,
            "message": if error.to_string().contains("401") { "Chave de API inválida ou revogada." } else { "Não foi possível verificar a chave agora. Tente novamente." }
        })),
    }
}
#[tauri::command]
pub fn remote_provider_save_api_key(
    state: State<'_, AppState>,
    key: String,
) -> Result<serde_json::Value, String> {
    if key.trim().is_empty() {
        return Err("Informe uma chave de API válida.".into());
    }
    let data_dir = state.data.lock().map_err(lock_error)?.data_dir.clone();
    save_stem_split_api_key(&data_dir, key.trim())?;
    let mut data = state.data.lock().map_err(lock_error)?;
    data.settings.remove("stemSplitApiKey");
    save_settings_locked(&data)?;
    drop(data);
    remote_provider_status(state)
}
#[tauri::command]
pub fn remote_provider_clear_api_key(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let mut data = state.data.lock().map_err(lock_error)?;
    let data_dir = data.data_dir.clone();
    remove_stem_split_api_key(&data_dir)?;
    data.settings.remove("stemSplitApiKey");
    save_settings_locked(&data)?;
    drop(data);
    remote_provider_status(state)
}
#[tauri::command(rename_all = "camelCase")]
pub fn remote_provider_estimate_cost(
    state: State<'_, AppState>,
    track_id: String,
) -> Result<serde_json::Value, String> {
    let data = state.data.lock().map_err(lock_error)?;
    let duration = data
        .tracks
        .iter()
        .find(|track| track.id == track_id)
        .and_then(|track| track.duration)
        .unwrap_or(0.0);
    Ok(serde_json::json!({ "durationSeconds": duration, "estimatedUsd": duration / 60.0 * 0.1 }))
}

fn default_update_status() -> serde_json::Value {
    serde_json::json!({ "supported": false, "stage": "disabled", "message": "Atualizações automáticas não estão disponíveis nesta versão." })
}
#[tauri::command]
pub fn updates_status() -> Result<serde_json::Value, String> {
    Ok(default_update_status())
}
#[tauri::command]
pub fn updates_check() -> Result<serde_json::Value, String> {
    Ok(default_update_status())
}
#[tauri::command]
pub fn updates_download() -> Result<serde_json::Value, String> {
    Ok(default_update_status())
}
#[tauri::command]
pub fn updates_install() -> Result<(), String> {
    Err("Atualizações automáticas não estão disponíveis nesta versão.".into())
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
    fs::write(
        path,
        serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "estado indisponível".into()
}
fn now() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{seconds}")
}
fn is_supported_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            ["wav", "mp3", "flac", "webm", "m4a"].contains(&extension.to_ascii_lowercase().as_str())
        })
}
fn copy_with_limit<R: Read, W: std::io::Write>(
    reader: &mut R,
    writer: &mut W,
    limit: u64,
) -> Result<u64, String> {
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
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
fn audio_extension(url: &str, content_type: &str) -> Option<&'static str> {
    let path = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    if path.ends_with(".wav") || matches!(content_type, "audio/wav" | "audio/x-wav") {
        Some("wav")
    } else if path.ends_with(".mp3") || content_type == "audio/mpeg" {
        Some("mp3")
    } else if path.ends_with(".flac") || matches!(content_type, "audio/flac" | "audio/x-flac") {
        Some("flac")
    } else {
        None
    }
}
fn validate_public_url(value: &str) -> Result<String, String> {
    let url = value.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) || url.contains('@') {
        return Err("Use uma URL HTTP/HTTPS pública sem credenciais.".into());
    }
    let host = url
        .split("//")
        .nth(1)
        .and_then(|value| value.split(['/', '?', '#']).next())
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if host.is_empty() || is_private_host(&host) {
        return Err("Fontes locais ou privadas não são permitidas.".into());
    }
    Ok(url.to_string())
}
fn validate_youtube_url(value: &str) -> Result<String, String> {
    let url = validate_public_url(value)?;
    let host = url
        .split("//")
        .nth(1)
        .and_then(|value| value.split(['/', '?', '#']).next())
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim_start_matches("www.");
    if !matches!(host, "youtube.com" | "m.youtube.com" | "youtu.be") {
        return Err("Use uma URL HTTPS pública do YouTube, sem playlists.".into());
    }
    Ok(remove_youtube_playlist_params(&url))
}
fn remove_youtube_playlist_params(url: &str) -> String {
    let (without_fragment, fragment) = url.split_once('#').unwrap_or((url, ""));
    let Some((base, query)) = without_fragment.split_once('?') else {
        return url.to_string();
    };
    let kept = query
        .split('&')
        .filter(|parameter| {
            let name = parameter.split('=').next().unwrap_or("").to_ascii_lowercase();
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
fn is_private_host(host: &str) -> bool {
    if matches!(host, "localhost" | "::1") || host.ends_with(".local") {
        return true;
    }
    let octets: Vec<u8> = host
        .split('.')
        .filter_map(|value| value.parse().ok())
        .collect();
    if octets.len() != 4 {
        return false;
    }
    octets[0] == 10
        || octets[0] == 127
        || (octets[0] == 172 && (16..=31).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 168)
        || (octets[0] == 169 && octets[1] == 254)
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
    let detail = String::from_utf8_lossy(stderr)
        .trim()
        .to_string();
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
fn yt_dlp_runtime_args() -> Vec<String> {
    if command_available("deno") {
        Vec::new()
    } else if command_available("node") {
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
    let value = line.strip_prefix("download:")?.trim().trim_end_matches('%').trim();
    let percent = value.parse::<f64>().ok()?;
    percent.is_finite().then_some(percent.clamp(0.0, 100.0))
}
fn command_available(name: &str) -> bool {
    StdCommand::new(name)
        .arg("--version")
        .output()
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
fn yt_dlp_command(state: &State<'_, AppState>) -> StdCommand {
    let path = managed_yt_dlp_path(state);
    if path.is_file() {
        StdCommand::new(path)
    } else {
        StdCommand::new(if cfg!(windows) {
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
    let body = ureq::get("https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS")
        .call()
        .map_err(|e| format!("Não foi possível obter a assinatura do yt-dlp: {e}"))?
        .into_body()
        .read_to_string()
        .map_err(|e| e.to_string())?;
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
fn standard_models_installed(models: &Path) -> bool {
    models.join("htdemucs.onnx").is_file()
        || CORE_STEMS.iter().all(|stem| {
            models
                .join("htdemucs-ft")
                .join(format!("htdemucs_ft_{stem}_fp16weights.onnx"))
                .is_file()
        })
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
    let processed = apply_pitch_and_tempo(
        &mixed[start * 2..end * 2],
        end.saturating_sub(start),
        sample_rate,
        options.pitch,
        options.tempo,
        check_cancelled,
    )?;
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

fn export_is_cancelled(state: &State<'_, AppState>, request_id: &str) -> Result<(), String> {
    if state
        .export_cancelled
        .lock()
        .map_err(lock_error)?
        .contains(request_id)
    {
        Err("Exportação cancelada.".into())
    } else {
        Ok(())
    }
}

fn clear_export_cancelled(state: &State<'_, AppState>, request_id: &str) {
    if let Ok(mut cancelled) = state.export_cancelled.lock() {
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
