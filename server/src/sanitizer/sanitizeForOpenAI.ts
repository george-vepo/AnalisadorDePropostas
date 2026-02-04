import { applyPayloadBudget } from '../payloadBudget';
import { normalizeFieldName } from './normalizeFieldName';

export type SanitizeStats = {
  totalKeys: number;
  keptKeys: number;
  removedSensitiveCount: number;
  removedNotAllowlisted: number;
  removedBinaryCount: number;
  arraysTruncatedCount: number;
  depthLimitedCount: number;
  parsedJson: number;
  payloadTrimmed: boolean;
};

type SanitizeOptions = {
  allowList: Set<string>;
  maxDepth: number;
  maxArrayItems: number;
  maxPayloadBytes?: number;
  removeBinary: boolean;
  allowStringTruncation: boolean;
  stats: SanitizeStats;
};

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_ARRAY_ITEMS = 50;

const SENSITIVE_FIELD_NAMES = [
  'cpf',
  'cpfcnpj',
  'cnpj',
  'documento',
  'numdocumento',
  'rg',
  'pis',
  'nit',
  'token',
  'authorization',
  'bearer',
  'auth',
  'apikey',
  'api_key',
  'secret',
  'senha',
  'password',
  'key',
  'username',
  'user',
  'login',
  'email',
  'sharsakey',
  'hashassinatura',
  'assinatura',
  'sessionid',
  'session_id',
  'cookies',
];

const BINARY_FIELD_NAMES = [
  'anexo',
  'arquivo',
  'file',
  'pdf',
  'bytes',
  'content',
  'conteudo',
  'base64',
  'documento',
  'imagem',
  'boletobase64',
  'payloadbase64',
];

const DES_ENVIO_FIELD = 'desenvio';
const DES_RETORNO_FIELD = 'desretorno';

const URL_FIELD_NAMES = ['url', 'urlservico', 'endpoint', 'targeturl'];

const BASE64_PREFIXES = ['JVBERi0x', '/9j/', 'iVBORw0KGgo', 'UEsDB'];
const BASE64_RATIO_THRESHOLD = 0.95;
const LARGE_BASE64_MIN_LENGTH = 2000;
const DEPTH_LIMIT_PLACEHOLDER = '<DEPTH_LIMIT_REACHED>';

const looksLikeJson = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"{') || trimmed.startsWith('"[');
};

const normalizedSensitiveFields = new Set(SENSITIVE_FIELD_NAMES.map((name) => normalizeFieldName(name)));
const normalizedBinaryFieldNames = new Set(BINARY_FIELD_NAMES.map((name) => normalizeFieldName(name)));
const normalizedUrlFields = new Set(URL_FIELD_NAMES.map((name) => normalizeFieldName(name)));

const hasSensitiveDigits = (value: string): boolean => {
  const cpfRegex = /(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})/;
  const cnpjRegex = /(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{14})/;
  return cpfRegex.test(value) || cnpjRegex.test(value);
};

const maskSensitiveDigits = (value: string): string => {
  const cpfRegex = /(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})/g;
  const cnpjRegex = /(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{14})/g;
  const mask = (match: string) => '*'.repeat(match.length);
  return value.replace(cpfRegex, mask).replace(cnpjRegex, mask);
};

const looksLikeLargeBase64 = (value: string): boolean => {
  if (BASE64_PREFIXES.some((prefix) => value.startsWith(prefix))) return true;
  if (value.length <= LARGE_BASE64_MIN_LENGTH) return false;
  const sanitized = value.replace(/[\r\n]/g, '');
  if (!sanitized) return false;
  const match = sanitized.match(/[A-Za-z0-9+/=]/g);
  const ratio = (match?.length ?? 0) / sanitized.length;
  return ratio >= BASE64_RATIO_THRESHOLD;
};

const isProbablyBase64 = (value: string): boolean => {
  if (BASE64_PREFIXES.some((prefix) => value.startsWith(prefix))) return true;
  if (value.length < LARGE_BASE64_MIN_LENGTH) return false;
  const sanitized = value.replace(/[\r\n]/g, '');
  if (!sanitized) return false;
  if (!/^[A-Za-z0-9+/=]+$/.test(sanitized)) {
    const match = sanitized.match(/[A-Za-z0-9+/=]/g);
    const ratio = (match?.length ?? 0) / sanitized.length;
    return ratio >= BASE64_RATIO_THRESHOLD;
  }
  return true;
};

const normalizeSpaces = (value: string): string => value.replace(/ {2,}/g, ' ');

const isSensitiveFieldName = (fieldNorm: string): boolean => {
  if (!fieldNorm) return false;
  return Array.from(normalizedSensitiveFields).some((marker) => fieldNorm.includes(marker));
};

const isBinaryFieldName = (fieldNorm: string): boolean => {
  if (!fieldNorm) return false;
  return Array.from(normalizedBinaryFieldNames).some((marker) => fieldNorm.includes(marker));
};

const isUrlFieldName = (fieldNorm: string): boolean => {
  if (!fieldNorm) return false;
  if (normalizedUrlFields.has(fieldNorm)) return true;
  return fieldNorm.includes('url');
};

