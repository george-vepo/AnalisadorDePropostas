import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

const execFileAsync = promisify(execFile);
const isWindows = process.platform === 'win32';
const PAC_DISCOVERY_COOLDOWN_MS = 30_000;
const DEFAULT_WPAD_URL = 'http://webproxy.adcorp.intranet/wpad.dat';
const DEFAULT_HEALTHCHECK_TIMEOUT_MS = 1_800;

let cachedPacUrl: string | null = null;
let inFlightResolve: Promise<string | null> | null = null;
let lastResolvedAt = 0;
let refreshTimer: NodeJS.Timeout | null = null;

const isTruthy = (value?: string) =>
  ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');

const sanitizeUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = '[REDACTED]';
      parsed.password = '';
    }
    return parsed.toString();
  } catch {
    return value;
  }
};

const normalizePacUrl = (value: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const isLoopbackPacUrl = (pacUrl: string) => {
  const hostname = new URL(pacUrl).hostname.toLowerCase();
  return hostname === '127.0.0.1' || hostname === 'localhost';
};

const toAbortSignal = (timeoutMs: number) => {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
};

const isHealthcheckNetworkError = (error: unknown) => {
  const anyErr = error as { code?: string; cause?: { code?: string } };
  const code = anyErr?.cause?.code ?? anyErr?.code;
  return code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT';
};

const healthcheckPacUrl = async (pacUrl: string) => {
  const timeoutMs = Number(process.env.PAC_HEALTHCHECK_TIMEOUT_MS ?? DEFAULT_HEALTHCHECK_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(pacUrl, {
      method: 'GET',
      signal: toAbortSignal(Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_HEALTHCHECK_TIMEOUT_MS),
    });
    logger.info(
      {
        pacUrl: sanitizeUrl(pacUrl),
        status: response.status,
        durationMs: Date.now() - startedAt,
      },
      'Healthcheck do PAC loopback concluído.',
    );
    return response.ok;
  } catch (error) {
    logger.warn(
      {
        pacUrl: sanitizeUrl(pacUrl),
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        networkError: isHealthcheckNetworkError(error),
      },
      'Healthcheck do PAC loopback falhou.',
    );
    return false;
  }
};

const readRegistryAutoConfigUrl = async (): Promise<string | null> => {
  const { stdout } = await execFileAsync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings').AutoConfigURL",
    ],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  const trimmed = stdout?.trim();
  return trimmed ? trimmed : null;
};

const getWpadUrl = () => normalizePacUrl(process.env.WPAD_URL ?? DEFAULT_WPAD_URL) ?? DEFAULT_WPAD_URL;

const shouldRefresh = () => Date.now() - lastResolvedAt > PAC_DISCOVERY_COOLDOWN_MS;

const discoverPacUrl = async (reason: string) => {
  const forcedPacUrl = normalizePacUrl(process.env.PAC_URL ?? process.env.PROXY_PAC_URL ?? null);
  if (forcedPacUrl) {
    logger.info(
      { pacUrl: sanitizeUrl(forcedPacUrl), reason },
      'PAC definido por variável de ambiente (PAC_URL/PROXY_PAC_URL).',
    );
    return forcedPacUrl;
  }

  if (!isWindows) {
    const fallbackWpad = getWpadUrl();
    logger.info(
      { pacUrl: sanitizeUrl(fallbackWpad), reason },
      'SO não Windows. Usando WPAD_URL padrão/configurado.',
    );
    return fallbackWpad;
  }

  const rawRegistryPacUrl = await readRegistryAutoConfigUrl();
  const registryPacUrl = normalizePacUrl(rawRegistryPacUrl);

  logger.info(
    {
      reason,
      autoConfigUrlRaw: rawRegistryPacUrl ? sanitizeUrl(rawRegistryPacUrl) : null,
      autoConfigUrl: registryPacUrl ? sanitizeUrl(registryPacUrl) : null,
    },
    'AutoConfigURL lido do registry.',
  );

  if (registryPacUrl) {
    if (isLoopbackPacUrl(registryPacUrl)) {
      const healthy = await healthcheckPacUrl(registryPacUrl);
      if (healthy) {
        return registryPacUrl;
      }
      logger.warn(
        { pacUrl: sanitizeUrl(registryPacUrl), reason },
        'PAC loopback está stale/indisponível. Aplicando fallback para WPAD corporativo.',
      );
    } else {
      return registryPacUrl;
    }
  }

  const fallbackWpad = getWpadUrl();
  logger.info(
    { pacUrl: sanitizeUrl(fallbackWpad), reason },
    'Usando WPAD corporativo como fallback de discovery.',
  );
  return fallbackWpad;
};

export const resolvePacUrlForRequest = async (reason: string) => {
  if (isTruthy(process.env.DISABLE_PAC_DISCOVERY)) {
    return normalizePacUrl(process.env.PAC_URL ?? process.env.PROXY_PAC_URL ?? null);
  }

  if (!shouldRefresh() && cachedPacUrl) {
    return cachedPacUrl;
  }

  if (inFlightResolve) {
    return inFlightResolve;
  }

  inFlightResolve = (async () => {
    lastResolvedAt = Date.now();
    try {
      const pacUrl = await discoverPacUrl(reason);
      cachedPacUrl = pacUrl;
      return pacUrl;
    } catch (error) {
      const fallbackWpad = getWpadUrl();
      cachedPacUrl = fallbackWpad;
      logger.warn(
        {
          reason,
          pacUrl: sanitizeUrl(fallbackWpad),
          error: error instanceof Error ? error.message : String(error),
        },
        'Falha ao resolver PAC URL. Usando fallback de WPAD.',
      );
      return fallbackWpad;
    } finally {
      inFlightResolve = null;
    }
  })();

  return inFlightResolve;
};

export const initPacDiscovery = async (loggerLike: LoggerLike) => {
  const pacUrl = await resolvePacUrlForRequest('startup');
  loggerLike.info(
    { pacUrl: pacUrl ? sanitizeUrl(pacUrl) : null },
    'PAC discovery inicializado.',
  );

  const intervalMinutes = Number(process.env.PAC_DISCOVERY_INTERVAL_MINUTES ?? '');
  if (Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      void resolvePacUrlForRequest('interval');
    }, intervalMinutes * 60_000);
    loggerLike.info(
      { intervalMinutes },
      'Watcher de PAC discovery habilitado.',
    );
  }

  return Boolean(pacUrl);
};

export const notePacNetworkError = (error: unknown) => {
  const anyErr = error as { code?: string };
  const code = anyErr?.code;
  if (code !== 'ECONNRESET' && code !== 'ETIMEDOUT' && code !== 'ECONNREFUSED') return;
  void resolvePacUrlForRequest(`network:${code}`);
};

export const getActivePacUrl = () => cachedPacUrl;
