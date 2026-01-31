import { describe, expect, it } from 'vitest';
import { matchPath } from '../sanitizer/matchPath';

describe('matchPath', () => {
  it('matches paths with array wildcards', () => {
    expect(matchPath('data.set0[2].STA_PAGO', 'data.set0[].STA_PAGO')).toBe(true);
  });

  it('matches nested arrays with wildcards', () => {
    expect(matchPath('data.set0[2].items[10].code', 'data.set0[].items[].code')).toBe(true);
  });

  it('does not match different paths', () => {
    expect(matchPath('data.set1[2].STA_PAGO', 'data.set0[].STA_PAGO')).toBe(false);
  });
});
