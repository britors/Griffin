# Griffin Music

Aplicativo desktop standalone da W3TI para separação local de stems e prática instrumental. O processamento é local por padrão: não há servidor próprio, e o áudio só é enviado ao StemSplit quando você escolhe e confirma a separação remota.

[![Baixar Griffin Music](https://img.shields.io/badge/Baixar-Griffin%20Music-d4a531?style=for-the-badge&logo=github&logoColor=white)](https://github.com/britors/Griffin/releases/latest)

## Estado atual

O MVP e a Fase 2 de prática musical já estão integrados na `main`:

- separação local em vocal, bateria, baixo e outros com `htdemucs_ft`, com perfil opcional de seis stems para guitarra e piano, modelos baixados sob demanda pelo próprio app;
- player sincronizado com mixer, mute/solo, pitch, tempo e loop A-B;
- projetos, favoritos, recentes e cache local;
- BPM, tonalidade, afinação, seções, acordes e letras sincronizadas;
- metrônomo com subdivisão e contagem de entrada;
- prática progressiva e atalhos de teclado;
- exportação de mixagens e stems individuais em WAV PCM, com sample rate e bit depth configuráveis;
- build Linux DEB/RPM e Windows NSIS configurado no GitHub Actions.

A release pública `v0.1.2` será publicada a partir da nova tag e ficará disponível pelo botão de download acima.

## Requisitos

- Node.js 22.x recomendado (o CI usa Node 22);
- npm;
- aproximadamente 1 GB livre para os modelos ONNX (baixados pelo app na primeira execução) e alguns GB adicionais para empacotar os instaladores;
- Linux: GTK3, NSS, ALSA e, para gerar RPM localmente, `rpm-build`.

No openSUSE Leap:

```bash
sudo zypper install rpm-build
```

## Desenvolvimento

```bash
git clone git@github.com:britors/Griffin.git
cd Griffin
npm ci
npm run dev
```

Os modelos ONNX não são versionados no Git nem empacotados no instalador. Na primeira execução, o app oferece um download (~1 GB) do modelo especialista `htdemucs_ft` e do fallback single-file `htdemucs`, salvos em `userData/models`. O perfil padrão produz quatro stems.

Para instalar também o modelo opcional `htdemucs-6s` — que adiciona guitarra e piano — use o botão "Ativar guitarra e piano" em Preferências → Processamento, depois que o modelo padrão estiver instalado.

Alternativamente, `scripts/download-models.sh` continua disponível para baixar os modelos manualmente (por exemplo, em CI de testes ou provisionamento em lote), aceitando `GRIFFIN_MODEL_DIR` e `GRIFFIN_EXTENDED=1`.

### Aceleração NVIDIA/CUDA

O worker ONNX inclui o provider CUDA para Linux e Windows e tenta usar a GPU quando "Automático" ou "Preferir GPU" está selecionado em Preferências → Processamento. Em sistemas compatíveis, o botão "Instalar suporte NVIDIA" baixa e instala por usuário o runtime CUDA/cuDNN oficial, sem exigir instalação manual ou privilégios administrativos. O download é validado por checksum e fica dentro de `userData/runtimes/cuda`; o Griffin adiciona esse diretório ao processo do worker somente quando ele existe.

`nvidia-smi` confirmar o driver não garante que as bibliotecas de inferência estejam disponíveis. Em sistemas sem suporte NVIDIA, ou quando a instalação não foi concluída, o Griffin informa CPU como provider efetivo e faz fallback sem interromper a separação.

Para confirmar o uso real, observe o provider exibido no progresso da separação (`cuda` ou `cpu`) e o campo Provider ONNX após o processamento. A opção "Somente CPU" desativa a tentativa de CUDA.

### Separação remota opcional

O Griffin também pode usar o StemSplit como alternativa remota. O áudio só deixa o computador depois de uma confirmação explícita para cada operação remota; a chave fica armazenada localmente e a separação local continua disponível sem internet. O comparativo e a decisão sobre outros provedores estão em [`docs/REMOTE_PROVIDERS.md`](docs/REMOTE_PROVIDERS.md).

## Validação e build

```bash
npm run typecheck
npm run build
npx vitest run src/main/application/__tests__
cargo test --manifest-path src-tauri/Cargo.toml
```

Linux:

```bash
npm run package:linux
```

Windows x64:

```bash
npm run package:win
```

Os artefatos são gravados em `release/`. O RPM local exige o executável `rpmbuild`; no GitHub Actions ele é instalado automaticamente.

Depois de gerar os pacotes Linux, valide os formatos e o logo:

```bash
npm run validate:packages
```

Essa verificação também valida sintaticamente `install.sh`, `uninstall.sh`, `download-models.sh` e `PKGBUILD`. O workflow de release executa a mesma checagem para DEB/RPM no Linux e para o instalador NSIS x64 no Windows.

### Exportação de áudio

O painel de exportação permite salvar uma mixagem combinada ou cada stem selecionado separadamente em WAV PCM. A exportação aplica o estado atual do mixer, EQ, pitch, tempo e loop, sem sobrescrever arquivos existentes. MP3 e FLAC ficam reservados para quando um encoder local compatível for distribuído; o aplicativo informa essa indisponibilidade sem enviar áudio para a nuvem.

### Importação remota e YouTube

A importação remota exige uma fonte pública suportada e confirmação de que o usuário possui os direitos ou autorização. A integração do YouTube é opcional, depende de `yt-dlp` instalado pelo usuário, aceita apenas vídeos individuais e não contorna DRM, playlists ou restrições técnicas. Verifique os Termos de Serviço do YouTube e a legislação aplicável antes de usar ou distribuir essa funcionalidade.

## Instalação por release

Quando uma release estiver publicada:

- Ubuntu/Debian: baixe o `.deb`;
- Fedora/openSUSE: baixe o `.rpm`;
- Windows 10/11: baixe o instalador `.exe`;
- Arch/Manjaro: use o `PKGBUILD` com `makepkg` ou AUR.

No Linux, os scripts aceitam `GRIFFIN_REPO` e `GRIFFIN_VERSION` para testar outra origem ou versão:

```bash
curl -fsSL https://raw.githubusercontent.com/britors/Griffin/main/scripts/install.sh | sudo bash
sudo bash scripts/uninstall.sh
sudo bash scripts/uninstall.sh --purge
```

O modo padrão preserva configurações, cache de stems e projetos. `--purge` remove os dados locais do usuário.

## Arquitetura

O projeto usa arquitetura hexagonal com DDD:

- `src/shared/domain`: agregados e regras de domínio;
- `src-tauri/src`: comandos, estado persistido, importação/exportação, áudio e integrações nativas;
- `src-tauri/src/bin/griffin-onnx-worker.rs`: worker ONNX separado, com limite de memória;
- `src/main/application` e parte de `src/main/infrastructure`: serviços TypeScript puros mantidos para testes e referência;
- `src/renderer`: React, Zustand e player.

Documentação adicional:

- [Arquitetura](docs/ARCHITECTURE.md)
- [Validação de áudio e cache](docs/VALIDATION.md)
- [Griffin com OBS no Windows](docs/OBS_WINDOWS.md)
- [Processo de release](docs/RELEASE.md)
- [Separação remota opcional](docs/REMOTE_SEPARATION.md)
- [Política de privacidade](PRIVACY.md)
- [Contribuição](CONTRIBUTING.md)

## Licença

GPLv3. Consulte o arquivo [LICENSE](LICENSE).
