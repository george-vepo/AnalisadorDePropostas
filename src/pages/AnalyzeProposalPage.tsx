import { useMemo, useState } from 'react';

type Status = {
  type: 'idle' | 'loading' | 'success' | 'error';
  message: string;
};

type AnalyzeResponse = {
  analysisText?: string;
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

const AnalyzeProposalPage = () => {
  const [codProposta, setCodProposta] = useState('');
  const [status, setStatus] = useState<Status>({
    type: 'idle',
    message: 'Informe o código da proposta para iniciar a análise.',
  });
  const [analysisText, setAnalysisText] = useState('');
  const [sanitizedJson, setSanitizedJson] = useState('');
  const [showSanitized, setShowSanitized] = useState(false);
  const [lastMeta, setLastMeta] = useState<AnalyzeResponse['meta'] | null>(null);

  const canAnalyze = codProposta.trim().length > 0 && status.type !== 'loading';

  const handleAnalyze = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!codProposta.trim()) {
      setStatus({ type: 'error', message: 'Digite o código da proposta.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Consultando e analisando proposta...' });
    setAnalysisText('');
    setSanitizedJson('');
    setLastMeta(null);

    try {
      const trimmed = codProposta.trim();
      const modeQuery = showSanitized ? '?mode=sanitized' : '';
      const response = await fetch(`/api/analyze/${encodeURIComponent(trimmed)}${modeQuery}`);
      const payload = (await response.json()) as AnalyzeResponse & ErrorResponse;

      if (!response.ok) {
        const message = payload.error?.message ?? 'Erro ao executar análise.';
        const details = payload.error?.details ? ` (${payload.error.details})` : '';
        throw new Error(`${message}${details}`);
      }

      if (showSanitized) {
        setSanitizedJson(JSON.stringify(payload.sanitizedJson ?? payload, null, 2));
        setStatus({ type: 'success', message: 'JSON sanitizado pronto para inspeção.' });
      } else {
        setAnalysisText(payload.analysisText ?? 'Sem resposta disponível.');
        setStatus({ type: 'success', message: 'Análise concluída com sucesso.' });
      }

      setLastMeta(payload.meta ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro inesperado ao executar análise.';
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
          <button
            type="button"
            className="secondary"
            onClick={() => setShowSanitized((prev) => !prev)}
          >
            {showSanitized ? 'Ver análise' : 'Ver JSON sanitizado'}
          </button>
        </div>
        <small>
          {showSanitized
            ? 'Modo debug: retorna apenas JSON sanitizado, sem chamada à OpenAI.'
            : 'A análise usa OpenAI e dados sanitizados.'}
        </small>
      </form>

      <div className={statusClass}>{status.message}</div>

      {(analysisText || sanitizedJson) && (
        <section className="result">
          <div className="analysis-header">
            <div>
              <h2>{showSanitized ? 'JSON sanitizado' : 'Análise'}</h2>
              <p className="analysis-subtitle">
                {showSanitized
                  ? 'Uso interno para validação de privacidade.'
                  : 'Resumo gerado automaticamente pela OpenAI.'}
              </p>
            </div>
            {!showSanitized && (
              <div className="analysis-actions">
                <button type="button" className="secondary" onClick={handleCopy}>
                  Copiar análise
                </button>
              </div>
            )}
          </div>

          <pre className="output">{showSanitized ? sanitizedJson : analysisText}</pre>

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
