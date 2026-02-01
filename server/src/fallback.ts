import type { extractSignals } from './signals/extractSignals';
import type { matchRunbooks } from './runbooks/matchRunbooks';

export const buildFallbackAnalysisText = (
  signals: ReturnType<typeof extractSignals>,
  runbooksMatched: ReturnType<typeof matchRunbooks>,
) => {
  const lines: string[] = [];
  const resumoParts = [
    signals.proposal.codProposta ? `Proposta ${signals.proposal.codProposta}` : 'Proposta analisada',
    signals.proposal.statusSituacao ? `STA_SITUACAO=${signals.proposal.statusSituacao}` : null,
    signals.proposal.statusAssinatura ? `STA_ASSINATURA=${signals.proposal.statusAssinatura}` : null,
    signals.proposal.statusPago ? `STA_PAGO=${signals.proposal.statusPago}` : null,
  ].filter(Boolean);

  lines.push('1) Resumo');
  lines.push(resumoParts.join(' | ') || 'Sem dados suficientes para resumo.');
  lines.push('');

  const hypotheses: string[] = [];
  if (signals.flags.includes('SENSIBILIZACAO_COM_ERRO')) {
    hypotheses.push('Falha em sensibilização ou integração (flag SENSIBILIZACAO_COM_ERRO).');
  }
  if (signals.flags.includes('ASSINADO_SEM_PAGAMENTO')) {
    hypotheses.push('Pagamento não confirmado após assinatura (flag ASSINADO_SEM_PAGAMENTO).');
  }
  if (signals.topErrors.length > 0) {
    hypotheses.push('Erro técnico registrado em erros[] (ver COD_ERRO/DES_ERRO).');
  }
  if (hypotheses.length === 0) {
    hypotheses.push('Dados insuficientes para causa provável; validar status e integrações.');
  }

  lines.push('2) Causa provável');
  hypotheses.slice(0, 3).forEach((item, index) => {
    lines.push(`${index + 1}. ${item}`);
  });
  lines.push('');

  lines.push('3) Evidências');
  const evidence: string[] = [];
  if (signals.proposal.statusSituacao) {
    evidence.push(`proposta.STA_SITUACAO=${signals.proposal.statusSituacao}`);
  }
  if (signals.proposal.statusAssinatura) {
    evidence.push(`proposta.STA_ASSINATURA=${signals.proposal.statusAssinatura}`);
  }
  if (signals.proposal.statusPago) {
    evidence.push(`proposta.STA_PAGO=${signals.proposal.statusPago}`);
  }
  if (signals.counts.integracoesTotal > 0) {
    evidence.push(`integracoes[].STA_STATUS (total=${signals.counts.integracoesTotal})`);
  }
  if (signals.counts.errosTotal > 0) {
    evidence.push(`erros[].COD_ERRO/DES_ERRO (total=${signals.counts.errosTotal})`);
  }
  if (signals.flags.length > 0) {
    evidence.push(`signals.flags=${signals.flags.join(', ')}`);
  }
  if (signals.topErrors.length > 0) {
    signals.topErrors.slice(0, 3).forEach((error) => {
      const codigo = error.codigo ?? 'SEM_CODIGO';
      const mensagem = error.mensagemCurta ?? 'Sem mensagem';
      evidence.push(`erros[].COD_ERRO=${codigo} | DES_ERRO=${mensagem}`);
    });
  }
  if (evidence.length === 0) {
    evidence.push('Sem evidências suficientes nos sinais coletados.');
  }
  evidence.forEach((item) => lines.push(`- ${item}`));
  lines.push('');

  lines.push('4) Próximos passos');
  const nextSteps: string[] = [];
  if (runbooksMatched.length > 0) {
    runbooksMatched.slice(0, 3).forEach((runbook) => {
      nextSteps.push(`Aplicar runbook "${runbook.title}" (${runbook.severitySuggestion ?? 'sem severidade'}).`);
    });
  }
  if (signals.counts.integracoesTotal > 0) {
    nextSteps.push('Verificar integrações com STA_STATUS=ERRO e logs técnicos associados.');
  }
  if (signals.counts.errosTotal > 0) {
    nextSteps.push('Validar COD_ERRO/DES_ERRO nas tabelas de erros para confirmar causa raiz.');
  }
  if (nextSteps.length === 0) {
    nextSteps.push('Coletar logs e integrações recentes para detalhar a falha.');
  }
  nextSteps.slice(0, 5).forEach((item) => lines.push(`- ${item}`));
  lines.push('');

  lines.push('5) Perguntas para confirmar');
  const questions: string[] = [];
  if (!signals.proposal.statusSituacao) {
    questions.push('Qual o valor de proposta.STA_SITUACAO no momento da análise?');
  }
  if (!signals.proposal.statusAssinatura) {
    questions.push('Qual o status de proposta.STA_ASSINATURA ou assinaturaDigital.STA_ASSINATURA?');
  }
  if (!signals.proposal.statusPago) {
    questions.push('Existe confirmação de pagamento (proposta.STA_PAGO/pagamento.STA_PAGAMENTO)?');
  }
  if (signals.counts.errosTotal === 0) {
    questions.push('Há registros em erros[].COD_ERRO/DES_ERRO para esta proposta?');
  }
  if (signals.counts.integracoesTotal === 0) {
    questions.push('Houve integrações recentes (integracoes[].STA_STATUS/DES_INTEGRACAO)?');
  }
  if (questions.length === 0) {
    questions.push('Há evidências adicionais (logs, traceId/requestId) para confirmar a causa?');
  }
  questions.slice(0, 5).forEach((item) => lines.push(`- ${item}`));

  return lines.join('\n');
};
