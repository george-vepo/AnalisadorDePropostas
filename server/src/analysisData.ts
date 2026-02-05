import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { getPool, sql } from './db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.resolve(__dirname, '../sql/analysis.sql');
const jsonSqlPath = path.resolve(__dirname, '../sql/analysis_json.sql');
const sensibilizacaoSqlPath = path.resolve(__dirname, '../sql/analysis_sensibilizacao.sql');
const pagamentoSqlPath = path.resolve(__dirname, '../sql/analysis_pagamento.sql');
const analysisSql = readFileSync(sqlPath, 'utf-8');
const analysisJsonSql = readFileSync(jsonSqlPath, 'utf-8');
const analysisSensibilizacaoSql = readFileSync(sensibilizacaoSqlPath, 'utf-8');
const analysisPagamentoSql = readFileSync(pagamentoSqlPath, 'utf-8');

export type AnalysisType = 'padrao' | 'sensibilizacao' | 'pagamento';

export type AnalysisDataResult = {
  data: Record<string, unknown>;
  recordsets: Array<Array<Record<string, unknown>>>;
  rowsBySet: number[];
  elapsedMs: number;
  format: 'json' | 'recordsets';
  fallbackUsed: boolean;
};

export type MultiAnalysisDataItem = {
  codigoProposta: string;
  resultadoJson: Record<string, unknown>;
};

export type MultiAnalysisDataResult = {
  items: MultiAnalysisDataItem[];
  elapsedMs: number;
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

const executeMultiQueryWithRetry = async (
  sqlText: string,
  codPropostasCsv: string,
  pool: Awaited<ReturnType<typeof getPool>>,
) => {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const request = pool.request();
      request.input('codPropostas', sql.VarChar(sql.MAX), codPropostasCsv);
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

const extractMultiJsonData = (recordsets: Array<Array<Record<string, unknown>>>) => {
  const firstSet = recordsets[0] ?? [];
  return firstSet.map((row) => {
    const codigoProposta = String(
      (row as Record<string, unknown>).COD_PROPOSTA ??
        (row as Record<string, unknown>).cod_proposta ??
        (row as Record<string, unknown>).codigoProposta ??
        '',
    ).trim();
    if (!codigoProposta) {
      throw new Error('COD_PROPOSTA ausente no resultado.');
    }

    const jsonValue =
      (row as Record<string, unknown>).ResultadoJson ??
      (row as Record<string, unknown>).resultadoJson ??
      (row as Record<string, unknown>).data ??
      Object.values(row)[0];

    if (!jsonValue) {
      throw new Error(`Coluna JSON não encontrada para proposta ${codigoProposta}.`);
    }

    if (typeof jsonValue === 'string') {
      return { codigoProposta, resultadoJson: JSON.parse(jsonValue) as Record<string, unknown> };
    }

    if (typeof jsonValue === 'object') {
      return { codigoProposta, resultadoJson: jsonValue as Record<string, unknown> };
    }

    throw new Error(`Formato de JSON inválido para proposta ${codigoProposta}.`);
  });
};

const resolveSqlByType = (analysisType: AnalysisType | undefined) => {
  if (analysisType === 'sensibilizacao') return analysisSensibilizacaoSql;
  if (analysisType === 'pagamento') return analysisPagamentoSql;
  return analysisJsonSql;
};

const executeRecordsetsQuery = async (codProposta: string, pool: Awaited<ReturnType<typeof getPool>>) => {
  return executeQueryWithRetry(analysisSql, codProposta, pool);
};

export const fetchAnalysisFromDb = async (
  codProposta: string,
  analysisType: AnalysisType = 'padrao',
): Promise<AnalysisDataResult> => {
  const startedAt = performance.now();
  const pool = await getPool();
  const sqlText = resolveSqlByType(analysisType);

  try {
    const recordsets = await executeQueryWithRetry(sqlText, codProposta, pool);
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

export const fetchAnalysesFromDb = async (
  codPropostas: string[],
  analysisType: AnalysisType = 'padrao',
): Promise<MultiAnalysisDataResult> => {
  const startedAt = performance.now();
  const pool = await getPool();
  const codPropostasCsv = codPropostas.join(',');

  const sqlText = resolveSqlByType(analysisType);
  const recordsets = await executeMultiQueryWithRetry(sqlText, codPropostasCsv, pool);
  const items = extractMultiJsonData(recordsets);
  const elapsedMs = Math.round(performance.now() - startedAt);

  return {
    items,
    elapsedMs,
  };
};
