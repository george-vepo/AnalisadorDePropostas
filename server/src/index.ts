import express from 'express';
import './env';
import { analysisRouter } from './routes/analysis';
import { analyzeRouter } from './routes/analyze';
import { systemRouter } from './routes/system';
import { httpLogger, logger } from './logger';
import { incrementRequest } from './metrics';
import { loadConfig } from './config/loadConfig';

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(httpLogger);
app.use((req, _res, next) => {
  incrementRequest(req.path);
  next();
});
app.use('/api', analyzeRouter);
app.use('/api', analysisRouter);
app.use('/api', systemRouter);

const configResult = loadConfig();
if (!configResult.config) {
  logger.error(
    { errors: configResult.errors ?? [] },
    'Config inválido ao iniciar. /api/analyze retornará erro até corrigir.',
  );
} else {
  logger.info({ hash: configResult.hash }, 'Config carregado com sucesso.');
}

const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => {
  logger.info(`Server running on http://localhost:${port}`);
});
