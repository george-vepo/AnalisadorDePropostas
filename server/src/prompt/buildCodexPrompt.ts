import type { AnalysisType } from '../analysisData';

const toCompactJson = (value: unknown) => JSON.stringify(value);

const getContextByAnalysisType = (analysisType: AnalysisType) => {
  if (analysisType === 'sensibilizacao') {
    return 'Contexto: Quero diagnosticar erro de sensibilização (repasse CVP -> SIGPF/CAIXA) e inconsistências entre integrações e base interna.';
  }

  if (analysisType === 'pagamento') {
    return 'Contexto: Quero diagnosticar o fluxo de pagamento (boleto/link, débito, status final) e inconsistências entre etapas.';
  }

  return 'Contexto: Estou usando um app que extrai dados de proposta e quero revisar/diagnosticar inconsistências.';
};

export const buildCodexPrompt = (proposalNumber: string, sanitizedData: unknown, analysisType: AnalysisType = 'padrao') => {
  const compact = toCompactJson(sanitizedData);

  return [
    getContextByAnalysisType(analysisType),
    `Tipo de análise: ${analysisType}`,
    `Proposta: ${proposalNumber}`,
    '',
    'Dados (sanitizados):',
    compact,
    '',
    'Tarefas:',
    '- Identifique inconsistências ou lacunas relevantes no fluxo da proposta.',
    '- Aponte possíveis causas técnicas em ordem de probabilidade.',
    '- Sugira um checklist objetivo de validação para confirmar a causa raiz.',
    '- Recomende próximos passos de correção e quais evidências coletar.',
  ]
    .filter(Boolean)
    .join('\n');
};
