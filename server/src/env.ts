import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger';
import { initPacProxyFromEnv } from './network/pacDispatcher';
import { initNetworkFromEnv } from './network/proxy';

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

const pacEnabled = initPacProxyFromEnv(logger);
logger.info(
  { pacEnabled, pacUrlDefined: Boolean(process.env.PROXY_PAC_URL) },
  'Proxy PAC init',
);

if (!pacEnabled) {
  initNetworkFromEnv(logger);
}
