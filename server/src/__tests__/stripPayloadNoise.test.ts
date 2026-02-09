import { describe, expect, it } from 'vitest';
import { stripPayloadNoise } from '../sanitizer/stripPayloadNoise';

describe('stripPayloadNoise', () => {
  it('removes base64 blobs inside JSON strings even when sanitizeStrings is false', () => {
    const allowList = new Set(['des_retorno']);
    const payload = {
      DES_RETORNO: JSON.stringify({
        entidade: `JVBERi0x${'A'.repeat(220)}`,
      }),
    };

    const result = stripPayloadNoise(payload, {
      allowList,
      sanitizeStrings: false,
    }) as typeof payload;

    const parsed = JSON.parse(result.DES_RETORNO);
    expect(parsed.entidade).toBe('[REMOVIDO_BASE64]');
  });

  it('removes token query params inside JSON string URLs when sanitizeStrings is false', () => {
    const allowList = new Set(['des_retorno']);
    const payload = {
      DES_RETORNO: JSON.stringify({
        entidade: {
          url: 'https://example.com/assinatura?token=abc123&foo=bar',
        },
      }),
    };

    const result = stripPayloadNoise(payload, {
      allowList,
      sanitizeStrings: false,
    }) as typeof payload;

    const parsed = JSON.parse(result.DES_RETORNO);
    expect(parsed.entidade.url).toBe('https://example.com/assinatura?foo=bar');
  });
});
