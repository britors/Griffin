#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use hound::{SampleFormat, WavSpec, WavWriter};
#[cfg(any(target_os = "linux", target_os = "windows"))]
use ort::ep;
use ort::{session::Session, value::Tensor};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{self, BufRead},
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
};
use symphonia::{
    core::{
        audio::SampleBuffer, codecs::DecoderOptions, errors::Error as SymphoniaError,
        formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
    },
    default::{get_codecs, get_probe},
};

const SAMPLE_RATE: u32 = 44_100;
const CHUNK_SIZE: usize = 343_980;
const HOP_SIZE: usize = CHUNK_SIZE / 2;
// Decisão de produto: piso reduzido de 8 GiB para 2 GiB para não bloquear
// usuários com menos RAM. Pico real medido (04/08/2026, /usr/bin/time -v,
// htdemucs.onnx, perfil "speed", 1 stem, 4 threads, CPU) foi de ~6,18 GiB —
// ou seja, este piso é apenas um pré-requisito mínimo de partida, não uma
// garantia de que a separação não vai estourar a RAM disponível em máquinas
// modestas. Assumido conscientemente; se voltar a incomodar usuários com
// crashes no meio da separação, é esse o motivo.
const MIN_AVAILABLE_MEMORY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const CORE_ORDER: [&str; 4] = ["drums", "bass", "other", "vocals"];
const EXTENDED_ORDER: [&str; 6] = ["drums", "bass", "other", "vocals", "guitar", "piano"];

#[derive(Debug, Deserialize)]
struct Request {
    #[serde(rename = "type")]
    kind: String,
    track: Track,
    target: Option<String>,
    #[serde(rename = "modelsDir")]
    models_dir: PathBuf,
    #[serde(rename = "cacheDir")]
    cache_dir: PathBuf,
    #[serde(rename = "executionProvider", default)]
    execution_provider: Option<String>,
    #[serde(rename = "processingThreads", default)]
    processing_threads: Option<usize>,
    #[serde(rename = "processingProfile", default)]
    processing_profile: Option<String>,
    #[serde(rename = "modelProfile", default)]
    model_profile: Option<String>,
    #[serde(rename = "cudaRuntimeAvailable", default)]
    cuda_runtime_available: bool,
}
#[derive(Debug, Deserialize)]
struct Track {
    id: String,
    path: String,
}

#[derive(Clone, Default)]
struct PauseControl(Arc<(Mutex<bool>, Condvar)>);

impl PauseControl {
    fn set_paused(&self, paused: bool) {
        let (state, wake) = &*self.0;
        if let Ok(mut value) = state.lock() {
            *value = paused;
            if !paused {
                wake.notify_all();
            }
        }
    }

    fn wait_if_paused(&self) {
        let (state, wake) = &*self.0;
        let Ok(mut paused) = state.lock() else { return };
        while *paused {
            paused = match wake.wait(paused) {
                Ok(value) => value,
                Err(_) => return,
            };
        }
    }
}

fn main() {
    if std::env::args().any(|argument| argument == "--probe-cuda") {
        if let Err(error) = probe_cuda() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    let input = io::stdin().lock().lines().next().and_then(Result::ok);
    let Some(input) = input else {
        return;
    };
    let request = match parse_request(&input) {
        Ok(value) => value,
        Err(error) => {
            emit_error(&error);
            return;
        }
    };
    if let Err(error) = validate_request(&request) {
        emit_error(&error);
        return;
    }
    let pause_control = PauseControl::default();
    let reader_control = pause_control.clone();
    std::thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines().flatten() {
            let command = serde_json::from_str::<serde_json::Value>(&line)
                .ok()
                .and_then(|value| {
                    value
                        .get("type")
                        .and_then(|kind| kind.as_str())
                        .map(str::to_owned)
                });
            match command.as_deref() {
                Some("pause") => reader_control.set_paused(true),
                Some("resume") => reader_control.set_paused(false),
                _ => {}
            }
        }
    });
    if let Err(error) = separate(request, &pause_control) {
        emit_error(&error);
    }
}

