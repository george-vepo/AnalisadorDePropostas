import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type PipelineConfig = {
  privacy: {
    allowList: string[];
    crypto: {
      enabled: boolean;
      timeWindow: 'hour' | 'day';
    };
  };
  openai: {
    model: string;
    temperature: number;
    systemPrompt: string;
    userPromptTemplate: string;
  };
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pipelinePath = path.resolve(__dirname, '../../shared/pipeline.json');

export const loadPipelineConfig = (): PipelineConfig => {
  const raw = readFileSync(pipelinePath, 'utf-8');
  return JSON.parse(raw) as PipelineConfig;
};
