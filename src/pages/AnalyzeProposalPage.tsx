import { useMemo, useState } from 'react';

type Status = {
  type: 'idle' | 'loading' | 'success' | 'error';
  message: string;
};

type AnalyzeResponse = {
  analysisText?: string;
};

type ErrorResponse = {
  error?: {
    message?: string;
    details?: string;
  };
};

const AnalyzeProposalPage = () => {
  const [codProposta, setCodProposta] = useState('');
  const [status, setStatus] = useState<Status>({
    type: 'idle',
    message: 'Informe o código da proposta para iniciar a análise.',
  });
  const [analysisText, setAnalysisText] = useState('');

  const canAnalyze = codProposta.trim().length > 0 && status.type !== 'loading';

  const handleAnalyze = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!codProposta.trim()) {
      setStatus({ type: 'error', message: 'Digite o código da proposta.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Consultando e analisando proposta...' });
    setAnalysisText('');

    try {
      const trimmed = codProposta.trim();
      const response = await fetch(`/api/analyze/${encodeURIComponent(trimmed)}`);
      const payload = (await response.json()) as AnalyzeResponse & ErrorResponse;

      if (!response.ok) {
        const message = payload.error?.message ?? 'Erro ao executar análise.';
        const details = payload.error?.details ? ` (${payload.error.details})` : '';
        throw new Error(`${message}${details}`);
      }

      setAnalysisText(payload.analysisText ?? 'Sem resposta disponível.');
      setStatus({ type: 'success', message: 'Análise concluída com sucesso.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro inesperado ao executar análise.';
      setStatus({ type: 'error', message });
    }
  };

  const statusClass = useMemo(() => {
    if (status.type === 'error') return 'status error';
    if (status.type === 'success') return 'status success';
    return 'status';
  }, [status.type]);

  return (
    <main>
      <h1>Analisador de Propostas</h1>
      <p>Consulta direta ao SQL Server com autenticação integrada do Windows.</p>

      <form onSubmit={handleAnalyze}>
        <label htmlFor="codProposta">Código da proposta</label>
        <input
          id="codProposta"
          type="text"
          value={codProposta}
          onChange={(event) => setCodProposta(event.target.value)}
          placeholder="Ex.: 9063046000890-1"
        />
        <div className="actions">
          <button type="submit" disabled={!canAnalyze}>
            {status.type === 'loading' ? 'Analisando...' : 'Analisar'}
          </button>
        </div>
      </form>

      <div className={statusClass}>{status.message}</div>

      {analysisText && (
        <section className="result">
          <div>
            <h2>Análise</h2>
            <p className="analysis-subtitle">Resumo gerado automaticamente pela OpenAI.</p>
          </div>
          <pre className="output">{analysisText}</pre>
        </section>
      )}
    </main>
  );
};

export default AnalyzeProposalPage;
