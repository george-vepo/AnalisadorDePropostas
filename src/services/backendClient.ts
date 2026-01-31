import { applyTemplate } from './template';
import { PipelineConfig } from '../types/PipelineConfig';

export type BackendResponse<T = unknown> = {
  data: T;
};

const buildBackendUrl = (config: PipelineConfig['backend'], proposalNumber: string): string => {
  const baseUrl = applyTemplate(config.baseUrl, { proposalNumber });
  const endpoint = applyTemplate(config.analysisEndpoint, { proposalNumber });
  return `${baseUrl.replace(/\/$/, '')}${endpoint}`;
};

export const getAnalysis = async (
  proposalNumber: string,
  config: PipelineConfig['backend'],
  token?: string,
): Promise<BackendResponse> => {
  const url = buildBackendUrl(config, proposalNumber);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.authHeaderTemplate) {
    headers.Authorization = applyTemplate(config.authHeaderTemplate, { token });
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Falha ao consultar backend (${response.status}): ${errorText || response.statusText}`,
    );
  }

  const data = (await response.json()) as unknown;
  return { data };
};
