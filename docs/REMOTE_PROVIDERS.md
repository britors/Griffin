# Provedores remotos de separação

Avaliação revisada em **4 de agosto de 2026**. Preços, limites e políticas de terceiros podem mudar; confira as fontes antes de alterar a integração ou o texto exibido ao usuário.

## Decisão atual

O Griffin mantém a separação local como caminho padrão. A única integração remota implementada é o **StemSplit**, escolhida por oferecer API REST self-service, chave por usuário, quatro ou seis stems e créditos sem assinatura obrigatória.

AudioShake e LALAL.AI continuam como alternativas técnicas, mas não possuem adaptador no runtime atual. Uma futura integração deve reutilizar as garantias de consentimento, segredo, limite, cancelamento, cache e fallback local.

## Comparativo

| Provedor | API e saída | Modelo comercial observado | Situação no Griffin |
| --- | --- | --- | --- |
| StemSplit | REST, upload assinado, job com polling, quatro ou seis stems; WAV, MP3 e FLAC | 5 minutos iniciais; pacotes pay-as-you-go publicados entre US$ 0,10 e US$ 0,20 por minuto, sem assinatura | Integrado em Tauri/Rust |
| LALAL.AI | API de stem splitting e limpeza; produtos web, desktop e plugin | Acesso à API incluído no plano Pro; assinatura e franquia de minutos | Adiado: cobrança fixa e contrato precisam ser revistos |
| AudioShake | API para separação e serviços profissionais; produto Indie separado | Portal de desenvolvedores oferece 10 créditos de teste e opção pay-as-you-go | Adiado: avaliar preços efetivos, termos, retenção e UX de créditos |

## Limites: provedor versus aplicativo

A documentação do StemSplit publica limite de **500 MB e 120 minutos** por arquivo, além de 60 requisições por minuto. O Griffin deliberadamente aplica limites menores, de **100 MB e 60 minutos**, para manter previsibilidade de memória, upload, custo e tempo de espera. Mensagens e testes devem chamar esses valores de “limites do Griffin”, não de limites máximos do StemSplit.

## Requisitos para qualquer integração

- A separação local permanece funcional sem rede, conta ou chave.
- O usuário fornece sua própria credencial, que nunca entra em `settings.json` ou no diagnóstico.
- A interface só oferece o provedor após verificar a credencial.
- Cada envio exige confirmação com destino, custo estimado, retenção e efeito do cancelamento.
- Somente a faixa escolhida pode ser enviada.
- O backend valida tamanho, duração, formato, URLs, redirecionamentos e tamanho dos resultados.
- Fila, progresso, conclusão, falha e expiração precisam ser visíveis.
- Os stems retornados entram no cache local e são persistidos como os resultados locais.
- A ausência de endpoint remoto de cancelamento deve ser explicada antes do envio.
- Termos, preços e privacidade precisam ser revistos antes de cada release que altere o provedor.

## Referências oficiais

- [StemSplit API](https://stemsplit.io/developers/docs)
- [StemSplit — preços](https://stemsplit.io/pricing)
- [StemSplit — privacidade](https://stemsplit.io/legal/privacy-policy)
- [LALAL.AI API](https://www.lalal.ai/api/v1/docs/)
- [LALAL.AI — preços](https://www.lalal.ai/pricing/)
- [AudioShake — portal de desenvolvedores](https://developer.audioshake.ai/)
- [AudioShake Indie — preços](https://indie.audioshake.ai/pricing)
