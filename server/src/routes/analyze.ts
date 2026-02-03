import { Router } from 'express';
import { performance } from 'node:perf_hooks';
import { fetchAnalysesFromDb, SqlTimeoutError } from '../analysisData';
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
const MAX_COD_PROPOSTAS = 20;

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

const normalizeCodPropostasInput = (input: unknown): string[] => {
  if (Array.isArray(input)) {
    return input
      .map((value) => (typeof value === 'string' ? value : String(value)))
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (typeof input === 'string') {
    return input
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  if (input === undefined || input === null) {
    return [];
  }

  return [String(input).trim()].filter(Boolean);
};

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

analyzeRouter.post('/analyze', async (req, res) => {
  const startedAt = performance.now();
  const requestId = (req as { id?: string }).id;
  const reqLogger = (req as { log?: typeof logger }).log ?? logger;
  const logStage = (stage: string, elapsedMs: number) => {
    reqLogger.info({ requestId, stage, elapsedMs }, 'Stage completed');
  };

  const rawInput = (req.body as { codPropostas?: unknown; codProposta?: unknown })?.codPropostas ?? req.body?.codProposta;
  const normalized = normalizeCodPropostasInput(rawInput);
  const codPropostas = Array.from(new Set(normalized));

  if (codPropostas.length === 0) {
    return res.status(400).json(buildErrorResponse('codPropostas inválido', 'Informe ao menos uma proposta.'));
  }

  if (codPropostas.length > MAX_COD_PROPOSTAS) {
    return res
      .status(400)
      .json(buildErrorResponse('Limite excedido', `Envie no máximo ${MAX_COD_PROPOSTAS} propostas.`));
  }

  const invalidLength = codPropostas.find((codProposta) => codProposta.length > MAX_COD_PROPOSTA_LENGTH);
  if (invalidLength) {
    return res.status(400).json(buildErrorResponse('codProposta inválido', 'Informe códigos válidos.'));
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

  let analysisData;
  try {
    analysisData = await fetchAnalysesFromDb(codPropostas);
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    incrementError();
    return res.status(500).json(buildErrorResponse('OPENAI_API_KEY não configurada.'));
  }

  const maxOpenAiBytes = Number(process.env.MAX_OPENAI_INPUT_BYTES ?? 150000);
  const byProposta = new Map(analysisData.items.map((item) => [item.codigoProposta, item]));

  const results = [];
  for (const codProposta of codPropostas) {
    const dbItem = byProposta.get(codProposta);

    if (!dbItem) {
      results.push({
        codigoProposta: codProposta,
        error: { message: 'Proposta não encontrada no banco.' },
      });
      continue;
    }

    const cacheKey = buildCacheKey(codProposta, configResult.hash ?? 'invalid');
    if (configResult.config.cache?.enabled) {
      const cached = responseCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        results.push(cached.value);
        continue;
      }
    }

    const normalizeStart = performance.now();
    const normalizedPayload = normalize(dbItem.resultadoJson, configResult.config.privacy.normalizer);
    const normalizeElapsed = Math.round(performance.now() - normalizeStart);
    logStage('normalize', normalizeElapsed);

    const sanitizeStart = performance.now();
    let sanitizedResult;
    try {
      sanitizedResult = sanitizeForOpenAI(normalizedPayload, allowListSet, {
        maxStringLength: Number(process.env.OPENAI_PAYLOAD_MAX_STRING ?? 500),
        maxStackTraceLength: Number(process.env.OPENAI_PAYLOAD_MAX_STACKTRACE ?? 2000),
        maxPayloadBytes: maxOpenAiBytes,
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Erro desconhecido ao proteger dados.';
      incrementError();
      results.push({
        codigoProposta: codProposta,
        resultadoJson: dbItem.resultadoJson,
        error: { message: 'Falha ao sanitizar dados', details },
      });
      continue;
    }
    logStage('sanitize', Math.round(performance.now() - sanitizeStart));

    const sanitizedBytes = toBytes(sanitizedResult.sanitizedJson);
    reqLogger.info(
      {
        requestId,
        codigoProposta: codProposta,
        payloadBytesBefore: toBytes(dbItem.resultadoJson),
        payloadBytesAfter: sanitizedBytes,
        removedSensitive: sanitizedResult.stats.removedSensitive,
        removedLarge: sanitizedResult.stats.removedLarge,
        removedNotAllowlisted: sanitizedResult.stats.removedNotAllowlisted,
        totalKeys: sanitizedResult.stats.totalKeys,
        keptKeys: sanitizedResult.stats.keptKeys,
        parsedJson: sanitizedResult.stats.parsedJson,
        payloadTrimmed: sanitizedResult.stats.payloadTrimmed,
      },
      'Sanitize metrics',
    );

    const signalsStart = performance.now();
    const signals = configResult.config.analysis.signals?.enabled
      ? extractSignals(normalizedPayload, configResult.config.analysis.signals)
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
      normalizedPayload,
      signals as Record<string, unknown>,
      configResult.config.runbooks.items,
    );
    logStage('signalsRunbooks', Math.round(performance.now() - signalsStart));

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
      results.push({
        codigoProposta: codProposta,
        resultadoJson: dbItem.resultadoJson,
        error: { message: 'Payload grande demais para OpenAI.' },
      });
      continue;
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
      results.push({
        codigoProposta: codProposta,
        resultadoJson: dbItem.resultadoJson,
        error: { message: 'Falha ao chamar OpenAI', details },
      });
      continue;
    }

    const responseBody = {
      codigoProposta: codProposta,
      resultadoJson: dbItem.resultadoJson,
      analise: { texto: analysisText },
    };

    if (configResult.config.cache?.enabled) {
      responseCache.set(cacheKey, {
        expiresAt: Date.now() + (configResult.config.cache.ttlSeconds ?? 600) * 1000,
        value: responseBody,
      });
    }

    results.push(responseBody);
  }

  reqLogger.info(
    {
      requestId,
      elapsedMsTotal: Math.round(performance.now() - startedAt),
      proposalsCount: codPropostas.length,
    },
    'Pipeline analysis completed',
  );

  return res.json(results);
});
