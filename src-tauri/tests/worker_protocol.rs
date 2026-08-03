use std::io::Write;
use std::process::{Command, Stdio};

fn run_worker(input: &str) -> serde_json::Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_griffin-onnx-worker"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("start ONNX worker");
    child
        .stdin
        .as_mut()
        .expect("worker stdin")
        .write_all(input.as_bytes())
        .expect("write worker request");
    drop(child.stdin.take());
    let output = child.wait_with_output().expect("wait for worker");
    let stdout = String::from_utf8(output.stdout).expect("worker output must be UTF-8");
    let line = stdout
        .lines()
        .next()
        .expect("worker must emit one response");
    serde_json::from_str::<serde_json::Value>(line).expect("worker response must be JSON")
}

#[test]
fn worker_reports_malformed_requests_without_panicking() {
    let response = run_worker("not json\n");
    assert_eq!(response["type"], "error");
    assert!(response["message"]
        .as_str()
        .unwrap()
        .contains("request inválido"));
}

#[test]
fn worker_rejects_unknown_operations_before_loading_onnx() {
    let response = run_worker(
        r#"{"type":"inspect","track":{"id":"track-1","path":"/tmp/song.wav"},"modelsDir":"/tmp/models","cacheDir":"/tmp/cache"}"#,
    );
    assert_eq!(response["type"], "error");
    assert_eq!(response["message"], "tipo de operação desconhecido");
}
