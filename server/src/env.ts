import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, setGlobalDispatcher } from 'undici';
import { logger } from './logger';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
const result = dotenv.config({ path: envPath });

process.env.DOTENV_CONFIG_LOADED = 'true';
if (result.error) {
  logger.warn(
    { err: result.error.message, envPath },
    'Falha ao carregar .env no bootstrap.',
  );
}

const PROXY_ENV_VARS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'NODE_USE_ENV_PROXY',
] as const;

const clearProxyEnvVars = (): string[] => {
  const removed: string[] = [];

  for (const name of PROXY_ENV_VARS) {
    if (process.env[name] !== undefined) {
      removed.push(name);
      delete process.env[name];
    }
  }

  return removed;
};

const removedProxyEnvVars = clearProxyEnvVars();

setGlobalDispatcher(
  new Agent({
    connectTimeout: 10_000,
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 120_000,
  }),
);

logger.info(
  { removedProxyEnvVars },
  'Proxy desabilitado por padrão (env vars de proxy limpas)',
);
