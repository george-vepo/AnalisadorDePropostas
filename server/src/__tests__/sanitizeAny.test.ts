import { describe, expect, it } from 'vitest';
import { sanitizeAndEncrypt } from '../sanitizer';
import { normalizeFieldName } from '../sanitizer/normalizeFieldName';

const buildAllowList = (names: string[]) => new Set(names.map((name) => normalizeFieldName(name)));

describe('sanitizeAny allowlist by field name', () => {
  it('keeps allowlisted fields clear and encrypts others, including JSON strings', () => {
    const allowList = buildAllowList([
      'COD_PROPOSTA',
      'status',
      'DES_ENVIO',
      'DES_RETORNO',
      'codigoSexo',
      'canalVenda',
    ]);

    const payload = {
      COD_PROPOSTA: '123',
      cpf: '11122233344',
      canalVenda: 'ONLINE',
      pessoa: {
        codigoSexo: 'F',
        email: 'test@example.com',
      },
      logs: [
        {
          DES_ENVIO: '{"status":"OK","cpf":"11122233344","dados":{"codigoSexo":"M","token":"abc"}}',
        },
      ],
      DES_RETORNO: JSON.stringify(
        JSON.stringify({
          status: 'OK',
          email: 'another@example.com',
        }),
      ),
    };

    const result = sanitizeAndEncrypt(
      payload,
      allowList,
      { enabled: true, timeWindow: 'day', format: '' },
      'test-passphrase',
    );

    const sanitized = result.sanitizedJson as typeof payload;

    expect(sanitized.COD_PROPOSTA).toBe('123');
    expect(sanitized.canalVenda).toBe('ONLINE');
    expect(String(sanitized.cpf)).toMatch(/^ENC\[v1\]:/);
    expect(sanitized.pessoa.codigoSexo).toBe('F');
    expect(String(sanitized.pessoa.email)).toMatch(/^ENC\[v1\]:/);

    expect(typeof sanitized.logs[0].DES_ENVIO).toBe('string');
    const envioParsed = JSON.parse(sanitized.logs[0].DES_ENVIO as string) as Record<string, unknown>;
    expect(envioParsed.status).toBe('OK');
    expect(String(envioParsed.cpf)).toMatch(/^ENC\[v1\]:/);
    const envioDados = envioParsed.dados as Record<string, unknown>;
    expect(envioDados.codigoSexo).toBe('M');
    expect(String(envioDados.token)).toMatch(/^ENC\[v1\]:/);

    expect(typeof sanitized.DES_RETORNO).toBe('string');
    const retornoParsed = JSON.parse(sanitized.DES_RETORNO as string) as Record<string, unknown>;
    expect(retornoParsed.status).toBe('OK');
    expect(String(retornoParsed.email)).toMatch(/^ENC\[v1\]:/);
  });
});
