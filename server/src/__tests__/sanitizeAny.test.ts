import { describe, expect, it } from 'vitest';
import { sanitizeForOpenAI } from '../sanitizer';
import { normalizeFieldName } from '../sanitizer/normalizeFieldName';

const buildAllowList = (names: string[]) => new Set(names.map((name) => normalizeFieldName(name)));

describe('sanitizeForOpenAI', () => {
  it('removes sensitive fields even if allowlisted', () => {
    const allowList = buildAllowList(['cpf', 'codigoProposta']);
    const payload = { cpf: '11122233344', codigoProposta: 'ABC123' };

    const result = sanitizeForOpenAI(payload, allowList);
    const sanitized = result.sanitizedJson as typeof payload;

    expect(sanitized).toEqual({ codigoProposta: 'ABC123' });
  });

  it('drops base64 and JWT-like strings', () => {
    const allowList = buildAllowList(['descricao', 'mensagem']);
    const jwt = `${'a'.repeat(30)}.${'b'.repeat(90)}.${'c'.repeat(90)}`;
    const payload = { descricao: 'A'.repeat(240), mensagem: jwt };

    const result = sanitizeForOpenAI(payload, allowList);
    const sanitized = result.sanitizedJson as typeof payload;

    expect(sanitized).toEqual({});
  });

  it('sanitizes JSON strings inside DES_ENVIO/DES_RETORNO', () => {
    const allowList = buildAllowList(['DES_ENVIO', 'DES_RETORNO', 'status', 'sucesso', 'codigo', 'descricao']);
    const payload = {
      DES_ENVIO: '{"status":"OK","cpf":"11122233344","dados":{"codigo":"X1","token":"abc"}}',
      DES_RETORNO: JSON.stringify({ sucesso: true, descricao: 'ok', cpf: '00011122233' }),
    };

    const result = sanitizeForOpenAI(payload, allowList);
    const sanitized = result.sanitizedJson as Record<string, unknown>;
    const envio = sanitized.DES_ENVIO as Record<string, unknown>;
    const retorno = sanitized.DES_RETORNO as Record<string, unknown>;

    expect(envio.status).toBe('OK');
    expect((envio as { cpf?: string }).cpf).toBeUndefined();
    const envioDados = envio.dados as Record<string, unknown>;
    expect(envioDados.codigo).toBe('X1');
    expect((envioDados as { token?: string }).token).toBeUndefined();

    expect(retorno.sucesso).toBe(true);
    expect(retorno.descricao).toBe('ok');
    expect((retorno as { cpf?: string }).cpf).toBeUndefined();
  });

  it('keeps payload under the configured limit', () => {
    const allowList = buildAllowList(['status', 'logs']);
    const payload = {
      logs: Array.from({ length: 50 }, (_, index) => ({
        status: `OK-${index}`,
        cpf: '11122233344',
      })),
    };

    const result = sanitizeForOpenAI(payload, allowList, { maxPayloadBytes: 400 });
    const sanitizedJson = result.sanitizedJson as Record<string, unknown>;
    const bytes = Buffer.byteLength(JSON.stringify(sanitizedJson));

    expect(bytes).toBeLessThanOrEqual(400);
    expect(result.stats.payloadTrimmed).toBe(true);
    const logs = (sanitizedJson.logs ?? []) as Array<Record<string, unknown>>;
    if (logs.length > 0) {
      expect(logs[0].cpf).toBeUndefined();
    }
  });
});
