import { Router } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { getPool, sql } from './db';
import { loadPipelineConfig } from './pipeline';
import { normalizeData } from './sanitizer/normalize';
import { sanitizeData } from './sanitizer';
import { analyzeWithOpenAI } from './openaiClient';
import { extractSignals } from './signals/extractSignals';
import { matchRunbooks } from './runbooks/matchRunbooks';
import type { StructuredAnalysis } from './openaiSchema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, '../sql/analysis.sql');
const analysisSql = readFileSync(sqlPath, 'utf-8');
const pipeline = loadPipelineConfig();

const CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 30;

const cache = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>();
const rateLimits = new Map<string, { count: number; resetAt: number }>();

export const analyzeRouter = Router();

const proposalRegex = /^[\w-]{1,64}$/;

const buildCacheKey = (proposalNumber: string, mode: string, pipelineHash: string) => {
  return `${proposalNumber}:${mode}:${pipelineHash}`;
};

const getClientIp = (req: { ip?: string; socket?: { remoteAddress?: string | null } }) => {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
};

const applyRateLimit = (ip: string) => {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count, resetAt: entry.resetAt };
};

const buildFallbackText = (
  proposalNumber: string,
  reason: string,
  signals: Record<string, unknown>,
  runbooks: Array<{ title: string }>,
) => {
  const runbookList = runbooks.map((runbook) => `- ${runbook.title}`).join('\n');
  return [
    `Análise automática indisponível para a proposta ${proposalNumber}.`,
    `Motivo: ${reason}.`,
    '',
    'Resumo dos sinais disponíveis:',
    JSON.stringify(signals, null, 2),
    '',
    runbookList ? `Runbooks sugeridos:\n${runbookList}` : 'Nenhum runbook aplicável encontrado.',
  ].join('\n');
};

const buildTicketMarkdown = (analysis: StructuredAnalysis, suggestedRunbooks: string[]) => {
  const list = (items: string[]) => items.map((item) => `- ${item}`).join('\n') || '- (vazio)';
  const runbooksList = suggestedRunbooks.length ? list(suggestedRunbooks) : '- (nenhum)';

  return [
    `# ${analysis.title}`,
    `**Severidade:** ${analysis.severity}`,
    `**Confiança:** ${analysis.confidence}%`,
    '',
    '## Resumo',
    analysis.summary,
    '',
    '## Causa provável',
    analysis.probable_cause,
    '',
    '## Evidências',
    list(analysis.evidence),
    '',
    '## Próximos passos',
    list(analysis.next_steps),
    '',
    '## Perguntas',
    list(analysis.questions),
    '',
    '## Runbooks sugeridos',
    runbooksList,
  ].join('\n');
};

