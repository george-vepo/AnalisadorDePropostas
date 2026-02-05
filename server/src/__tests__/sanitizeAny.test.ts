import { describe, expect, it } from 'vitest';
import { sanitizePayloadDetailed } from '../sanitizer';
import { normalizeFieldName } from '../sanitizer/normalizeFieldName';

const buildAllowList = (names: string[]) => new Set(names.map((name) => normalizeFieldName(name)));

describe('sanitizePayloadDetailed', () => {
  it('masks CPF digits inside strings without removing the field', () => {
    const allowList = buildAllowList(['mensagem']);
    const payload = { mensagem: 'Não foi encontrado os dados para o CPF:14028002664' };

    const result = sanitizePayloadDetailed(payload, { allowList });

    expect(result.sanitizedJson).toEqual({
      mensagem: 'Não foi encontrado os dados para o CPF:***********',
    });
  });

  it('normalizes only multiple spaces while preserving single spaces', () => {
    const allowList = buildAllowList(['mensagem']);
    const payload = { mensagem: 'Texto   com  espaços   úteis' };

    const result = sanitizePayloadDetailed(payload, { allowList });
    const sanitized = result.sanitizedJson as typeof payload;

    expect(sanitized).toEqual({ mensagem: 'Texto com espaços úteis' });
  });

  it('removes DES_RETORNO when it contains large base64 content', () => {
    const allowList = buildAllowList(['DES_RETORNO']);
    const payload = { DES_RETORNO: `JVBERi0x${'A'.repeat(2100)}` };

    const result = sanitizePayloadDetailed(payload, { allowList });

    expect(result.sanitizedJson).toEqual({});
  });

  it('removes sensitive query params from URL fields', () => {
    const allowList = buildAllowList(['URL_SERVICO']);
    const payload = { URL_SERVICO: 'https://example.com/api?Cpf=14028002664&foo=bar' };

    const result = sanitizePayloadDetailed(payload, { allowList });
    const sanitized = result.sanitizedJson as typeof payload;

    const parsedUrl = new URL(sanitized.URL_SERVICO);
    expect(parsedUrl.searchParams.get('Cpf')).toBeNull();
    expect(parsedUrl.searchParams.get('foo')).toBe('bar');
  });

  it('removes objects that become empty after cleaning', () => {
    const allowList = buildAllowList(['detalhes']);
    const payload = { detalhes: { cpf: '11122233344' } };

    const result = sanitizePayloadDetailed(payload, { allowList });

    expect(result.sanitizedJson).toEqual({});
  });

  it('keeps large DES_ENVIO strings intact while masking CPFs', () => {
    const allowList = buildAllowList(['DES_ENVIO']);
    const text = `Inicio ${'á'.repeat(100000)} CPF 14028002664 fim ${'B'.repeat(100000)}`;
    const payload = { DES_ENVIO: text };

    const result = sanitizePayloadDetailed(payload, { allowList });
    const sanitized = result.sanitizedJson as typeof payload;

    expect(sanitized.DES_ENVIO).toContain('CPF ***********');
    expect(sanitized.DES_ENVIO).not.toContain('14028002664');
    expect(sanitized.DES_ENVIO).not.toContain('TRUNCATED');
    expect(sanitized.DES_ENVIO.length).toBe(text.length);
  });

  it('truncates arrays with metadata when exceeding maxArrayItems', () => {
    const allowList = buildAllowList(['itens', 'id']);
    const payload = { itens: Array.from({ length: 500 }, (_, index) => ({ id: index })) };

    const result = sanitizePayloadDetailed(payload, { allowList, maxArrayItems: 50 });
    const sanitized = result.sanitizedJson as any;

    expect(sanitized.itens.__meta).toEqual({
      arrayTruncated: true,
      originalLength: 500,
      kept: 50,
    });
    expect(sanitized.itens.items).toHaveLength(50);
    expect(sanitized.itens.items[0]).toEqual({ id: 0 });
  });

  it('replaces deep objects beyond maxDepth with a placeholder', () => {
    const allowList = buildAllowList(['nivel1', 'nivel2']);
    const payload = { nivel1: { nivel2: { nivel3: { valor: 'x' } } } };

    const result = sanitizePayloadDetailed(payload, { allowList, maxDepth: 2 });
    const sanitized = result.sanitizedJson as any;

    expect(sanitized.nivel1.nivel2.nivel3).toBe('<DEPTH_LIMIT_REACHED>');
  });
});
