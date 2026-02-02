import { describe, expect, it } from 'vitest';
import { normalizeFieldName, stripPayloadNoise } from '../sanitizer';

const buildAllowList = (fields: string[]) => new Set(fields.map((field) => normalizeFieldName(field)));

describe('stripPayloadNoise', () => {
  const allowList = buildAllowList([
    'codSessao',
    'codigoSessao',
    'sessionId',
    'stackTrace',
    'mensagem',
    'descricao',
    'DES_ENVIO',
    'DES_RETORNO',
  ]);

  it('remove JWT tokens', () => {
    const input = {
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signed',
      mensagem: 'ok',
    };

    const result = stripPayloadNoise(input, { allowList });

    expect(result).toEqual({ mensagem: 'ok' });
  });

  it('removes large base64 payloads', () => {
    const base64 = 'A'.repeat(240);
    const input = { descricao: base64 };

    const result = stripPayloadNoise(input, { allowList });

    expect(result).toEqual({ descricao: '[REMOVIDO_BASE64]' });
  });

  it('removes large hex blobs', () => {
    const hex = 'a'.repeat(80);
    const input = { descricao: hex };

    const result = stripPayloadNoise(input, { allowList });

    expect(result).toEqual({ descricao: '[REMOVIDO_HEX]' });
  });

  it('truncates huge stack traces', () => {
    const stackTrace = 'line\n'.repeat(600);
    const input = { stackTrace };

    const result = stripPayloadNoise(input, { allowList, maxStackTraceLength: 200 });

    expect((result as { stackTrace: string }).stackTrace.endsWith('...(truncado)')).toBe(true);
    expect((result as { stackTrace: string }).stackTrace.length).toBeLessThanOrEqual(213);
  });

  it('parses and sanitizes JSON inside DES_ENVIO', () => {
    const payload = JSON.stringify({
      codigoSessao: 'ABC123',
      token: 'header.payload.signature',
      stackTrace: 'line\n'.repeat(600),
    });
    const input = { DES_ENVIO: payload };

    const result = stripPayloadNoise(input, { allowList, maxStackTraceLength: 200 });
    const sanitized = (result as { DES_ENVIO: Record<string, unknown> }).DES_ENVIO;

    expect(sanitized).toEqual({
      codigoSessao: 'ABC123',
      stackTrace: expect.stringContaining('...(truncado)'),
    });
  });

  it('keeps codigoSessao and sessionId in nested objects', () => {
    const input = {
      wrapper: {
        COD_SESSAO: 'S123',
        inner: {
          sessionId: 'S456',
          token: 'header.payload.signature',
        },
      },
    };

    const result = stripPayloadNoise(input, { allowList });

    expect(result).toEqual({
      wrapper: {
        COD_SESSAO: 'S123',
        inner: {
          sessionId: 'S456',
        },
      },
    });
  });
});
