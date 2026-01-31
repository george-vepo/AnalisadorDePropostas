import { Router } from 'express';
import { fetchRawAnalysisFromDb } from '../analysisData';

const MAX_COD_PROPOSTA_LENGTH = 50;

export const analysisRouter = Router();

const buildErrorResponse = (message: string, details?: string) => ({
  error: {
    message,
    details,
  },
});

analysisRouter.get('/analysis/:codProposta', async (req, res) => {
  const codProposta = String(req.params.codProposta ?? '').trim();

  if (!codProposta || codProposta.length > MAX_COD_PROPOSTA_LENGTH) {
    return res.status(400).json(buildErrorResponse('codProposta inválido', 'Informe um código válido.'));
  }

  try {
    const result = await fetchRawAnalysisFromDb(codProposta);
    return res.json({
      codProposta,
      meta: {
        setsCount: result.recordsets.length,
        rowsBySet: result.rowsBySet,
        elapsedMs: result.elapsedMs,
      },
      data: result.data,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Erro desconhecido ao executar análise.';
    return res.status(500).json(buildErrorResponse('Erro ao executar análise', details));
  }
});
