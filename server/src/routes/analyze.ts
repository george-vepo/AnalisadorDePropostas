import { Router } from 'express';
import { performance } from 'node:perf_hooks';
import { fetchAnalysisFromDb } from '../analysisData';
import { normalize } from '../normalizer';
import { loadPipelineConfig } from '../pipeline';
import { analyzeWithOpenAIText } from '../openaiClient';
import { sanitizeAndEncrypt } from '../sanitizer';

const MAX_COD_PROPOSTA_LENGTH = 50;

export const analyzeRouter = Router();
const pipeline = loadPipelineConfig();

const buildErrorResponse = (message: string, details?: string) => ({
  error: {
    message,
    details,
  },
});

const shouldReturnDebug = (req: { query?: { debug?: string } }) => {
  if (req.query?.debug === '1') return true;
  return (process.env.DEBUG_RETURN_SANITIZED ?? 'false') === 'true';
};

const toBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

analyzeRouter.get('/analyze/:codProposta', async (req, res) => {
  const startedAt = performance.now();
  const codProposta = String(req.params.codProposta ?? '').trim();
  const mode = String(req.query.mode ?? 'analysis').trim();

  if (!codProposta || codProposta.length > MAX_COD_PROPOSTA_LENGTH) {
    return res.status(400).json(buildErrorResponse('codProposta inválido', 'Informe um código válido.'));
  }

  if (mode && mode !== 'analysis' && mode !== 'sanitized') {
    return res.status(400).json(buildErrorResponse('Modo inválido', 'Use mode=analysis ou mode=sanitized.'));
  }

  let analysisData;
  try {
    analysisData = await fetchAnalysisFromDb(codProposta);
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Erro desconhecido ao consultar o banco.';
    return res.status(500).json(buildErrorResponse('Falha ao consultar o banco', details));
  }

  const payload = analysisData.data;

  const normalized = normalize(payload, pipeline.config.privacy.normalizer);
  const normalizedBytes = toBytes(normalized);

  let sanitizedResult;
  try {
    sanitizedResult = sanitizeAndEncrypt(
      normalized,
      pipeline.config.privacy.allowList,
      pipeline.config.privacy.crypto,
      process.env.OPENAI_CRYPTO_PASSPHRASE ?? '',
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Erro desconhecido ao proteger dados.';
    return res.status(500).json(buildErrorResponse('Falha ao sanitizar dados', details));
  }

  const sanitizedBytes = toBytes(sanitizedResult.sanitizedJson);

  if (mode === 'sanitized') {
    const responseBody: Record<string, unknown> = {
      sanitizedJson: sanitizedResult.sanitizedJson,
      meta: {
        elapsedMsTotal: Math.round(performance.now() - startedAt),
        elapsedMsDb: analysisData.elapsedMs,
        elapsedMsOpenai: 0,
        setsCount: analysisData.recordsets.length,
        rowsBySet: analysisData.rowsBySet,
        format: analysisData.format,
        fallbackUsed: analysisData.fallbackUsed,
        payloadBytesNormalized: normalizedBytes,
        payloadBytesSanitized: sanitizedBytes,
        stats: sanitizedResult.stats,
      },
    };

    if (shouldReturnDebug(req)) {
      responseBody.debug = { sanitizedJson: sanitizedResult.sanitizedJson };
    }

    return res.json(responseBody);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json(buildErrorResponse('OPENAI_API_KEY não configurada.'));
  }

  const openaiStart = performance.now();
  let analysisText = '';

  try {
    const result = await analyzeWithOpenAIText(
      codProposta,
      sanitizedResult.sanitizedJson,
      pipeline.config.openai,
      apiKey,
    );
    analysisText = result.text;
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Erro desconhecido na OpenAI.';
    return res.status(500).json(buildErrorResponse('Falha ao chamar OpenAI', details));
  }

  const responseBody: Record<string, unknown> = {
    analysisText,
    meta: {
      elapsedMsTotal: Math.round(performance.now() - startedAt),
      elapsedMsDb: analysisData.elapsedMs,
      elapsedMsOpenai: Math.round(performance.now() - openaiStart),
      setsCount: analysisData.recordsets.length,
      rowsBySet: analysisData.rowsBySet,
      format: analysisData.format,
      fallbackUsed: analysisData.fallbackUsed,
      payloadBytesNormalized: normalizedBytes,
      payloadBytesSanitized: sanitizedBytes,
      stats: sanitizedResult.stats,
    },
  };

  if (shouldReturnDebug(req)) {
    responseBody.debug = { sanitizedJson: sanitizedResult.sanitizedJson };
  }

  return res.json(responseBody);
});
