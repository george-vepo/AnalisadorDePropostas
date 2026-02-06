import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { getPool, sql } from './db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sensibilizacaoSqlPath = path.resolve(__dirname, '../sql/analysis_sensibilizacao.sql');
const pagamentoSqlPath = path.resolve(__dirname, '../sql/analysis_pagamento.sql');
const analysisSensibilizacaoSql = readFileSync(sensibilizacaoSqlPath, 'utf-8');
const analysisPagamentoSql = readFileSync(pagamentoSqlPath, 'utf-8');

export type AnalysisType = 'sensibilizacao' | 'pagamento';

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

const resolveSqlByType = (analysisType: AnalysisType) => {
  if (analysisType === 'sensibilizacao') return analysisSensibilizacaoSql;
  return analysisPagamentoSql;
};

export const fetchAnalysesFromDb = async (
  codPropostas: string[],
  analysisType: AnalysisType,
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