analyzeRouter.get('/analyze/:proposalNumber', async (req, res) => {
  const startedAt = performance.now();
  const proposalNumber = String(req.params.proposalNumber ?? '').trim();
  const mode = String(req.query.mode ?? 'analysis').trim();

  if (!proposalNumber || !proposalRegex.test(proposalNumber)) {
    return res.status(400).json({ error: 'Número da proposta inválido.' });
  }

  if (!['analysis', 'sanitized', 'ticket'].includes(mode)) {
    return res.status(400).json({ error: 'Modo inválido. Use analysis, sanitized ou ticket.' });
  }

  const ip = getClientIp(req);
  const rate = applyRateLimit(ip);
  if (!rate.allowed) {
    return res.status(429).json({
      error: 'Limite de requisições excedido. Tente novamente em alguns minutos.',
      meta: { resetAt: rate.resetAt },
    });
  }

  const cacheKey = buildCacheKey(proposalNumber, mode, pipeline.hash);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json(cached.payload);
  }

  if (mode === 'ticket') {
    const analysisCacheKey = buildCacheKey(proposalNumber, 'analysis', pipeline.hash);
    const analysisCached = cache.get(analysisCacheKey);
    if (analysisCached && analysisCached.expiresAt > Date.now()) {
      const cachedPayload = analysisCached.payload;
      const cachedAnalysis = cachedPayload.analysis as StructuredAnalysis | null;
      const cachedRunbooks = (cachedPayload.runbooks as Array<{ title: string }>) ?? [];
      const cachedSignals = cachedPayload.signals as Record<string, unknown>;
      const suggestedRunbooks = cachedAnalysis?.suggested_runbooks ?? cachedRunbooks.map((item) => item.title);
      const ticketMarkdown = cachedAnalysis
        ? buildTicketMarkdown(cachedAnalysis, suggestedRunbooks)
        : buildFallbackText(proposalNumber, 'Resultado em cache sem análise estruturada', cachedSignals, cachedRunbooks);
      const responseBody = { ...cachedPayload, ticketMarkdown };
      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload: responseBody });
      return res.json(responseBody);
    }
  }

  try {
    const pool = await getPool();
    const request = pool.request();
    request.input('codProposta', sql.VarChar, proposalNumber);

    const result = await request.query(analysisSql);
    const recordsets = result.recordsets ?? [];

    const data = recordsets.reduce<Record<string, unknown>>((acc, set, index) => {
      acc[`set${index}`] = set;
      return acc;
    }, {});

    const normalized = normalizeData(data);

    const signals = pipeline.config.analysis.signals.enabled
      ? extractSignals(normalized, pipeline.config.analysis.signals)
      : { statusSummary: {}, flags: [], counts: { errors: 0, integrations: 0 }, timestamps: {}, topErrors: [], integrations: [], includePaths: {} };

    const matchedRunbooks = matchRunbooks(normalized, signals as Record<string, unknown>, pipeline.config.runbooks.items);

    const passphrase = process.env.OPENAI_CRYPTO_PASSPHRASE ?? '';
    const sanitizedJson = sanitizeData(
      normalized,
      pipeline.config.privacy.allowList,
      pipeline.config.privacy.crypto,
      passphrase,
    );

    const elapsedMs = Math.round(performance.now() - startedAt);
    const rowsBySet = recordsets.map((set) => set.length);

    if (mode === 'sanitized') {
      const responseBody: Record<string, unknown> = {
        sanitizedJson,
        signals,
        runbooks: matchedRunbooks,
        meta: {
          elapsedMs,
          setsCount: recordsets.length,
          rowsBySet,
        },
      };

      if (req.query.debug === 'true') {
        responseBody.debug = { sanitizedJson, signals, runbooks: matchedRunbooks };
      }

      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload: responseBody });
      return res.json(responseBody);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY não configurada.');
    }

    const payloadForModel = {
      proposalNumber,
      signals,
      runbooks: matchedRunbooks,
      data: sanitizedJson,
    };

    const analysisResult = await analyzeWithOpenAI(proposalNumber, payloadForModel, pipeline.config.openai, apiKey);

    let structuredAnalysis = analysisResult.structured;
    let fallbackText: string | undefined;

    if (!structuredAnalysis) {
      const reason = analysisResult.refusal || analysisResult.error || 'Resposta inválida do modelo';
      fallbackText = buildFallbackText(proposalNumber, reason, signals as Record<string, unknown>, matchedRunbooks);
    }

    const suggestedRunbooks = structuredAnalysis?.suggested_runbooks ?? matchedRunbooks.map((item) => item.title);
    const ticketMarkdown = structuredAnalysis ? buildTicketMarkdown(structuredAnalysis, suggestedRunbooks) : fallbackText;

    const responseBody: Record<string, unknown> = {
      analysis: structuredAnalysis ?? null,
      analysisText: fallbackText,
      runbooks: matchedRunbooks,
      signals,
      ticketMarkdown: mode === 'ticket' ? ticketMarkdown : undefined,
      meta: {
        elapsedMs,
        setsCount: recordsets.length,
        rowsBySet,
      },
    };

    if (req.query.debug === 'true') {
      responseBody.debug = { sanitizedJson, payloadForModel };
    }

    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload: responseBody });
    return res.json(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao processar análise.';
    return res.status(500).json({ error: message });
  }
});
