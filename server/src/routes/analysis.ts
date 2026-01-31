import { Router } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { getPool, sql } from '../db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, '../../sql/analysis.sql');
const analysisSql = readFileSync(sqlPath, 'utf-8');

const MAX_COD_PROPOSTA_LENGTH = 50;

export const analysisRouter = Router();

const buildErrorResponse = (message: string, details?: string) => ({
  error: {
    message,
    details,
  },
});

analysisRouter.get('/analysis/:codProposta', async (req, res) => {
  const startedAt = performance.now();
  const codProposta = String(req.params.codProposta ?? '').trim();

  if (!codProposta || codProposta.length > MAX_COD_PROPOSTA_LENGTH) {
    return res.status(400).json(buildErrorResponse('codProposta inválido', 'Informe um código válido.'));
  }

  let pool;
  try {
    pool = await getPool();
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Erro desconhecido ao conectar no banco.';
    return res.status(500).json(buildErrorResponse('Falha ao conectar no banco', details));
  }

  try {
    const request = pool.request();
    request.input('codProposta', sql.VarChar(50), codProposta);

    const result = await request.query(analysisSql);
    const recordsets = result.recordsets ?? [];
    const rowsBySet = recordsets.map((set) => set.length);

    const data = recordsets.reduce<Record<string, unknown>>((acc, set, index) => {
      acc[`set${index}`] = set;
      return acc;
    }, {});

    const elapsedMs = Math.round(performance.now() - startedAt);

    return res.json({
      codProposta,
      meta: {
        setsCount: recordsets.length,
        rowsBySet,
        elapsedMs,
      },
      data,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Erro desconhecido ao executar análise.';
    return res.status(500).json(buildErrorResponse('Erro ao executar análise', details));
  }
});
