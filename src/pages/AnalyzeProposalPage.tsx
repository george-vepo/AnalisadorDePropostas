import { useMemo, useState } from 'react';

type Status = {
  type: 'idle' | 'loading' | 'success' | 'error';
  message: string;
};

type AnalysisResponse = {
  codProposta: string;
  meta: {
    setsCount: number;
    rowsBySet: number[];
    elapsedMs: number;
  };
  data: Record<string, unknown>;
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
    message: 'Informe o código da proposta para consultar a análise SQL.',
  });
  const [responseJson, setResponseJson] = useState('');

  const canAnalyze = codProposta.trim().length > 0 && status.type !== 'loading';

  const handleAnalyze = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!codProposta.trim()) {
      setStatus({ type: 'error', message: 'Digite o código da proposta.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Executando análise no SQL Server...' });
    setResponseJson('');

    try {
      const trimmed = codProposta.trim();
      const response = await fetch(`/api/analysis/${encodeURIComponent(trimmed)}`);
      const payload = (await response.json()) as AnalysisResponse & ErrorResponse;

      if (!response.ok) {
        const message = payload.error?.message ?? 'Erro ao executar análise.';
        const details = payload.error?.details ? ` (${payload.error.details})` : '';
        throw new Error(`${message}${details}`);
      }

      setResponseJson(JSON.stringify(payload, null, 2));
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
            {status.type === 'loading' ? 'Buscando...' : 'Buscar análise (debug)'}
          </button>
        </div>
        <small>O retorno é exibido em JSON apenas para fins de debug.</small>
      </form>

      <div className={statusClass}>{status.message}</div>

      {responseJson && (
        <section>
          <h2>Resposta</h2>
          <pre className="output">{responseJson}</pre>
        </section>
      )}
    </main>
  );
};

export default AnalyzeProposalPage;
