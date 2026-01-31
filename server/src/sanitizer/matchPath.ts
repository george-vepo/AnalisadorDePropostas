const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const patternToRegex = (pattern: string) => {
  const parts = pattern.split('[]').map(escapeRegex);
  const source = `^${parts.join('\\[\\d+\\]')}$`;
  return new RegExp(source);
};

export const matchPath = (actualPath: string, allowPattern: string) => {
  return patternToRegex(allowPattern).test(actualPath);
};

export const createPathMatcher = (patterns: string[]) => {
  const regexes = patterns.map(patternToRegex);
  return (path: string) => regexes.some((regex) => regex.test(path));
};
