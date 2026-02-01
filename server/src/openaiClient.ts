import {
  structuredAnalysisSchema,
  type StructuredAnalysis,
  validateStructuredOutput,
} from './openaiSchema';

type OpenAIOutputSchemaConfig = {
  enabled: boolean;
  name: string;
  strict: boolean;
  schema: Record<string, unknown>;
};

type OpenAIConfig = {
  model: string;
  temperature: number;
  systemPrompt: string;
  userPromptTemplate: string;
  outputSchema?: OpenAIOutputSchemaConfig;
};

type OpenAIRequestOptions = {
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
};

export type OpenAIAnalysisResult = {
  structured?: StructuredAnalysis;
  rawText?: string;
  refusal?: string;
  error?: string;
};

const renderTemplate = (template: string, values: Record<string, string>) => {
  return Object.entries(values).reduce((result, [key, value]) => {
    return result.replaceAll(`{{${key}}}`, value);
  }, template);
};

const extractOutputText = (payload: any): string => {
  if (payload.output_text) return payload.output_text as string;

  if (Array.isArray(payload.output)) {
    const chunks = payload.output.flatMap((item: any) => {
      if (!Array.isArray(item.content)) return [];
      return item.content
        .filter((content: any) => content.type === 'output_text' || content.type === 'text')
        .map((content: any) => content.text ?? '');
    });
    if (chunks.length > 0) return chunks.join('');
  }

  return '';
};

const extractJsonOutput = (payload: any): unknown | null => {
  if (!Array.isArray(payload.output)) return null;

  for (const item of payload.output) {
    if (!Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content.type === 'output_json' && content.json) {
        return content.json;
      }
      if (content.type === 'output_text' && content.text) {
        try {
          return JSON.parse(content.text);
        } catch {
          continue;
        }
      }
    }
  }

  return null;
};

const extractRefusal = (payload: any): string | null => {
  if (!Array.isArray(payload.output)) return null;

  for (const item of payload.output) {
    if (!Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content.type === 'refusal') {
        return content.refusal ?? 'Resposta recusada pelo modelo.';
      }
    }
  }

  return null;
};

const isSchemaUnsupportedError = (status: number, errorText: string) => {
  if (status < 400) return false;
  const lower = errorText.toLowerCase();
  return lower.includes('json_schema') || lower.includes('response_format') || lower.includes('schema');
};

const buildRequestBody = (
  config: OpenAIConfig,
  userPrompt: string,
  formatType?: 'json_schema' | 'json_object',
): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    model: config.model,
    temperature: config.temperature,
    input: [
      { role: 'system', content: config.systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };

  if (formatType === 'json_schema' && config.outputSchema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: config.outputSchema.name,
        strict: config.outputSchema.strict,
        schema: config.outputSchema.schema,
      },
    };
  }

  if (formatType === 'json_object') {
    body.text = {
      format: {
        type: 'json_object',
      },
    };
  }

  return body;
};

const postOpenAI = async (
  body: Record<string, unknown>,
  apiKey: string,
  options: OpenAIRequestOptions,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let payload: any = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }

    return { response, payload, rawText };
  } finally {
    clearTimeout(timeout);
  }
};

const shouldRetry = (status: number) => status === 429 || status >= 500;

const postOpenAIWithRetry = async (
  body: Record<string, unknown>,
  apiKey: string,
  options: OpenAIRequestOptions,
) => {
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt <= options.maxRetries) {
    try {
      const result = await postOpenAI(body, apiKey, options);
      if (!result.response.ok && shouldRetry(result.response.status) && attempt < options.maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, options.retryBackoffMs * (attempt + 1)));
        attempt += 1;
        continue;
      }
      return result;
    } catch (error) {
      lastError = error;
      if (attempt >= options.maxRetries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, options.retryBackoffMs * (attempt + 1)));
      attempt += 1;
    }
  }
  throw lastError ?? new Error('Erro desconhecido ao chamar OpenAI.');
};

