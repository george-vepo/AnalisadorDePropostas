import { createPathMatcher } from './sanitizer/matchPath';

export type NormalizerConfig = {
  maxDepth: number;
  maxArrayItems: number;
  dropPaths: string[];
  keepPaths: string[];
};

const DEPTH_LIMIT_MARKER = '<DEPTH_LIMIT_REACHED>';

const filterByKeepPaths = (value: unknown, keepPaths: string[]) => {
  if (!keepPaths.length) return value;
  const matcher = createPathMatcher(keepPaths);

  const walk = (node: unknown, path: string): unknown => {
    if (matcher(path)) {
      return node;
    }

    if (Array.isArray(node)) {
      const next = node
        .map((item, index) => walk(item, path ? `${path}[${index}]` : `[${index}]`))
        .filter((item) => item !== undefined);
      return next.length ? next : undefined;
    }

    if (node && typeof node === 'object') {
      const entries = Object.entries(node as Record<string, unknown>)
        .map(([key, item]) => {
          const nextPath = path ? `${path}.${key}` : key;
          return [key, walk(item, nextPath)] as const;
        })
        .filter(([, item]) => item !== undefined);
      if (!entries.length) return undefined;
      return Object.fromEntries(entries);
    }

    return undefined;
  };

  return walk(value, '');
};

export const filterPayloadByPaths = (input: unknown, config: NormalizerConfig): unknown => {
  const filtered = filterByKeepPaths(input, config.keepPaths ?? []);
  const dropMatcher = createPathMatcher(config.dropPaths ?? []);

  const walk = (node: unknown, path: string): unknown => {
    if (dropMatcher(path)) {
      return undefined;
    }

    if (Array.isArray(node)) {
      const next = node
        .map((item, index) => walk(item, path ? `${path}[${index}]` : `[${index}]`))
        .filter((item) => item !== undefined);
      return next.length ? next : undefined;
    }

    if (node && typeof node === 'object') {
      const entries = Object.entries(node as Record<string, unknown>)
        .map(([key, item]) => {
          const nextPath = path ? `${path}.${key}` : key;
          return [key, walk(item, nextPath)] as const;
        })
        .filter(([, item]) => item !== undefined);
      if (!entries.length) return undefined;
      return Object.fromEntries(entries);
    }

    return node;
  };

  return walk(filtered, '');
};

export const normalize = (input: unknown, config: NormalizerConfig): unknown => {
  const filtered = filterByKeepPaths(input, config.keepPaths ?? []);
  const dropMatcher = createPathMatcher(config.dropPaths ?? []);

  const walk = (node: unknown, path: string, depth: number): unknown => {
    if (dropMatcher(path)) {
      return undefined;
    }

    if (depth > config.maxDepth) {
      return DEPTH_LIMIT_MARKER;
    }

    if (Array.isArray(node)) {
      const limited = node.slice(0, config.maxArrayItems);
      const normalized = limited
        .map((item, index) => walk(item, path ? `${path}[${index}]` : `[${index}]`, depth + 1))
        .filter((item) => item !== undefined);

      return normalized;
    }

    if (node && typeof node === 'object') {
      const entries = Object.entries(node as Record<string, unknown>)
        .map(([key, item]) => {
          const nextPath = path ? `${path}.${key}` : key;
          return [key, walk(item, nextPath, depth + 1)] as const;
        })
        .filter(([, item]) => item !== undefined);

      return Object.fromEntries(entries);
    }

    return node;
  };

  return walk(filtered, '', 0);
};
