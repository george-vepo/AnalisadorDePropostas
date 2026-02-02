import { Router } from 'express';
import { performance } from 'node:perf_hooks';
import { fetchAnalysisFromDb, SqlTimeoutError } from '../analysisData';
import { getConfig } from '../config/loadConfig';
import { normalize } from '../normalizer';
import { analyzeWithOpenAIText } from '../openaiClient';
import { applyPayloadBudget } from '../payloadBudget';
import { getAllowListSet, sanitizeForOpenAI } from '../sanitizer';
import { extractSignals } from '../signals/extractSignals';
import { matchRunbooks } from '../runbooks/matchRunbooks';
import { buildCacheKey } from '../cache';
import { logger } from '../logger';
import { incrementError } from '../metrics';

const MAX_COD_PROPOSTA_LENGTH = 50;

export const analyzeRouter = Router();

const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const rateLimitState = new Map<string, { count: number; resetAt: number }>();
const allowListSet = getAllowListSet();

const buildErrorResponse = (message: string, details?: string) => ({
  error: {
    message,
    details,
  },
});

const toBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

const getClientIp = (req: { headers?: Record<string, string | string[] | undefined>; ip?: string }) => {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim();
  if (Array.isArray(forwarded)) return forwarded[0];
  return req.ip ?? 'unknown';
};

