#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(feature = "gui")]
mod commands;
#[cfg(feature = "gui")]
mod state;
#[cfg(feature = "gui")]
mod types;

#[cfg(feature = "gui")]
use commands::*;
#[cfg(feature = "gui")]
use state::AppState;
#[cfg(feature = "gui")]
use tauri::Manager;

#[cfg(feature = "gui")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            window_minimize,
            window_toggle_maximize,
            window_close,
            library_list,
            library_import,
            library_import_many,
            library_read,
            library_remove,
            library_choose_file,
            library_choose_files,
            library_preview_url,
            library_import_url,
            library_cancel_remote_import,
            youtube_preview,
            youtube_import,
            youtube_cancel,
            projects_list,
            projects_create,
            projects_rename,
            projects_remove,
            projects_add_track,
            projects_remove_track,
            projects_move_track,
            projects_create_snapshot,
            projects_restore_snapshot,
            projects_remove_snapshot,
            projects_update_player_state,
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
            export_audio,
            export_cancel,
            models_status,
            models_download,
            models_cancel,
            yt_dlp_status,
            yt_dlp_download,
            yt_dlp_cancel,
            performance_save,
            chords_export,
            remote_provider_status,
            remote_provider_save_api_key,
            remote_provider_clear_api_key,
            remote_provider_estimate_cost,
            updates_status,
            updates_check,
            updates_download,
            updates_install,
        ])
        .setup(|app| {
            let state = app.state::<AppState>();
            state.initialize(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar Griffin Music");
}