const sanitizeUrlValue = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    const params = Array.from(url.searchParams.entries());
    params.forEach(([name, paramValue]) => {
      const normalizedName = normalizeFieldName(name);
      const isSensitive = isSensitiveFieldName(normalizedName);
      const hasSensitiveValue = hasSensitiveDigits(paramValue);
      if (isSensitive || hasSensitiveValue) {
        url.searchParams.delete(name);
      }
    });
    if (url.searchParams.toString().length === 0) {
      url.search = '';
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

const sanitizeArray = (
  value: unknown[],
  options: SanitizeOptions,
  fieldNorm?: string,
  depth = 0,
): unknown[] | { __meta: Record<string, unknown>; items: unknown[] } | undefined => {
  const originalLength = value.length;
  const limited = value.slice(0, options.maxArrayItems);
  const sanitizedItems = limited
    .map((item) => sanitizeAny(item, options, fieldNorm, depth + 1))
    .filter((item) => item !== undefined);
  if (sanitizedItems.length === 0) return undefined;
  if (originalLength > options.maxArrayItems) {
    options.stats.arraysTruncatedCount += 1;
    return {
      __meta: {
        arrayTruncated: true,
        originalLength,
        kept: sanitizedItems.length,
      },
      items: sanitizedItems,
    };
  }
  return sanitizedItems;
};

export const sanitizeDeepDelete = (
  input: unknown,
  options: SanitizeOptions,
  fieldName?: string,
  depth = 0,
): unknown => {
  if (depth > options.maxDepth) {
    options.stats.depthLimitedCount += 1;
    return DEPTH_LIMIT_PLACEHOLDER;
  }

  if (Array.isArray(input)) {
    return sanitizeArray(input, options, fieldName, depth);
  }

  if (input && typeof input === 'object') {
    const sanitizedObject = Object.entries(input as Record<string, unknown>).reduce<Record<string, unknown>>(
      (acc, [key, value]) => {
        const normalizedName = normalizeFieldName(key);
        if (!normalizedName) return acc;
        options.stats.totalKeys += 1;
        if (isSensitiveFieldName(normalizedName)) {
          options.stats.removedSensitiveCount += 1;
          return acc;
        }

        const sanitizedValue = sanitizeDeepDelete(value, options, normalizedName, depth + 1);
        if (sanitizedValue === undefined) {
          return acc;
        }

        const isAllowlisted = options.allowList.has(normalizedName);
        const isObject = sanitizedValue && typeof sanitizedValue === 'object' && !Array.isArray(sanitizedValue);
        const isArray = Array.isArray(sanitizedValue);
        const isDepthPlaceholder = sanitizedValue === DEPTH_LIMIT_PLACEHOLDER;
        const hasNestedContent = isDepthPlaceholder
          ? true
          : isArray
            ? sanitizedValue.length > 0
            : isObject
              ? Object.keys(sanitizedValue as Record<string, unknown>).length > 0
              : false;

        if (!isAllowlisted && !hasNestedContent) {
          options.stats.removedNotAllowlisted += 1;
          return acc;
        }

        if (isObject && Object.keys(sanitizedValue as Record<string, unknown>).length === 0) {
          return acc;
        }

        if (isArray && sanitizedValue.length === 0) {
          return acc;
        }

        acc[key] = sanitizedValue;
        options.stats.keptKeys += 1;
        return acc;
      },
      {},
    );
    if (Object.keys(sanitizedObject).length === 0) return undefined;
    return sanitizedObject;
  }

  if (typeof input === 'string') {
    const normalizedName = fieldName ? normalizeFieldName(fieldName) : '';
    if (options.removeBinary && isProbablyBase64(input)) {
      options.stats.removedBinaryCount += 1;
      return undefined;
    }

    if (normalizedName === DES_ENVIO_FIELD || normalizedName === DES_RETORNO_FIELD) {
      if (looksLikeJson(input)) {
        try {
          const parsed = JSON.parse(input);
          options.stats.parsedJson += 1;
          return sanitizeDeepDelete(parsed, options, normalizedName, depth + 1);
        } catch {
          return normalizeSpaces(maskSensitiveDigits(input));
        }
      }
      return normalizeSpaces(maskSensitiveDigits(input));
    }

    if (isUrlFieldName(normalizedName)) {
      const sanitizedUrl = sanitizeUrlValue(input);
      if (!sanitizedUrl) {
        options.stats.removedSensitiveCount += 1;
        return undefined;
      }
      return normalizeSpaces(sanitizedUrl);
    }

    if (isBinaryFieldName(normalizedName) && looksLikeLargeBase64(input)) {
      options.stats.removedBinaryCount += 1;
      return undefined;
    }

    if (hasSensitiveDigits(input)) {
      return normalizeSpaces(maskSensitiveDigits(input));
    }

    return normalizeSpaces(input);
  }

  return input;
};

export const sanitizeAny = sanitizeDeepDelete;

export const sanitizeForOpenAI = (
  input: unknown,
  allowList: Set<string>,
  options?: {
    maxDepth?: number;
    maxArrayItems?: number;
    maxPayloadBytes?: number;
  },
) => {
  const stats: SanitizeStats = {
    totalKeys: 0,
    keptKeys: 0,
    removedSensitiveCount: 0,
    removedNotAllowlisted: 0,
    removedBinaryCount: 0,
    arraysTruncatedCount: 0,
    depthLimitedCount: 0,
    parsedJson: 0,
    payloadTrimmed: false,
  };

  const sanitizeOptions: SanitizeOptions = {
    allowList,
    maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxArrayItems: options?.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS,
    maxPayloadBytes: options?.maxPayloadBytes,
    removeBinary: true,
    allowStringTruncation: false,
    stats,
  };

  let sanitizedJson = sanitizeAny(input, sanitizeOptions);

  if (sanitizedJson === undefined) {
    sanitizedJson = {};
  }

  if (sanitizeOptions.maxPayloadBytes && sanitizedJson) {
    const reduced = applyPayloadBudget(sanitizedJson, sanitizeOptions.maxPayloadBytes);
    sanitizedJson = reduced.payload;
    stats.payloadTrimmed = reduced.arraysRemoved > 0 || reduced.stringsTrimmed > 0;
  }

  return { sanitizedJson, stats };
};
