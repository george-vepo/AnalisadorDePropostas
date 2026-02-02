import { normalizeFieldName } from './normalizeFieldName';

type StripPayloadOptions = {
  allowList: Set<string>;
  maxArrayItems?: number;
  maxStringLength?: number;
  maxMessageLength?: number;
  maxStackTraceLength?: number;
};

const DEFAULT_MAX_ARRAY_ITEMS = 10;
const DEFAULT_MAX_STRING_LENGTH = 500;
const DEFAULT_MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_MAX_STACKTRACE_LENGTH = 2000;

const TOKEN_FIELD_MARKERS = ['token', 'bearer', 'authorization', 'cookie', 'sha', 'rsa', 'key', 'secret'];
const INFORMATIVE_MARKERS = [
  'status',
  'sucesso',
  'mensagem',
  'mensagens',
  'codigo',
  'descricao',
  'data',
  'hora',
  'tempo',
  'sessao',
  'session',
];

const looksLikeJwt = (value: string): boolean => {
  if (value.length < 80) return false;
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
};

const looksLikeBase64 = (value: string): boolean => {
  if (value.length < 200) return false;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return true;
  return /^[A-Za-z0-9_-]+$/.test(value);
};

const looksLikeHexBlob = (value: string): boolean => {
  if (value.length < 64) return false;
  return /^[A-Fa-f0-9]+$/.test(value);
};

const looksLikePem = (value: string): boolean => {
  return value.includes('-----BEGIN ') || value.includes('PRIVATE KEY');
};

const shouldDropByFieldName = (fieldNorm: string): boolean => {
  return TOKEN_FIELD_MARKERS.some((marker) => fieldNorm.includes(marker));
};

const isInformativeFieldName = (fieldNorm: string): boolean => {
  if (!fieldNorm) return false;
  if (fieldNorm.startsWith('cod')) return true;
  return INFORMATIVE_MARKERS.some((marker) => fieldNorm.includes(marker));
};

const shouldKeepFieldName = (fieldNorm: string, allowList: Set<string>): boolean => {
  return allowList.has(fieldNorm) || isInformativeFieldName(fieldNorm);
};

const looksLikeJson = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"{') || trimmed.startsWith('"[');
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

const truncateWithSuffix = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...(truncado)`;
};

const sanitizeString = (fieldNorm: string, value: string, options: Required<StripPayloadOptions>): unknown => {
  const parsed = tryParseJsonString(value);
  if (parsed) {
    return sanitizeAny(parsed.parsed, options);
  }

  if (looksLikePem(value)) return '[REMOVIDO_CHAVE]';
  if (looksLikeJwt(value)) return '[REMOVIDO_TOKEN]';
  if (looksLikeBase64(value)) return '[REMOVIDO_BASE64]';
  if (looksLikeHexBlob(value)) return '[REMOVIDO_HEX]';

  if (fieldNorm.includes('stacktrace')) {
    return truncateWithSuffix(value, options.maxStackTraceLength);
  }

  if (fieldNorm.includes('mensagem') || fieldNorm.includes('descricao')) {
    return truncateWithSuffix(value, options.maxMessageLength);
  }

  if (value.length > options.maxStringLength) return '[REMOVIDO_POR_TAMANHO]';
  return value;
};

const sanitizeArray = (fieldNorm: string, value: unknown[], options: Required<StripPayloadOptions>): unknown[] => {
  const limited = value.slice(0, options.maxArrayItems);
  const sanitized = limited
    .map((item) => sanitizeAny(item, options, fieldNorm))
    .filter((item) => {
      if (item === undefined || item === null) return false;
      if (Array.isArray(item)) return item.length > 0;
      if (typeof item === 'object') return Object.keys(item as Record<string, unknown>).length > 0;
      return true;
    });
  return sanitized;
};

export const sanitizeAny = (
  input: unknown,
  options: Required<StripPayloadOptions>,
  fieldNorm = '',
): unknown => {
  if (Array.isArray(input)) {
    return sanitizeArray(fieldNorm, input, options);
  }

  if (input && typeof input === 'object') {
    return Object.entries(input as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, value]) => {
      const normalizedName = normalizeFieldName(key);
      if (!normalizedName) return acc;
      if (shouldDropByFieldName(normalizedName)) return acc;

      const sanitizedValue = sanitizeAny(value, options, normalizedName);
      const isValueObject = sanitizedValue && typeof sanitizedValue === 'object' && !Array.isArray(sanitizedValue);
      const isValueArray = Array.isArray(sanitizedValue);
      const hasNestedContent = isValueArray
        ? sanitizedValue.length > 0
        : isValueObject
          ? Object.keys(sanitizedValue as Record<string, unknown>).length > 0
          : false;

      if (!shouldKeepFieldName(normalizedName, options.allowList) && !hasNestedContent) {
        return acc;
      }

      if (isValueObject && Object.keys(sanitizedValue as Record<string, unknown>).length === 0) {
        return acc;
      }

      if (isValueArray && sanitizedValue.length === 0) {
        return acc;
      }

      acc[key] = sanitizedValue;
      return acc;
    }, {});
  }

  if (typeof input === 'string') {
    return sanitizeString(fieldNorm, input, options);
  }

  return input;
};

export const stripPayloadNoise = (input: unknown, options: StripPayloadOptions): unknown => {
  const normalizedOptions: Required<StripPayloadOptions> = {
    allowList: options.allowList,
    maxArrayItems: options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS,
    maxStringLength: options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH,
    maxMessageLength: options.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH,
    maxStackTraceLength: options.maxStackTraceLength ?? DEFAULT_MAX_STACKTRACE_LENGTH,
  };
  return sanitizeAny(input, normalizedOptions);
};

export {
  looksLikeJwt,
  looksLikeBase64,
  looksLikeHexBlob,
  shouldDropByFieldName,
};
export type { StripPayloadOptions };
