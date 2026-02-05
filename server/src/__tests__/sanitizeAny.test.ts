import { describe, expect, it } from 'vitest';
import { sanitizePayload } from '../sanitizer';

describe('sanitizePayload', () => {
  it('removes sensitive fields', () => {
    const payload = { nome: 'Teste', cpf: '14028002664', tokenAcesso: 'abc' };
    const result = sanitizePayload(payload) as Record<string, unknown>;

    expect(result).toEqual({ nome: 'Teste' });
  });

  it('masks CPF/CNPJ sequence inside string and truncates long content', () => {
    const payload = { mensagem: `CPF 14028002664 ${'x'.repeat(120)}` };
    const result = sanitizePayload(payload, { maxStringLength: 40 }) as Record<string, string>;

    expect(result.mensagem).toContain('[REDACTED]');
    expect(result.mensagem.endsWith('...')).toBe(true);
  });

  it('limits array size', () => {
    const payload = { itens: Array.from({ length: 5 }, (_, index) => ({ id: index })) };
    const result = sanitizePayload(payload, { maxArrayItems: 2 }) as { itens: Array<{ id: number }> };

    expect(result.itens).toHaveLength(2);
    expect(result.itens[1]).toEqual({ id: 1 });
  });
});
