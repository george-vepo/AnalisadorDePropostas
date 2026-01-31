import { useMemo, useState } from 'react';

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
  const canAnalyze = proposalNumber.trim().length > 0 && status.type !== 'loading';

  const handleAnalyze = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!proposalNumber.trim()) {
      setStatus({ type: 'error', message: 'Digite o número da proposta.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Consultando backend e analisando proposta...' });
    setAnalysisText('');

    try {
      const response = await fetch(`/api/analyze/${encodeURIComponent(proposalNumber.trim())}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Erro ao analisar proposta.');
      }

      setAnalysisText(payload.analysisText ?? '');
      setStatus({ type: 'success', message: 'Análise concluída com sucesso.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro inesperado ao analisar proposta.';

      setStatus({ type: 'error', message });
    }
  };

  const handleCopy = async () => {
    if (!analysisText) return;
    await navigator.clipboard.writeText(analysisText);
    setStatus({ type: 'success', message: 'Análise copiada para a área de transferência.' });
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
          <button type="button" onClick={handleCopy} disabled={!analysisText || status.type === 'loading'}>
            Copiar análise
          </button>
        </div>
        <small>Os dados são sanitizados e criptografados no backend antes de serem enviados à OpenAI.</small>
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
