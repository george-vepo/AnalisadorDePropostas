import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export type PipelineConfig = {
  privacy: {
    allowList: string[];
    crypto: {
      enabled: boolean;
      timeWindow: 'hour' | 'day';
      format: string;
    };
    normalizer: {
      maxDepth: number;
      maxArrayItems: number;
      maxStringLength: number;
      dropPaths: string[];
      keepPaths: string[];
    };
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
const pipelinePath = path.resolve(__dirname, '../config/pipeline.json');

export const loadPipelineConfig = (): PipelineConfigWithHash => {
  const raw = readFileSync(pipelinePath, 'utf-8');
  const hash = createHash('sha256').update(raw).digest('hex');
  return {
    config: JSON.parse(raw) as PipelineConfig,
    hash,
  };
};
