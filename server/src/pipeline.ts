
export type RunbookCondition = {
  path: string;
  equals?: string | number | boolean;
  in?: Array<string | number | boolean>;
  exists?: boolean;
  contains?: string;
  notEquals?: string | number | boolean;
};

export type RunbookWhen = {
  all?: RunbookCondition[];
  any?: RunbookCondition[];
};

export type SignalRule = {
  id: string;
  description: string;
  when: RunbookWhen;
  flag: string;
  severity?: 'P0' | 'P1' | 'P2' | 'P3' | 'UNKNOWN';
};

export type RunbookItem = {
  id: string;
  when: RunbookWhen;
  title: string;
  severitySuggestion: 'P0' | 'P1' | 'P2' | 'P3' | 'UNKNOWN';
  steps: string[];
  links: string[];
};

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
  analysis: {
    signals: {
      enabled: boolean;
      maxItemsPerArray: number;
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
    projectId?: string;
    outputSchema: {
      enabled: boolean;
      name: string;
      strict: boolean;
      schema: Record<string, unknown>;
    };
  };
  cache: {
    enabled: boolean;
    ttlSeconds: number;
  };
  rateLimit: {
    enabled: boolean;
    windowSeconds: number;
    maxRequests: number;
  };
};

export type PipelineConfigWithHash = {
  config: PipelineConfig;
  hash: string;
};
