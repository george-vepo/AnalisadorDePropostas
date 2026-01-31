type OpenAIConfig = {
  model: string;
  temperature: number;
  systemPrompt: string;
  userPromptTemplate: string;
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

export const analyzeWithOpenAI = async (
  proposalNumber: string,
  sanitizedJson: unknown,
  config: OpenAIConfig,
  apiKey: string,
): Promise<string> => {
  const dataJson = JSON.stringify(sanitizedJson, null, 2);
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

  const payload = await response.json();
  const text = extractOutputText(payload);

  if (!text) {
    throw new Error('Resposta da OpenAI sem conteúdo de texto.');
  }

  return text.trim();
};
