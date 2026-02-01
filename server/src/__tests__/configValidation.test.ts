import { describe, expect, it } from 'vitest';
import { validateConfigData } from '../config/loadConfig';

const validConfig = {
  privacy: {
    allowList: ['proposta.COD_PROPOSTA'],
    crypto: {
      enabled: true,
      timeWindow: 'hour',
      format: 'ENC',
    },
    normalizer: {
      maxDepth: 5,
      maxArrayItems: 10,
      maxStringLength: 200,
      dropPaths: [],
      keepPaths: [],
    },
  },
  analysis: {
    signals: {
      enabled: true,
      maxItemsPerArray: 10,
      includePaths: [],
      rules: [],
    },
  },
  runbooks: {
    items: [],
  },
  openai: {
    model: 'gpt-5.2-mini',
    temperature: 0.2,
    systemPrompt: 'prompt',
    userPromptTemplate: 'template',
    outputSchema: {
      enabled: false,
      name: 'schema',
      strict: true,
      schema: {},
    },
  },
  cache: {
    enabled: true,
    ttlSeconds: 60,
  },
  rateLimit: {
    enabled: true,
    windowSeconds: 60,
    maxRequests: 10,
  },
};

describe('validateConfigData', () => {
  it('accepts a valid config payload', () => {
    const result = validateConfigData(validConfig);
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid config payload', () => {
    const invalid = { ...validConfig, openai: { model: 'gpt-5.2-mini' } };
    const result = validateConfigData(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors?.some((error) => error.path.includes('openai'))).toBe(true);
  });
});
