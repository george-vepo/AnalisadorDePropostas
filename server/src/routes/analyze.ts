import { Router } from 'express';
import { performance } from 'node:perf_hooks';
import { fetchAnalysisFromDb } from '../analysisData';
import { normalize } from '../normalizer';
import { loadPipelineConfig } from '../pipeline';
import { analyzeWithOpenAI } from '../openaiClient';
import { sanitizeAndEncrypt } from '../sanitizer';
import { extractSignals } from '../signals/extractSignals';
import { matchRunbooks } from '../runbooks/matchRunbooks';
import { buildCacheKey } from '../cache';

const MAX_COD_PROPOSTA_LENGTH = 50;

export const analyzeRouter = Router();
const pipeline = loadPipelineConfig();

const responseCache = new Map<string, { expiresAt: number; value: unknown }>();
const rateLimitState = new Map<string, { count: number; resetAt: number }>();

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

const getClientIp = (req: { headers?: Record<string, string | string[] | undefined>; ip?: string }) => {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim();
  if (Array.isArray(forwarded)) return forwarded[0];
  return req.ip ?? 'unknown';
};

const checkRateLimit = (ip: string) => {
  if (!pipeline.config.rateLimit?.enabled) return { allowed: true };

  const windowMs = (pipeline.config.rateLimit.windowSeconds ?? 300) * 1000;
  const maxRequests = pipeline.config.rateLimit.maxRequests ?? 30;
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

const buildFallbackAnalysisText = (
  signals: ReturnType<typeof extractSignals>,
  runbooksMatched: ReturnType<typeof matchRunbooks>,
) => {
  const lines: string[] = [];
  lines.push(`Resumo rápido da proposta ${signals.proposal.codProposta ?? ''}`.trim());
  lines.push('');
  lines.push('Sinais principais:');
  lines.push(`- Situação: ${signals.proposal.statusSituacao ?? 'N/D'}`);
  lines.push(`- Assinatura: ${signals.proposal.statusAssinatura ?? 'N/D'}`);
  lines.push(`- Pago: ${signals.proposal.statusPago ?? 'N/D'}`);
  lines.push(`- Integrações: ${signals.counts.integracoesTotal}`);
  lines.push(`- Erros: ${signals.counts.errosTotal}`);
  if (signals.flags.length > 0) {
    lines.push(`- Flags: ${signals.flags.join(', ')}`);
  }
  if (signals.topErrors.length > 0) {
    lines.push('');
    lines.push('Erros frequentes:');
    signals.topErrors.forEach((error) => {
      lines.push(`- ${error.codigo ?? 'SEM_CODIGO'}: ${error.mensagemCurta ?? 'Sem mensagem'}`);
    });
  }
  if (runbooksMatched.length > 0) {
    lines.push('');
    lines.push('Runbooks sugeridos:');
    runbooksMatched.forEach((runbook) => {
      lines.push(`- ${runbook.title} (${runbook.severitySuggestion})`);
    });
  }
  lines.push('');
  lines.push('Dados insuficientes? Validar status em sistemas de origem e confirmar integrações recentes.');
  return lines.join('\n');
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

analyzeRouter.get('/analyze/:codProposta', async (req, res) => {
  const startedAt = performance.now();
  const codProposta = String(req.params.codProposta ?? '').trim();
  const mode = String(req.query.mode ?? 'analysis').trim();

  if (!codProposta || codProposta.length > MAX_COD_PROPOSTA_LENGTH) {
    return res.status(400).json(buildErrorResponse('codProposta inválido', 'Informe um código válido.'));
  }

  if (mode && mode !== 'analysis' && mode !== 'sanitized' && mode !== 'ticket') {
    return res.status(400).json(buildErrorResponse('Modo inválido', 'Use mode=analysis, mode=sanitized ou mode=ticket.'));
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

  const cacheKey = buildCacheKey(codProposta, pipeline.hash, mode);
  if (pipeline.config.cache?.enabled) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.value);
    }
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

  const signals = pipeline.config.analysis.signals?.enabled
    ? extractSignals(normalized, pipeline.config.analysis.signals)
    : emptySignals();
  const runbooksMatched = matchRunbooks(normalized, signals as Record<string, unknown>, pipeline.config.runbooks.items);

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

    if (pipeline.config.cache?.enabled) {
      responseCache.set(cacheKey, {
        expiresAt: Date.now() + (pipeline.config.cache.ttlSeconds ?? 600) * 1000,
        value: responseBody,
      });
    }

    return res.json(responseBody);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json(buildErrorResponse('OPENAI_API_KEY não configurada.'));
  }

  const payloadForModel = {
    proposalNumber: codProposta,
    signals,
    runbooks: runbooksMatched,
    data: sanitizedResult.sanitizedJson,
  };

  const openaiStart = performance.now();
  const openaiResult = await analyzeWithOpenAI(codProposta, payloadForModel, pipeline.config.openai, apiKey);
  const elapsedMsOpenai = Math.round(performance.now() - openaiStart);

  const schemaFailure = openaiResult.error === 'Resposta da OpenAI fora do schema esperado.';
  if (openaiResult.error && !schemaFailure) {
    return res
      .status(502)
      .json(buildErrorResponse('Falha ao chamar OpenAI', openaiResult.error));
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
        },
      };
    }
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
            },
          };
  }

  if (shouldReturnDebug(req)) {
    responseBody.debug = { sanitizedJson: sanitizedResult.sanitizedJson };
  }

  if (pipeline.config.cache?.enabled) {
    responseCache.set(cacheKey, {
      expiresAt: Date.now() + (pipeline.config.cache.ttlSeconds ?? 600) * 1000,
      value: responseBody,
    });
  }

  return res.json(responseBody);
});
