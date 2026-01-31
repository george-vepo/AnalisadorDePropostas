import type { SignalRule } from '../pipeline';
import { evaluateWhen, getValuesByPath } from '../runbooks/conditions';

export type SignalsConfig = {
  enabled: boolean;
  includePaths: string[];
  rules: SignalRule[];
};

export type ExtractedSignals = {
  statusSummary: Record<string, number>;
  flags: Array<{ id: string; description: string; severity?: SignalRule['severity'] }>; 
  counts: {
    errors: number;
    integrations: number;
  };
  timestamps: {
    createdAt?: string;
    lastUpdate?: string;
    lastFailure?: string;
    ageHours?: number;
  };
  topErrors: Array<{ code: string; message?: string; count: number }>;
  integrations: Array<{ name: string; status: string }>;
  includePaths: Record<string, Array<string | number | boolean>>;
};

const MAX_ERRORS = 5;
const MAX_INTEGRATIONS = 10;
const MAX_INCLUDE_VALUES = 5;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const maskSensitive = (value: string): string => {
  const noEmails = value.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email]');
  return noEmails.replace(/\d/g, '#');
};

const sanitizeValue = (value: unknown): string | number | boolean | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const masked = maskSensitive(trimmed);
    return masked.length > 120 ? `${masked.slice(0, 120)}...` : masked;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
};

const extractDates = (value: unknown): Date | null => {
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
};

export const extractSignals = (normalizedRawJson: unknown, config: SignalsConfig): ExtractedSignals => {
  const statusCounts: Record<string, number> = {};
  const errorMap = new Map<string, { code: string; message?: string; count: number }>();
  const integrations: Array<{ name: string; status: string }> = [];
  const includePaths: Record<string, Array<string | number | boolean>> = {};
  const flags: Array<{ id: string; description: string; severity?: SignalRule['severity'] }> = [];

  const createdAtDates: Date[] = [];
  const updateDates: Date[] = [];
  const failureDates: Date[] = [];

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (!isPlainObject(value)) return;

    if (typeof value.status === 'string') {
      const key = value.status.trim();
      if (key) {
        statusCounts[key] = (statusCounts[key] ?? 0) + 1;
      }
    }

    const hasIntegrationName = typeof value.nome === 'string' || typeof value.name === 'string';
    if (hasIntegrationName && typeof value.status === 'string') {
      const name = sanitizeValue(value.nome ?? value.name);
      const status = sanitizeValue(value.status);
      if (name && status && integrations.length < MAX_INTEGRATIONS) {
        integrations.push({ name: String(name), status: String(status) });
      }
    }

    const codeCandidate = value.erroCodigo ?? value.errorCode ?? value.code;
    if (typeof codeCandidate === 'string' || typeof codeCandidate === 'number') {
      const messageCandidate = value.erroMensagem ?? value.errorMessage ?? value.message;
      const code = String(codeCandidate);
      const message = typeof messageCandidate === 'string' ? String(sanitizeValue(messageCandidate)) : undefined;
      const signature = `${code}|${message ?? ''}`;
      const existing = errorMap.get(signature);
      if (existing) {
        existing.count += 1;
      } else if (errorMap.size < MAX_ERRORS) {
        errorMap.set(signature, { code, message, count: 1 });
      }
    }

    Object.entries(value).forEach(([key, child]) => {
      const lowerKey = key.toLowerCase();
      const date = extractDates(child);
      if (date) {
        if (/(criacao|created)/i.test(lowerKey)) createdAtDates.push(date);
        if (/(atual|update)/i.test(lowerKey)) updateDates.push(date);
        if (/(falha|erro|error)/i.test(lowerKey)) failureDates.push(date);
      }
      walk(child);
    });
  };

  walk(normalizedRawJson);

  config.includePaths.forEach((path) => {
    const values = getValuesByPath(normalizedRawJson, path)
      .map(sanitizeValue)
      .filter((value): value is string | number | boolean => value !== null);
    if (values.length > 0) {
      includePaths[path] = Array.from(new Set(values)).slice(0, MAX_INCLUDE_VALUES);
    }
  });

  config.rules.forEach((rule) => {
    if (evaluateWhen(rule.when, normalizedRawJson)) {
      flags.push({ id: rule.flag, description: rule.description, severity: rule.severity });
    }
  });

  const createdAt = createdAtDates.sort((a, b) => a.getTime() - b.getTime())[0];
  const lastUpdate = updateDates.sort((a, b) => b.getTime() - a.getTime())[0];
  const lastFailure = failureDates.sort((a, b) => b.getTime() - a.getTime())[0];

  const ageHours = createdAt ? Math.round((Date.now() - createdAt.getTime()) / 36e5) : undefined;

  return {
    statusSummary: statusCounts,
    flags,
    counts: {
      errors: Array.from(errorMap.values()).reduce((acc, entry) => acc + entry.count, 0),
      integrations: integrations.length,
    },
    timestamps: {
      createdAt: createdAt?.toISOString(),
      lastUpdate: lastUpdate?.toISOString(),
      lastFailure: lastFailure?.toISOString(),
      ageHours,
    },
    topErrors: Array.from(errorMap.values()),
    integrations,
    includePaths,
  };
};
