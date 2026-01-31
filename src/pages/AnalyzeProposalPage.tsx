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
  analysisText?: string;
  structured?: StructuredAnalysis;
  ticketMarkdown?: string;
  sanitizedJson?: Record<string, unknown>;
  meta?: {
    elapsedMsTotal?: number;
    elapsedMsDb?: number;
    elapsedMsOpenai?: number;
    setsCount?: number;
    rowsBySet?: number[];
    payloadBytesNormalized?: number;
    payloadBytesSanitized?: number;
    format?: 'json' | 'recordsets';
    fallbackUsed?: boolean;
  };
};

type ErrorResponse = {
  error?: {
    message?: string;
    details?: string;
  };
};

const buildTicketMarkdown = (structured: StructuredAnalysis) => {
  const lines: string[] = [];
  lines.push(`# ${structured.title}`);
  lines.push(`**Severidade:** ${structured.severity} | **Confiança:** ${structured.confidence}%`);
  lines.push('');
  lines.push('## Resumo');
  lines.push(structured.summary);
  lines.push('');
  lines.push('## Causa provável');
  lines.push(structured.probable_cause);
  lines.push('');
  lines.push('## Evidências');
  structured.evidence.forEach((item) => lines.push(`- ${item}`));
  lines.push('');
  lines.push('## Próximos passos');
  structured.next_steps.forEach((item) => lines.push(`- ${item}`));
  lines.push('');
  lines.push('## Perguntas');
  structured.questions.forEach((item) => lines.push(`- ${item}`));
  if (structured.suggested_runbooks && structured.suggested_runbooks.length > 0) {
    lines.push('');
    lines.push('## Runbooks sugeridos');
    structured.suggested_runbooks.forEach((item) => lines.push(`- ${item}`));
  }
  return lines.join('\n');
};

