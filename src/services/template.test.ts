import { describe, expect, it } from 'vitest';
import { applyTemplate, TemplateError } from './template';

describe('applyTemplate', () => {
  it('replaces placeholders', () => {
    const result = applyTemplate('Olá {{name}}', { name: 'Ana' });
    expect(result).toBe('Olá Ana');
  });

  it('throws when missing', () => {
    expect(() => applyTemplate('ID {{id}}', {})).toThrow(TemplateError);
  });
});