const checkRateLimit = (ip: string) => {
  const configResult = getConfig();
  const config = configResult.config;
  if (!config) return { allowed: true };
  if (!config.rateLimit?.enabled) return { allowed: true };

  const windowMs = (config.rateLimit.windowSeconds ?? 300) * 1000;
  const maxRequests = config.rateLimit.maxRequests ?? 30;
  const now = Date.now();
  const current = rateLimitState.get(ip);

  if (!current || current.resetAt <= now) {
    rateLimitState.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (current.count >= maxRequests) {
    return { allowed: false, retryAfterMs: current.resetAt - now };
  }

  current.count += 1;
  return { allowed: true };
};

const buildConfigErrorDetails = (errors?: Array<{ path: string; message: string }>) => {
  if (!errors || errors.length === 0) return 'Config inválido.';
  return errors.map((error) => `${error.path}: ${error.message}`).join('; ');
};

analyzeRouter.get('/analyze/:codProposta', async (req, res) => {
  const startedAt = performance.now();
  const codProposta = String(req.params.codProposta ?? '').trim();
  const requestId = (req as { id?: string }).id;
  const reqLogger = (req as { log?: typeof logger }).log ?? logger;
  const logStage = (stage: string, elapsedMs: number) => {
    reqLogger.info({ requestId, stage, elapsedMs }, 'Stage completed');
  };

  if (!codProposta || codProposta.length > MAX_COD_PROPOSTA_LENGTH) {
    return res.status(400).json(buildErrorResponse('codProposta inválido', 'Informe um código válido.'));
  }

  const configResult = getConfig();
  if (!configResult.config) {
    incrementError();
    return res.status(500).json(
      buildErrorResponse('Config inválido', buildConfigErrorDetails(configResult.errors)),
    );
  }

  const rateLimitResult = checkRateLimit(getClientIp(req));
  if (!rateLimitResult.allowed) {
    return res.status(429).json(
      buildErrorResponse(
        'Limite de requisições excedido',
        `Aguarde ${Math.ceil((rateLimitResult.retryAfterMs ?? 0) / 1000)}s antes de tentar novamente.`,
      ),
    );
  }

  const cacheKey = buildCacheKey(codProposta, configResult.hash ?? 'invalid');
  if (configResult.config.cache?.enabled) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.value);
    }
  }

  let analysisData;
  try {
    analysisData = await fetchAnalysisFromDb(codProposta);
  } catch (error) {
    if (error instanceof SqlTimeoutError) {
      incrementError();
      return res.status(504).json(buildErrorResponse('Timeout no SQL', error.message));
    }
    const details = error instanceof Error ? error.message : 'Erro desconhecido ao consultar o banco.';
    incrementError();
    return res.status(500).json(buildErrorResponse('Falha ao consultar o banco', details));
  }

  logStage('dbFetch', analysisData.elapsedMs);
  const payload = analysisData.data;

  const normalizeStart = performance.now();
  const normalized = normalize(payload, configResult.config.privacy.normalizer);
  const normalizeElapsed = Math.round(performance.now() - normalizeStart);
  logStage('normalize', normalizeElapsed);

  const sanitizeStart = performance.now();
  let sanitizedResult;
  try {
    sanitizedResult = sanitizeForOpenAI(normalized, allowListSet, {
      maxStringLength: Number(process.env.OPENAI_PAYLOAD_MAX_STRING ?? 500),
      maxStackTraceLength: Number(process.env.OPENAI_PAYLOAD_MAX_STACKTRACE ?? 2000),
      maxPayloadBytes: Number(process.env.MAX_OPENAI_INPUT_BYTES ?? 150000),
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Erro desconhecido ao proteger dados.';
    incrementError();
    return res.status(500).json(buildErrorResponse('Falha ao sanitizar dados', details));
  }
  logStage('sanitize', Math.round(performance.now() - sanitizeStart));

  const signalsStart = performance.now();
  const signals = configResult.config.analysis.signals?.enabled
    ? extractSignals(normalized, configResult.config.analysis.signals)
    : {
        proposal: { datas: {} },
        counts: { integracoesTotal: 0, errosTotal: 0, logsTotal: 0 },
        recent: {},
        flags: [],
        topErrors: [],
        integrationsSummary: [],
        safeFields: {},
      };
  const runbooksMatched = matchRunbooks(
    normalized,
    signals as Record<string, unknown>,
    configResult.config.runbooks.items,
  );
  logStage('signalsRunbooks', Math.round(performance.now() - signalsStart));

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    incrementError();
    return res.status(500).json(buildErrorResponse('OPENAI_API_KEY não configurada.'));
  }

  const maxOpenAiBytes = Number(process.env.MAX_OPENAI_INPUT_BYTES ?? 150000);
  let payloadForModel = {
    proposalNumber: codProposta,
    signals,
    runbooks: runbooksMatched,
    data: sanitizedResult.sanitizedJson,
  };
  let payloadBytesForModel = toBytes(payloadForModel);

  if (payloadBytesForModel > maxOpenAiBytes) {
    const reduced = applyPayloadBudget(sanitizedResult.sanitizedJson, maxOpenAiBytes);
    payloadForModel = {
      proposalNumber: codProposta,
      signals,
      runbooks: runbooksMatched,
      data: reduced.payload,
    };
    payloadBytesForModel = toBytes(payloadForModel);
  }

  if (payloadBytesForModel > maxOpenAiBytes) {
    incrementError();
    return res.status(413).json(buildErrorResponse('Payload grande demais para OpenAI.'));
  }

  let analysisText: string;
  try {
    const openaiStart = performance.now();
    const textResult = await analyzeWithOpenAIText(
      codProposta,
      payloadForModel,
      configResult.config.openai,
      apiKey,
      {
        timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? 30000),
        maxRetries: 1,
        retryBackoffMs: 500,
      },
    );
    analysisText = textResult.text;
    logStage('openai', Math.round(performance.now() - openaiStart));
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Erro desconhecido ao chamar OpenAI.';
    incrementError();
    return res.status(502).json(buildErrorResponse('Falha ao chamar OpenAI', details));
  }

  const responseBody = { analysisText };

  if (configResult.config.cache?.enabled) {
    responseCache.set(cacheKey, {
      expiresAt: Date.now() + (configResult.config.cache.ttlSeconds ?? 600) * 1000,
      value: responseBody,
    });
  }

  reqLogger.info(
    {
      requestId,
      elapsedMsTotal: Math.round(performance.now() - startedAt),
    },
    'Pipeline analysis completed',
  );

  return res.json(responseBody);
});
