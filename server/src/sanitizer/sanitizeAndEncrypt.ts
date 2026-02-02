import { createEncryptor, type CryptoConfig } from './crypto';
import { normalizeFieldName } from './normalizeFieldName';

export type SanitizeStats = {
  totalLeaves: number;
  allowedLeaves: number;
  encryptedLeaves: number;
};

const serializeValue = (value: unknown) => {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
};

const looksLikeJson = (value: string) => {
  const trimmed = value.trim();
  return (
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('"{') ||
    trimmed.startsWith('"[')
  );
};

const tryParseJsonString = (value: string, maxDepth = 2): { parsed: unknown } | null => {
  let current: unknown = value;
  for (let attempt = 0; attempt < maxDepth; attempt += 1) {
    if (typeof current !== 'string') return null;
    if (!looksLikeJson(current)) return null;
    try {
      const parsed = JSON.parse(current);
      if (typeof parsed === 'string') {
        current = parsed;
        continue;
      }
      return { parsed };
    } catch {
      return null;
    }
  }
  return null;
};

type SanitizeOptions = {
  allowList: Set<string>;
  encrypt: (plainText: string) => string;
  stats: SanitizeStats;
};

const sanitizePrimitive = (
  value: unknown,
  fieldName: string | undefined,
  options: SanitizeOptions,
  trackStats = true,
): unknown => {
  const normalizedName = normalizeFieldName(fieldName);
  const isAllowed = normalizedName ? options.allowList.has(normalizedName) : false;

  if (typeof value === 'string') {
    const parsed = tryParseJsonString(value);
    if (parsed) {
      const sanitizedParsed = sanitizeAny(parsed.parsed, options, false);
      const serialized = JSON.stringify(sanitizedParsed);
      if (trackStats) {
        options.stats.totalLeaves += 1;
      }
      if (isAllowed) {
        if (trackStats) {
          options.stats.allowedLeaves += 1;
        }
        return serialized;
      }
      if (trackStats) {
        options.stats.encryptedLeaves += 1;
      }
      return options.encrypt(serialized);
    }

    if (trackStats) {
      options.stats.totalLeaves += 1;
    }
    if (isAllowed) {
      if (trackStats) {
        options.stats.allowedLeaves += 1;
      }
      return value;
    }
    if (trackStats) {
      options.stats.encryptedLeaves += 1;
    }
    return options.encrypt(value);
  }

  if (value === null || typeof value !== 'object') {
    if (trackStats) {
      options.stats.totalLeaves += 1;
    }
    if (isAllowed) {
      if (trackStats) {
        options.stats.allowedLeaves += 1;
      }
      return value;
    }
    if (trackStats) {
      options.stats.encryptedLeaves += 1;
    }
    return options.encrypt(serializeValue(value));
  }

  return value;
};

export const sanitizeAny = (
  input: unknown,
  options: SanitizeOptions,
  trackStats = true,
  fieldName?: string,
): unknown => {
  if (Array.isArray(input)) {
    return input.map((item) => {
      if (item && typeof item === 'object') {
        return sanitizeAny(item, options, trackStats);
      }
      return sanitizePrimitive(item, fieldName, options, trackStats);
    });
  }

  if (input && typeof input === 'object') {
    return Object.entries(input as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, item]) => {
      if (item && typeof item === 'object') {
        acc[key] = sanitizeAny(item, options, trackStats, key);
      } else {
        acc[key] = sanitizePrimitive(item, key, options, trackStats);
      }
      return acc;
    }, {});
  }

  return sanitizePrimitive(input, fieldName, options, trackStats);
};

export const sanitizeAndEncrypt = (
  value: unknown,
  allowList: Set<string>,
  cryptoConfig: CryptoConfig,
  passphrase: string,
) => {
  const encryptor = createEncryptor(cryptoConfig, passphrase);
  const stats: SanitizeStats = { totalLeaves: 0, allowedLeaves: 0, encryptedLeaves: 0 };
  const options: SanitizeOptions = { allowList, encrypt: encryptor.encrypt, stats };

  return { sanitizedJson: sanitizeAny(value, options), stats };
};