fn probe_cuda() -> Result<(), String> {
    let _ = ort::init().with_name("griffin-cuda-probe").commit();
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        Session::builder()
            .map_err(|error| format!("ONNX Runtime incompatível: {error}"))?
            .with_execution_providers([ep::CUDA::default()
                .with_conv_algorithm_search(ep::cuda::ConvAlgorithmSearch::Heuristic)
                .with_conv_max_workspace(false)
                .build()
                .error_on_failure()])
            .map_err(|error| format!("CUDA/cuDNN não pôde ser carregado: {error}"))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        Err("CUDA não está disponível neste sistema; use CPU.".into())
    }
}

fn parse_request(input: &str) -> Result<Request, String> {
    serde_json::from_str(input).map_err(|error| format!("request inválido: {error}"))
}

fn validate_request(request: &Request) -> Result<(), String> {
    if request.kind == "separate" {
        Ok(())
    } else {
        Err("tipo de operação desconhecido".into())
    }
}

fn selected_stems(
    target: Option<&str>,
    model_profile: &str,
    models_dir: &Path,
) -> Result<Vec<String>, String> {
    match target {
        Some(target) if ALL_STEMS.contains(&target) => Ok(vec![target.to_string()]),
        Some(_) => Err("Stem de destino inválido.".into()),
        None if model_profile == "six-stem" && models_dir.join("htdemucs_6s.onnx").exists() => {
            Ok(EXTENDED_ORDER
                .iter()
                .map(|stem| (*stem).to_string())
                .collect())
        }
        None => Ok(CORE_ORDER.iter().map(|stem| (*stem).to_string()).collect()),
    }
}

