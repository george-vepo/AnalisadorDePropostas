import { createEncryptor, type CryptoConfig } from './crypto';
import { createPathMatcher } from './matchPath';

export type SanitizeStats = {
  totalLeaves: number;
  allowedLeaves: number;
  encryptedLeaves: number;
};

const getFieldName = (path: string) => {
  if (!path) return 'field';
  const segment = path.split('.').pop() ?? 'field';
  const cleaned = segment.replace(/\[\d+\]/g, '');
  return cleaned || 'field';
};

const serializeValue = (value: unknown) => {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
};

export const sanitizeAndEncrypt = (
  value: unknown,
  allowList: string[],
  cryptoConfig: CryptoConfig,
  passphrase: string,
) => {
  const matcher = createPathMatcher(allowList);
  const encryptor = createEncryptor(cryptoConfig, passphrase);
  const stats: SanitizeStats = { totalLeaves: 0, allowedLeaves: 0, encryptedLeaves: 0 };

  const walk = (currentValue: unknown, path: string): unknown => {
    if (Array.isArray(currentValue)) {
      return currentValue.map((item, index) => {
        const nextPath = path ? `${path}[${index}]` : `[${index}]`;
        return walk(item, nextPath);
      });
    }

    if (currentValue && typeof currentValue === 'object') {
      return Object.entries(currentValue as Record<string, unknown>).reduce<Record<string, unknown>>(
        (acc, [key, item]) => {
          const nextPath = path ? `${path}.${key}` : key;
          acc[key] = walk(item, nextPath);
          return acc;
        },
        {},
      );
    }

    stats.totalLeaves += 1;

    if (matcher(path)) {
      stats.allowedLeaves += 1;
      return currentValue;
    }

    stats.encryptedLeaves += 1;
    const fieldName = getFieldName(path);
    return encryptor.encrypt(fieldName, serializeValue(currentValue));
  };

  return { sanitizedJson: walk(value, ''), stats };
};
