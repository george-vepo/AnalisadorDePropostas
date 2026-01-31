import { applyTemplate } from './template';

export type CryptoConfig = {
  enabled: boolean;
  timeWindow: 'hour' | 'day';
  format: string;
};

const textEncoder = new TextEncoder();

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const getWindow = (timeWindow: CryptoConfig['timeWindow'], date = new Date()): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());

  if (timeWindow === 'day') {
    return `${year}${month}${day}`;
  }

  return `${year}${month}${day}T${hour}`;
};

const deriveKey = async (
  passphrase: string,
  window: string,
  context: string,
): Promise<CryptoKey> => {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(`${passphrase}|${window}|${context}`),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: textEncoder.encode(context),
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
};

export const encryptField = async (
  fieldName: string,
  value: unknown,
  config: CryptoConfig,
  passphrase: string,
  context = 'pipeline-v1',
): Promise<string> => {
  const window = getWindow(config.timeWindow);

  if (!config.enabled) {
    return `${fieldName}:REDACTED`;
  }

  if (!passphrase) {
    throw new Error('Passphrase não configurada para criptografia.');
  }

  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, window, context);
  const payload = textEncoder.encode(JSON.stringify(value));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    payload,
  );

  const formatted = applyTemplate(config.format, {
    fieldName,
    window,
    nonceB64: toBase64(nonce.buffer),
    cipherB64: toBase64(cipherBuffer),
  });

  return formatted;
};
