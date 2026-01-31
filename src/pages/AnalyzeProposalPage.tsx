import { useMemo, useState } from 'react';
import pipelineConfig from '../config/pipeline.json';
import { PipelineConfig } from '../types/PipelineConfig';
import { getAnalysis } from '../services/backendClient';
import { sanitizeAndEncrypt } from '../services/sanitizer';
import { analyzeProposal } from '../services/openaiClient';
import { TemplateError } from '../services/template';

const typedConfig = pipelineConfig as PipelineConfig;

type Status = {
  type: 'idle' | 'loading' | 'success' | 'error';
  message: string;
};

const AnalyzeProposalPage = () => {
  const [proposalNumber, setProposalNumber] = useState('');
  const [status, setStatus] = useState<Status>({
    type: 'idle',
    message: 'Informe o número da proposta para iniciar a análise.',
  });
  const [analysisText, setAnalysisText] = useState('');
  const [sanitizedJson, setSanitizedJson] = useState<unknown>(null);

  const canAnalyze = proposalNumber.trim().length > 0 && status.type !== 'loading';

  const handleAnalyze = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!proposalNumber.trim()) {
      setStatus({ type: 'error', message: 'Digite o número da proposta.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Consultando backend e preparando dados...' });
    setAnalysisText('');

    try {
      const backendToken = import.meta.env.VITE_BACKEND_TOKEN as string | undefined;
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
      const passphrase = import.meta.env.VITE_CRYPTO_PASSPHRASE as string | undefined;

      if (!apiKey) {
        throw new Error('VITE_OPENAI_API_KEY não configurada.');
      }

      const backendResult = await getAnalysis(proposalNumber, typedConfig.backend, backendToken);

      const sanitized = await sanitizeAndEncrypt(
        backendResult.data,
        typedConfig.privacy.allowList,
        typedConfig.privacy.crypto,
        passphrase ?? '',
        'pipeline-v1',
      );

      setSanitizedJson(sanitized);

      setStatus({ type: 'loading', message: 'Chamando OpenAI para análise...' });
      const analysis = await analyzeProposal(proposalNumber, sanitized, typedConfig.openai, apiKey);

      setAnalysisText(analysis);
      setStatus({ type: 'success', message: 'Análise concluída com sucesso.' });
    } catch (error) {
      const message = error instanceof TemplateError
        ? `Erro de template: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Erro inesperado ao analisar proposta.';

      setStatus({ type: 'error', message });
    }
  };

  const handleCopy = async () => {
    if (!sanitizedJson) return;
    await navigator.clipboard.writeText(JSON.stringify(sanitizedJson, null, 2));
    setStatus({ type: 'success', message: 'JSON sanitizado copiado para a área de transferência.' });
  };

  const statusClass = useMemo(() => {
    if (status.type === 'error') return 'status error';
    if (status.type === 'success') return 'status success';
    return 'status';
  }, [status.type]);

  return (
    <main>
      <h1>Analisador de Propostas</h1>
      <p>Digite o número da proposta e gere uma análise automática.</p>

      <form onSubmit={handleAnalyze}>
        <label htmlFor="proposalNumber">Número da proposta</label>
        <input
          id="proposalNumber"
          type="text"
          value={proposalNumber}
          onChange={(event) => setProposalNumber(event.target.value)}
          placeholder="Ex.: 2024-000123"
        />
        <div className="actions">
          <button type="submit" disabled={!canAnalyze}>
            {status.type === 'loading' ? 'Analisando...' : 'Analisar'}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!sanitizedJson || status.type === 'loading'}
          >
            Copiar JSON Sanitizado
          </button>
        </div>
        <small>Os dados são sanitizados antes de serem enviados à OpenAI.</small>
      </form>

      <div className={statusClass}>{status.message}</div>

      {analysisText && (
        <section>
          <h2>Resultado da análise</h2>
          <div className="output">{analysisText}</div>
        </section>
      )}
    </main>
  );
};

export default AnalyzeProposalPage;
