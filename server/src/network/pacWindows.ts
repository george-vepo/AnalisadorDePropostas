import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

const execFileAsync = promisify(execFile);
const isWindows = process.platform === 'win32';
const PAC_REFRESH_COOLDOWN_MS = 30_000;
// Exemplo: DISABLE_PAC_DISCOVERY=true + HTTP_PROXY/HTTPS_PROXY (ou PROXY_FALLBACK_URL) para proxy fixo.

let cachedPacUrl: string | null = null;
let pacSource: 'env' | 'discovery' | null = null;
let pacIsReachable = false;
let inFlightRefresh: Promise<string | null> | null = null;
let lastRefreshAt = 0;
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

const PAC_VALIDATION_TIMEOUT_MS = 2_500;

const validatePacReachability = async (pacUrl: string): Promise<boolean> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAC_VALIDATION_TIMEOUT_MS);
  try {
    const response = await fetch(pacUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/x-ns-proxy-autoconfig,*/*;q=0.1' },
    });
    if (!response.ok) {
      return false;
    }
    const body = await response.text();
    return body.length > 20;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
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

const parseWinHttpOutput = (output: string) => {
  if (/direct access/i.test(output)) {
    return { pacUrl: null, proxyServer: null, direct: true };
  }
  const pacMatch = output.match(/PAC URL\s*:\s*(\S+)/i);
  const proxyMatch = output.match(/Proxy Server\(s\)\s*:\s*(.+)/i);
  return {
    pacUrl: pacMatch?.[1]?.trim() ?? null,
    proxyServer: proxyMatch?.[1]?.trim() ?? null,
    direct: false,
  };
};

const readWinHttpPacUrl = async () => {
  const { stdout } = await execFileAsync(
    'netsh',
    ['winhttp', 'show', 'proxy'],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  return parseWinHttpOutput(stdout ?? '');
};

export const getPacUrlFromWindows = async (): Promise<string | null> => {
  if (!isWindows) return null;

  const registryValue = await readRegistryAutoConfigUrl();
  const normalizedRegistry = normalizePacUrl(registryValue);
  logger.info(
    { autoConfigUrl: registryValue ? sanitizeUrl(registryValue) : null },
    'AutoConfigURL lido do registry.',
  );
  if (normalizedRegistry) {
    return normalizedRegistry;
  }

  const winHttp = await readWinHttpPacUrl();
  if (winHttp.direct) {
    logger.info({}, 'WinHTTP proxy: acesso direto.');
    return null;
  }

  if (winHttp.proxyServer) {
    logger.warn(
      { proxyServer: winHttp.proxyServer },
      'WinHTTP proxy encontrado, mas sem PAC URL.',
    );
  }

  const normalizedPac = normalizePacUrl(winHttp.pacUrl);
  if (normalizedPac) {
    return normalizedPac;
  }

  return null;
};

const applyPacUrl = (pacUrl: string | null, loggerLike: LoggerLike, reason: string) => {
  if (pacSource === 'env') {
    loggerLike.info(
      { pacUrl: sanitizeUrl(process.env.PROXY_PAC_URL ?? '') },
      'PROXY_PAC_URL definido por env. Discovery ignorado.',
    );
    return pacUrl;
  }

  if (pacUrl) {
    pacIsReachable = true;
    cachedPacUrl = pacUrl;
    pacSource = 'discovery';
    process.env.PROXY_PAC_URL = pacUrl;
    loggerLike.info(
      { pacUrl: sanitizeUrl(pacUrl), reason },
      'PAC URL atualizado via discovery.',
    );
    return pacUrl;
  }

  if (pacSource === 'discovery') {
    delete process.env.PROXY_PAC_URL;
  }
  cachedPacUrl = null;
  pacIsReachable = false;
  pacSource = pacSource === 'env' ? 'env' : null;
  loggerLike.warn({ reason }, 'PAC URL não encontrado. Usando fallback.');
  return null;
};

const shouldRefresh = () => Date.now() - lastRefreshAt > PAC_REFRESH_COOLDOWN_MS;

export const refreshPacDiscovery = async (reason: string) => {
  if (!isWindows) return null;
  if (isTruthy(process.env.DISABLE_PAC_DISCOVERY)) {
    logger.info(
      { reason },
      'Discovery de PAC desativado via DISABLE_PAC_DISCOVERY.',
    );
    return null;
  }
  if (!shouldRefresh()) {
    return cachedPacUrl;
  }
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    lastRefreshAt = Date.now();
    try {
      const pacUrl = await getPacUrlFromWindows();
      if (pacUrl) {
        const reachable = await validatePacReachability(pacUrl);
        if (!reachable) {
          logger.warn(
            { pacUrl: sanitizeUrl(pacUrl), reason },
            'PAC inválido (não acessível).',
          );
          return applyPacUrl(null, logger, reason);
        }
        logger.info(
          { pacUrl: sanitizeUrl(pacUrl), reason },
          'PAC válido e acessível.',
        );
      }
      return applyPacUrl(pacUrl, logger, reason);
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error), reason },
        'Falha ao descobrir PAC no Windows.',
      );
      return applyPacUrl(null, logger, reason);
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
};

export const initPacDiscovery = async (loggerLike: LoggerLike) => {
  if (!isWindows) {
    return false;
  }
  if (process.env.PROXY_PAC_URL?.trim()) {
    pacSource = 'env';
    cachedPacUrl = process.env.PROXY_PAC_URL.trim();
    pacIsReachable = await validatePacReachability(cachedPacUrl);
    if (!pacIsReachable) {
      delete process.env.PROXY_PAC_URL;
      cachedPacUrl = null;
      pacSource = null;
      loggerLike.warn({}, 'PAC inválido (não acessível). Ignorando PROXY_PAC_URL do ambiente.');
      return false;
    }
    loggerLike.info(
      { pacUrl: sanitizeUrl(cachedPacUrl) },
      'PROXY_PAC_URL já definido no ambiente.',
    );
    return true;
  }
  if (isTruthy(process.env.DISABLE_PAC_DISCOVERY)) {
    loggerLike.info(
      { disableFlag: process.env.DISABLE_PAC_DISCOVERY },
      'Discovery de PAC desativado via DISABLE_PAC_DISCOVERY.',
    );
    return false;
  }

  const pacUrl = await refreshPacDiscovery('startup');

  const intervalMinutes = Number(process.env.PAC_DISCOVERY_INTERVAL_MINUTES ?? '');
  if (Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      void refreshPacDiscovery('interval');
    }, intervalMinutes * 60_000);
    loggerLike.info(
      { intervalMinutes },
      'Watcher de PAC discovery habilitado.',
    );
  }

  return Boolean(pacUrl);
};

export const notePacNetworkError = (error: unknown) => {
  if (!isWindows) return;
  if (isTruthy(process.env.DISABLE_PAC_DISCOVERY)) return;
  const anyErr = error as { code?: string };
  const code = anyErr?.code;
  if (code !== 'ECONNRESET' && code !== 'ETIMEDOUT') return;
  void refreshPacDiscovery(`network:${code}`);
};

export const getActivePacUrl = () =>
  process.env.PROXY_PAC_URL?.trim() || cachedPacUrl;

export const hasValidPac = () => Boolean(getActivePacUrl() && pacIsReachable);
