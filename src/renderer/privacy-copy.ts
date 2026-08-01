export const LOCAL_PRIVACY_LABEL = 'Local por padrão'
export const LOCAL_PRIVACY_DESCRIPTION = 'O processamento é local por padrão. Uma faixa só sai do computador se você escolher a separação na nuvem e confirmar o envio.'

export function remoteConsentMessage(costLine: string) {
  return `Esta operação enviará a faixa selecionada para o StemSplit.io (nuvem) — o áudio deixará este computador.\n\n${costLine}\n\nO arquivo original é apagado em até 48h; os stems ficam disponíveis por 7-14 dias. Cancelar não garante que a cobrança seja evitada, já que o processamento pode já ter começado no servidor. Esta confirmação é solicitada antes de cada operação remota.`
}
