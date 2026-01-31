import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { getPool, sql } from './db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, '../sql/analysis.sql');
const jsonSqlPath = path.resolve(__dirname, '../sql/analysis_json.sql');
const analysisSql = readFileSync(sqlPath, 'utf-8');
const analysisJsonSql = readFileSync(jsonSqlPath, 'utf-8');

export type AnalysisDataResult = {
  data: Record<string, unknown>;
  recordsets: Array<Array<Record<string, unknown>>>;
  rowsBySet: number[];
  elapsedMs: number;
  format: 'json' | 'recordsets';
  fallbackUsed: boolean;
};

const toRecordsetData = (recordsets: Array<Array<Record<string, unknown>>>) =>
  recordsets.reduce<Record<string, unknown>>((acc, set, index) => {
    acc[`set${index}`] = set;
    return acc;
  }, {});

const extractJsonData = (recordsets: Array<Array<Record<string, unknown>>>) => {
  const firstSet = recordsets[0] ?? [];
  const row = firstSet[0];
  if (!row) {
    throw new Error('Resultado JSON vazio.');
  }

  const jsonValue = (row as Record<string, unknown>).data ?? Object.values(row)[0];
  if (!jsonValue) {
    throw new Error('Coluna JSON não encontrada.');
  }

  if (typeof jsonValue === 'string') {
    return JSON.parse(jsonValue) as Record<string, unknown>;
  }

  if (typeof jsonValue === 'object') {
    return jsonValue as Record<string, unknown>;
  }

  throw new Error('Formato de JSON inválido.');
};

const executeRecordsetsQuery = async (codProposta: string, pool: Awaited<ReturnType<typeof getPool>>) => {
  const request = pool.request();
  request.input('codProposta', sql.VarChar(50), codProposta);
  const result = await request.query(analysisSql);
  const recordsets = (result.recordsets ?? []) as Array<Array<Record<string, unknown>>>;
  return recordsets;
};

export const fetchAnalysisFromDb = async (codProposta: string): Promise<AnalysisDataResult> => {
  const startedAt = performance.now();
  const pool = await getPool();

  try {
    const request = pool.request();
    request.input('codProposta', sql.VarChar(50), codProposta);
    const result = await request.query(analysisJsonSql);
    const recordsets = (result.recordsets ?? []) as Array<Array<Record<string, unknown>>>;
    const data = extractJsonData(recordsets);
    const elapsedMs = Math.round(performance.now() - startedAt);

    return {
      data,
      recordsets,
      rowsBySet: recordsets.map((set) => set.length),
      elapsedMs,
      format: 'json',
      fallbackUsed: false,
    };
  } catch (error) {
    const recordsets = await executeRecordsetsQuery(codProposta, pool);
    const elapsedMs = Math.round(performance.now() - startedAt);

    return {
      data: toRecordsetData(recordsets),
      recordsets,
      rowsBySet: recordsets.map((set) => set.length),
      elapsedMs,
      format: 'recordsets',
      fallbackUsed: true,
    };
  }
};
