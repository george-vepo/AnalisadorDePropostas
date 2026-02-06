import { useMemo, useState } from 'react';

type Status = {
  type: 'idle' | 'loading' | 'success' | 'error';
  message: string;
};

type AnalyzeResponse = {
  ok: boolean;
  proposalNumber: string;
  prompt: string;
};

type ErrorResponse = {
  error?: {
    message?: string;
    details?: string;
  };
};

type AnalysisType = 'sensibilizacao' | 'pagamento';

const AnalyzeProposalPage = () => {
  const [codProposta, setCodProposta] = useState('');
  const [analysisType, setAnalysisType] = useState<AnalysisType>('sensibilizacao');
  const [sanitizeEnabled, setSanitizeEnabled] = useState(true);
  const [status, setStatus] = useState<Status>({
    type: 'idle',
    message: 'Informe um código de proposta para gerar o prompt.',
  });
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);

  const canAnalyze = useMemo(() => codProposta.trim().length > 0 && status.type !== 'loading', [codProposta, status.type]);

  const handleAnalyze = async (event: React.FormEvent) => {
    event.preventDefault();

    const proposal = codProposta.trim();
    if (!proposal) {
      setStatus({ type: 'error', message: 'Digite um código de proposta válido.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Consultando proposta e gerando prompt...' });
    setPrompt('');

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codProposta: proposal, analysisType, sanitizeEnabled }),
      });
      const payload = (await response.json()) as AnalyzeResponse & ErrorResponse;

      if (!response.ok) {
        const message = payload.error?.message ?? 'Erro ao gerar prompt.';
        const details = payload.error?.details ? ` (${payload.error.details})` : '';
        throw new Error(`${message}${details}`);
      }

      setPrompt(payload.prompt ?? '');
      setStatus({ type: 'success', message: 'Prompt gerado com sucesso.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro inesperado ao gerar prompt.';
      setStatus({ type: 'error', message });
    }
  };

  const handleCopy = async () => {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const statusClass = useMemo(() => {
    if (status.type === 'error') return 'status error';
    if (status.type === 'success') return 'status success';
    return 'status';
  }, [status.type]);

  return (
    <main>
      <h1>Analisador de Propostas</h1>
      <p>Consulta no SQL e geração local de prompt para uso no Codex.</p>

      <form onSubmit={handleAnalyze}>
        <label htmlFor="analysisType">Tipo de análise</label>
        <select
          id="analysisType"
          value={analysisType}
          onChange={(event) => setAnalysisType(event.target.value as AnalysisType)}
        >
          <option value="sensibilizacao">Análise de sensibilização</option>
          <option value="pagamento">Análise de pagamento</option>
        </select>

        <div className="toggle-field">
          <span>Sanitização</span>
          <label className="switch" htmlFor="sanitizeEnabled">
            <input
              id="sanitizeEnabled"
              type="checkbox"
              checked={sanitizeEnabled}
              onChange={(event) => setSanitizeEnabled(event.target.checked)}
            />
            <span className="slider" aria-hidden="true" />
          </label>
        </div>

        <label htmlFor="codProposta">Código da proposta</label>
        <input
          id="codProposta"
          value={codProposta}
          onChange={(event) => setCodProposta(event.target.value)}
          placeholder="Ex.: 9063046000890-1"
        />
        <div className="actions">
          <button type="submit" disabled={!canAnalyze}>
            {status.type === 'loading' ? 'Gerando...' : 'Gerar prompt'}
          </button>
        </div>
      </form>

      <div className={statusClass}>{status.message}</div>

      {prompt && (
        <section className="result">
          <h2>Prompt</h2>
          <textarea className="prompt-box" readOnly value={prompt} rows={14} />
          <div className="actions">
            <button type="button" onClick={handleCopy}>Copiar</button>
            {copied && <span className="helper">Copiado!</span>}
          </div>
        </section>
      )}
    </main>
  );
};

export default AnalyzeProposalPage;
