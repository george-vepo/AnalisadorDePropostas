import { describe, expect, it } from 'vitest';
import { matchRunbooks } from '../matchRunbooks';
import type { RunbookItem } from '../../pipeline';

const sampleData = {
  proposta: {
    STA_SITUACAO: 'PENDENTE_PAGAMENTO',
    STA_ASSINATURA: 'OK',
  },
  integracoes: [{ DES_INTEGRACAO: 'SENSIBILIZACAO', STA_STATUS: 'ERRO' }],
  logs: [{ DES_ERRO_TECNICO: 'Timeout ao integrar' }],
};

const signals = {
  flags: ['SENSIBILIZACAO_COM_ERRO'],
  proposal: {
    statusSituacao: 'PENDENTE_PAGAMENTO',
  },
};

const runbooks: RunbookItem[] = [
  {
    id: 'sensibilizacao-falha',
    when: { any: [{ path: 'integracoes[].STA_STATUS', equals: 'ERRO' }] },
    title: 'Falha na sensibilização',
    severitySuggestion: 'P1',
    steps: ['Checar fila'],
    links: ['https://runbook-interno/sensibilizacao'],
  },
  {
    id: 'status-in',
    when: { all: [{ path: 'proposta.STA_SITUACAO', in: ['PENDENTE_PAGAMENTO', 'PENDENTE'] }] },
    title: 'Pagamento pendente',
    severitySuggestion: 'P2',
    steps: ['Validar gateway'],
    links: [],
  },
  {
    id: 'flag-exists',
    when: { all: [{ path: 'signals.flags[]', equals: 'SENSIBILIZACAO_COM_ERRO' }] },
    title: 'Flag de erro de sensibilização',
    severitySuggestion: 'P2',
    steps: ['Reprocessar'],
    links: [],
  },
  {
    id: 'log-contains',
    when: { any: [{ path: 'logs[].DES_ERRO_TECNICO', contains: 'timeout' }] },
    title: 'Timeout detectado',
    severitySuggestion: 'P3',
    steps: ['Verificar latência'],
    links: [],
  },
  {
    id: 'log-exists',
    when: { all: [{ path: 'logs[].DES_ERRO_TECNICO', exists: true }] },
    title: 'Erro técnico presente',
    severitySuggestion: 'P3',
    steps: ['Analisar logs'],
    links: [],
  },
];

describe('matchRunbooks', () => {
  it('returns runbooks that match conditions', () => {
    const matched = matchRunbooks(sampleData, signals, runbooks);

    expect(matched).toHaveLength(5);
    expect(matched[0]?.id).toBe('sensibilizacao-falha');
  });
});
