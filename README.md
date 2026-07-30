# Griffin Music

Aplicativo desktop standalone da W3TI para separação local de stems e prática instrumental. O áudio permanece no computador: não há servidor próprio nem upload de faixas.

## Estado atual

O MVP e a Fase 2 de prática musical já estão integrados na `main`:

- separação local em vocal, bateria, baixo e outros com `htdemucs_ft`, com perfil opcional de seis stems para guitarra e piano;
- player sincronizado com mixer, mute/solo, pitch, tempo e loop A-B;
- projetos, favoritos, recentes e cache local;
- BPM, tonalidade, afinação, seções, acordes e letras sincronizadas;
- metrônomo com subdivisão e contagem de entrada;
- prática progressiva e atalhos de teclado;
- exportação de mixagens e stems individuais em WAV PCM, com sample rate e bit depth configuráveis;
- build Linux AppImage/DEB/RPM e Windows NSIS configurado no GitHub Actions.

A release pública `v0.1.0` ainda não foi criada. Ela será publicada quando a tag for autorizada e enviada ao GitHub.

## Requisitos

- Node.js 22.x recomendado (o CI usa Node 22);
- npm;
- aproximadamente 1 GB livre para os modelos ONNX e alguns GB adicionais para empacotar os instaladores;
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
bash scripts/download-models.sh
npm run dev
```

O script baixa o modelo especialista `htdemucs_ft` e o fallback single-file `htdemucs` para `src/main/models/`. Esses arquivos não são versionados no Git; o workflow de release baixa os modelos antes do empacotamento.

O perfil padrão produz quatro stems. Para instalar também o modelo opcional `htdemucs-6s` — que adiciona guitarra e piano — use:

```bash
GRIFFIN_EXTENDED=1 bash scripts/download-models.sh
```

O arquivo é baixado como `src/main/models/htdemucs_6s.onnx`. Se ele não estiver presente, o aplicativo mantém o perfil de quatro stems e informa nas preferências que o modelo estendido precisa ser instalado.

## Validação e build

```bash
npm run typecheck
npm run build
npx vitest run src/main/application/__tests__
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

Depois de gerar os pacotes Linux, valide os formatos, o logo e os modelos empacotados:

```bash
npm run validate:packages
```

Essa verificação também valida sintaticamente `install.sh`, `uninstall.sh`, `download-models.sh` e `PKGBUILD`. O workflow de release executa a mesma checagem para AppImage/DEB/RPM no Linux e para o instalador NSIS x64 no Windows.

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
- `src/main/application`: casos de uso e portas;
- `src/main/infrastructure`: filesystem, JSON, ONNX e áudio;
- `src/main/presentation`: handlers IPC;
- `src/renderer`: React, Zustand e player.

Documentação adicional:

- [Arquitetura](docs/ARCHITECTURE.md)
- [Validação de áudio e cache](docs/VALIDATION.md)
- [Processo de release](docs/RELEASE.md)
- [Contribuição](CONTRIBUTING.md)

## Licença

GPLv3. Consulte o arquivo [LICENSE](LICENSE).
