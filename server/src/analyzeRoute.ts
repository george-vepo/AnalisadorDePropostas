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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, '../sql/analysis.sql');
const analysisSql = readFileSync(sqlPath, 'utf-8');
const pipeline = loadPipelineConfig();

export const analyzeRouter = Router();

const proposalRegex = /^[\w-]{1,64}$/;

analyzeRouter.get('/analyze/:proposalNumber', async (req, res) => {
  const startedAt = performance.now();
  const proposalNumber = String(req.params.proposalNumber ?? '').trim();

  if (!proposalNumber || !proposalRegex.test(proposalNumber)) {
    return res.status(400).json({ error: 'Número da proposta inválido.' });
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

    const passphrase = process.env.OPENAI_CRYPTO_PASSPHRASE ?? '';
    const sanitizedJson = sanitizeData(
      normalized,
      pipeline.privacy.allowList,
      pipeline.privacy.crypto,
      passphrase,
    );

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY não configurada.');
    }

    const analysisText = await analyzeWithOpenAI(proposalNumber, sanitizedJson, pipeline.openai, apiKey);

    const elapsedMs = Math.round(performance.now() - startedAt);
    const rowsBySet = recordsets.map((set) => set.length);
    const responseBody: Record<string, unknown> = {
      analysisText,
      meta: {
        elapsedMs,
        setsCount: recordsets.length,
        rowsBySet,
      },
    };

    if (req.query.debug === 'true') {
      responseBody.debug = { sanitizedJson };
    }

    return res.json(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao processar análise.';
    return res.status(500).json({ error: message });
  }
});
