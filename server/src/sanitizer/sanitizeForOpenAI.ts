import { applyPayloadBudget } from '../payloadBudget';
import { normalizeFieldName } from './normalizeFieldName';

export type SanitizeStats = {
  totalKeys: number;
  keptKeys: number;
  removedSensitive: number;
  removedNotAllowlisted: number;
  removedLarge: number;
  parsedJson: number;
  payloadTrimmed: boolean;
};

type SanitizeOptions = {
  allowList: Set<string>;
  maxStringLength: number;
  maxStackTraceLength: number;
  maxJsonDepth: number;
  maxPayloadBytes?: number;
  stats: SanitizeStats;
};

const DEFAULT_MAX_STRING_LENGTH = 500;
const DEFAULT_MAX_STACKTRACE_LENGTH = 400;
const DEFAULT_MAX_JSON_DEPTH = 2;

const SENSITIVE_FIELD_MARKERS = [
  'nome',
  'cpf',
  'rg',
  'email',
  'telefone',
  'tel',
  'celular',
  'endereco',
  'logradouro',
  'bairro',
  'cep',
  'cidade',
  'uf',
  'conta',
  'agencia',
  'banco',
  'operacao',
  'cartao',
  'boleto',
  'token',
  'bearer',
  'authorization',
  'senha',
  'pass',
  'secret',
  'key',
  'rsa',
  'sha',
  'usuario',
  'matricula',
  'username',
  'solicitante',
  'correspondente',
  'ip',
];

const DES_ENVIO_FIELD = 'desenvio';
const DES_RETORNO_FIELD = 'desretorno';

const looksLikeJwt = (value: string): boolean => {
  if (value.length < 80) return false;
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
};

const looksLikeBase64 = (value: string): boolean => {
  if (value.length < 200) return false;
  const sanitized = value.replace(/[\r\n]/g, '');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(sanitized)) return true;
  return /^[A-Za-z0-9_-]+$/.test(sanitized);
};

const looksLikeHexBlob = (value: string): boolean => {
  if (value.length < 64) return false;
  return /^[A-Fa-f0-9]+$/.test(value);
};

const looksLikePem = (value: string): boolean => value.includes('-----BEGIN ') || value.includes('PRIVATE KEY');

