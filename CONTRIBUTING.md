# Contribuindo com o Griffin Music

## Regra principal

`main` é uma branch protegida. Não fazemos push direto nela. Toda alteração deve estar relacionada a uma issue, ser desenvolvida em uma branch própria e entrar por Pull Request.

## Fluxo de trabalho

1. Escolha ou crie uma issue no GitHub.
2. Atualize sua cópia local:

   ```bash
   git switch main
   git pull --ff-only origin main
   ```

3. Crie uma branch a partir de `main`:

   ```bash
   git switch -c feature/29-salvar-projetos
   ```

   Use `feature/` para funcionalidades, `fix/` para bugs, `chore/` para manutenção e `docs/` para documentação.

4. Implemente, teste e faça commits pequenos e claros. Preserve alterações locais sem relação com a issue.
5. Envie a branch e abra um PR:

   ```bash
   git push -u origin feature/29-salvar-projetos
   gh pr create --base main --head feature/29-salvar-projetos
   ```

6. O PR deve referenciar a issue, passar pela validação automática e ser mergeado somente depois da revisão.
7. Depois do merge, remova a branch local e remota quando apropriado.

## Convenções

- Uma issue por mudança coerente.
- Uma branch por issue.
- Não misturar refatorações sem relação com a issue.
- Atualizar testes e documentação quando o comportamento mudar.
- Antes do PR, executar as validações proporcionais à mudança. O conjunto padrão está abaixo.
- Usar `Closes #N` ou `Fixes #N` no PR quando a mudança resolver a issue.
- Não versionar modelos ONNX, runtimes, áudios, relatórios, chaves de API, chaves de assinatura ou diretórios de build.
- Mudanças em rede, arquivos ou processos externos devem manter validação de entrada, limites, cancelamento e mensagens sem dados sensíveis.

## Validação local

Para alterações no renderer ou nos contratos compartilhados:

```bash
npm run typecheck
npm test
npm run build:frontend
```

Para alterações em Rust, comandos Tauri, persistência, downloads ou worker:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features gui
npm run validate:tauri
```

Antes de preparar uma release, acrescente `npm run validate:version`, `npm run test:updater-manifest` e as validações de pacote descritas em [`docs/RELEASE.md`](docs/RELEASE.md). `npm run build` gera o aplicativo Tauri completo; para validar apenas a interface, prefira `npm run build:frontend`.

## Modelo de commits

Prefira mensagens objetivas, por exemplo:

```text
feat(player): implement loop A-B
fix(audio): preserve pitch while changing tempo
chore(repo): update release workflow
```
