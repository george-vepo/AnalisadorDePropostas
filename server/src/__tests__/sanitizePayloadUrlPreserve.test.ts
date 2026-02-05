import { describe, expect, it } from 'vitest';
import { sanitizePayloadDetailed } from '../sanitizer';
import { normalizeFieldName } from '../sanitizer/normalizeFieldName';

const buildAllowList = (fields: string[]) => new Set(fields.map((field) => normalizeFieldName(field)));

describe('sanitizePayload URL preservation for analysis-specific flows', () => {
  it('keeps non-parseable service URL when preserveUnparseableUrls is enabled', () => {
    const allowList = buildAllowList(['URL_SERVICO']);
    const payload = { URL_SERVICO: '/sigpf/sensibilizacao?cpf=14028002664&proposta=123' };

    const result = sanitizePayloadDetailed(payload, {
      allowList,
      preserveUnparseableUrls: true,
    });

    expect(result.sanitizedJson).toEqual({
      URL_SERVICO: '/sigpf/sensibilizacao?cpf=***********&proposta=123',
    });
  });

  it('removes non-parseable service URL when preserveUnparseableUrls is disabled', () => {
    const allowList = buildAllowList(['URL_SERVICO']);
    const payload = { URL_SERVICO: '/sigpf/pagamento?cpf=14028002664&proposta=123' };

    const result = sanitizePayloadDetailed(payload, {
      allowList,
      preserveUnparseableUrls: false,
    });

    expect(result.sanitizedJson).toEqual({});
  });
});