const looksLikeJson = (value: string) => {
  const trimmed = value.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"{') || trimmed.startsWith('"[');
};

const stripNonInformationalChars = (value: string): string => {
  return value.replace(/[{}\[\],"]/g, '').replace(/\s+/g, '').trim();
};

const sanitizeJsonStringByRegex = (value: string, allowList: Set<string>): string => {
  const markerPattern = SENSITIVE_FIELD_MARKERS.join('|');
  const sensitiveFieldRegex = new RegExp(
    `"([^"]+)"\\s*:\\s*("([^"\\\\]|\\\\.)*"|\\d+|true|false|null)`,
    'gi',
  );
  const sanitized = value.replace(sensitiveFieldRegex, (match, key, rawValue) => {
    const normalizedKey = normalizeFieldName(key) ?? '';
    const isSensitive = normalizedKey
      ? SENSITIVE_FIELD_MARKERS.some((marker) => normalizedKey.includes(marker))
      : false;
    if (!normalizedKey || (!allowList.has(normalizedKey) && !isSensitive)) {
      if (typeof rawValue === 'string' && rawValue.startsWith('"')) {
        const innerValue = rawValue.slice(1, -1).trim();
        if (innerValue.startsWith('{') || innerValue.startsWith('[')) {
          return match;
        }
      }
      return `"${key}":"[REMOVIDO]"`;
    }
    if (isSensitive) {
      return `"${key}":"[REMOVIDO]"`;
    }
    return match;
  });
  return stripNonInformationalChars(sanitized);
};

const isSensitiveFieldName = (fieldNorm: string): boolean => {
  return SENSITIVE_FIELD_MARKERS.some((marker) => fieldNorm.includes(marker));
};

const summarizeStackTrace = (value: string, maxLength: number): string | undefined => {
  const firstLine = value.split('\n')[0]?.trim();
  const base = firstLine && firstLine.length > 0 ? firstLine : value.trim();
  if (!base) return undefined;
  if (base.length <= maxLength) return base;
  return `${base.slice(0, maxLength)}...(resumo)`;
};

const sanitizeString = (
  fieldNorm: string,
  value: string,
  options: SanitizeOptions,
): unknown => {
  const isJsonLike = looksLikeJson(value);
  if (isJsonLike) {
    options.stats.parsedJson += 1;
    const sanitizedJson = sanitizeJsonStringByRegex(value, options.allowList);
    if (sanitizedJson.length > options.maxStringLength) {
      options.stats.removedLarge += 1;
      return undefined;
    }
    return sanitizedJson;
  }

  if (looksLikePem(value) || looksLikeJwt(value) || looksLikeBase64(value) || looksLikeHexBlob(value)) {
    options.stats.removedLarge += 1;
    return undefined;
  }

  if (fieldNorm.includes('stacktrace')) {
    return summarizeStackTrace(value, options.maxStackTraceLength);
  }

  if (value.length > options.maxStringLength) {
    options.stats.removedLarge += 1;
    return undefined;
  }

  return value;
};

const sanitizeArray = (
  value: unknown[],
  options: SanitizeOptions,
  fieldNorm?: string,
): unknown[] | undefined => {
  const sanitizedItems = value
    .map((item) => sanitizeAny(item, options, fieldNorm))
    .filter((item) => {
      if (item === undefined || item === null) return false;
      if (Array.isArray(item)) return item.length > 0;
      if (typeof item === 'object') return Object.keys(item as Record<string, unknown>).length > 0;
      return true;
    });
  if (sanitizedItems.length === 0) return undefined;
  return sanitizedItems;
};

export const sanitizeAny = (
  input: unknown,
  options: SanitizeOptions,
  fieldName?: string,
): unknown => {
  if (Array.isArray(input)) {
    return sanitizeArray(input, options, fieldName);
  }

  if (input && typeof input === 'object') {
    return Object.entries(input as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, value]) => {
      const normalizedName = normalizeFieldName(key);
      if (!normalizedName) return acc;
      options.stats.totalKeys += 1;
      if (isSensitiveFieldName(normalizedName)) {
        options.stats.removedSensitive += 1;
        return acc;
      }

      const sanitizedValue = sanitizeAny(value, options, normalizedName);
      if (sanitizedValue === undefined) {
        options.stats.removedLarge += 1;
        return acc;
      }

      const isAllowlisted = options.allowList.has(normalizedName);
      const isObject = sanitizedValue && typeof sanitizedValue === 'object' && !Array.isArray(sanitizedValue);
      const isArray = Array.isArray(sanitizedValue);
      const hasNestedContent = isArray
        ? sanitizedValue.length > 0
        : isObject
          ? Object.keys(sanitizedValue as Record<string, unknown>).length > 0
          : false;

      if (!isAllowlisted && !hasNestedContent) {
        options.stats.removedNotAllowlisted += 1;
        return acc;
      }

      if (isObject && Object.keys(sanitizedValue as Record<string, unknown>).length === 0) {
        options.stats.removedLarge += 1;
        return acc;
      }

      if (isArray && sanitizedValue.length === 0) {
        options.stats.removedLarge += 1;
        return acc;
      }

      acc[key] = sanitizedValue;
      options.stats.keptKeys += 1;
      return acc;
    }, {});
  }

  if (typeof input === 'string') {
    const normalizedName = fieldName ? normalizeFieldName(fieldName) : '';
    if (normalizedName === DES_ENVIO_FIELD || normalizedName === DES_RETORNO_FIELD) {
      if (looksLikeJson(input)) {
        options.stats.parsedJson += 1;
        return sanitizeJsonStringByRegex(input, options.allowList);
      }
      const fallback =
        normalizedName === DES_ENVIO_FIELD ? { envio_nao_parseavel: true } : { retorno_nao_parseavel: true };
      return sanitizeAny(fallback, options, normalizedName);
    }
    return sanitizeString(normalizedName, input, options);
  }

  return input;
};

export const sanitizeForOpenAI = (
  input: unknown,
  allowList: Set<string>,
  options?: {
    maxStringLength?: number;
    maxStackTraceLength?: number;
    maxJsonDepth?: number;
    maxPayloadBytes?: number;
  },
) => {
  const stats: SanitizeStats = {
    totalKeys: 0,
    keptKeys: 0,
    removedSensitive: 0,
    removedNotAllowlisted: 0,
    removedLarge: 0,
    parsedJson: 0,
    payloadTrimmed: false,
  };

  const sanitizeOptions: SanitizeOptions = {
    allowList,
    maxStringLength: options?.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH,
    maxStackTraceLength: options?.maxStackTraceLength ?? DEFAULT_MAX_STACKTRACE_LENGTH,
    maxJsonDepth: options?.maxJsonDepth ?? DEFAULT_MAX_JSON_DEPTH,
    maxPayloadBytes: options?.maxPayloadBytes,
    stats,
  };

  let sanitizedJson = sanitizeAny(input, sanitizeOptions);

  if (sanitizeOptions.maxPayloadBytes && sanitizedJson) {
    const reduced = applyPayloadBudget(sanitizedJson, sanitizeOptions.maxPayloadBytes);
    sanitizedJson = reduced.payload;
    stats.payloadTrimmed = reduced.arraysRemoved > 0 || reduced.stringsTrimmed > 0;
  }

  return { sanitizedJson, stats };
};
