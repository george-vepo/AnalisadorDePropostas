const DEFAULT_MAX_ARRAY_ITEMS = 50;
const DEFAULT_MAX_STRING_LENGTH = 2000;

const SENSITIVE_TOKENS = [
  'cpf',
  'cnpj',
  'documento',
  'rg',
  'pis',
  'token',
  'authorization',
  'api_key',
  'apikey',
  'secret',
  'senha',
  'password',
  'email',
  'cookie',
];

const CPF_OR_CNPJ_REGEX = /(\d{11}|\d{14})/g;

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const shouldRemoveKey = (key: string) => {
  const normalized = normalizeKey(key);
  return SENSITIVE_TOKENS.some((token) => normalized.includes(normalizeKey(token)));
};

const sanitizeString = (value: string, maxStringLength: number) => {
  const masked = value.replace(CPF_OR_CNPJ_REGEX, '[REDACTED]');
  return masked.length > maxStringLength ? `${masked.slice(0, maxStringLength)}...` : masked;
};

type Options = {
  maxArrayItems?: number;
  maxStringLength?: number;
};

const sanitizeValue = (value: unknown, options: Required<Options>): unknown => {
  if (typeof value === 'string') {
    return sanitizeString(value, options.maxStringLength);
  }

  if (Array.isArray(value)) {
    return value.slice(0, options.maxArrayItems).map((item) => sanitizeValue(item, options));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, itemValue]) => {
      if (shouldRemoveKey(key)) return acc;
      acc[key] = sanitizeValue(itemValue, options);
      return acc;
    }, {});
  }

  return value;
};

export const sanitizePayload = (payload: unknown, options: Options = {}) => {
  const normalizedOptions: Required<Options> = {
    maxArrayItems: options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS,
    maxStringLength: options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH,
  };

  return sanitizeValue(payload, normalizedOptions);
};
