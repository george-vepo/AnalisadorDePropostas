import type { SignalRule } from '../pipeline';
import { evaluateWhen, getValuesByPath } from '../runbooks/conditions';

export type SignalsConfig = {
  enabled: boolean;
  maxItemsPerArray: number;
  includePaths: string[];
  rules: SignalRule[];
};

export type ExtractedSignals = {
  proposal: {
    codProposta?: string;
    statusSituacao?: string;
    statusAssinatura?: string;
    statusPago?: string;
    datas: {
      cadastro?: string;
      assinatura?: string;
      alteracao?: string;
      sensibilizacao?: string;
    };
  };
  counts: {
    integracoesTotal: number;
    errosTotal: number;
    logsTotal: number;
  };
  recent: {
    lastUpdate?: string;
    lastError?: string;
  };
  flags: string[];
  topErrors: Array<{ codigo?: string; mensagemCurta?: string }>;
  integrationsSummary: Array<{ nome?: string; status?: string; erroCodigo?: string }>;
  safeFields: Record<string, Array<string | number | boolean>>;
};

const MAX_STRING_LENGTH = 160;

const EMAIL_REGEX = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g;
const CPF_REGEX = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{11}\b/;
const PHONE_REGEX = /\b\d{10,13}\b/;
const LONG_DIGITS_REGEX = /\d{6,}/;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const sanitizeText = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (EMAIL_REGEX.test(trimmed) || CPF_REGEX.test(trimmed) || PHONE_REGEX.test(trimmed)) {
    return '[REMOVIDO]';
  }
  if (LONG_DIGITS_REGEX.test(trimmed)) {
    return '[REMOVIDO]';
  }
  const cleaned = trimmed.replace(EMAIL_REGEX, '[REMOVIDO]');
  const normalized = cleaned.replace(/\s+/g, ' ');
  return normalized.length > MAX_STRING_LENGTH
    ? `${normalized.slice(0, MAX_STRING_LENGTH)}...`
    : normalized;
};

const sanitizeIdentifier = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_STRING_LENGTH ? trimmed.slice(0, MAX_STRING_LENGTH) : trimmed;
};

const sanitizePrimitive = (value: unknown): string | number | boolean | null => {
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
};

const parseDate = (value: unknown): Date | null => {
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
};

