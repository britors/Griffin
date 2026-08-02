use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub type Stems = HashMap<String, String>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub name: String,
    pub path: String,
    pub imported_at: String,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub stems: Option<Stems>,
    #[serde(default)]
    pub analysis: Option<TrackAnalysis>,
    #[serde(default)]
    pub lyrics: Option<Vec<LyricsLine>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackAnalysis {
    pub bpm: f64,
    pub key: String,
    pub tuning_hz: f64,
    pub confidence: f64,
    #[serde(default)]
    pub sections: Option<Vec<TrackSection>>,
    #[serde(default)]
    pub chords: Option<Vec<ChordEvent>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSection {
    pub id: String,
    pub name: String,
    pub start: f64,
    pub end: f64,
    pub confidence: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChordEvent {
    pub id: String,
    pub name: String,
    pub start: f64,
    pub end: f64,
    pub confidence: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsLine {
    pub id: String,
    pub text: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub track_ids: Vec<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub file_path: Option<String>,
    #[serde(default)]
    pub file_saved_at: Option<String>,
    #[serde(default)]
    pub snapshots: Option<Vec<ProjectSnapshot>>,
    #[serde(default)]
    pub player_state: Option<PlayerSnapshot>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GriffinProjectFile {
    pub format: String,
    pub version: u32,
    pub saved_at: String,
    pub project: Project,
    pub folders: Vec<ProjectFolder>,
    pub tracks: Vec<Track>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOpenResult {
    pub project: Project,
    pub folders: Vec<ProjectFolder>,
    pub tracks: Vec<Track>,
    pub missing_tracks: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub track_ids: Vec<String>,
    pub player: PlayerSnapshot,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub selected_track_id: Option<String>,
    pub take_path: Option<String>,
    pub take_name: Option<String>,
    pub position: f64,
    pub pitch: f64,
    pub tempo: f64,
    pub loop_enabled: bool,
    pub loop_start: f64,
    pub loop_end: f64,
    pub volumes: HashMap<String, f64>,
    pub pans: HashMap<String, f64>,
    pub routes: HashMap<String, String>,
    pub equalizer: HashMap<String, Vec<f64>>,
    pub muted: HashMap<String, bool>,
    pub solo: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeparationStatus {
    pub available: bool,
    pub message: String,
    pub provider: Option<String>,
    pub profile: Option<String>,
    pub memory_bytes: Option<u64>,
    pub last_duration_ms: Option<u64>,
    pub model_profile: Option<String>,
    pub six_stem_available: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioExportOptions {
    pub stems: Vec<String>,
    pub volumes: HashMap<String, f64>,
    pub pans: HashMap<String, f64>,
    pub routes: HashMap<String, String>,
    pub equalizer: HashMap<String, Vec<f64>>,
    pub muted: HashMap<String, bool>,
    pub solo: Option<String>,
    pub mode: Option<String>,
    pub pitch: f64,
    pub tempo: f64,
    #[serde(rename = "loopRange")]
    pub loop_range: Option<LoopRange>,
    pub format: String,
    pub sample_rate: u32,
    pub bit_depth: u16,
    pub request_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LoopRange {
    pub start: f64,
    pub end: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioExportResult {
    pub path: String,
    pub paths: Vec<String>,
    pub duration: f64,
    pub format: String,
    pub sample_rate: u32,
    pub bit_depth: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalResourcesSummary {
    pub cache_path: String,
    pub cache_bytes: u64,
    pub model_path: String,
    pub model_bytes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadStatus {
    pub standard_installed: bool,
    pub extended_installed: bool,
    pub downloading: Option<String>,
}
