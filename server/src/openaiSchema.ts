import Ajv, { type ValidateFunction } from 'ajv';

export type StructuredAnalysis = {
  title: string;
  summary: string;
  probable_cause: string;
  confidence: number;
  severity: 'P0' | 'P1' | 'P2' | 'P3' | 'UNKNOWN';
  evidence: string[];
  next_steps: string[];
  questions: string[];
  suggested_runbooks?: string[];
};

export const structuredAnalysisSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    probable_cause: { type: 'string' },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3', 'UNKNOWN'] },
    evidence: { type: 'array', items: { type: 'string' } },
    next_steps: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' } },
    suggested_runbooks: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'summary', 'probable_cause', 'confidence', 'severity', 'evidence', 'next_steps', 'questions'],
  additionalProperties: false,
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const validate: ValidateFunction = ajv.compile(structuredAnalysisSchema);

export const validateStructuredAnalysis = (data: unknown): data is StructuredAnalysis => {
  return Boolean(validate(data));
};

export const getStructuredAnalysisErrors = () => validate.errors ?? [];
