# Arquitetura do Griffin Music

O Griffin Music segue uma arquitetura hexagonal orientada a domínio. O processo principal é o composition root; Electron e filesystem são detalhes substituíveis.

```text
Renderer/API ──> Presentation (IPC) ──> Application Services ──> Ports
                                          │                    ▲
                                          └── Domain            │
Infrastructure adapters ───────────────────────────────────────┘
```

## Camadas

- `src/shared/domain`: agregados e regras invariantes serializáveis entre processos. `AudioTrack` é o aggregate root da biblioteca.
- `src/main/application`: casos de uso (`LibraryApplicationService`, `SeparationApplicationService`) e portas. Não importa Electron, React ou filesystem.
- `src/main/infrastructure`: implementações das portas: JSON, arquivos locais, picker Electron, cache de stems e ONNX.
- `src/main/presentation`: handlers IPC finos, sem regra de negócio.
- `src/renderer`: estado e componentes da interface. O renderer só conhece o contrato público exposto pelo preload.

## Fluxo de separação

1. IPC recebe um snapshot da faixa.
2. `SeparationApplicationService` reidrata o aggregate pelo repositório.
3. `StemSeparator` verifica cache e modelo, executa o adapter ONNX e retorna os quatro caminhos.
4. O aggregate recebe `attachStems`.
5. O repositório persiste o novo snapshot.
6. O resultado serializado volta ao renderer.

O tensor contract está isolado em `OnnxDemucsSeparator`: entrada `mix [1, 2, 343980]`, saída `stems [1, 4, 2, 343980]`, na ordem Demucs `drums`, `bass`, `other`, `vocals`. O modo padrão executa os quatro especialistas `htdemucs_ft`; o arquivo único `htdemucs.onnx` permanece como fallback rápido.
