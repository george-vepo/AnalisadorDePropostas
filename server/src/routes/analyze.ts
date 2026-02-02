import { Router } from 'express';
import { performance } from 'node:perf_hooks';
import { fetchAnalysisFromDb, SqlTimeoutError } from '../analysisData';
import { getConfig } from '../config/loadConfig';
import { normalize } from '../normalizer';
import { analyzeWithOpenAI, analyzeWithOpenAIText } from '../openaiClient';
import { buildFallbackAnalysisText } from '../fallback';
import { applyPayloadBudget } from '../payloadBudget';
import { redactSensitive } from '../redaction';
import { getAllowListSet, sanitizeAndEncrypt } from '../sanitizer';
import { extractSignals } from '../signals/extractSignals';
import { matchRunbooks } from '../runbooks/matchRunbooks';
import { buildCacheKey } from '../cache';
import { logger } from '../logger';
import { incrementError } from '../metrics';

const MAX_COD_PROPOSTA_LENGTH = 50;
const MAX_DRY_RUN_RESPONSE_BYTES = 200 * 1024;
const MAX_SANITIZED_PREVIEW_BYTES = 100 * 1024;

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

const buildTicketMarkdown = (
  structured: {
    title: string;
    summary: string;
    probable_cause: string;
    confidence: number;
    severity: string;
    evidence: string[];
    next_steps: string[];
    questions: string[];
    suggested_runbooks?: string[];
  },
  runbooksMatched: ReturnType<typeof matchRunbooks>,
) => {
  const lines: string[] = [];
  lines.push(`# ${structured.title}`);
  lines.push(`**Severidade:** ${structured.severity} | **Confiança:** ${structured.confidence}%`);
  lines.push('');
  lines.push('## Resumo');
  lines.push(structured.summary);
  lines.push('');
  lines.push('## Causa provável');
  lines.push(structured.probable_cause);
  lines.push('');
  lines.push('## Evidências');
  structured.evidence.forEach((item) => lines.push(`- ${item}`));
  lines.push('');
  lines.push('## Próximos passos');
  structured.next_steps.forEach((item) => lines.push(`- ${item}`));
  lines.push('');
  lines.push('## Perguntas');
  structured.questions.forEach((item) => lines.push(`- ${item}`));

  const suggestions = structured.suggested_runbooks ?? [];
  const matchedByIdOrTitle = suggestions
    .map((suggestion) => {
      const normalized = suggestion.toLowerCase();
      return (
        runbooksMatched.find((runbook) => runbook.id.toLowerCase() === normalized) ??
        runbooksMatched.find((runbook) => runbook.title.toLowerCase() === normalized)
      );
    })
    .filter(Boolean);

  if (suggestions.length > 0 || runbooksMatched.length > 0) {
    lines.push('');
    lines.push('## Runbooks sugeridos');

    const runbooksToRender = matchedByIdOrTitle.length > 0 ? matchedByIdOrTitle : runbooksMatched;
    runbooksToRender.forEach((runbook) => {
      if (!runbook) return;
      const links = runbook.links.length > 0 ? ` (${runbook.links.join(' ')})` : '';
      lines.push(`- ${runbook.title}${links}`);
    });

    const fallbackSuggestions = suggestions.filter(
      (suggestion) => !matchedByIdOrTitle.some((runbook) => runbook?.title === suggestion || runbook?.id === suggestion),
    );
    fallbackSuggestions.forEach((suggestion) => lines.push(`- ${suggestion}`));
  }

  return lines.join('\n');
};

const emptySignals = () => ({
  proposal: { datas: {} },
  counts: { integracoesTotal: 0, errosTotal: 0, logsTotal: 0 },
  recent: {},
  flags: [],
  topErrors: [],
  integrationsSummary: [],
  safeFields: {},
});

const buildConfigErrorDetails = (errors?: Array<{ path: string; message: string }>) => {
  if (!errors || errors.length === 0) return 'Config inválido.';
  return errors.map((error) => `${error.path}: ${error.message}`).join('; ');
};

const buildSanitizedPreview = (sanitizedJson: unknown) => {
  const previewResult = applyPayloadBudget(sanitizedJson, MAX_SANITIZED_PREVIEW_BYTES);
  return {
    preview: previewResult.payload,
    previewBytes: previewResult.bytes,
    arraysRemoved: previewResult.arraysRemoved,
    stringsTrimmed: previewResult.stringsTrimmed,
    exceeded: previewResult.exceeded,
  };
};

