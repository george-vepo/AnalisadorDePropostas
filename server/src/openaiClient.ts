import { structuredAnalysisSchema, type StructuredAnalysis, validateStructuredAnalysis } from './openaiSchema';

type OpenAIConfig = {
  model: string;
  temperature: number;
  systemPrompt: string;
  userPromptTemplate: string;
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

export const analyzeWithOpenAIText = async (
  proposalNumber: string,
  sanitizedPayload: unknown,
  config: OpenAIConfig,
  apiKey: string,
): Promise<{ text: string; raw: unknown }> => {
  const dataJson = JSON.stringify(sanitizedPayload, null, 2);
  const userPrompt = renderTemplate(config.userPromptTemplate, {
    proposalNumber,
    dataJson,
  });

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      input: [
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI error: ${response.status} ${errorBody}`);
  }

  const apiPayload = await response.json();

  if (apiPayload.error) {
    throw new Error(apiPayload.error.message ?? 'Erro retornado pela OpenAI.');
  }

  const text = extractOutputText(apiPayload).trim();
  if (text) {
    return { text, raw: apiPayload };
  }

  return { text: JSON.stringify(apiPayload), raw: apiPayload };
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

export const analyzeWithOpenAI = async (
  proposalNumber: string,
  payloadForModel: unknown,
  config: OpenAIConfig,
  apiKey: string,
): Promise<OpenAIAnalysisResult> => {
  const dataJson = JSON.stringify(payloadForModel, null, 2);
  const userPrompt = renderTemplate(config.userPromptTemplate, {
    proposalNumber,
    dataJson,
  });

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      input: [
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'proposal_analysis',
          strict: true,
          schema: structuredAnalysisSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI error: ${response.status} ${errorBody}`);
  }

  const apiPayload = await response.json();

  if (apiPayload.error) {
    return { error: apiPayload.error.message ?? 'Erro retornado pela OpenAI.' };
  }

  const refusal = extractRefusal(apiPayload);
  if (refusal) {
    return { refusal };
  }

  const jsonOutput = extractJsonOutput(apiPayload);
  if (jsonOutput && validateStructuredAnalysis(jsonOutput)) {
    return { structured: jsonOutput };
  }

  const text = extractOutputText(apiPayload);
  return {
    rawText: text.trim() || undefined,
    error: 'Resposta da OpenAI fora do schema esperado.',
  };
};
