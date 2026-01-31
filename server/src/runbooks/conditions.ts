import type { RunbookCondition, RunbookWhen } from '../pipeline';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

export const getValuesByPath = (data: unknown, path: string): unknown[] => {
  if (!path) return [];
  const segments = path.split('.').filter(Boolean);
  let current: unknown[] = [data];

  for (const segment of segments) {
    const isArraySegment = segment.endsWith('[]');
    const key = isArraySegment ? segment.slice(0, -2) : segment;
    const next: unknown[] = [];

    for (const item of current) {
      if (!isPlainObject(item)) continue;
      const value = item[key];

      if (isArraySegment) {
        if (Array.isArray(value)) {
          next.push(...value);
        }
      } else if (value !== undefined) {
        next.push(value);
      }
    }

    current = next;
    if (current.length === 0) break;
  }

  return current;
};

const normalizeComparable = (value: unknown): string | number | boolean | null => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
};

const matchesCondition = (values: unknown[], condition: RunbookCondition): boolean => {
  if (condition.exists !== undefined) {
    const exists = values.some((value) => value !== undefined && value !== null);
    return condition.exists ? exists : !exists;
  }

  const normalizedValues = values.map(normalizeComparable).filter((value) => value !== null);

  if (condition.equals !== undefined) {
    return normalizedValues.some((value) => String(value).toLowerCase() === String(condition.equals).toLowerCase());
  }

  if (condition.notEquals !== undefined) {
    return normalizedValues.every((value) => String(value).toLowerCase() !== String(condition.notEquals).toLowerCase());
  }

  if (condition.in && condition.in.length > 0) {
    const allowed = condition.in.map((entry) => String(entry).toLowerCase());
    return normalizedValues.some((value) => allowed.includes(String(value).toLowerCase()));
  }

  if (condition.contains) {
    const target = condition.contains.toLowerCase();
    return normalizedValues.some((value) => String(value).toLowerCase().includes(target));
  }

  return false;
};

export const evaluateWhen = (
  when: RunbookWhen,
  data: unknown,
  signals?: Record<string, unknown>,
): boolean => {
  const evalCondition = (condition: RunbookCondition) => {
    const target = condition.path.startsWith('signals.') && signals
      ? signals
      : data;
    const path = condition.path.startsWith('signals.') ? condition.path.slice('signals.'.length) : condition.path;
    const values = getValuesByPath(target, path);
    return matchesCondition(values, condition);
  };

  if (when.all && when.all.length > 0) {
    return when.all.every(evalCondition);
  }

  if (when.any && when.any.length > 0) {
    return when.any.some(evalCondition);
  }

  return false;
};
