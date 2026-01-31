import { describe, expect, it } from 'vitest';
import { buildCacheKey } from '../cache';

describe('buildCacheKey', () => {
  it('includes proposal, hash, and mode', () => {
    const key = buildCacheKey('123', 'hash123', 'analysis');
    expect(key).toBe('123:hash123:analysis');
  });
});
