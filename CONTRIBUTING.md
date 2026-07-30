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

4. Implemente, teste e faça commits pequenos e claros.
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
- Antes do PR, executar `npm run typecheck`, `npm test` e `npm run build`.
- Usar `Closes #N` ou `Fixes #N` no PR quando a mudança resolver a issue.

## Modelo de commits

Prefira mensagens objetivas, por exemplo:

```text
feat(player): implement loop A-B
fix(audio): preserve pitch while changing tempo
chore(repo): update release workflow
```
