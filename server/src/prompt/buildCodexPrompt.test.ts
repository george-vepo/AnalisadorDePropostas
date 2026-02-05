import { describe, expect, it } from 'vitest';
import { buildCodexPrompt } from './buildCodexPrompt';

describe('buildCodexPrompt', () => {
  it('includes sensibilizacao context', () => {
    const prompt = buildCodexPrompt('123', { ok: true }, 'sensibilizacao');
    expect(prompt).toContain('sensibilização');
    expect(prompt).toContain('Tipo de análise: sensibilizacao');
  });

  it('includes pagamento context', () => {
    const prompt = buildCodexPrompt('123', { ok: true }, 'pagamento');
    expect(prompt).toContain('fluxo de pagamento');
    expect(prompt).toContain('Tipo de análise: pagamento');
  });
});
