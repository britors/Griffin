# Separação remota opcional (issue #80)

O Griffin separa stems localmente por padrão, sem rede. Este documento registra a avaliação e a decisão sobre oferecer, de forma **opcional**, um provedor de separação em nuvem.

## Comparativo de provedores

| Provedor | Modelo de preço | Acesso à API | Encaixe |
|---|---|---|---|
| AudioShake | Enterprise, sob consulta comercial | `api.audioshake.ai`, sem self-serve | Voltado a labels/distribuidoras; não serve para um app desktop indie |
| LALAL.AI | Assinatura mensal/anual | API só no plano Pro (~US$15–20/mês, cobrado mesmo sem uso) | Cobrança fixa não combina com uso opcional/esporádico |
| **StemSplit** (escolhido) | Pay-as-you-go, sem assinatura | REST, self-serve, 5 min grátis por conta | Cobra só pelo uso — encaixa no modelo opcional |

## Decisão

**StemSplit** foi escolhido como primeiro (e único, por ora) provedor remoto suportado. Além do preço, é o mesmo time por trás do org `StemSplitio` no Hugging Face, de onde o Griffin já baixa os pesos ONNX do modelo local (issue #85) — já era uma dependência de confiança do projeto antes desta decisão.

## Limites técnicos (API StemSplit)

- Arquivo: até 100 MB, até 60 minutos de áudio.
- Taxa: 60 requisições/minuto.
- Formatos de entrada: MP3, WAV, FLAC, M4A, AAC, OGG, WebM, WMA. Saída: MP3, WAV, FLAC (Griffin sempre pede WAV, para compatibilidade com o pipeline local).
- Sem endpoint de cancelamento de job: cancelar no Griffin só interrompe o acompanhamento local (polling); o processamento no servidor pode continuar e consumir créditos já debitados.

## Retenção de dados (StemSplit)

- Upload direto: arquivo original apagado em até 48h; stems ficam disponíveis para download por 14 dias e depois somem automaticamente.
- Envio por URL: original apagado em até 24h; stems disponíveis por 7 dias.
- Metadados de submissão retidos por 90 dias (prevenção a abuso/conformidade legal).
- Sem uso de áudio para treinar modelos, segundo a política de privacidade vigente na data desta avaliação.

## Como funciona no Griffin

O único runtime de separação remota é o comando Tauri em Rust. Ele usa a API REST do StemSplit diretamente; não há um adaptador TypeScript ou SDK paralelo.

- Requer uma chave de API própria do usuário (Preferências → Processamento → "Separação na nuvem"). No Windows e macOS ela fica no cofre nativo do sistema; no Linux, em arquivo separado com permissão restrita ao usuário. Ela não é retornada por `settings_get` nem gravada em `settings.json`.
- Só aparece como opção no player quando a chave está configurada **e** verificada (saldo consultado com sucesso).
- Sempre exige consentimento explícito antes de cada operação remota, com estimativa de custo e resumo da retenção.
- Se a separação remota falhar, o app oferece "Tentar localmente" como fallback — a separação local continua funcionando normalmente sem qualquer configuração de nuvem.
