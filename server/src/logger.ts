import { randomUUID } from 'node:crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'OPENAI_API_KEY',
  'OPENAI_CRYPTO_PASSPHRASE',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const headerId = req.headers['x-request-id'];
    const requestId = typeof headerId === 'string' && headerId ? headerId : randomUUID();
    res.setHeader('x-request-id', requestId);
    return requestId;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
