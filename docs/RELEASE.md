# Release 2.0.1

Esta versão reúne a preparação automática para usuários não técnicos, retomada de downloads após reinício, reparo de modelos/runtime/yt-dlp corrompidos, pausa e retomada durante downloads e separação, projetos `.gfn` com organização em pastas e melhorias de estabilidade do worker ONNX. Os diagnósticos continuam locais e manuais; nenhum relatório é enviado automaticamente.

Os artefatos de produção devem ser gerados pelos workflows Linux e Windows disparados pela tag `v2.0.1`. Antes da publicação, valide `npm run validate:version`, `npm run validate:tauri`, os testes e os pacotes gerados.

## Histórico

### Release 1.2.1

Esta versão corrige o empacotamento de produção: o aplicativo não tenta mais conectar ao servidor Vite de desenvolvimento em `127.0.0.1:1420`; essa configuração ficou isolada no modo de desenvolvimento. Também torna robustos os downloads públicos do Griffin: modelos ONNX, CUDA/cuDNN, yt-dlp, prévias de áudio e stems remotos passam a seguir redirecionamentos públicos com validação de segurança. O download do runtime NVIDIA mantém a retomada por partes. Em builds Windows, os processos auxiliares não exibem mais janelas de console que possam parecer um prompt suspeito.

O workflow de release é disparado por tags `v*` e publica `.deb`, `.rpm`, instalador NSIS x64 e o manifesto assinado do updater. Os modelos ONNX não são mais empacotados no instalador: o próprio aplicativo os baixa sob demanda em runtime (`userData/models`), na primeira execução ou via Preferências.

## Projetos `.gfn`

O arquivo `.gfn` é um manifesto JSON versionado que preserva o projeto, a árvore de pastas/subpastas e as referências das bibliotecas. Os áudios continuam armazenados na biblioteca local; ao abrir um projeto em outro local, o Griffin informa quais arquivos não foram encontrados sem descartar o projeto carregado.

O empacotamento é feito pelo Tauri: o instalador Windows usa NSIS e as distribuições Linux geram `.deb` e `.rpm`. MSI não é anunciado pelo updater enquanto não houver um MSI real publicado. Cada artefato de atualização recebe assinatura Tauri e o `latest.json` é gerado a partir dos arquivos publicados no GitHub Releases. No Linux, o updater escolhe o `.deb` ou `.rpm` de acordo com o tipo do bundle instalado; o OBS continua disponível como canal de distribuição do RPM.

## Publicação no OBS

O pacote do Griffin Music fica no projeto pessoal `home:rodrigosbrito`, fora de qualquer projeto Lyra. O nome do pacote é `griffin-music`; não usar `home:rodrigosbrito:lyra` nem `griffin` como destino. A publicação da versão 1.2.1 deve atualizar `home:rodrigosbrito/griffin-music`.

## Chaves de assinatura

A chave pública do updater fica versionada em `src-tauri/tauri.conf.json`. A chave privada nunca deve entrar no repositório: configure `TAURI_SIGNING_PRIVATE_KEY` e, se aplicável, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` como secrets do repositório GitHub. Sem a chave privada, o workflow falha antes de publicar uma release incompleta.

O instalador inicial Linux descobre os assets pela API da release, baixa o `.sig` correspondente e verifica o arquivo com `minisign` usando a mesma chave pública antes de chamar `apt`, `dnf` ou `zypper`. A máquina precisa ter `curl` e `minisign`; a ausência do verificador encerra a instalação sem instalar um pacote não verificado.

O spec usado pelo OBS fica versionado em `packaging/griffin.spec`. O CI executa `scripts/validate-obs-spec.sh` contra o RPM gerado e verifica versão, binários, worker ONNX, providers, desktop entry e ícones. Assim, uma alteração manual no checkout do OBS não é necessária para uma publicação válida.

Para gerar uma nova chave, use `npx tauri signer generate -w caminho/griffin-music.key`. A perda da chave privada impede que instalações existentes aceitem atualizações futuras.

Validação local:

```bash
npm run typecheck
npm run build
npm run package:linux
npm run validate:packages
```

O teste do instalador Windows deve ser executado em runner Windows ou máquina Windows 10/11 x64. O yt-dlp é baixado pelo próprio Griffin em runtime e armazenado por usuário.
