use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{ipc::Channel, AppHandle, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::{
    sync::Mutex,
    time::{sleep, Duration},
};

#[derive(Default)]
pub struct UpdaterState {
    update: Mutex<Option<Update>>,
    downloaded: Mutex<Option<Vec<u8>>>,
    cancel: Mutex<Option<Arc<AtomicBool>>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    pub version: String,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "event", content = "data")]
#[serde(rename_all = "camelCase")]
pub enum DownloadEvent {
    Started { content_length: Option<u64> },
    Progress { chunk_length: usize },
    Finished,
}

async fn wait_for_cancel(cancel: Arc<AtomicBool>) {
    while !cancel.load(Ordering::Acquire) {
        sleep(Duration::from_millis(50)).await;
    }
}

#[tauri::command]
pub async fn app_version<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    Ok(app.package_info().version.to_string())
}

#[tauri::command]
pub async fn updater_check<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, UpdaterState>,
    target: String,
    timeout: Option<u64>,
) -> Result<Option<UpdateMetadata>, String> {
    let mut builder = app.updater_builder().target(target);
    if let Some(timeout) = timeout {
        builder = builder.timeout(Duration::from_millis(timeout));
    }
    let update = builder
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;

    *state.downloaded.lock().await = None;
    *state.update.lock().await = update.clone();
    Ok(update.map(|update| UpdateMetadata {
        version: update.version,
        body: update.body,
    }))
}

#[tauri::command]
pub async fn updater_download<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, UpdaterState>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let update = state
        .update
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Nenhuma atualização disponível para baixar.".to_string())?;
    let cancel = Arc::new(AtomicBool::new(false));
    *state.cancel.lock().await = Some(cancel.clone());
    *state.downloaded.lock().await = None;

    let mut first_chunk = true;
    let download = update.download(
        |chunk_length, content_length| {
            if first_chunk {
                first_chunk = false;
                let _ = on_event.send(DownloadEvent::Started { content_length });
            }
            let _ = on_event.send(DownloadEvent::Progress { chunk_length });
        },
        || {
            let _ = on_event.send(DownloadEvent::Finished);
        },
    );
    tokio::pin!(download);

    let result = tokio::select! {
        result = &mut download => result.map(Some).map_err(|error| error.to_string()),
        _ = wait_for_cancel(cancel.clone()) => Err("Download cancelado.".to_string()),
    };
    *state.cancel.lock().await = None;
    if let Some(bytes) = result? {
        *state.downloaded.lock().await = Some(bytes);
        Ok(())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn updater_cancel_download(state: State<'_, UpdaterState>) -> Result<(), String> {
    if let Some(cancel) = state.cancel.lock().await.as_ref() {
        cancel.store(true, Ordering::Release);
    }
    Ok(())
}

#[tauri::command]
pub async fn updater_install<R: Runtime>(
    _app: AppHandle<R>,
    state: State<'_, UpdaterState>,
) -> Result<(), String> {
    let update = state
        .update
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Nenhuma atualização disponível.".to_string())?;
    let bytes = state
        .downloaded
        .lock()
        .await
        .take()
        .ok_or_else(|| "Baixe uma atualização antes de instalar.".to_string())?;
    if let Err(error) = update.install(&bytes) {
        *state.downloaded.lock().await = Some(bytes);
        return Err(error.to_string());
    }
    *state.update.lock().await = None;
    Ok(())
}
