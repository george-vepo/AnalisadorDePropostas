import { Router } from 'express';
import { fetchAnalysisFromDb, SqlTimeoutError } from '../analysisData';
import { incrementError } from '../metrics';

const MAX_COD_PROPOSTA_LENGTH = 50;

export const analysisRouter = Router();

const buildErrorResponse = (message: string, details?: string) => ({
  error: {
    message,
    details,
  },
});

analysisRouter.get('/analysis/:codProposta', async (req, res) => {
  if ((process.env.DEV_ALLOW_RAW ?? 'false') !== 'true') {
    return res.status(403).json(buildErrorResponse('Endpoint de debug desabilitado.'));
  }

  const codProposta = String(req.params.codProposta ?? '').trim();

  if (!codProposta || codProposta.length > MAX_COD_PROPOSTA_LENGTH) {
    return res.status(400).json(buildErrorResponse('codProposta inválido', 'Informe um código válido.'));
  }

  try {
    const result = await fetchAnalysisFromDb(codProposta);
    return res.json({
      codProposta,
      meta: {
        setsCount: result.recordsets.length,
        rowsBySet: result.rowsBySet,
        elapsedMs: result.elapsedMs,
        format: result.format,
        fallbackUsed: result.fallbackUsed,
      },
      data: result.data,
    });
  } catch (error) {
    if (error instanceof SqlTimeoutError) {
      incrementError();
      return res.status(504).json(buildErrorResponse('Timeout no SQL', error.message));
    }
    const details = error instanceof Error ? error.message : 'Erro desconhecido ao executar análise.';
    incrementError();
    return res.status(500).json(buildErrorResponse('Erro ao executar análise', details));
  }
});
