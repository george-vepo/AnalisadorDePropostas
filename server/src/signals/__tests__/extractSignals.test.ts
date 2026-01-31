import { describe, expect, it } from 'vitest';
import { extractSignals } from '../extractSignals';

const jsonData = {
  proposta: {
    COD_PROPOSTA: '9063046000890-1',
    STA_SITUACAO: 'PENDENTE_PAGAMENTO',
    STA_ASSINATURA: 'OK',
    STA_PAGO: 'N',
    DTH_CADASTRO: '2024-01-01T00:00:00Z',
    DTH_ALTERACAO: '2024-01-02T00:00:00Z',
  },
  integracoes: [
    { DES_INTEGRACAO: 'SENSIBILIZACAO', STA_STATUS: 'ERRO', COD_ERRO: 'E1' },
    { DES_INTEGRACAO: 'ANALISE', STA_STATUS: 'OK' },
  ],
  erros: [{ COD_ERRO: 'E1', DES_ERRO: 'Falha contato suporte@example.com', DTH_ERRO: '2024-01-02T02:00:00Z' }],
  logs: [{ DTH_ACESSO: '2024-01-03T00:00:00Z' }],
};

const recordsetData = {
  set0: [
    {
      COD_PROPOSTA: '123',
      STA_SITUACAO: 'PENDENTE',
      STA_ASSINATURA: 'OK',
      STA_PAGO: 'N',
      DTA_CADASTRO: '2024-01-01T00:00:00Z',
      DTA_ALTERACAO: '2024-01-04T00:00:00Z',
    },
  ],
  set1: [{ COD_ERRO: 'E1', DES_ERRO: 'Falha geral', DTH_ERRO: '2024-01-02T00:00:00Z' }],
  set2: [{ DES_INTEGRACAO: 'SENSIBILIZACAO', STA_STATUS: 'ERRO', COD_ERRO: 'E1' }],
  set3: [{ DTH_ACESSO: '2024-01-03T00:00:00Z' }],
};

const config = {
  enabled: true,
  maxItemsPerArray: 10,
  includePaths: ['proposta.STA_SITUACAO', 'integracoes[].STA_STATUS'],
  rules: [
    {
      id: 'assinado-sem-pagamento',
      description: 'Assinatura aprovada com pagamento pendente.',
      when: {
        all: [
          { path: 'proposta.STA_ASSINATURA', equals: 'OK' },
          { path: 'proposta.STA_PAGO', equals: 'N' },
        ],
      },
      flag: 'ASSINADO_SEM_PAGAMENTO',
      severity: 'P1',
    },
  ],
};

describe('extractSignals', () => {
  it('extracts signals from JSON payload', () => {
    const signals = extractSignals(jsonData, config);

    expect(signals.proposal.codProposta).toBe('9063046000890-1');
    expect(signals.proposal.statusSituacao).toBe('PENDENTE_PAGAMENTO');
    expect(signals.counts.integracoesTotal).toBe(2);
    expect(signals.counts.errosTotal).toBe(1);
    expect(signals.flags).toContain('ASSINADO_SEM_PAGAMENTO');
    expect(signals.topErrors[0]?.mensagemCurta).toBe('[REMOVIDO]');
    expect(signals.safeFields['proposta.STA_SITUACAO']).toContain('PENDENTE_PAGAMENTO');
  });

  it('extracts signals from recordset payloads', () => {
    const signals = extractSignals(recordsetData, config);

    expect(signals.proposal.codProposta).toBe('123');
    expect(signals.proposal.statusSituacao).toBe('PENDENTE');
    expect(signals.counts.logsTotal).toBe(1);
    expect(signals.integrationsSummary[0]?.nome).toBe('SENSIBILIZACAO');
  });
});
