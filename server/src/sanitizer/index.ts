import { createAllowListMatcher } from './allowList';
import { createEncryptor, CryptoConfig } from './crypto';

const getFieldName = (path: string) => {
  if (!path) return 'field';
  const segments = path.split('.');
  return segments[segments.length - 1];
};

const serializeValue = (value: unknown) => {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
};

export const sanitizeData = (
  value: unknown,
  allowList: string[],
  cryptoConfig: CryptoConfig,
  passphrase: string,
) => {
  const matcher = createAllowListMatcher(allowList);
  const encryptor = createEncryptor(cryptoConfig, passphrase);

  const walk = (currentValue: unknown, path: string): unknown => {
    if (matcher(path)) {
      return currentValue;
    }

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

    const fieldName = getFieldName(path);
    return encryptor.encrypt(fieldName, serializeValue(currentValue));
  };

  return walk(value, '');
};
