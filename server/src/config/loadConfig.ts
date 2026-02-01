import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import Ajv, { type ErrorObject } from 'ajv';
import type { PipelineConfig } from '../pipeline';

export type ConfigError = {
  path: string;
  message: string;
};

export type ConfigResult = {
  config: PipelineConfig | null;
  hash: string | null;
  errors?: ConfigError[];
};

const severitySchema = { type: 'string', enum: ['P0', 'P1', 'P2', 'P3', 'UNKNOWN'] } as const;

const runbookConditionSchema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    equals: { type: ['string', 'number', 'boolean'] },
    in: { type: 'array', items: { type: ['string', 'number', 'boolean'] } },
    exists: { type: 'boolean' },
    contains: { type: 'string' },
    notEquals: { type: ['string', 'number', 'boolean'] },
  },
  required: ['path'],
  additionalProperties: false,
} as const;

const runbookWhenSchema = {
  type: 'object',
  properties: {
    all: { type: 'array', items: runbookConditionSchema },
    any: { type: 'array', items: runbookConditionSchema },
  },
  additionalProperties: false,
} as const;

const signalRuleSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    description: { type: 'string' },
    when: runbookWhenSchema,
    flag: { type: 'string' },
    severity: severitySchema,
  },
  required: ['id', 'description', 'when', 'flag'],
  additionalProperties: false,
} as const;

const runbookItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    when: runbookWhenSchema,
    title: { type: 'string' },
    severitySuggestion: severitySchema,
    steps: { type: 'array', items: { type: 'string' } },
    links: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'when', 'title', 'severitySuggestion', 'steps', 'links'],
  additionalProperties: false,
} as const;

export const pipelineSchema = {
  type: 'object',
  properties: {
    privacy: {
      type: 'object',
      properties: {
        allowList: { type: 'array', items: { type: 'string' } },
        crypto: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            timeWindow: { type: 'string', enum: ['hour', 'day'] },
            format: { type: 'string' },
          },
          required: ['enabled', 'timeWindow', 'format'],
          additionalProperties: false,
        },
        normalizer: {
          type: 'object',
          properties: {
            maxDepth: { type: 'integer', minimum: 1 },
            maxArrayItems: { type: 'integer', minimum: 1 },
            maxStringLength: { type: 'integer', minimum: 1 },
            dropPaths: { type: 'array', items: { type: 'string' } },
            keepPaths: { type: 'array', items: { type: 'string' } },
          },
          required: ['maxDepth', 'maxArrayItems', 'maxStringLength', 'dropPaths', 'keepPaths'],
          additionalProperties: false,
        },
      },
      required: ['allowList', 'crypto', 'normalizer'],
      additionalProperties: false,
    },
    analysis: {
      type: 'object',
      properties: {
        signals: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            maxItemsPerArray: { type: 'integer', minimum: 1 },
            includePaths: { type: 'array', items: { type: 'string' } },
            rules: { type: 'array', items: signalRuleSchema },
          },
          required: ['enabled', 'maxItemsPerArray', 'includePaths', 'rules'],
          additionalProperties: false,
        },
      },
      required: ['signals'],
      additionalProperties: false,
    },
    runbooks: {
      type: 'object',
      properties: {
        items: { type: 'array', items: runbookItemSchema },
      },
      required: ['items'],
      additionalProperties: false,
    },
    openai: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        temperature: { type: 'number' },
        systemPrompt: { type: 'string' },
        userPromptTemplate: { type: 'string' },
        outputSchema: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            name: { type: 'string' },
            strict: { type: 'boolean' },
            schema: { type: 'object', additionalProperties: true },
          },
          required: ['enabled', 'name', 'strict', 'schema'],
          additionalProperties: false,
        },
      },
      required: ['model', 'temperature', 'systemPrompt', 'userPromptTemplate', 'outputSchema'],
      additionalProperties: false,
    },
    cache: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        ttlSeconds: { type: 'integer', minimum: 1 },
      },
      required: ['enabled', 'ttlSeconds'],
      additionalProperties: false,
    },
    rateLimit: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        windowSeconds: { type: 'integer', minimum: 1 },
        maxRequests: { type: 'integer', minimum: 1 },
      },
      required: ['enabled', 'windowSeconds', 'maxRequests'],
      additionalProperties: false,
    },
  },
  required: ['privacy', 'analysis', 'runbooks', 'openai', 'cache', 'rateLimit'],
  additionalProperties: false,
} as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pipelinePath = path.resolve(__dirname, '../../config/pipeline.json');

let cachedConfig: ConfigResult | null = null;

const formatAjvErrors = (errors?: ErrorObject[] | null): ConfigError[] => {
  if (!errors) return [];
  return errors.map((error) => {
    const instancePath = error.instancePath ? error.instancePath.replace(/^\//, '').replaceAll('/', '.') : '';
    const missingProperty =
      typeof (error.params as { missingProperty?: string })?.missingProperty === 'string'
        ? (error.params as { missingProperty?: string }).missingProperty
        : '';
    const path = instancePath && missingProperty ? `${instancePath}.${missingProperty}` : instancePath || missingProperty || 'root';
    return {
      path,
      message: error.message ?? 'Erro de validação.',
    };
  });
};

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validatePipeline = ajv.compile(pipelineSchema);

export const loadConfig = (): ConfigResult => {
  try {
    const raw = readFileSync(pipelinePath, 'utf-8');
    const hash = createHash('sha256').update(raw).digest('hex');
    const parsedJson = JSON.parse(raw);
    const valid = validatePipeline(parsedJson);
    if (!valid) {
      const errors = formatAjvErrors(validatePipeline.errors);
      cachedConfig = { config: null, hash, errors };
      return cachedConfig;
    }

    cachedConfig = { config: parsedJson as PipelineConfig, hash };
    return cachedConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido ao ler pipeline.json.';
    cachedConfig = {
      config: null,
      hash: null,
      errors: [{ path: 'root', message }],
    };
    return cachedConfig;
  }
};

export const getConfig = (): ConfigResult => {
  if (!cachedConfig) {
    return loadConfig();
  }
  return cachedConfig;
};

export const validateConfig = (): ConfigResult => loadConfig();

export const validateConfigData = (data: unknown) => {
  const valid = validatePipeline(data);
  if (!valid) {
    return { ok: false, errors: formatAjvErrors(validatePipeline.errors) };
  }
  return { ok: true, config: data as PipelineConfig };
};
