use hound::{SampleFormat, WavSpec, WavWriter};
use ort::{session::Session, value::Tensor};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{self, BufRead},
    path::{Path, PathBuf},
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
const MIN_AVAILABLE_MEMORY_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const CORE_ORDER: [&str; 4] = ["drums", "bass", "other", "vocals"];
const EXTENDED_ORDER: [&str; 6] = ["drums", "bass", "other", "vocals", "guitar", "piano"];

#[derive(Deserialize)]
struct Request {
    #[serde(rename = "type")]
    kind: String,
    track: Track,
    target: Option<String>,
    #[serde(rename = "modelsDir")]
    models_dir: PathBuf,
    #[serde(rename = "cacheDir")]
    cache_dir: PathBuf,
}
#[derive(Deserialize)]
struct Track {
    id: String,
    path: String,
}

fn main() {
    let input = io::stdin().lock().lines().next().and_then(Result::ok);
    let Some(input) = input else {
        return;
    };
    let request: Request = match serde_json::from_str(&input) {
        Ok(value) => value,
        Err(error) => {
            emit_error(&format!("request inválido: {error}"));
            return;
        }
    };
    if request.kind != "separate" {
        emit_error("tipo de operação desconhecido");
        return;
    }
    if let Err(error) = separate(request) {
        emit_error(&error);
    }
}

fn separate(request: Request) -> Result<(), String> {
    ort::init().with_name("griffin-onnx-worker").commit();
    let names: Vec<String> = match request.target.as_deref() {
        Some(target) if ALL_STEMS.contains(&target) => vec![target.to_string()],
        Some(_) => return Err("Stem de destino inválido.".into()),
        None => {
            if request.models_dir.join("htdemucs_6s.onnx").exists() {
                EXTENDED_ORDER
                    .iter()
                    .map(|stem| (*stem).to_string())
                    .collect()
            } else {
                CORE_ORDER.iter().map(|stem| (*stem).to_string()).collect()
            }
        }
    };
    let source_hash = source_hash(Path::new(&request.track.path))?;
    let target_key = request
        .target
        .as_deref()
        .map(|target| format!("-target-{target}"))
        .unwrap_or_default();
    let key = format!(
        "{}-{}-{}{}",
        request.track.id,
        &source_hash[..16],
        if names.len() == 6 { "six" } else { "four" },
        target_key
    );
    let output_dir = request.cache_dir.join(key);
    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    let output_paths: Vec<PathBuf> = names
        .iter()
        .map(|stem| output_dir.join(format!("{stem}.wav")))
        .collect();
    if output_paths.iter().all(|path| path.is_file()) {
        emit_done(&names, &output_paths);
        return Ok(());
    }
    ensure_memory_budget()?;
    let (left, right) = decode_stereo(Path::new(&request.track.path))?;
    if left.is_empty() {
        return Err("O arquivo de áudio está vazio.".into());
    }
    ensure_audio_memory_budget(left.len())?;
    for (index, stem) in names.iter().enumerate() {
        let model = choose_model(&request.models_dir, stem)?;
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
        let mut session = Session::builder()
            .map_err(|e| e.to_string())?
            .with_intra_threads(1)
            .map_err(|e| e.to_string())?
            .with_inter_threads(1)
            .map_err(|e| e.to_string())?
            .commit_from_file(model)
            .map_err(|e| e.to_string())?;
        let mut stem_left = vec![0.0f32; left.len()];
        let mut stem_right = vec![0.0f32; right.len()];
        let mut weights = vec![0.0f32; left.len()];
        let mut start = 0usize;
        while start < left.len() {
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
                serde_json::json!({ "type": "progress", "progress": { "trackId": request.track.id, "progress": (0.02 + progress * 0.96).min(0.98), "stage": format!("Separando {stem}") } })
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
        write_wav(&path, &stem_left, &stem_right)?;
    }
    emit_done(&names, &output_paths);
    Ok(())
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
        None
    }
}

fn choose_model(models: &Path, stem: &str) -> Result<PathBuf, String> {
    let six = models.join("htdemucs_6s.onnx");
    if (stem == "guitar" || stem == "piano") && six.exists() {
        return Ok(six);
    }
    let specialist = models
        .join("htdemucs-ft")
        .join(format!("htdemucs_ft_{stem}_fp16weights.onnx"));
    if specialist.exists() {
        return Ok(specialist);
    }
    let single = models.join("htdemucs.onnx");
    if single.exists() {
        return Ok(single);
    }
    Err(format!("Modelo ONNX não encontrado para {stem}."))
}

fn source_hash(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = std::io::Read::read(&mut file, &mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
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
