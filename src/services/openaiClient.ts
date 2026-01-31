import { applyTemplate } from './template';
import { PipelineConfig } from '../types/PipelineConfig';

export const analyzeProposal = async (
  proposalNumber: string,
  sanitizedJson: unknown,
  config: PipelineConfig['openai'],
  apiKey: string,
): Promise<string> => {
  const payload = {
    model: config.model,
    temperature: config.temperature,
    input: [
      {
        role: 'system',
        content: [{ type: 'text', text: config.systemPrompt }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: applyTemplate(config.userPromptTemplate, {
              proposalNumber,
              dataJson: JSON.stringify(sanitizedJson, null, 2),
            }),
          },
        ],
      },
    ],
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Falha ao chamar OpenAI (${response.status}): ${errorText || response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };

  const textParts = data.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('\n')
    .trim();

  if (!textParts) {
    throw new Error('Resposta da OpenAI não contém texto.');
  }

  return textParts;
};
