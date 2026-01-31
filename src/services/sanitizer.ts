import { CryptoConfig, encryptField } from './crypto';
import { JsonPath } from '../types/JsonPath';

export type SanitizeOptions = {
  allowList: JsonPath[];
  crypto: CryptoConfig;
  passphrase: string;
  context?: string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isAllowed = (path: string, allowList: JsonPath[]): boolean => {
  return allowList.includes(path);
};

const sanitizeValue = async (
  value: unknown,
  path: string,
  options: SanitizeOptions,
): Promise<unknown> => {
  if (isAllowed(path, options.allowList)) {
    return value;
  }

  if (Array.isArray(value)) {
    const arrayPath = path ? `${path}[]` : '[]';
    if (isAllowed(arrayPath, options.allowList)) {
      return value;
    }
    const sanitizedItems = await Promise.all(
      value.map((item) => sanitizeValue(item, arrayPath, options)),
    );
    return sanitizedItems;
  }

  if (isPlainObject(value)) {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, childValue]) => {
        const childPath = path ? `${path}.${key}` : key;
        const sanitizedChild = await sanitizeValue(childValue, childPath, options);
        return [key, sanitizedChild] as const;
      }),
    );

    return Object.fromEntries(entries);
  }

  const fieldName = path ? path.split('.').pop() ?? path : 'root';
  return encryptField(fieldName, value, options.crypto, options.passphrase, options.context);
};

export const sanitizeAndEncrypt = async (
  inputJson: unknown,
  allowList: JsonPath[],
  crypto: CryptoConfig,
  passphrase: string,
  context = 'pipeline-v1',
): Promise<unknown> => {
  if (Array.isArray(inputJson)) {
    return sanitizeValue(inputJson, '', { allowList, crypto, passphrase, context });
  }

  if (isPlainObject(inputJson)) {
    return sanitizeValue(inputJson, '', { allowList, crypto, passphrase, context });
  }

  return sanitizeValue(inputJson, '', { allowList, crypto, passphrase, context });
};