const firstValue = (data: unknown, paths: string[]): unknown => {
  for (const path of paths) {
    const values = getValuesByPath(data, path);
    for (const value of values) {
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
};

const firstString = (data: unknown, paths: string[], allowIdentifiers = false): string | undefined => {
  const value = firstValue(data, paths);
  if (typeof value === 'string') {
    return allowIdentifiers ? sanitizeIdentifier(value) ?? undefined : sanitizeText(value) ?? undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
};

const latestDateFromPaths = (data: unknown, paths: string[]): string | undefined => {
  const dates: Date[] = [];
  paths.forEach((path) => {
    const values = getValuesByPath(data, path);
    values.forEach((value) => {
      const date = parseDate(value);
      if (date) dates.push(date);
    });
  });
  if (dates.length === 0) return undefined;
  dates.sort((a, b) => b.getTime() - a.getTime());
  return dates[0]?.toISOString();
};

const getArrayItems = (data: unknown, paths: string[]): unknown[] => {
  for (const path of paths) {
    const values = getValuesByPath(data, path);
    if (values.length > 0) return values;
  }
  return [];
};

export const extractSignals = (rawData: unknown, config: SignalsConfig): ExtractedSignals => {
  const maxItems = Math.max(1, config.maxItemsPerArray ?? 50);

  const integracoes = getArrayItems(rawData, ['integracoes[]', 'set2[]']);
  const logs = getArrayItems(rawData, ['logs[]', 'set3[]']);
  const erros = getArrayItems(rawData, ['erros[]', 'set1[]']);

  const proposal = {
    codProposta: firstString(rawData, ['proposta.COD_PROPOSTA', 'set0[].COD_PROPOSTA', 'cod_proposta'], true),
    statusSituacao: firstString(rawData, ['proposta.STA_SITUACAO', 'set0[].STA_SITUACAO']),
    statusAssinatura: firstString(rawData, [
      'proposta.STA_ASSINATURA',
      'assinaturaDigital[].STA_ASSINATURA',
      'set0[].STA_ASSINATURA',
    ]),
    statusPago: firstString(rawData, ['proposta.STA_PAGO', 'pagamento.STA_PAGAMENTO', 'set0[].STA_PAGO']),
    datas: {
      cadastro: latestDateFromPaths(rawData, ['proposta.DTH_CADASTRO', 'set0[].DTA_CADASTRO']),
      assinatura: latestDateFromPaths(rawData, ['assinaturaDigital[].DTH_EVENTO', 'set0[].DTA_ASSINATURA']),
      alteracao: latestDateFromPaths(rawData, ['proposta.DTH_ALTERACAO', 'set0[].DTA_ALTERACAO']),
      sensibilizacao: latestDateFromPaths(rawData, ['proposta.DTA_SENSIBILIZACAO', 'set0[].DTA_SENSIBILIZACAO']),
    },
  };

  const counts = {
    integracoesTotal: integracoes.length,
    errosTotal: erros.length,
    logsTotal: logs.length,
  };

  const recent = {
    lastUpdate: latestDateFromPaths(rawData, [
      'proposta.DTH_ALTERACAO',
      'integracoes[].DTH_EVENTO',
      'logs[].DTH_ACESSO',
      'set0[].DTA_ALTERACAO',
      'set2[].DTH_EVENTO',
      'set3[].DTH_ACESSO',
    ]),
    lastError: latestDateFromPaths(rawData, ['erros[].DTH_ERRO', 'logs[].DTH_ACESSO', 'set1[].DTH_ERRO']),
  };

  const errorMap = new Map<string, { codigo?: string; mensagemCurta?: string }>();
  erros.forEach((entry) => {
    if (!isPlainObject(entry)) return;
    const codigoRaw =
      entry.COD_ERRO ?? entry.codigo ?? entry.code ?? entry.erroCodigo ?? entry.errorCode ?? entry.ERRO_CODIGO;
    const mensagemRaw =
      entry.DES_ERRO ?? entry.mensagem ?? entry.message ?? entry.erroMensagem ?? entry.errorMessage;
    const codigo = typeof codigoRaw === 'string' ? sanitizeIdentifier(codigoRaw) ?? undefined : codigoRaw;
    const mensagem = typeof mensagemRaw === 'string' ? sanitizeText(mensagemRaw) ?? undefined : undefined;
    const signature = `${codigo ?? ''}|${mensagem ?? ''}`;
    if (!errorMap.has(signature)) {
      errorMap.set(signature, { codigo: codigo ? String(codigo) : undefined, mensagemCurta: mensagem });
    }
  });

  const topErrors = Array.from(errorMap.values()).slice(0, maxItems);

  const integrationsSummary = integracoes
    .filter(isPlainObject)
    .map((entry) => {
      const nomeRaw = entry.DES_INTEGRACAO ?? entry.nome ?? entry.name;
      const statusRaw = entry.STA_STATUS ?? entry.status;
      const erroCodigoRaw = entry.COD_ERRO ?? entry.erroCodigo ?? entry.errorCode;
      const nome = typeof nomeRaw === 'string' ? sanitizeText(nomeRaw) ?? undefined : undefined;
      const status = typeof statusRaw === 'string' ? sanitizeIdentifier(statusRaw) ?? undefined : undefined;
      const erroCodigo = typeof erroCodigoRaw === 'string' ? sanitizeIdentifier(erroCodigoRaw) ?? undefined : undefined;
      return {
        nome,
        status,
        erroCodigo,
      };
    })
    .filter((entry) => entry.nome || entry.status || entry.erroCodigo)
    .slice(0, maxItems);

  const safeFields: Record<string, Array<string | number | boolean>> = {};
  config.includePaths.forEach((path) => {
    const values = getValuesByPath(rawData, path)
      .map(sanitizePrimitive)
      .filter((value): value is string | number | boolean => value !== null && value !== undefined);
    if (values.length > 0) {
      safeFields[path] = Array.from(new Set(values)).slice(0, maxItems);
    }
  });

  const flags: string[] = [];
  config.rules.forEach((rule) => {
    if (evaluateWhen(rule.when, rawData, { proposal, counts, recent, flags: [] })) {
      flags.push(rule.flag);
    }
  });

  return {
    proposal,
    counts,
    recent,
    flags: Array.from(new Set(flags)).slice(0, maxItems),
    topErrors,
    integrationsSummary,
    safeFields,
  };
};