const AnalyzeProposalPage = () => {
  const [codProposta, setCodProposta] = useState('');
  const [mode, setMode] = useState<'analysis' | 'sanitized' | 'ticket'>('analysis');
  const [status, setStatus] = useState<Status>({
    type: 'idle',
    message: 'Informe o código da proposta para iniciar a análise.',
  });
  const [analysisText, setAnalysisText] = useState('');
  const [structured, setStructured] = useState<StructuredAnalysis | null>(null);
  const [ticketMarkdown, setTicketMarkdown] = useState('');
  const [sanitizedJson, setSanitizedJson] = useState('');
  const [lastMeta, setLastMeta] = useState<AnalyzeResponse['meta'] | null>(null);
  const [lastPayload, setLastPayload] = useState('');

  const canAnalyze = codProposta.trim().length > 0 && status.type !== 'loading';

  const handleAnalyze = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!codProposta.trim()) {
      setStatus({ type: 'error', message: 'Digite o código da proposta.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Consultando e analisando proposta...' });
    setAnalysisText('');
    setStructured(null);
    setTicketMarkdown('');
    setSanitizedJson('');
    setLastMeta(null);
    setLastPayload('');

    try {
      const trimmed = codProposta.trim();
      const modeQuery = mode === 'analysis' ? '' : `?mode=${mode}`;
      const response = await fetch(`/api/analyze/${encodeURIComponent(trimmed)}${modeQuery}`);
      const payload = (await response.json()) as AnalyzeResponse & ErrorResponse;

      if (!response.ok) {
        const message = payload.error?.message ?? 'Erro ao executar análise.';
        const details = payload.error?.details ? ` (${payload.error.details})` : '';
        throw new Error(`${message}${details}`);
      }

      setLastPayload(JSON.stringify(payload, null, 2));

      if (mode === 'sanitized') {
        setSanitizedJson(JSON.stringify(payload.sanitizedJson ?? payload, null, 2));
        setStatus({ type: 'success', message: 'JSON sanitizado pronto para inspeção.' });
      } else if (mode === 'ticket') {
        setTicketMarkdown(payload.ticketMarkdown ?? '');
        setStructured(payload.structured ?? null);
        setStatus({ type: 'success', message: 'Ticket gerado com sucesso.' });
      } else {
        if (payload.structured) {
          setStructured(payload.structured);
          setStatus({ type: 'success', message: 'Análise estruturada concluída com sucesso.' });
        } else {
          setAnalysisText(payload.analysisText ?? 'Sem resposta disponível.');
          setStatus({ type: 'success', message: 'Análise concluída com fallback de texto.' });
        }
      }

      setLastMeta(payload.meta ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro inesperado ao executar análise.';
      setStatus({ type: 'error', message });
    }
  };

  const handleCopyTicket = async () => {
    const text =
      ticketMarkdown || (structured ? buildTicketMarkdown(structured) : analysisText || '');
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setStatus({ type: 'success', message: 'Resumo do ticket copiado para a área de transferência.' });
  };

  const handleCopyJson = async () => {
    if (!lastPayload) return;
    await navigator.clipboard.writeText(lastPayload);
    setStatus({ type: 'success', message: 'JSON completo copiado para a área de transferência.' });
  };

  const statusClass = useMemo(() => {
    if (status.type === 'error') return 'status error';
    if (status.type === 'success') return 'status success';
    return 'status';
  }, [status.type]);

  const severityClass = useMemo(() => {
    if (!structured) return 'badge unknown';
    return `badge ${structured.severity.toLowerCase()}`;
  }, [structured]);

  const shouldShowStructured = mode !== 'sanitized' && structured;
  const shouldShowTicket = mode === 'ticket' && ticketMarkdown;

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
        <label htmlFor="mode">Modo</label>
        <select id="mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
          <option value="analysis">Análise (estruturada)</option>
          <option value="ticket">Ticket (Markdown)</option>
          <option value="sanitized">JSON sanitizado</option>
        </select>
        <div className="actions">
          <button type="submit" disabled={!canAnalyze}>
            {status.type === 'loading' ? 'Analisando...' : 'Analisar'}
          </button>
          <button type="button" className="secondary" onClick={handleCopyTicket}>
            Copiar resumo pro ticket
          </button>
          <button type="button" className="secondary" onClick={handleCopyJson}>
            Copiar JSON completo
          </button>
        </div>
        <small>
          {mode === 'sanitized'
            ? 'Modo debug: retorna apenas JSON sanitizado, sem chamada à OpenAI.'
            : mode === 'ticket'
              ? 'Gera Markdown pronto para colar no ticket.'
              : 'A análise usa OpenAI e dados sanitizados.'}
        </small>
      </form>

      <div className={statusClass}>{status.message}</div>

      {(analysisText || sanitizedJson || structured || ticketMarkdown) && (
        <section className="result">
          <div className="analysis-header">
            <div>
              <h2>
                {mode === 'sanitized'
                  ? 'JSON sanitizado'
                  : mode === 'ticket'
                    ? 'Ticket gerado'
                    : 'Análise'}
              </h2>
              <p className="analysis-subtitle">
                {mode === 'sanitized'
                  ? 'Uso interno para validação de privacidade.'
                  : mode === 'ticket'
                    ? 'Markdown pronto para colagem no atendimento.'
                    : 'Resumo estruturado gerado automaticamente pela OpenAI.'}
              </p>
            </div>
            {shouldShowStructured && (
              <div className="analysis-actions">
                <span className={severityClass}>{structured.severity}</span>
                <span className="confidence">Confiança: {structured.confidence}%</span>
              </div>
            )}
          </div>

          {mode === 'sanitized' && <pre className="output">{sanitizedJson}</pre>}

          {shouldShowTicket && <pre className="output">{ticketMarkdown}</pre>}

          {shouldShowStructured && (
            <div className="structured">
              <div className="section">
                <h3>{structured.title}</h3>
                <p>{structured.summary}</p>
              </div>
              <div className="section">
                <h3>Causa provável</h3>
                <p>{structured.probable_cause}</p>
              </div>
              <div className="section">
                <h3>Evidências</h3>
                <ul>
                  {structured.evidence.map((item, index) => (
                    <li key={`evidence-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="section">
                <h3>Próximos passos</h3>
                <ul>
                  {structured.next_steps.map((item, index) => (
                    <li key={`next-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="section">
                <h3>Perguntas</h3>
                <ul>
                  {structured.questions.map((item, index) => (
                    <li key={`question-${index}`}>{item}</li>
                  ))}
                </ul>
              </div>
              {structured.suggested_runbooks && structured.suggested_runbooks.length > 0 && (
                <div className="section">
                  <h3>Runbooks sugeridos</h3>
                  <ul>
                    {structured.suggested_runbooks.map((item, index) => (
                      <li key={`runbook-${index}`}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {!structured && analysisText && mode === 'analysis' && (
            <pre className="output">{analysisText}</pre>
          )}

          {lastMeta && (
            <div className="analysis-meta">
              <span className="badge">
                {lastMeta.elapsedMsTotal ? `${lastMeta.elapsedMsTotal} ms` : 'Tempo indisponível'}
              </span>
              <span className="badge">
                {lastMeta.format ? `Formato: ${lastMeta.format}` : 'Formato indisponível'}
              </span>
              <small>
                {lastMeta.fallbackUsed === undefined
                  ? 'Fallback indisponível'
                  : lastMeta.fallbackUsed
                    ? 'Fallback: script legado usado'
                    : 'Fallback: SQL JSON usado'}
              </small>
              <small>
                {lastMeta.payloadBytesSanitized
                  ? `Payload sanitizado: ${lastMeta.payloadBytesSanitized} bytes`
                  : 'Payload sanitizado indisponível'}
              </small>
            </div>
          )}
        </section>
      )}
    </main>
  );
};

export default AnalyzeProposalPage;
