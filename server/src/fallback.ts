import type { extractSignals } from './signals/extractSignals';
import type { matchRunbooks } from './runbooks/matchRunbooks';

export const buildFallbackAnalysisText = (
  signals: ReturnType<typeof extractSignals>,
  runbooksMatched: ReturnType<typeof matchRunbooks>,
) => {
  const lines: string[] = [];
  lines.push(`Resumo rápido da proposta ${signals.proposal.codProposta ?? ''}`.trim());
  lines.push('');
  lines.push('Sinais principais:');
  lines.push(`- Situação: ${signals.proposal.statusSituacao ?? 'N/D'}`);
  lines.push(`- Assinatura: ${signals.proposal.statusAssinatura ?? 'N/D'}`);
  lines.push(`- Pago: ${signals.proposal.statusPago ?? 'N/D'}`);
  lines.push(`- Integrações: ${signals.counts.integracoesTotal}`);
  lines.push(`- Erros: ${signals.counts.errosTotal}`);
  if (signals.flags.length > 0) {
    lines.push(`- Flags: ${signals.flags.join(', ')}`);
  }
  if (signals.topErrors.length > 0) {
    lines.push('');
    lines.push('Erros frequentes:');
    signals.topErrors.forEach((error) => {
      lines.push(`- ${error.codigo ?? 'SEM_CODIGO'}: ${error.mensagemCurta ?? 'Sem mensagem'}`);
    });
  }
  if (runbooksMatched.length > 0) {
    lines.push('');
    lines.push('Runbooks sugeridos:');
    runbooksMatched.forEach((runbook) => {
      lines.push(`- ${runbook.title} (${runbook.severitySuggestion})`);
    });
  }
  lines.push('');
  lines.push('Dados insuficientes? Validar status em sistemas de origem e confirmar integrações recentes.');
  return lines.join('\n');
};
