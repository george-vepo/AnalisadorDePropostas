import { logger } from './logger';

type OpenAIConfig = {
  model: string;
  temperature: number;
  systemPrompt: string;
  userPromptTemplate: string;
  projectId?: string;
};

type OpenAIRequestOptions = {
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
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

const buildRequestBody = (config: OpenAIConfig, userPrompt: string): Record<string, unknown> => {
  return {
    model: config.model,
    temperature: config.temperature,
    instructions: config.systemPrompt,
    input: userPrompt,
  };
};

const postOpenAI = async (
  body: Record<string, unknown>,
  apiKey: string,
  options: OpenAIRequestOptions,
  projectId?: string,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (projectId) {
    headers['OpenAI-Project'] = projectId;
  }
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers,
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
  projectId?: string,
) => {
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt <= options.maxRetries) {
    try {
      const result = await postOpenAI(body, apiKey, options, projectId);
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
  const projectId = config.projectId?.trim() || process.env.OPENAI_PROJECT_ID?.trim();

  const { response, payload, rawText } = await postOpenAIWithRetry(
    buildRequestBody(config, userPrompt),
    apiKey,
    requestOptions,
    projectId,
  );

  if (!response.ok) {
    const requestId = response.headers.get('x-request-id') ?? undefined;
    const errorBody = payload ?? rawText;
    logger.error(
      {
        status: response.status,
        requestId,
        errorBody,
      },
      'OpenAI response error',
    );
    throw new Error(`OpenAI error: ${response.status} ${rawText}`);
  }

  if (payload?.error) {
    const requestId = response.headers.get('x-request-id') ?? undefined;
    logger.error(
      {
        status: response.status,
        requestId,
        errorBody: payload.error,
      },
      'OpenAI response error',
    );
    throw new Error(payload.error.message ?? 'Erro retornado pela OpenAI.');
  }

  const text = extractOutputText(payload ?? {}).trim();
  if (text) {
    return { text, raw: payload };
  }

  return { text: JSON.stringify(payload ?? {}), raw: payload };
};
