export type TemplateValues = Record<string, string | number | undefined | null>;

const placeholderRegex = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;

export class TemplateError extends Error {
  missingKeys: string[];

  constructor(message: string, missingKeys: string[]) {
    super(message);
    this.name = 'TemplateError';
    this.missingKeys = missingKeys;
  }
}

export const applyTemplate = (template: string, values: TemplateValues): string => {
  const missing = new Set<string>();

  const result = template.replace(placeholderRegex, (_, rawKey: string) => {
    const value = values[rawKey];
    if (value === undefined || value === null || value === '') {
      missing.add(rawKey);
      return '';
    }
    return String(value);
  });

  if (missing.size > 0) {
    throw new TemplateError(
      `Faltam valores para os placeholders: ${Array.from(missing).join(', ')}`,
      Array.from(missing),
    );
  }

  return result;
};
