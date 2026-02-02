import { describe, expect, it } from 'vitest';
import { buildCacheKey } from '../cache';

describe('buildCacheKey', () => {
  it('includes proposal and hash', () => {
    const key = buildCacheKey('123', 'hash123');
    expect(key).toBe('123:hash123');
  });
});
