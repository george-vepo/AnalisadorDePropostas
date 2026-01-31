const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 4000;

export const normalizeData = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(normalizeData);
  }

  if (typeof value === 'string') {
    if (value.length <= MAX_STRING_LENGTH) return value;
    const truncated = value.slice(0, MAX_STRING_LENGTH);
    return `${truncated}...<truncado ${value.length - MAX_STRING_LENGTH} caracteres>`;
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
      (acc, [key, child]) => {
        acc[key] = normalizeData(child);
        return acc;
      },
      {},
    );
  }

  return value;
};