analyzeRouter.get('/analyze/:codProposta', async (req, res) => {
  const startedAt = performance.now();
  const codProposta = String(req.params.codProposta ?? '').trim();
  const mode = String(req.query.mode ?? 'analysis').trim();
  const requestId = (req as { id?: string }).id;
  const reqLogger = (req as { log?: typeof logger }).log ?? logger;
  const logStage = (stage: string, elapsedMs: number) => {
    reqLogger.info({ requestId, stage, elapsedMs }, 'Stage completed');
  };

  if (!codProposta || codProposta.length > MAX_COD_PROPOSTA_LENGTH) {
    return res.status(400).json(buildErrorResponse('codProposta inválido', 'Informe um código válido.'));
  }

  if (mode && mode !== 'analysis' && mode !== 'sanitized' && mode !== 'ticket' && mode !== 'dry-run') {
    return res
      .status(400)
      .json(buildErrorResponse('Modo inválido', 'Use mode=analysis, mode=sanitized, mode=ticket ou mode=dry-run.'));
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

  const cacheKey = buildCacheKey(codProposta, configResult.hash ?? 'invalid', mode);
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

  const stageTimings: Record<string, number> = {
    dbFetch: analysisData.elapsedMs,
  };
  logStage('dbFetch', analysisData.elapsedMs);
  const payload = analysisData.data;

  const stripStart = performance.now();
  const normalized = normalize(payload, configResult.config.privacy.normalizer);
  const stripElapsed = Math.round(performance.now() - stripStart);
  stageTimings.stripLimits = stripElapsed;
  stageTimings.normalize = stripElapsed;
  logStage('stripLimits', stripElapsed);
  const normalizedBytes = toBytes(normalized);

  const sanitizeStart = performance.now();
  let sanitizedResult;
  try {
    sanitizedResult = sanitizeAndEncrypt(
      normalized,
      allowListSet,
      configResult.config.privacy.crypto,
      process.env.OPENAI_CRYPTO_PASSPHRASE ?? '',
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Erro desconhecido ao proteger dados.';
    incrementError();
    return res.status(500).json(buildErrorResponse('Falha ao sanitizar dados', details));
  }
  stageTimings.sanitize = Math.round(performance.now() - sanitizeStart);
  logStage('sanitize', stageTimings.sanitize);

  const sanitizedBytes = toBytes(sanitizedResult.sanitizedJson);

  const signalsStart = performance.now();
  const signals = configResult.config.analysis.signals?.enabled
    ? extractSignals(normalized, configResult.config.analysis.signals)
    : emptySignals();
  const runbooksMatched = matchRunbooks(
    normalized,
    signals as Record<string, unknown>,
    configResult.config.runbooks.items,
  );
  stageTimings.signalsRunbooks = Math.round(performance.now() - signalsStart);
  logStage('signalsRunbooks', stageTimings.signalsRunbooks);

  if ((process.env.DEBUG_LOG_PAYLOAD ?? 'false') === 'true') {
    const preview = buildSanitizedPreview(sanitizedResult.sanitizedJson);
    reqLogger.info(
      {
        requestId,
        sanitizedPreview: redactSensitive(preview.preview),
        previewBytes: preview.previewBytes,
      },
      'Sanitized payload preview (redacted)',
    );
  }

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
        openaiUsed: false,
      },
    };

    responseBody.debug = {
      sanitizedPreview: buildSanitizedPreview(sanitizedResult.sanitizedJson).preview,
      signals,
      runbooksMatched,
    };

    if (configResult.config.cache?.enabled) {
      responseCache.set(cacheKey, {
        expiresAt: Date.now() + (configResult.config.cache.ttlSeconds ?? 600) * 1000,
        value: responseBody,
      });
    }

    return res.json(responseBody);
  }

  if (mode === 'dry-run') {
    const preview = buildSanitizedPreview(sanitizedResult.sanitizedJson);
    const responseBody: Record<string, unknown> = {
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
        openaiUsed: false,
      },
      signals,
      runbooksMatched,
      sanitizedPreview: preview.preview,
    };

    const responseBytes = toBytes(responseBody);
    if (responseBytes > MAX_DRY_RUN_RESPONSE_BYTES) {
      return res.json({
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
          openaiUsed: false,
          responseTruncated: true,
          responseBytes,
          responseMaxBytes: MAX_DRY_RUN_RESPONSE_BYTES,
        },
        signals: {
          proposal: signals.proposal,
          counts: signals.counts,
          flags: signals.flags,
        },
        runbooksMatched: runbooksMatched.map((runbook) => ({
          id: runbook.id,
          title: runbook.title,
          severitySuggestion: runbook.severitySuggestion,
        })),
        sanitizedPreview: {
          truncated: true,
          previewBytes: preview.previewBytes,
          arraysRemoved: preview.arraysRemoved,
          stringsTrimmed: preview.stringsTrimmed,
        },
      });
    }

    return res.json(responseBody);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  let openaiResult = { structured: undefined, rawText: undefined, refusal: undefined, error: undefined };
  let openaiText: string | undefined;
  let openaiUsed = false;
  let openaiError: string | undefined;
  let elapsedMsOpenai = 0;
  let payloadBytesForModel = 0;
  let payloadAdjusted = false;
  const useStructuredOutput = configResult.config.openai.outputSchema?.enabled ?? false;

  if (!apiKey) {
    openaiError = 'OPENAI_API_KEY não configurada.';
  } else {
    const maxOpenAiBytes = Number(process.env.MAX_OPENAI_INPUT_BYTES ?? 150000);
    const payloadForModel = {
      proposalNumber: codProposta,
      signals,
      runbooks: runbooksMatched,
      data: sanitizedResult.sanitizedJson,
    };
    payloadBytesForModel = toBytes(payloadForModel);
    let payloadForModelAdjusted = payloadForModel;

    if (payloadBytesForModel > maxOpenAiBytes) {
      const reduced = applyPayloadBudget(sanitizedResult.sanitizedJson, maxOpenAiBytes);
      payloadForModelAdjusted = {
        proposalNumber: codProposta,
        signals,
        runbooks: runbooksMatched,
        data: reduced.payload,
      };
      payloadBytesForModel = toBytes(payloadForModelAdjusted);
      payloadAdjusted = reduced.arraysRemoved > 0 || reduced.stringsTrimmed > 0;
    }

    if (payloadBytesForModel > maxOpenAiBytes) {
      openaiError = 'Payload grande demais para OpenAI.';
    } else {
      try {
        openaiUsed = true;
        const openaiStart = performance.now();
        if (useStructuredOutput) {
          openaiResult = await analyzeWithOpenAI(
            codProposta,
            payloadForModelAdjusted,
            configResult.config.openai,
            apiKey,
            {
              timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? 30000),
              maxRetries: 1,
              retryBackoffMs: 500,
            },
          );
        } else {
          const textResult = await analyzeWithOpenAIText(
            codProposta,
            payloadForModelAdjusted,
            configResult.config.openai,
            apiKey,
            {
              timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? 30000),
              maxRetries: 1,
              retryBackoffMs: 500,
            },
          );
          openaiText = textResult.text;
        }
        elapsedMsOpenai = Math.round(performance.now() - openaiStart);
        stageTimings.openai = elapsedMsOpenai;
        logStage('openai', elapsedMsOpenai);
      } catch (error) {
        openaiError = error instanceof Error ? error.message : 'Erro desconhecido ao chamar OpenAI.';
      }
    }
  }

  if (openaiResult.error || openaiResult.refusal || openaiError) {
    openaiError = openaiError ?? openaiResult.error ?? openaiResult.refusal;
  }

  let responseBody: Record<string, unknown>;
  if (openaiResult.structured) {
    if (mode === 'ticket') {
      responseBody = {
        ticketMarkdown: buildTicketMarkdown(openaiResult.structured, runbooksMatched),
        structured: openaiResult.structured,
        meta: {
          elapsedMsTotal: Math.round(performance.now() - startedAt),
          elapsedMsDb: analysisData.elapsedMs,
          elapsedMsOpenai,
          setsCount: analysisData.recordsets.length,
          rowsBySet: analysisData.rowsBySet,
          format: analysisData.format,
          fallbackUsed: analysisData.fallbackUsed,
          payloadBytesNormalized: normalizedBytes,
          payloadBytesSanitized: sanitizedBytes,
          stats: sanitizedResult.stats,
          openaiUsed,
          openaiError,
          payloadBytesForModel,
          payloadAdjusted,
        },
      };
    } else {
      responseBody = {
        structured: openaiResult.structured,
        meta: {
          elapsedMsTotal: Math.round(performance.now() - startedAt),
          elapsedMsDb: analysisData.elapsedMs,
          elapsedMsOpenai,
          setsCount: analysisData.recordsets.length,
          rowsBySet: analysisData.rowsBySet,
          format: analysisData.format,
          fallbackUsed: analysisData.fallbackUsed,
          payloadBytesNormalized: normalizedBytes,
          payloadBytesSanitized: sanitizedBytes,
          stats: sanitizedResult.stats,
          openaiUsed,
          openaiError,
          payloadBytesForModel,
          payloadAdjusted,
        },
      };
    }
  } else if (openaiText) {
    responseBody =
      mode === 'ticket'
        ? {
            ticketMarkdown: openaiText,
            structured: null,
            meta: {
              elapsedMsTotal: Math.round(performance.now() - startedAt),
              elapsedMsDb: analysisData.elapsedMs,
              elapsedMsOpenai,
              setsCount: analysisData.recordsets.length,
              rowsBySet: analysisData.rowsBySet,
              format: analysisData.format,
              fallbackUsed: analysisData.fallbackUsed,
              payloadBytesNormalized: normalizedBytes,
              payloadBytesSanitized: sanitizedBytes,
              stats: sanitizedResult.stats,
              openaiUsed,
              openaiError,
              payloadBytesForModel,
              payloadAdjusted,
            },
          }
        : {
            analysisText: openaiText,
            meta: {
              elapsedMsTotal: Math.round(performance.now() - startedAt),
              elapsedMsDb: analysisData.elapsedMs,
              elapsedMsOpenai,
              setsCount: analysisData.recordsets.length,
              rowsBySet: analysisData.rowsBySet,
              format: analysisData.format,
              fallbackUsed: analysisData.fallbackUsed,
              payloadBytesNormalized: normalizedBytes,
              payloadBytesSanitized: sanitizedBytes,
              stats: sanitizedResult.stats,
              openaiUsed,
              openaiError,
              payloadBytesForModel,
              payloadAdjusted,
            },
          };
  } else {
    const fallbackText = buildFallbackAnalysisText(signals, runbooksMatched);
    responseBody =
      mode === 'ticket'
        ? {
            ticketMarkdown: fallbackText,
            structured: null,
            meta: {
              elapsedMsTotal: Math.round(performance.now() - startedAt),
              elapsedMsDb: analysisData.elapsedMs,
              elapsedMsOpenai,
              setsCount: analysisData.recordsets.length,
              rowsBySet: analysisData.rowsBySet,
              format: analysisData.format,
              fallbackUsed: analysisData.fallbackUsed,
              payloadBytesNormalized: normalizedBytes,
              payloadBytesSanitized: sanitizedBytes,
              stats: sanitizedResult.stats,
              openaiUsed: false,
              openaiError,
              payloadBytesForModel,
              payloadAdjusted,
            },
          }
        : {
            analysisText: fallbackText,
            meta: {
              elapsedMsTotal: Math.round(performance.now() - startedAt),
              elapsedMsDb: analysisData.elapsedMs,
              elapsedMsOpenai,
              setsCount: analysisData.recordsets.length,
              rowsBySet: analysisData.rowsBySet,
              format: analysisData.format,
              fallbackUsed: analysisData.fallbackUsed,
              payloadBytesNormalized: normalizedBytes,
              payloadBytesSanitized: sanitizedBytes,
              stats: sanitizedResult.stats,
              openaiUsed: false,
              openaiError,
              payloadBytesForModel,
              payloadAdjusted,
            },
          };
  }

  responseBody.debug = {
    sanitizedPreview: buildSanitizedPreview(sanitizedResult.sanitizedJson).preview,
    signals,
    runbooksMatched,
  };

  if (configResult.config.cache?.enabled) {
    responseCache.set(cacheKey, {
      expiresAt: Date.now() + (configResult.config.cache.ttlSeconds ?? 600) * 1000,
      value: responseBody,
    });
  }

  if (openaiError) {
    incrementError();
  }

  reqLogger.info(
    {
      requestId,
      stageTimings,
      elapsedMsTotal: Math.round(performance.now() - startedAt),
    },
    'Pipeline analysis completed',
  );

  return res.json(responseBody);
});
