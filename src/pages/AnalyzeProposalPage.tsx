import { useMemo, useState } from 'react';

type Status = {
  type: 'idle' | 'loading' | 'success' | 'error';
  message: string;
};

type StructuredAnalysis = {
  title: string;
  summary: string;
  probable_cause: string;
  confidence: number;
  severity: 'P0' | 'P1' | 'P2' | 'P3' | 'UNKNOWN';
  evidence: string[];
  next_steps: string[];
  questions: string[];
  suggested_runbooks?: string[];
};

type AnalyzeResponse = {
  analysis: StructuredAnalysis | null;
  analysisText?: string | null;
  ticketMarkdown?: string | null;
};

const AnalyzeProposalPage = () => {
  const [proposalNumber, setProposalNumber] = useState('');
  const [lastAnalyzedNumber, setLastAnalyzedNumber] = useState('');
  const [status, setStatus] = useState<Status>({
    type: 'idle',
    message: 'Informe o número da proposta para iniciar a análise.',
  });
  const [analysis, setAnalysis] = useState<StructuredAnalysis | null>(null);
  const [analysisText, setAnalysisText] = useState('');
  const [ticketMarkdown, setTicketMarkdown] = useState('');
  const canAnalyze = proposalNumber.trim().length > 0 && status.type !== 'loading';

  const handleAnalyze = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!proposalNumber.trim()) {
      setStatus({ type: 'error', message: 'Digite o número da proposta.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Consultando backend e analisando proposta...' });
    setAnalysis(null);
    setAnalysisText('');
    setTicketMarkdown('');

    try {
      const trimmed = proposalNumber.trim();
      const response = await fetch(`/api/analyze/${encodeURIComponent(trimmed)}`);
      const payload = (await response.json()) as AnalyzeResponse;

      if (!response.ok) {
        throw new Error((payload as { error?: string })?.error ?? 'Erro ao analisar proposta.');
      }

      setAnalysis(payload.analysis ?? null);
      setAnalysisText(payload.analysisText ?? '');
      setTicketMarkdown(payload.ticketMarkdown ?? '');
      setLastAnalyzedNumber(trimmed);
      setStatus({ type: 'success', message: 'Análise concluída com sucesso.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro inesperado ao analisar proposta.';

      setStatus({ type: 'error', message });
    }
  };

  const handleCopyTicket = async () => {
    if (!lastAnalyzedNumber) return;

    try {
      let ticket = ticketMarkdown;

      if (!ticket) {
        const response = await fetch(`/api/analyze/${encodeURIComponent(lastAnalyzedNumber)}?mode=ticket`);
        const payload = (await response.json()) as AnalyzeResponse;
        if (!response.ok) {
          throw new Error((payload as { error?: string })?.error ?? 'Erro ao gerar ticket.');
        }
        ticket = payload.ticketMarkdown ?? '';
        setTicketMarkdown(ticket);
      }

      if (ticket) {
        await navigator.clipboard.writeText(ticket);
        setStatus({ type: 'success', message: 'Resumo do ticket copiado.' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro inesperado ao copiar ticket.';
      setStatus({ type: 'error', message });
    }
  };

  const handleCopyJson = async () => {
    if (!analysis) return;
    await navigator.clipboard.writeText(JSON.stringify(analysis, null, 2));
    setStatus({ type: 'success', message: 'JSON completo copiado.' });
  };

  const statusClass = useMemo(() => {
    if (status.type === 'error') return 'status error';
    if (status.type === 'success') return 'status success';
    return 'status';
  }, [status.type]);

  const severityClass = analysis?.severity ? `badge ${analysis.severity.toLowerCase()}` : 'badge';

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
        </div>
        <small>Os dados são sanitizados e criptografados no backend antes de serem enviados à OpenAI.</small>
      </form>

      <div className={statusClass}>{status.message}</div>

      {analysis && (
        <section className="result">
          <div className="analysis-header">
            <div>
              <h2>{analysis.title}</h2>
              <p className="analysis-subtitle">{analysis.summary}</p>
            </div>
            <div className="analysis-meta">
              <span className={severityClass}>{analysis.severity}</span>
              <span className="confidence">Confiança: {analysis.confidence}%</span>
            </div>
          </div>

          <div className="analysis-actions">
            <button type="button" className="secondary" onClick={handleCopyTicket}>
              Copiar resumo pro ticket
            </button>
            <button type="button" className="secondary" onClick={handleCopyJson} disabled={!analysis}>
              Copiar JSON completo
            </button>
          </div>

          <div className="section">
            <h3>Causa provável</h3>
            <p>{analysis.probable_cause}</p>
          </div>

          <div className="section">
            <h3>Evidências</h3>
            <ul>
              {analysis.evidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="section">
            <h3>Próximos passos</h3>
            <ul>
              {analysis.next_steps.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="section">
            <h3>Perguntas</h3>
            <ul>
              {analysis.questions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          {analysis.suggested_runbooks && analysis.suggested_runbooks.length > 0 && (
            <div className="section">
              <h3>Runbooks sugeridos</h3>
              <ul>
                {analysis.suggested_runbooks.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {!analysis && analysisText && (
        <section>
          <h2>Resultado da análise</h2>
          <div className="output">{analysisText}</div>
        </section>
      )}
    </main>
  );
};

export default AnalyzeProposalPage;
