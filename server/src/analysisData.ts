import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { getPool, sql } from './db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, '../sql/analysis.sql');
const analysisSql = readFileSync(sqlPath, 'utf-8');

export type AnalysisDataResult = {
  data: Record<string, unknown>;
  recordsets: Array<Array<Record<string, unknown>>>;
  rowsBySet: number[];
  elapsedMs: number;
};

export const fetchRawAnalysisFromDb = async (codProposta: string): Promise<AnalysisDataResult> => {
  const startedAt = performance.now();
  const pool = await getPool();
  const request = pool.request();
  request.input('codProposta', sql.VarChar(50), codProposta);

  const result = await request.query(analysisSql);
  const recordsets = (result.recordsets ?? []) as Array<Array<Record<string, unknown>>>;
  const rowsBySet = recordsets.map((set) => set.length);

  const data = recordsets.reduce<Record<string, unknown>>((acc, set, index) => {
    acc[`set${index}`] = set;
    return acc;
  }, {});

  const elapsedMs = Math.round(performance.now() - startedAt);

  return {
    data,
    recordsets,
    rowsBySet,
    elapsedMs,
  };
};
