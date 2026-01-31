import { describe, expect, it } from 'vitest';
import {
  structuredAnalysisSchema,
  validateStructuredAnalysis,
  validateStructuredOutput,
} from '../openaiSchema';

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

describe('validateStructuredOutput', () => {
  it('validates against a provided schema', () => {
    const valid = {
      title: 'Teste',
      summary: 'Resumo',
      probable_cause: 'Causa',
      confidence: 90,
      severity: 'P1',
      evidence: ['E1'],
      next_steps: ['Passo 1'],
      questions: ['Pergunta'],
    };

    const result = validateStructuredOutput(structuredAnalysisSchema, valid);
    expect(result.valid).toBe(true);
  });

  it('flags invalid payloads against the schema', () => {
    const invalid = {
      title: 'Sem campos obrigatórios',
    };

    const result = validateStructuredOutput(structuredAnalysisSchema, invalid);
    expect(result.valid).toBe(false);
  });
});
