# Arquitetura do Griffin Music

O Griffin Music segue uma arquitetura orientada a domínio. O frontend React roda na janela Tauri e o composition root nativo fica em Rust.

```text
Renderer/API ──> Tauri commands ──> Rust state/services ──> filesystem/processos nativos
                                      │
                                      └── worker ONNX separado
```

## Camadas

- `src/shared/domain`: agregados e regras invariantes serializáveis entre processos. `AudioTrack` é o aggregate root da biblioteca.
- `src-tauri/src`: comandos, estado persistido, importação/exportação, análise, separação e integrações nativas.
- `src-tauri/src/bin/griffin-onnx-worker.rs`: processo separado que carrega o ONNX, processa um stem por vez e encerra ao finalizar.
- `src/renderer`: estado, componentes e player da interface. A comunicação usa `@tauri-apps/api` e comandos explicitamente registrados.
- `src/main/application` e parte de `src/main/infrastructure`: serviços TypeScript puros mantidos como referência e testes de domínio; não são carregados pelo aplicativo Tauri. A separação StemSplit não possui adaptador TypeScript: seu único runtime é o comando Rust `separation_start`.
- `src/renderer`: estado e componentes da interface. O renderer só conhece o contrato público exposto pelo preload.

## Fluxo de separação

1. O renderer invoca `separation_start` com o snapshot da faixa.
2. Rust inicia um único `griffin-onnx-worker` e envia uma requisição JSON.
3. O worker verifica memória, cache e modelo, processa os stems sequencialmente e retorna os caminhos WAV.
4. Rust mescla os stems novos com os já existentes e persiste `library.json`.
5. O resultado serializado volta ao renderer.

## Fonte única da separação StemSplit

O fluxo remoto oficial vive em `src-tauri/src/commands.rs`, junto com o armazenamento da chave, polling, cancelamento, cache e persistência dos stems. O SDK TypeScript e o antigo adaptador `StemSplitSeparator` foram removidos para evitar que regras de limite, cache, erros ou cancelamento sejam implementadas duas vezes.

O contrato do tensor está isolado no worker Rust: entrada `mix [1, 2, 343980]`, saída Demucs na ordem `drums`, `bass`, `other`, `vocals` e, quando `htdemucs_6s.onnx` está instalado, também `guitar` e `piano`. O worker executa um stem por vez para limitar o pico de RAM.