fn separate(request: Request, pause_control: &PauseControl) -> Result<(), String> {
    let _ = ort::init().with_name("griffin-onnx-worker").commit();
    let requested_provider = request
        .execution_provider
        .as_deref()
        .filter(|provider| matches!(*provider, "auto" | "cpu" | "cuda"))
        .unwrap_or("auto");
    let processing_threads = request
        .processing_threads
        .filter(|threads| *threads > 0)
        .unwrap_or(1)
        .clamp(1, 8);
    let processing_profile = request
        .processing_profile
        .as_deref()
        .filter(|profile| matches!(*profile, "quality" | "balanced" | "speed"))
        .unwrap_or("quality");
    let model_profile = request
        .model_profile
        .as_deref()
        .filter(|profile| matches!(*profile, "four-stem" | "six-stem"))
        .unwrap_or("four-stem");
    let names = selected_stems(
        request.target.as_deref(),
        model_profile,
        &request.models_dir,
    )?;
    let source_hash = source_hash(Path::new(&request.track.path))?;
    let target_key = request
        .target
        .as_deref()
        .map(|target| format!("-target-{target}"))
        .unwrap_or_default();
    let models = names
        .iter()
        .map(|stem| choose_model(&request.models_dir, stem, processing_profile, model_profile))
        .collect::<Result<Vec<_>, _>>()?;
    let (effective_provider, mut probe_session) =
        effective_provider(requested_provider, &models[0], processing_threads)?;
    let model_key = model_content_hash(&names, &models)?;
    let key = format!(
        "{}-{}-{}-{}-{}-{}-{}{}",
        cache_component(&request.track.id),
        &source_hash[..16],
        if names.len() == 6 { "six" } else { "four" },
        processing_profile,
        effective_provider,
        &model_key[..16],
        effective_provider == "cuda" && request.cuda_runtime_available,
        target_key
    );
    let output_dir = request.cache_dir.join(key);
    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    let output_paths: Vec<PathBuf> = names
        .iter()
        .map(|stem| output_dir.join(format!("{stem}.wav")))
        .collect();
    if output_paths.iter().all(|path| path.is_file())
        && cache_provider_matches(&output_dir, effective_provider)
    {
        emit_done(&names, &output_paths);
        return Ok(());
    }
    ensure_memory_budget()?;
    let (left, right) = decode_stereo(Path::new(&request.track.path))?;
    if left.is_empty() {
        return Err("O arquivo de áudio está vazio.".into());
    }
    ensure_audio_memory_budget(left.len())?;
    let mut active_provider = "cpu";
    for (index, stem) in names.iter().enumerate() {
        let model = &models[index];
        let model_order = if model
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.contains("6s"))
        {
            &EXTENDED_ORDER[..]
        } else {
            &CORE_ORDER[..]
        };
        let target_index = model_order
            .iter()
            .position(|name| name == stem)
            .ok_or_else(|| format!("O modelo não contém o stem {stem}."))?;
        let (mut session, provider) = if index == 0 {
            (
                match probe_session.take() {
                    Some(session) => session,
                    None => {
                        create_session(model, processing_threads, effective_provider == "cuda")?
                    }
                },
                effective_provider,
            )
        } else {
            (
                create_session(model, processing_threads, effective_provider == "cuda")?,
                effective_provider,
            )
        };
        active_provider = provider;
        let mut stem_left = vec![0.0f32; left.len()];
        let mut stem_right = vec![0.0f32; right.len()];
        let mut weights = vec![0.0f32; left.len()];
        let mut start = 0usize;
        while start < left.len() {
            pause_control.wait_if_paused();
            let mut input = vec![0.0f32; 2 * CHUNK_SIZE];
            let end = (start + CHUNK_SIZE).min(left.len());
            input[..end - start].copy_from_slice(&left[start..end]);
            input[CHUNK_SIZE..CHUNK_SIZE + end - start].copy_from_slice(&right[start..end]);
            let tensor = Tensor::from_array(([1usize, 2, CHUNK_SIZE], input.into_boxed_slice()))
                .map_err(|e| e.to_string())?;
            let outputs = session
                .run(ort::inputs!["mix" => tensor])
                .map_err(|e| e.to_string())?;
            let (_, values) = outputs["stems"]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            let channels_per_stem = values.len() / (2 * CHUNK_SIZE);
            if target_index >= channels_per_stem {
                return Err(format!("Saída do modelo incompatível para {stem}."));
            }
            for sample in 0..(end - start) {
                let weight = (0.5
                    - 0.5
                        * (2.0 * std::f32::consts::PI * sample as f32 / (CHUNK_SIZE - 1) as f32)
                            .cos())
                .max(0.01);
                let base = target_index * 2 * CHUNK_SIZE;
                stem_left[start + sample] += values[base + sample] * weight;
                stem_right[start + sample] += values[base + CHUNK_SIZE + sample] * weight;
                weights[start + sample] += weight;
            }
            let progress = (index as f64 + end as f64 / left.len() as f64) / names.len() as f64;
            println!(
                "{}",
                serde_json::json!({ "type": "progress", "progress": { "trackId": request.track.id, "progress": (0.02 + progress * 0.96).min(0.98), "stage": format!("Separando {stem} · {active_provider}"), "provider": active_provider } })
            );
            start += HOP_SIZE;
        }
        for sample in 0..left.len() {
            let weight = if weights[sample] == 0.0 {
                1.0
            } else {
                weights[sample]
            };
            stem_left[sample] /= weight;
            stem_right[sample] /= weight;
        }
        let path = &output_paths[index];
        write_wav(path, &stem_left, &stem_right)?;
    }
    let _ = std::fs::write(output_dir.join(".provider"), active_provider);
    emit_done(&names, &output_paths);
    Ok(())
}

fn cache_provider_matches(output_dir: &Path, effective_provider: &str) -> bool {
    std::fs::read_to_string(output_dir.join(".provider"))
        .map(|provider| provider.trim() == effective_provider)
        .unwrap_or(false)
}

fn effective_provider(
    requested_provider: &str,
    first_model: &Path,
    processing_threads: usize,
) -> Result<(&'static str, Option<Session>), String> {
    if requested_provider == "cpu" {
        return Ok(("cpu", None));
    }
    match create_session(first_model, processing_threads, true) {
        Ok(session) => Ok(("cuda", Some(session))),
        Err(cuda_error) => {
            eprintln!("CUDA indisponível; usando CPU: {cuda_error}");
            create_session(first_model, processing_threads, false)
                .map(|session| ("cpu", Some(session)))
                .map_err(|cpu_error| format!("CUDA e CPU falharam: {cuda_error}; {cpu_error}"))
        }
    }
}

