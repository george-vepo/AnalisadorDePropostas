import { describe, expect, it } from 'vitest';
import { applyPayloadBudget } from '../payloadBudget';

describe('applyPayloadBudget', () => {
  it('removes arrays before trimming strings', () => {
    const payload = {
      logs: Array.from({ length: 50 }, (_, index) => ({
        id: index,
        message: `log-${index}`.repeat(20),
      })),
      details: {
        longText: 'x'.repeat(2000),
      },
    };

    const result = applyPayloadBudget(payload, 500);
    expect(result.arraysRemoved).toBeGreaterThan(0);
    expect(Array.isArray((result.payload as any).logs)).toBe(true);
    expect((result.payload as any).logs.length).toBe(0);
    expect(result.stringsTrimmed).toBeGreaterThan(0);
    expect((result.payload as any).details.longText).toContain('[truncado]');
  });
});
