import { useMemo, useState } from 'react';

type Status = {
  type: 'idle' | 'loading' | 'success' | 'error';
  message: string;
};

type AnalyzeResponse = {
  codigoProposta: string;
  resultadoJson?: unknown;
  analise?: {
    texto?: string;
  };
  error?: {
    message?: string;
    details?: string;
  };
};

type ErrorResponse = {
  error?: {
    message?: string;
    details?: string;
  };
};

const normalizeCodPropostas = (value: string) => {
  const tokens = value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(tokens));
};

const AnalyzeProposalPage = () => {
  const [codPropostasText, setCodPropostasText] = useState('');
  const [analysisType, setAnalysisType] = useState<'padrao' | 'sensibilizacao' | 'pagamento'>('padrao');
  const [status, setStatus] = useState<Status>({
    type: 'idle',
    message: 'Informe um ou mais códigos de proposta para iniciar a análise.',
  });
  const [results, setResults] = useState<AnalyzeResponse[]>([]);

  const normalizedPropostas = useMemo(() => normalizeCodPropostas(codPropostasText), [codPropostasText]);
  const canAnalyze = normalizedPropostas.length > 0 && status.type !== 'loading';

  const handleAnalyze = async (event: React.FormEvent) => {
    event.preventDefault();

    if (normalizedPropostas.length === 0) {
      setStatus({ type: 'error', message: 'Digite ao menos um código de proposta válido.' });
      return;
    }

    setStatus({ type: 'loading', message: 'Consultando e analisando propostas...' });
    setResults([]);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codPropostas: normalizedPropostas, analysisType }),
      });
      const payload = (await response.json()) as AnalyzeResponse[] & ErrorResponse;

      if (!response.ok) {
        const message = payload.error?.message ?? 'Erro ao executar análise.';
        const details = payload.error?.details ? ` (${payload.error.details})` : '';
        throw new Error(`${message}${details}`);
      }

      setResults(Array.isArray(payload) ? payload : []);
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
        <label htmlFor="analysisType">Tipo de análise</label>
        <select
          id="analysisType"
          value={analysisType}
          onChange={(event) =>
            setAnalysisType(event.target.value as 'padrao' | 'sensibilizacao' | 'pagamento')
          }
        >
          <option value="padrao">Análise padrão</option>
          <option value="sensibilizacao">Análise de erro de sensibilização</option>
          <option value="pagamento">Análise de pagamento</option>
        </select>
        {analysisType === 'sensibilizacao' && (
          <div className="context-card">
            <p className="helper">
              Etapa essencial no processo de vendas na CVP: repasse dos contratos para o SIGPF
              (sensibilização), garantindo coerência entre o portal de vendas e o SIGPF.
            </p>
          </div>
        )}
        {analysisType === 'pagamento' && (
          <div className="context-card">
            <p className="helper">
              Esta análise valida se a geração de boletos/links e o débito do pagamento ocorreram corretamente.
            </p>
            <p className="helper">
              Tempo estimado: aproximadamente 10 minutos.
            </p>
          </div>
        )}
        <label htmlFor="codPropostas">Códigos das propostas</label>
        <textarea
          id="codPropostas"
          value={codPropostasText}
          onChange={(event) => setCodPropostasText(event.target.value)}
          placeholder="Ex.: 9063046000890-1, 8405430000088-1"
          rows={4}
        />
        {normalizedPropostas.length > 0 && (
          <p className="helper">{normalizedPropostas.length} propostas detectadas.</p>
        )}
        <div className="actions">
          <button type="submit" disabled={!canAnalyze}>
            {status.type === 'loading' ? 'Analisando...' : 'Analisar'}
          </button>
        </div>
      </form>

      <div className={statusClass}>{status.message}</div>

      {results.length > 0 && (
        <section className="result">
          <div>
            <h2>Resultados</h2>
            <p className="analysis-subtitle">Resumo gerado automaticamente pela OpenAI.</p>
          </div>
          <div className="results-list">
            {results.map((result) => (
              <article key={result.codigoProposta} className="result-item">
                <h3>Proposta {result.codigoProposta}</h3>
                {result.error ? (
                  <p className="error-message">
                    {result.error.message}
                    {result.error.details ? ` (${result.error.details})` : ''}
                  </p>
                ) : (
                  <pre className="output">{result.analise?.texto ?? 'Sem resposta disponível.'}</pre>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
};

export default AnalyzeProposalPage;
