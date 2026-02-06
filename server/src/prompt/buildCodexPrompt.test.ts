import { describe, expect, it } from 'vitest';
import { buildCodexPrompt } from './buildCodexPrompt';

describe('buildCodexPrompt', () => {
  it('replaces endpoint URL by alias in sensibilizacao payload before returning prompt', () => {
    const prompt = buildCodexPrompt(
      '123',
      {
        urlServico: '/api/v1/Proposta/ConsultarProposta?proposta=123',
        nested: [
          '/api/v1/Produto/ListarProdutos',
          '/api/v1/Rotinas/Relatorio',
          '/api/v1/RegistroVenda',
          '/api/v1/Cartao',
          '/api/v2/Pagamento',
        ],
      },
      'sensibilizacao',
    );

    expect(prompt).toContain('servico_consultar_proposta_de_proposta?proposta=123');
    expect(prompt).toContain('servico_listar_produtos_de_produto');
    expect(prompt).toContain('servico_relatorio_de_rotinas');
    expect(prompt).toContain('servico_cadastro_ou_atualização_de_registro_venda');
    expect(prompt).toContain('servico_cartao');
    expect(prompt).toContain('servico_pagamento');
    expect(prompt).not.toContain('/api/v1/Proposta/ConsultarProposta');
  });

  it('replaces endpoint URL by alias in pagamento payload before returning prompt', () => {
    const prompt = buildCodexPrompt(
      '123',
      {
        urlServico: 'https://integracao.caixavidaeprevidencia.com.br/api/PortalAssinaturas/SolicitarAssinatura?proposta=123',
        nested: [
          'https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/PlanoIdeal',
          'https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/PlanoIdeal/TotalAcumulado',
        ],
      },
      'pagamento',
    );

    expect(prompt).toContain('servico_solicitar_assinatura_de_portal_assinaturas?proposta=123');
    expect(prompt).toContain('servico_plano_ideal_de_previdencia');
    expect(prompt).toContain('servico_total_acumulado_de_plano_ideal_de_previdencia');
    expect(prompt).not.toContain('https://integracao.caixavidaeprevidencia.com.br/api/PortalAssinaturas/SolicitarAssinatura');
  });

  it('includes pagamento context', () => {
    const prompt = buildCodexPrompt('123', { ok: true }, 'pagamento');
    expect(prompt).toContain('fluxo de pagamento');
    expect(prompt).toContain('Tipo de análise: pagamento');
  });

  it('does not truncate or show omission warning for large payloads', () => {
    const bigValue = 'x'.repeat(6000);
    const payload = { detalhe: bigValue };
    const prompt = buildCodexPrompt('123', payload, 'sensibilizacao');

    expect(prompt).toContain(JSON.stringify(payload));
    expect(prompt).not.toContain('Aviso: dados completos omitidos por limite de tamanho.');
  });
});
