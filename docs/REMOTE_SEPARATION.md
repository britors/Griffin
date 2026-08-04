# Separação remota opcional

O Griffin separa stems localmente por padrão. A nuvem é uma alternativa opt-in para quem configura sua própria conta do StemSplit e confirma cada faixa enviada.

## Fluxo no Griffin

1. O usuário salva e testa a própria chave em **Preferências → Separação na nuvem (opcional)**.
2. O app consulta o saldo sem devolver a chave ao renderer ou gravá-la em `settings.json`.
3. No Studio, o usuário seleciona **Nuvem (StemSplit)**.
4. O Griffin valida arquivo, duração e limites, calcula uma estimativa e exibe o consentimento.
5. Após a confirmação, Rust solicita o upload, envia somente a faixa selecionada e cria o job.
6. O app acompanha o job por polling, baixa os WAVs, grava o cache e atualiza a biblioteca.
7. Em caso de falha, a interface permite tentar o motor local.

O comando Rust `separation_start` é o único runtime desse fluxo. Não há adaptador TypeScript ou SDK paralelo.

## Limites efetivos

| Regra | StemSplit documentado | Griffin aplicado |
| --- | ---: | ---: |
| Tamanho do arquivo | até 500 MB | até 100 MB |
| Duração | até 120 minutos | até 60 minutos |
| Taxa da API | 60 requisições/minuto | polling conservador por job |
| Saída | WAV, MP3 ou FLAC | WAV |
| Perfis usados | quatro ou seis stems | quatro ou seis stems |

Os limites menores do Griffin são intencionais: reduzem risco de memória, tempo de upload, custo inesperado e expiração. A estimativa exibida usa o preço de referência implementado no app; o valor cobrado pelo provedor é definitivo e deve ser conferido antes do envio.

Formatos de entrada aceitos pela API incluem MP3, WAV, FLAC, M4A, AAC, OGG, WebM e WMA. O pipeline do Griffin ainda pode rejeitar um arquivo que o provedor aceitaria se ele não puder ser inspecionado com segurança.

## Cancelamento e falhas

O StemSplit não documenta um endpoint de cancelamento do job usado por esta integração. Cancelar no Griffin interrompe o polling e impede que o resultado atrasado altere a interface, mas o processamento já criado pode continuar e consumir os créditos debitados.

O Griffin limita o acompanhamento a dez minutos. Timeout local não significa necessariamente que o job remoto foi cancelado. Falhas de rede não devem expor a chave e não desativam o motor local.

## Retenção e privacidade

Segundo a política oficial consultada em 4 de agosto de 2026:

- em upload direto, o original é apagado em até 48 horas;
- os stems de upload direto ficam disponíveis por até 14 dias;
- em processamento por URL, o original é apagado em até 24 horas e os stems ficam por até 7 dias;
- metadados de submissão podem ser retidos por até 90 dias;
- a política declara que o áudio não é usado para treinar modelos.

Essas regras pertencem ao provedor e podem mudar. Consulte a [política vigente do StemSplit](https://stemsplit.io/legal/privacy-policy). O Griffin baixa os resultados para o cache local; depois disso, a cópia local segue a política do próprio Griffin.

## Credencial

No Windows, a chave usa o cofre nativo quando disponível. No Linux, o fallback é um arquivo separado com permissão restrita ao usuário. Ela não é retornada por `settings_get`, não entra em `settings.json`, não aparece no diagnóstico e nunca deve ser incluída em issue, screenshot ou commit.

## Referências

- [Documentação da API StemSplit](https://stemsplit.io/developers/docs)
- [Preços do StemSplit](https://stemsplit.io/pricing)
- [Política de privacidade do StemSplit](https://stemsplit.io/legal/privacy-policy)
- [Comparação com provedores avaliados](REMOTE_PROVIDERS.md)
