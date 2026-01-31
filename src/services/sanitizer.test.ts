import { describe, expect, it } from 'vitest';
import { sanitizeAndEncrypt } from './sanitizer';

const cryptoConfig = {
  enabled: false,
  timeWindow: 'hour' as const,
  format: '{{fieldName}}:ENC[v1|{{window}}|{{nonceB64}}|{{cipherB64}}]'
};

describe('sanitizeAndEncrypt', () => {
  it('keeps allow listed fields and redacts others', async () => {
    const input = {
      status: 'OK',
      owner: 'Maria',
      errors: [{ code: 'E1', message: 'Falha' }],
    };

    const result = await sanitizeAndEncrypt(
      input,
      ['status', 'errors[].code'],
      cryptoConfig,
      'pass',
    );

    expect(result).toEqual({
      status: 'OK',
      owner: 'owner:REDACTED',
      errors: [{ code: 'E1', message: 'message:REDACTED' }],
    });
  });
});
