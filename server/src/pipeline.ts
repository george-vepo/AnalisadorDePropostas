import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export type RunbookCondition = {
  path: string;
  equals?: string | number | boolean;
  notEquals?: string | number | boolean;
  contains?: string;
  in?: Array<string | number | boolean>;
  exists?: boolean;
};

export type RunbookWhen = {
  any?: RunbookCondition[];
  all?: RunbookCondition[];
};

export type RunbookItem = {
  id: string;
  when: RunbookWhen;
  title: string;
  steps: string[];
  links: string[];
  severitySuggestion: 'P0' | 'P1' | 'P2' | 'P3' | 'UNKNOWN';
};

export type SignalRule = {
  id: string;
  description: string;
  when: RunbookWhen;
  flag: string;
  severity?: 'P0' | 'P1' | 'P2' | 'P3' | 'UNKNOWN';
};

export type PipelineConfig = {
  privacy: {
    allowList: string[];
    crypto: {
      enabled: boolean;
      timeWindow: 'hour' | 'day';
    };
  };
  analysis: {
    signals: {
      enabled: boolean;
      includePaths: string[];
      rules: SignalRule[];
    };
  };
  runbooks: {
    items: RunbookItem[];
  };
  openai: {
    model: string;
    temperature: number;
    systemPrompt: string;
    userPromptTemplate: string;
  };
};

export type PipelineConfigWithHash = {
  config: PipelineConfig;
  hash: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pipelinePath = path.resolve(__dirname, '../../shared/pipeline.json');

export const loadPipelineConfig = (): PipelineConfigWithHash => {
  const raw = readFileSync(pipelinePath, 'utf-8');
  const hash = createHash('sha256').update(raw).digest('hex');
  return {
    config: JSON.parse(raw) as PipelineConfig,
    hash,
  };
};
