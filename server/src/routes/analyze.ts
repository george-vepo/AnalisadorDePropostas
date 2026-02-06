import { Router } from 'express';
import { type AnalysisType, fetchAnalysesFromDb, SqlTimeoutError } from '../analysisData';
import { getAllowListSet, sanitizePayload, stripPayloadNoise } from '../sanitizer';
import { buildCodexPrompt } from '../prompt/buildCodexPrompt';
import { logger } from '../logger';

const MAX_COD_PROPOSTA_LENGTH = 50;

export const analyzeRouter = Router();

const buildErrorResponse = (message: string, details?: string) => ({
  error: {
    message,
    details,
  },
});

const parseAnalysisType = (value: unknown): AnalysisType => {
  if (value === 'sensibilizacao' || value === 'pagamento') return value;
  return 'sensibilizacao';
};

const parseSanitizeEnabled = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return true;
};

analyzeRouter.post('/analyze', async (req, res) => {
  const requestId = (req as { id?: string }).id;
  const reqLogger = (req as { log?: typeof logger }).log ?? logger;

  const proposalNumber = String((req.body as { codProposta?: unknown })?.codProposta ?? '').trim();
  const analysisType = parseAnalysisType((req.body as { analysisType?: unknown })?.analysisType);
  const sanitizeEnabled = parseSanitizeEnabled((req.body as { sanitizeEnabled?: unknown })?.sanitizeEnabled);

  if (!proposalNumber || proposalNumber.length > MAX_COD_PROPOSTA_LENGTH) {
    return res
      .status(400)
      .json(buildErrorResponse('codProposta inválido', 'Informe um código de proposta válido.'));
  }

  try {
    const analysisData = await fetchAnalysesFromDb([proposalNumber], analysisType);
    const dbItem = analysisData.items.find((item) => item.codigoProposta === proposalNumber);

    if (!dbItem) {
      return res.status(404).json(buildErrorResponse('Proposta não encontrada no banco.'));
    }

    const allowList = getAllowListSet();
    const noiseStripped = stripPayloadNoise(dbItem.resultadoJson, {
      allowList,
      maxArrayItems: 40,
      sanitizeStrings: sanitizeEnabled,
    });
    const sanitizedData = sanitizeEnabled
      ? sanitizePayload(noiseStripped, {
          maxArrayItems: 40,
          maxPayloadBytes: 150000,
          preserveUnparseableUrls: true,
        })
      : noiseStripped;

    const prompt = buildCodexPrompt(proposalNumber, sanitizedData, analysisType);

    reqLogger.info({ requestId, proposalNumber, analysisType }, 'analyze success');
    return res.json({ ok: true, proposalNumber, prompt });
  } catch (error) {
    if (error instanceof SqlTimeoutError) {
      reqLogger.error({ requestId, proposalNumber, analysisType, error: error.message }, 'analyze error');
      return res.status(504).json(buildErrorResponse('Timeout no SQL', error.message));
    }

    const details = error instanceof Error ? error.message : 'Erro desconhecido ao consultar o banco.';
    reqLogger.error({ requestId, proposalNumber, analysisType, error: details }, 'analyze error');
    return res.status(500).json(buildErrorResponse('Falha ao consultar o banco', details));
  }
});
