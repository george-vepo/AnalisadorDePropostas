export type PipelineConfig = {
  backend: {
    baseUrl: string;
    analysisEndpoint: string;
    authHeaderTemplate?: string;
  };
  privacy: {
    allowList: string[];
    crypto: {
      enabled: boolean;
      timeWindow: 'hour' | 'day';
      format: string;
    };
  };
  openai: {
    model: string;
    temperature: number;
    systemPrompt: string;
    userPromptTemplate: string;
  };
};
