export type AllowListMatcher = (path: string) => boolean;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const createAllowListMatcher = (allowList: string[]): AllowListMatcher => {
  const patterns = allowList.map((entry) => {
    const escaped = escapeRegex(entry);
    const source = `^${escaped.replace(/\\\[\\\]/g, '\\\\[\\\\d+\\\\]')}$`;
    return new RegExp(source);
  });

  return (path: string) => patterns.some((regex) => regex.test(path));
};
