import { describe, expect, it } from 'vitest';
import { matchRunbooks } from '../matchRunbooks';
import type { RunbookItem } from '../../pipeline';

const sampleData = {
  status: 'PENDENTE_PAGAMENTO',
  integracoes: [{ nome: 'SENSIBILIZACAO', status: 'ERRO' }],
};

const runbooks: RunbookItem[] = [
  {
    id: 'sensibilizacao-falha',
    when: { any: [{ path: 'integracoes[].status', equals: 'ERRO' }] },
    title: 'Falha na sensibilização',
    severitySuggestion: 'P1',
    steps: ['Checar fila'],
    links: ['https://runbook-interno/sensibilizacao'],
  },
  {
    id: 'pagamento-ok',
    when: { all: [{ path: 'status', equals: 'OK' }] },
    title: 'Pagamento ok',
    severitySuggestion: 'P3',
    steps: ['Sem ação'],
    links: [],
  },
];

describe('matchRunbooks', () => {
  it('returns runbooks that match conditions', () => {
    const matched = matchRunbooks(sampleData, {}, runbooks);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.id).toBe('sensibilizacao-falha');
  });
});