fn model_content_hash(names: &[String], models: &[PathBuf]) -> Result<String, String> {
    let mut hasher = Sha256::new();
    for (name, model) in names.iter().zip(models) {
        hasher.update(name.as_bytes());
        hasher.update([0]);
        let mut file = File::open(model).map_err(|error| error.to_string())?;
        let mut buffer = vec![0u8; 1024 * 1024];
        loop {
            let read =
                std::io::Read::read(&mut file, &mut buffer).map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        hasher.update([0xff]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn create_session(model: &Path, threads: usize, use_cuda: bool) -> Result<Session, String> {
    let builder = Session::builder()
        .map_err(|error| error.to_string())?
        .with_intra_threads(threads)
        .map_err(|error| error.to_string())?
        .with_inter_threads(1)
        .map_err(|error| error.to_string())?;
    let mut builder = if use_cuda {
        #[cfg(any(target_os = "linux", target_os = "windows"))]
        {
            builder
                .with_execution_providers([ep::CUDA::default()
                    .with_conv_algorithm_search(ep::cuda::ConvAlgorithmSearch::Heuristic)
                    .with_conv_max_workspace(false)
                    .build()
                    .error_on_failure()])
                .map_err(|error| error.to_string())?
        }
        #[cfg(not(any(target_os = "linux", target_os = "windows")))]
        {
            return Err("CUDA não está disponível neste sistema; use CPU.".into());
        }
    } else {
        builder
    };
    builder
        .commit_from_file(model)
        .map_err(|error| error.to_string())
}

const ALL_STEMS: [&str; 6] = ["drums", "bass", "other", "vocals", "guitar", "piano"];

fn emit_done(names: &[String], paths: &[PathBuf]) {
    let stems = names
        .iter()
        .zip(paths)
        .map(|(stem, path)| (stem.clone(), path.to_string_lossy().to_string()))
        .collect::<HashMap<_, _>>();
    println!("{}", serde_json::json!({ "type": "done", "stems": stems }));
}

fn ensure_memory_budget() -> Result<(), String> {
    if let Some(available) = available_memory_bytes() {
        if available < MIN_AVAILABLE_MEMORY_BYTES {
            return Err(format!(
                "Memória RAM disponível insuficiente para o modelo ONNX (necessário pelo menos {} GiB; disponível {} GiB). Feche outros aplicativos e tente novamente.",
                MIN_AVAILABLE_MEMORY_BYTES / 1024 / 1024 / 1024,
                available / 1024 / 1024 / 1024
            ));
        }
    }
    Ok(())
}

fn ensure_audio_memory_budget(samples: usize) -> Result<(), String> {
    if let Some(available) = available_memory_bytes() {
        let audio_bytes = samples.saturating_mul(8) as u64;
        if available < MIN_AVAILABLE_MEMORY_BYTES.saturating_add(audio_bytes) {
            return Err("Memória RAM insuficiente para processar este áudio com segurança. Feche outros aplicativos ou use um arquivo menor.".into());
        }
    }
    Ok(())
}

fn available_memory_bytes() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/proc/meminfo")
            .ok()?
            .lines()
            .find_map(|line| {
                let mut fields = line.split_whitespace();
                if fields.next()? != "MemAvailable:" {
                    return None;
                }
                fields.next()?.parse::<u64>().ok().map(|kib| kib * 1024)
            })
    }
    #[cfg(not(target_os = "linux"))]
    {
        #[cfg(target_os = "windows")]
        {
            #[repr(C)]
            struct MemoryStatusEx {
                dw_length: u32,
                dw_memory_load: u32,
                ull_total_phys: u64,
                ull_avail_phys: u64,
                ull_total_page_file: u64,
                ull_avail_page_file: u64,
                ull_total_virtual: u64,
                ull_avail_virtual: u64,
                ull_avail_extended_virtual: u64,
            }

            #[link(name = "kernel32")]
            unsafe extern "system" {
                fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
            }

            let mut status = MemoryStatusEx {
                dw_length: std::mem::size_of::<MemoryStatusEx>() as u32,
                dw_memory_load: 0,
                ull_total_phys: 0,
                ull_avail_phys: 0,
                ull_total_page_file: 0,
                ull_avail_page_file: 0,
                ull_total_virtual: 0,
                ull_avail_virtual: 0,
                ull_avail_extended_virtual: 0,
            };
            // SAFETY: Windows fills the documented structure when the size is set.
            if unsafe { GlobalMemoryStatusEx(&mut status) } != 0 {
                return Some(status.ull_avail_phys);
            }
        }
        None
    }
}

fn choose_model(
    models: &Path,
    stem: &str,
    profile: &str,
    model_profile: &str,
) -> Result<PathBuf, String> {
    let six = models.join("htdemucs_6s.onnx");
    if model_profile == "six-stem" && six.exists() {
        return Ok(six);
    }
    if (stem == "guitar" || stem == "piano") && six.exists() {
        return Ok(six);
    }
    let specialist = models
        .join("htdemucs-ft")
        .join(format!("htdemucs_ft_{stem}_fp16weights.onnx"));
    let single = models.join("htdemucs.onnx");
    if profile == "quality" {
        if specialist.exists() {
            return Ok(specialist);
        }
        if single.exists() {
            return Ok(single);
        }
    } else {
        if single.exists() {
            return Ok(single);
        }
        if specialist.exists() {
            return Ok(specialist);
        }
    }
    Err(format!("Modelo ONNX não encontrado para {stem}."))
}

fn source_hash(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = std::io::Read::read(&mut file, &mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn cache_component(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())[..24].to_string()
}

fn decode_stereo(path: &Path) -> Result<(Vec<f32>, Vec<f32>), String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
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
    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| e.to_string())?;
    let mut left = Vec::new();
    let mut right = Vec::new();
    let mut source_rate = track.codec_params.sample_rate.unwrap_or(SAMPLE_RATE);
    while let Ok(packet) = format.next_packet() {
        match decoder.decode(&packet) {
            Ok(decoded) => {
                source_rate = decoded.spec().rate;
                let spec = *decoded.spec();
                let channels = spec.channels.count().max(1);
                let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                samples.copy_interleaved_ref(decoded);
                for frame in samples.samples().chunks(channels) {
                    left.push(frame[0]);
                    right.push(frame[if channels > 1 { 1 } else { 0 }]);
                }
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    if source_rate != SAMPLE_RATE {
        Ok((resample(&left, source_rate), resample(&right, source_rate)))
    } else {
        Ok((left, right))
    }
}

fn resample(input: &[f32], source_rate: u32) -> Vec<f32> {
    let length = ((input.len() as u64 * SAMPLE_RATE as u64) / source_rate as u64) as usize;
    (0..length)
        .map(|index| {
            input[((index as u64 * source_rate as u64) / SAMPLE_RATE as u64) as usize].to_owned()
        })
        .collect()
}
fn write_wav(path: &Path, left: &[f32], right: &[f32]) -> Result<(), String> {
    let spec = WavSpec {
        channels: 2,
        sample_rate: SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    let mut writer = WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    for (left, right) in left.iter().zip(right) {
        writer
            .write_sample((left.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
            .map_err(|e| e.to_string())?;
        writer
            .write_sample((right.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
            .map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())
}
fn emit_error(message: &str) {
    println!(
        "{}",
        serde_json::json!({ "type": "error", "message": message })
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
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
                "griffin-worker-{label}-{}-{suffix}",
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

    fn request_json(kind: &str) -> String {
        serde_json::json!({
            "type": kind,
            "track": { "id": "track-1", "path": "/tmp/song.wav" },
            "modelsDir": "/tmp/models",
            "cacheDir": "/tmp/cache"
        })
        .to_string()
    }

    #[test]
    fn parses_and_validates_worker_protocol() {
        let request = parse_request(&request_json("separate")).expect("valid request");
        assert_eq!(request.kind, "separate");
        assert!(validate_request(&request).is_ok());

        let invalid = parse_request("not json").expect_err("invalid JSON must fail");
        assert!(invalid.starts_with("request inválido:"));

        let unknown = parse_request(&request_json("inspect")).expect("valid JSON");
        assert_eq!(
            validate_request(&unknown).unwrap_err(),
            "tipo de operação desconhecido"
        );
    }

    #[test]
    fn selects_core_and_extended_stems_deterministically() {
        let temp = TempDir::new("models");
        assert_eq!(
            selected_stems(None, "six-stem", temp.path()).unwrap().len(),
            4
        );
        fs::write(temp.path().join("htdemucs_6s.onnx"), b"model").unwrap();
        assert_eq!(
            selected_stems(None, "six-stem", temp.path()).unwrap().len(),
            6
        );
        assert_eq!(
            selected_stems(Some("vocals"), "four-stem", temp.path()).unwrap(),
            vec!["vocals"]
        );
        assert_eq!(
            selected_stems(Some("guitar"), "four-stem", temp.path()).unwrap(),
            vec!["guitar"]
        );
        assert!(selected_stems(Some("invalid"), "four-stem", temp.path()).is_err());
    }

    #[test]
    fn chooses_models_by_profile_and_available_files() {
        let temp = TempDir::new("choose-model");
        fs::create_dir_all(temp.path().join("htdemucs-ft")).unwrap();
        fs::write(temp.path().join("htdemucs.onnx"), b"base").unwrap();
        fs::write(
            temp.path()
                .join("htdemucs-ft/htdemucs_ft_vocals_fp16weights.onnx"),
            b"specialist",
        )
        .unwrap();
        assert!(choose_model(temp.path(), "vocals", "quality", "four-stem")
            .unwrap()
            .ends_with("htdemucs_ft_vocals_fp16weights.onnx"));
        assert!(choose_model(temp.path(), "vocals", "speed", "four-stem")
            .unwrap()
            .ends_with("htdemucs.onnx"));
        assert!(choose_model(temp.path(), "drums", "quality", "four-stem")
            .unwrap()
            .ends_with("htdemucs.onnx"));
        assert!(choose_model(temp.path(), "vocals", "quality", "four-stem").is_ok());
        assert!(choose_model(temp.path(), "piano", "quality", "four-stem").is_ok());
    }

    #[test]
    fn cache_provider_rules_prevent_incorrect_cuda_reuse() {
        let temp = TempDir::new("cache");
        assert!(!cache_provider_matches(temp.path(), "cpu"));
        fs::write(temp.path().join(".provider"), "cpu").unwrap();
        assert!(cache_provider_matches(temp.path(), "cpu"));
        assert!(!cache_provider_matches(temp.path(), "cuda"));
        fs::write(temp.path().join(".provider"), "cuda").unwrap();
        assert!(cache_provider_matches(temp.path(), "cuda"));
        assert!(!cache_provider_matches(temp.path(), "cpu"));
    }

    #[test]
    fn source_hash_changes_when_audio_content_changes() {
        let temp = TempDir::new("hash");
        let path = temp.path().join("audio.wav");
        fs::write(&path, b"first").unwrap();
        let first = source_hash(&path).unwrap();
        fs::write(&path, b"second").unwrap();
        assert_ne!(first, source_hash(&path).unwrap());
    }

    #[test]
    fn model_cache_hash_changes_when_model_content_changes() {
        let temp = TempDir::new("model-hash");
        let model = temp.path().join("model.onnx");
        fs::write(&model, b"same-size").unwrap();
        let names = vec![String::from("vocals")];
        let models = vec![model.clone()];
        let first = model_content_hash(&names, &models).unwrap();
        fs::write(&model, b"different").unwrap();
        assert_ne!(first, model_content_hash(&names, &models).unwrap());
    }

    #[test]
    fn writes_a_valid_stereo_wav() {
        let temp = TempDir::new("wav");
        let path = temp.path().join("output.wav");
        write_wav(&path, &[0.0, 0.5, -0.5], &[0.0, -0.5, 0.5]).unwrap();
        let reader = hound::WavReader::open(path).unwrap();
        assert_eq!(reader.spec().channels, 2);
        assert_eq!(reader.spec().sample_rate, SAMPLE_RATE);
        assert_eq!(reader.duration(), 3);
    }

    #[test]
    fn resamples_audio_to_the_target_rate() {
        let output = resample(&[0.0, 1.0, 0.0, -1.0], 22_050);
        assert_eq!(output.len(), 8);
        assert_eq!(output[0], 0.0);
        assert_eq!(output[2], 1.0);
    }
}
