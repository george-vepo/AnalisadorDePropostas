import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';

export type CryptoConfig = {
  enabled: boolean;
  timeWindow: 'hour' | 'day';
  format: string;
};

type Encryptor = {
  encrypt: (plainText: string) => string;
};

const SALT = 'openai-crypto-salt-v1';

export const createEncryptor = (config: CryptoConfig, passphrase: string): Encryptor => {
  if (!config.enabled) {
    return {
      encrypt: () => 'REDACTED',
    };
  }

  if (!passphrase) {
    throw new Error('OPENAI_CRYPTO_PASSPHRASE não configurada.');
  }

  const key = scryptSync(passphrase, SALT, 32);

  return {
    encrypt: (plainText: string) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const cipherText = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const payload = Buffer.concat([iv, tag, cipherText]).toString('base64');
      return `ENC[v1]:${payload}`;
    },
  };
};