export const analyzeWithOpenAIText = async (
  proposalNumber: string,
  sanitizedPayload: unknown,
  config: OpenAIConfig,
  apiKey: string,
  requestOptions: OpenAIRequestOptions,
): Promise<{ text: string; raw: unknown }> => {
  const dataJson = JSON.stringify(sanitizedPayload, null, 2);
  const userPrompt = renderTemplate(config.userPromptTemplate, {
    proposalNumber,
    dataJson,
  });

  const { response, payload, rawText } = await postOpenAIWithRetry(
    buildRequestBody(config, userPrompt),
    apiKey,
    requestOptions,
  );

  if (!response.ok) {
    throw new Error(`OpenAI error: ${response.status} ${rawText}`);
  }

  if (payload?.error) {
    throw new Error(payload.error.message ?? 'Erro retornado pela OpenAI.');
  }

  const text = extractOutputText(payload ?? {}).trim();
  if (text) {
    return { text, raw: payload };
  }

  return { text: JSON.stringify(payload ?? {}), raw: payload };
};

export const analyzeWithOpenAI = async (
  proposalNumber: string,
  payloadForModel: unknown,
  config: OpenAIConfig,
  apiKey: string,
  requestOptions: OpenAIRequestOptions,
): Promise<OpenAIAnalysisResult> => {
  const dataJson = JSON.stringify(payloadForModel, null, 2);
  const userPrompt = renderTemplate(config.userPromptTemplate, {
    proposalNumber,
    dataJson,
  });

  const schemaConfig = config.outputSchema ?? {
    enabled: false,
    name: 'support_analysis',
    strict: true,
    schema: structuredAnalysisSchema,
  };
  const schemaForValidation = schemaConfig.schema ?? structuredAnalysisSchema;

  const { response, payload, rawText } = await postOpenAIWithRetry(
    buildRequestBody(config, userPrompt, schemaConfig.enabled ? 'json_schema' : undefined),
    apiKey,
    requestOptions,
  );

  if (!response.ok) {
    if (schemaConfig.enabled && isSchemaUnsupportedError(response.status, rawText)) {
      const retry = await postOpenAIWithRetry(
        buildRequestBody(config, userPrompt, 'json_object'),
        apiKey,
        requestOptions,
      );
      if (!retry.response.ok) {
        const retryError = retry.payload?.error?.message ?? retry.rawText;
        return { error: `OpenAI error: ${retry.response.status} ${retryError}` };
      }
      return processOpenAIPayload(retry.payload, schemaForValidation);
    }

    return { error: `OpenAI error: ${response.status} ${rawText}` };
  }

  return processOpenAIPayload(payload, schemaForValidation);
};

export const pingOpenAI = async (model: string, apiKey: string) => {
  const body = {
    model,
    input: [{ role: 'user', content: 'ping' }],
    max_output_tokens: 5,
  };

  const options: OpenAIRequestOptions = {
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? 30000),
    maxRetries: 1,
    retryBackoffMs: 500,
  };

  const { response, payload, rawText } = await postOpenAIWithRetry(body, apiKey, options);
  if (!response.ok) {
    const errorMessage = payload?.error?.message ?? rawText;
    throw new Error(`OpenAI error: ${response.status} ${errorMessage}`);
  }
};

const processOpenAIPayload = (
  payload: any,
  schemaForValidation: Record<string, unknown>,
): OpenAIAnalysisResult => {
  if (payload?.error) {
    return { error: payload.error.message ?? 'Erro retornado pela OpenAI.' };
  }

  const refusal = extractRefusal(payload);
  if (refusal) {
    return { refusal };
  }

  const jsonOutput = extractJsonOutput(payload);
  if (jsonOutput) {
    const { valid } = validateStructuredOutput(schemaForValidation, jsonOutput);
    if (valid) {
      return { structured: jsonOutput as StructuredAnalysis };
    }
  }

  const text = extractOutputText(payload);
  return {
    rawText: text.trim() || undefined,
    error: 'Resposta da OpenAI fora do schema esperado.',
  };
};
