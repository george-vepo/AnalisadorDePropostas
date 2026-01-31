import { describe, expect, it } from 'vitest';
import { validateStructuredAnalysis } from '../openaiSchema';

describe('validateStructuredAnalysis', () => {
  it('accepts a valid structured analysis', () => {
    const valid = {
      title: 'Teste',
      summary: 'Resumo',
      probable_cause: 'Causa',
      confidence: 80,
      severity: 'P2',
      evidence: ['E1'],
      next_steps: ['Passo 1'],
      questions: ['Pergunta'],
      suggested_runbooks: ['Runbook A'],
    };

    expect(validateStructuredAnalysis(valid)).toBe(true);
  });

  it('rejects an invalid structured analysis', () => {
    const invalid = {
      summary: 'Resumo',
    };

    expect(validateStructuredAnalysis(invalid)).toBe(false);
  });
});
