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

export class SqlTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlTimeoutError';
  }
}

const isTimeoutError = (error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const code = (error as { code?: string })?.code ?? '';
  return code === 'ETIMEOUT' || message.includes('timeout');
};

const isTransientError = (error: unknown) => {
  const code = (error as { code?: string })?.code ?? '';
  return ['ECONNRESET', 'ENETRESET', 'EPIPE', 'ESOCKET', 'ETIMEDOUT'].includes(code);
};

const executeQueryWithRetry = async (
  sqlText: string,
  codProposta: string,
  pool: Awaited<ReturnType<typeof getPool>>,
) => {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const request = pool.request();
      request.input('codProposta', sql.VarChar(50), codProposta);
      const result = await request.query(sqlText);
      return (result.recordsets ?? []) as Array<Array<Record<string, unknown>>>;
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new SqlTimeoutError('Timeout no SQL');
      }
      if (attempt < maxAttempts && isTransientError(error)) {
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        continue;
      }
      throw error;
    }
  }
  return [];
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
  return executeQueryWithRetry(analysisSql, codProposta, pool);
};

export const fetchAnalysisFromDb = async (codProposta: string): Promise<AnalysisDataResult> => {
  const startedAt = performance.now();
  const pool = await getPool();

  try {
    const recordsets = await executeQueryWithRetry(analysisJsonSql, codProposta, pool);
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
    if (error instanceof SqlTimeoutError) {
      throw error;
    }
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
