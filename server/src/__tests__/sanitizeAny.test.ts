import { describe, expect, it } from 'vitest';
import { sanitizeForOpenAI } from '../sanitizer';
import { normalizeFieldName } from '../sanitizer/normalizeFieldName';

const buildAllowList = (names: string[]) => new Set(names.map((name) => normalizeFieldName(name)));

describe('sanitizeForOpenAI', () => {
  it('removes fields when strings contain CPF digits', () => {
    const allowList = buildAllowList(['mensagem']);
    const payload = { mensagem: 'Não foi encontrado os dados para o CPF:14028002664' };

    const result = sanitizeForOpenAI(payload, allowList);

    expect(result.sanitizedJson).toEqual({});
  });

  it('normalizes only multiple spaces while preserving single spaces', () => {
    const allowList = buildAllowList(['mensagem']);
    const payload = { mensagem: 'Texto   com  espaços   úteis' };

    const result = sanitizeForOpenAI(payload, allowList);
    const sanitized = result.sanitizedJson as typeof payload;

    expect(sanitized).toEqual({ mensagem: 'Texto com espaços úteis' });
  });

  it('removes DES_RETORNO when it contains large base64 content', () => {
    const allowList = buildAllowList(['DES_RETORNO']);
    const payload = { DES_RETORNO: `JVBERi0x${'A'.repeat(2100)}` };

    const result = sanitizeForOpenAI(payload, allowList);

    expect(result.sanitizedJson).toEqual({});
  });

  it('removes sensitive query params from URL fields', () => {
    const allowList = buildAllowList(['URL_SERVICO']);
    const payload = { URL_SERVICO: 'https://example.com/api?Cpf=14028002664&foo=bar' };

    const result = sanitizeForOpenAI(payload, allowList);
    const sanitized = result.sanitizedJson as typeof payload;

    const parsedUrl = new URL(sanitized.URL_SERVICO);
    expect(parsedUrl.searchParams.get('Cpf')).toBeNull();
    expect(parsedUrl.searchParams.get('foo')).toBe('bar');
  });

  it('removes objects that become empty after cleaning', () => {
    const allowList = buildAllowList(['detalhes']);
    const payload = { detalhes: { cpf: '11122233344' } };

    const result = sanitizeForOpenAI(payload, allowList);

    expect(result.sanitizedJson).toEqual({});
  });
});
