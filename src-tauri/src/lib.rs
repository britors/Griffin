#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(feature = "gui")]
mod commands;
#[cfg(feature = "gui")]
mod state;
#[cfg(feature = "gui")]
mod types;
#[cfg(feature = "gui")]
mod updater;

#[cfg(feature = "gui")]
use commands::*;
#[cfg(feature = "gui")]
use state::AppState;
#[cfg(feature = "gui")]
use tauri::Manager;
#[cfg(feature = "gui")]
use updater::{
    app_version, updater_cancel_download, updater_check, updater_download, updater_install,
    UpdaterState,
};

#[cfg(feature = "gui")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            window_minimize,
            window_toggle_maximize,
            window_close,
            diagnostics_collect,
            diagnostics_log,
            diagnostics_previous,
            diagnostics_clear_previous,
            diagnostics_save,
            library_list,
            library_import,
            library_import_many,
            library_read,
            library_remove,
            library_choose_file,
            library_choose_files,
            library_rename,
            library_preview_url,
            library_import_url,
            library_cancel_remote_import,
            youtube_preview,
            youtube_import,
            youtube_cancel,
            projects_list,
            projects_folders_list,
            projects_create,
            projects_rename,
            projects_remove,
            projects_folder_create,
            projects_folder_rename,
            projects_folder_remove,
            projects_move,
            projects_add_track,
            projects_remove_track,
            projects_move_track,
            projects_create_snapshot,
            projects_restore_snapshot,
            projects_remove_snapshot,
            projects_update_player_state,
            projects_save_as,
            projects_save,
            projects_open,
            settings_get,
            settings_set,
            resources_summary,
            resources_clear_cache,
            lyrics_get,
            lyrics_update,
            analysis_analyze,
            analysis_update,
            separation_status,
            separation_start,
            separation_cancel,
            separation_pause,
            separation_resume,
            export_audio,
            export_cancel,
            models_status,
            models_download,
            models_cancel,
            models_pause,
            cuda_runtime_status,
            cuda_runtime_install,
            cuda_runtime_update,
            cuda_runtime_cancel,
            cuda_runtime_pause,
            yt_dlp_status,
            yt_dlp_download,
            yt_dlp_cancel,
            yt_dlp_pause,
            preparation_resume_pending,
            performance_save,
            chords_export,
            remote_provider_status,
            remote_provider_save_api_key,
            remote_provider_clear_api_key,
            remote_provider_estimate_cost,
            app_version,
            updater_check,
            updater_download,
            updater_cancel_download,
            updater_install,
        ])
        .manage(UpdaterState::default())
        .setup(|app| {
            let state = app.state::<AppState>();
            state.initialize(app.handle())?;
            state.record_session_event("startup.setup_complete", "ok");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar Griffin Music");
}
