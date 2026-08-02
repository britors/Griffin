# Provedores remotos de separação

## Decisão

O Griffin mantém a separação local como caminho padrão e oferece a separação remota como opção explícita. O primeiro provedor integrado é o StemSplit, por ter uma API pública orientada a separação de stems, suporte a 4 e 6 stems, chave de API por usuário e cobrança por créditos sem assinatura obrigatória.

AudioShake e LALAL.AI ficam registrados como alternativas avaliadas, mas não são integrados nesta versão. A integração pode ser adicionada atrás do mesmo contrato de separação remota sem alterar o fluxo local.

## Comparativo

| Provedor | API e saída | Modelo comercial observado | Decisão |
| --- | --- | --- | --- |
| StemSplit | REST; upload presigned; polling; 2, 4 e 6 stems; WAV, MP3 e FLAC | Créditos por duração, sem assinatura obrigatória; 5 minutos iniciais e pacotes publicados de $0,10–$0,20/min | Integrado no runtime Tauri/Rust |
| LALAL.AI | API para stem splitting e redução de ruído; também oferece desktop e VST | A página de preços indica assinatura; acesso à API aparece no plano Pro | Adiado: revisar contrato comercial e fluxo de cobrança antes de integrar |
| AudioShake | API/SDK para separação e uso profissional; oferta pública também inclui plano Indie | Preços públicos variam por produto; a página Indie publica cobrança por stem, enquanto o acesso de API/SDK exige validação comercial | Adiado: falta um caminho self-service claro para o caso do Griffin |

## Critérios de integração

- O usuário precisa configurar a própria chave; ela é armazenada no cofre do sistema quando disponível.
- A opção remota só aparece quando a chave foi verificada.
- Antes de cada operação remota, o Griffin informa que o áudio deixará o computador e mostra uma estimativa de custo.
- A interface mostra fila, processamento, conclusão, falhas, expiração e cancelamento.
- Os stems retornados entram no cache local e a separação local continua funcionando sem rede ou chave.
- O Griffin mantém limites próprios de 100 MB e 60 minutos para proteger memória e previsibilidade, mesmo que o provedor publique limites maiores.

## Referências

- [StemSplit API — documentação](https://stemsplit.io/developers/docs)
- [StemSplit — preços](https://stemsplit.io/pricing)
- [LALAL.AI API](https://www.lalal.ai/api/)
- [LALAL.AI — preços](https://www.lalal.ai/pricing/)
- [AudioShake — portal de desenvolvedores](https://www.audioshake.ai/developer-home)
- [AudioShake Indie — preços](https://indie.audioshake.ai/pricing)
