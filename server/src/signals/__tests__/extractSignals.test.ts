import { describe, expect, it } from 'vitest';
import { extractSignals } from '../extractSignals';

const sampleData = {
  status: 'PENDENTE_PAGAMENTO',
  assinatura: { status: 'OK' },
  pagamento: { status: 'PENDENTE' },
  integracoes: [
    { nome: 'SENSIBILIZACAO', status: 'ERRO', erroCodigo: 'E1', erroMensagem: 'Falha 123' },
    { nome: 'ANALISE', status: 'OK' },
  ],
  errors: [{ code: 'E1', message: 'Falha 123' }],
  dataCriacao: '2024-01-01T00:00:00Z',
  ultimaAtualizacao: '2024-01-02T00:00:00Z',
};

describe('extractSignals', () => {
  it('extracts status, flags, and counts', () => {
    const signals = extractSignals(sampleData, {
      enabled: true,
      includePaths: ['status', 'integracoes[].status', 'errors[].code', 'dataCriacao'],
      rules: [
        {
          id: 'assinatura-ok-pagamento-pendente',
          description: 'Assinatura aprovada com pagamento pendente.',
          when: {
            all: [
              { path: 'assinatura.status', equals: 'OK' },
              { path: 'pagamento.status', equals: 'PENDENTE' },
            ],
          },
          flag: 'assinatura_ok_pagamento_pendente',
          severity: 'P1',
        },
      ],
    });

    expect(signals.statusSummary['PENDENTE_PAGAMENTO']).toBe(1);
    expect(signals.flags.some((flag) => flag.id === 'assinatura_ok_pagamento_pendente')).toBe(true);
    expect(signals.counts.errors).toBe(2);
    expect(signals.integrations).toHaveLength(2);
    expect(signals.topErrors[0]?.code).toBe('E1');
    expect(signals.includePaths.status).toContain('PENDENTE_PAGAMENTO');
  });
});
