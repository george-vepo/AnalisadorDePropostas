import { Router } from 'express';
import { performance } from 'node:perf_hooks';
import { getPool } from '../db';
import { validateConfig, getConfig } from '../config/loadConfig';
import { getMetrics } from '../metrics';
import { pingOpenAI } from '../openaiClient';

export const systemRouter = Router();

systemRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    version: process.env.npm_package_version ?? 'unknown',
    time: new Date().toISOString(),
  });
});

systemRouter.get('/metrics', (_req, res) => {
  res.json({
    ok: true,
    metrics: getMetrics(),
  });
});

systemRouter.get('/config/validate', (_req, res) => {
  const result = validateConfig();
  if (!result.config) {
    return res.json({
      ok: false,
      errors: result.errors ?? [{ path: 'root', message: 'Config inválido.' }],
    });
  }

  return res.json({ ok: true });
});

systemRouter.get('/diag/db', async (_req, res) => {
  const startedAt = performance.now();
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 as ok');
    const elapsedMs = Math.round(performance.now() - startedAt);
    res.json({
      ok: true,
      elapsedMs,
      server: process.env.DB_SERVER ?? 'unknown',
      database: process.env.DB_DATABASE ?? 'unknown',
    });
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const message = error instanceof Error ? error.message : 'Erro desconhecido ao conectar no SQL Server.';
    res.status(500).json({
      ok: false,
      elapsedMs,
      error: message,
    });
  }
});

systemRouter.get('/diag/openai', async (_req, res) => {
  if ((process.env.DEV_ALLOW_DIAG_OPENAI ?? 'false') !== 'true') {
    return res.status(403).json({ ok: false, error: 'Diagnóstico OpenAI desabilitado.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'OPENAI_API_KEY não configurada.' });
  }

  const configResult = getConfig();
  const model = configResult.config?.openai.model ?? process.env.OPENAI_MODEL ?? 'gpt-5.2-mini';
  const projectId =
    configResult.config?.openai.projectId?.trim() || process.env.OPENAI_PROJECT_ID?.trim() || undefined;
  const startedAt = performance.now();

  try {
    await pingOpenAI(model, apiKey, projectId);
    const elapsedMs = Math.round(performance.now() - startedAt);
    return res.json({ ok: true, elapsedMs, model });
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const message = error instanceof Error ? error.message : 'Erro desconhecido ao chamar OpenAI.';
    return res.status(502).json({ ok: false, elapsedMs, model, error: message });
  }
});
