import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

export type CryptoConfig = {
  enabled: boolean;
  timeWindow: 'hour' | 'day';
  format: string;
};

const formatWindow = (date: Date, timeWindow: CryptoConfig['timeWindow']) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  if (timeWindow === 'day') {
    return `${year}${month}${day}`;
  }

  const hour = String(date.getHours()).padStart(2, '0');
  return `${year}${month}${day}T${hour}`;
};

type Encryptor = {
  window: string;
  encrypt: (fieldName: string, plainText?: string) => string;
};

export const createEncryptor = (config: CryptoConfig, passphrase: string): Encryptor => {
  const window = formatWindow(new Date(), config.timeWindow);

  if (!config.enabled) {
    return {
      window,
      encrypt: (fieldName: string) => `${fieldName}:REDACTED`,
    };
  }

  if (!passphrase) {
    throw new Error('OPENAI_CRYPTO_PASSPHRASE não configurada.');
  }

  const key = pbkdf2Sync(passphrase, window, 200_000, 32, 'sha256');

  return {
    window,
    encrypt: (fieldName: string, plainText: string) => {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const cipherText = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      const payload = Buffer.concat([cipherText, tag]).toString('base64');
      return config.format
        .replaceAll('{{field}}', fieldName)
        .replaceAll('{{window}}', window)
        .replaceAll('{{nonceB64}}', nonce.toString('base64'))
        .replaceAll('{{cipherB64}}', payload);
    },
  };
};
