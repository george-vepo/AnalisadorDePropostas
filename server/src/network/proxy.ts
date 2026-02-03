import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

const DOTENV_CONFIG_LOADED = 'DOTENV_CONFIG_LOADED';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultEnvPath = path.resolve(__dirname, '../../.env');

const ensureDotenvLoaded = (logger: LoggerLike) => {
  if (process.env[DOTENV_CONFIG_LOADED] === 'true') {
    return;
  }

  const result = dotenv.config({ path: defaultEnvPath });
  process.env[DOTENV_CONFIG_LOADED] = 'true';

  if (result.error) {
    logger.warn(
      { err: result.error.message, envPath: defaultEnvPath },
      'Falha ao carregar .env para configuração de proxy.',
    );
  }
};

const buildProxyUrlFromParts = (logger: LoggerLike): string | undefined => {
  const host = process.env.PROXY_HOST?.trim();
  const port = process.env.PROXY_PORT?.trim();
  const username = process.env.PROXY_USERNAME?.trim();
  const password = process.env.PROXY_PASSWORD?.trim();

  if (!host) {
    return undefined;
  }

  if (!port) {
    logger.warn(
      { proxyHost: host },
      'PROXY_HOST definido sem PROXY_PORT. Proxy ignorado.',
    );
    return undefined;
  }

  const hasAuth = Boolean(username || password);
  const authSegment = hasAuth
    ? `${encodeURIComponent(username ?? '')}:${encodeURIComponent(password ?? '')}@`
    : '';

  return `http://${authSegment}${host}:${port}`;
};

const describeProxy = (proxyUrl?: string) => {
  if (!proxyUrl) {
    return { host: undefined, port: undefined, hasAuth: false };
  }

  try {
    const url = new URL(proxyUrl);
    return {
      host: url.hostname,
      port: url.port || (url.protocol === 'https:' ? '443' : '80'),
      hasAuth: Boolean(url.username || url.password),
    };
  } catch {
    return { host: undefined, port: undefined, hasAuth: false };
  }
};

export const initNetworkFromEnv = (logger: LoggerLike) => {
  ensureDotenvLoaded(logger);

  const proxyFromParts = buildProxyUrlFromParts(logger);
  if (proxyFromParts) {
    if (!process.env.HTTP_PROXY) {
      process.env.HTTP_PROXY = proxyFromParts;
    }
    if (!process.env.HTTPS_PROXY) {
      process.env.HTTPS_PROXY = proxyFromParts;
    }
  }

  const httpProxy = process.env.HTTP_PROXY ?? process.env.http_proxy;
  const httpsProxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy;
  const nodeUseEnvProxy = process.env.NODE_USE_ENV_PROXY;

  setGlobalDispatcher(new EnvHttpProxyAgent());

  const httpDetails = describeProxy(httpProxy);
  const httpsDetails = describeProxy(httpsProxy);

  logger.info(
    {
      proxyEnabled: Boolean(httpProxy || httpsProxy),
      httpProxyHost: httpDetails.host,
      httpProxyPort: httpDetails.port,
      httpProxyAuth: httpDetails.hasAuth,
      httpsProxyHost: httpsDetails.host,
      httpsProxyPort: httpsDetails.port,
      httpsProxyAuth: httpsDetails.hasAuth,
      noProxyDefined: Boolean(noProxy),
      nodeUseEnvProxy: nodeUseEnvProxy ?? undefined,
    },
    'Configuração de proxy aplicada para requests HTTP.',
  );
};
