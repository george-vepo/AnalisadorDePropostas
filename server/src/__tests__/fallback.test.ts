import { describe, expect, it } from 'vitest';
import { buildFallbackAnalysisText } from '../fallback';

describe('buildFallbackAnalysisText', () => {
  it('builds a summary using signals and runbooks', () => {
    const signals = {
      proposal: {
        codProposta: '123',
        statusSituacao: 'OK',
        statusAssinatura: 'OK',
        statusPago: 'N',
      },
      counts: { integracoesTotal: 2, errosTotal: 1 },
      flags: ['FLAG_TESTE'],
      topErrors: [{ codigo: 'E1', mensagemCurta: 'Erro teste' }],
    };
    const runbooksMatched = [{ title: 'Runbook A', severitySuggestion: 'P1' }];

    const text = buildFallbackAnalysisText(signals as any, runbooksMatched as any);
    expect(text).toContain('Resumo rápido da proposta 123');
    expect(text).toContain('FLAG_TESTE');
    expect(text).toContain('Runbook A');
  });
});
