const toBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

type PathSegment = string | number;

type PathEntry = {
  path: PathSegment[];
  size: number;
};

const getValueAtPath = (root: any, path: PathSegment[]) => {
  return path.reduce((acc, segment) => (acc ? acc[segment] : undefined), root);
};

const setValueAtPath = (root: any, path: PathSegment[], value: unknown) => {
  let cursor = root;
  path.forEach((segment, index) => {
    if (index === path.length - 1) {
      cursor[segment] = value;
      return;
    }
    cursor = cursor[segment];
  });
};

const collectArraysAndStrings = (
  value: unknown,
  path: PathSegment[],
  arrays: PathEntry[],
  strings: PathEntry[],
) => {
  if (Array.isArray(value)) {
    arrays.push({ path, size: toBytes(value) });
    value.forEach((item, index) => collectArraysAndStrings(item, [...path, index], arrays, strings));
    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      collectArraysAndStrings(child, [...path, key], arrays, strings);
    });
    return;
  }

  if (typeof value === 'string') {
    strings.push({ path, size: value.length });
  }
};

export type PayloadBudgetResult = {
  payload: unknown;
  bytes: number;
  arraysRemoved: number;
  stringsTrimmed: number;
  exceeded: boolean;
};

export const applyPayloadBudget = (payload: unknown, maxBytes: number): PayloadBudgetResult => {
  const cloned = structuredClone(payload) as any;
  let bytes = toBytes(cloned);
  let arraysRemoved = 0;
  let stringsTrimmed = 0;

  if (bytes <= maxBytes) {
    return { payload: cloned, bytes, arraysRemoved, stringsTrimmed, exceeded: false };
  }

  const arrays: PathEntry[] = [];
  const strings: PathEntry[] = [];
  collectArraysAndStrings(cloned, [], arrays, strings);

  arrays.sort((a, b) => b.size - a.size);
  for (const entry of arrays) {
    const current = getValueAtPath(cloned, entry.path);
    if (Array.isArray(current) && current.length > 0) {
      setValueAtPath(cloned, entry.path, []);
      arraysRemoved += 1;
      bytes = toBytes(cloned);
      if (bytes <= maxBytes) {
        return { payload: cloned, bytes, arraysRemoved, stringsTrimmed, exceeded: false };
      }
    }
  }

  strings.sort((a, b) => b.size - a.size);
  for (const entry of strings) {
    const current = getValueAtPath(cloned, entry.path);
    if (typeof current === 'string' && current.length > 0) {
      const trimmed = current.slice(0, 200);
      setValueAtPath(cloned, entry.path, `${trimmed}…[truncado]`);
      stringsTrimmed += 1;
      bytes = toBytes(cloned);
      if (bytes <= maxBytes) {
        return { payload: cloned, bytes, arraysRemoved, stringsTrimmed, exceeded: false };
      }
    }
  }

  return { payload: cloned, bytes, arraysRemoved, stringsTrimmed, exceeded: bytes > maxBytes };
};
