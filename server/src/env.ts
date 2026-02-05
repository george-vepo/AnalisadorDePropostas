import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
const result = dotenv.config({ path: envPath });

process.env.DOTENV_CONFIG_LOADED = 'true';
if (result.error) {
  logger.warn({ err: result.error.message, envPath }, 'Falha ao carregar .env no bootstrap.');
}
