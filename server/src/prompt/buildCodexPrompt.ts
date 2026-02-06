import type { AnalysisType } from '../analysisData';

const toCompactJson = (value: unknown) => JSON.stringify(value);

const sensibilizacaoEndpointAliases = [
  ['/api/v1/AcessoVenda', 'servico_acesso_venda'],
  ['/api/v1/Agencia', 'servico_agencia'],
  ['/api/v1/Arquivo', 'servico_arquivo'],
  ['/api/v1/AssinaturaDigital', 'servico_assinatura_digital'],
  ['/api/v1/Banco', 'servico_banco'],
  ['/api/v1/Boleto', 'servico_boleto'],
  ['/api/v1/Campanha', 'servico_campanha'],
  ['/api/v1/Cartao', 'servico_cartao'],
  ['/api/v1/Cartao/BinCartao', 'servico_bin_cartao'],
  ['/api/v1/CodigoSias', 'servico_codigo_sias'],
  ['/api/v1/Documento', 'servico_documento'],
  ['/api/v1/Dps', 'servico_dps'],
  ['/api/v1/Email', 'servico_email'],
  ['/api/v1/FuncionarioCef', 'servico_funcionario_cef'],
  ['/api/v1/Gerenciamento', 'servico_gerenciamento'],
  ['/api/v1/Instituicao', 'servico_instituicao'],
  ['/api/v1/Link', 'servico_link'],
  ['/api/v1/Log', 'servico_log'],
  ['/api/v1/Mensagem', 'servico_mensagem'],
  ['/api/v1/Mensagens', 'servico_mensagens'],
  ['/api/v1/Pais', 'servico_pais'],
  ['/api/v1/Parentesco', 'servico_parentesco'],
  ['/api/v1/Perfil', 'servico_perfil'],
  ['/api/v1/Plano', 'servico_plano'],
  ['/api/v1/Prestamista', 'servico_prestamista'],
  ['/api/v1/Produto', 'servico_produto'],
  ['/api/v1/Profissao', 'servico_profissao'],
  ['/api/v1/Proposta', 'servico_proposta='],
  ['/api/v1/Simulacao', 'servico_simulacao'],
  ['/api/v1/StatusApi', 'servico_status_api'],
  ['/api/v1/SuperExecutiva', 'servico_super_executiva'],
  ['/api/v1/SuperRegional', 'servico_super_regional'],
  ['/api/v1/Usuario', 'servico_usuario'],
  ['/api/v1/Values', 'servico_values'],
  ['/api/v2/AcessoVenda', 'servico_acesso_venda_2'],
  ['/api/v2/AssinaturaDigital', 'servico_assinatura_digital_2'],
  ['/api/v2/Auth', 'servico_auth_2'],
  ['/api/v2/Auth/AutenticarSSO', 'servico_auth_autenticar_sso'],
  ['/api/v2/Cliente', 'servico_cliente_2'],
  ['/api/v2/Pagamento', 'servico_pagamento'],
  ['/api/v2/Produto', 'servico_produto_2'],
  ['/api/v2/Rotinas', 'servico_rotinas_2'],
  ['/api/v1/AcessoVenda/Cadastrar', 'servico_cadastrar_de_acesso_venda'],
  ['/api/v1/AcessoVenda/ConsultarPorSessionId', 'servico_consultar_por_session_id_de_acesso_venda'],
  ['/api/v1/AcessoVenda/ValidarProduto', 'servico_validar_produto_de_acesso_venda'],
  ['/api/v1/Agencia', 'servico_recurso_de_agencia'],
  ['/api/v1/Arquivo/ObterArquivo', 'servico_obter_arquivo_de_arquivo'],
  ['/api/v1/Arquivo/Upload', 'servico_upload_de_arquivo'],
  ['/api/v1/AssinaturaDigital', 'servico_recurso_de_assinatura_digital'],
  ['/api/v1/AssinaturaDigital/ConsultarStatus', 'servico_consultar_status_de_assinatura_digital'],
  ['/api/v1/AssinaturaDigital/Documentos', 'servico_documentos_de_assinatura_digital'],
  ['/api/v1/AssinaturaDigital/PropostaManual', 'servico_proposta_manual_de_assinatura_digital'],
  ['/api/v1/AssinaturaDigital/VerificarAssinaturaDigital', 'servico_verificar_assinatura_digital_de_assinatura_digital'],
  ['/api/v1/AssistenciaProduto', 'servico_recurso_de_assistencia_produto'],
  ['/api/v1/Auth/Autenticar', 'servico_autenticar_de_auth'],
  ['/api/v1/AutoCompraVida/SimularProposta', 'servico_simular_proposta_de_auto_compra_vida'],
  ['/api/v1/Boleto/Consultar', 'servico_consultar_de_boleto'],
  ['/api/v1/Campanha/Cadastrar', 'servico_cadastrar_de_campanha'],
  ['/api/v1/Campanha/ObterCampanhaVenda', 'servico_obter_campanha_venda_de_campanha'],
  ['/api/v1/Cartao/BinCartao', 'servico_bin_cartao_de_cartao'],
  ['/api/v1/cartao/DetalhePagamento', 'servico_detalhe_pagamento_de_cartao'],
  ['/api/v1/Cartao/Ola', 'servico_ola_de_cartao'],
  ['/api/v1/Cliente/Validar', 'servico_validar_de_cliente'],
  ['/api/v1/ClienteSinistroGerarProtocoloSolicitacao/ConsultarBeneficiarioPep', 'servico_consultar_beneficiario_pep_de_cliente_sinistro_gerar_protocolo_solicitacao'],
  ['/api/v1/ClienteSinistroGerarProtocoloSolicitacao/Validar', 'servico_validar_de_cliente_sinistro_gerar_protocolo_solicitacao'],
  ['/api/v1/Configuracao/Servico', 'servico_de_configuracao'],
  ['/api/v1/ConsultarValoresMinimos/ConsultarValoresMinimos', 'servico_consultar_valores_minimos_de_consultar_valores_minimos'],
  ['/api/v1/ContratoVenda/consultar', 'servico_consultar_de_contrato_venda'],
  ['/api/v1/CotacaoVida/Cotacoes', 'servico_cotacoes_de_cotacao_vida'],
  ['/api/v1/Documento/Fundo', 'servico_fundo_de_documento'],
  ['/api/v1/Documento/GerarDocumento', 'servico_gerar_documento_de_documento'],
  ['/api/v1/Documento/Listar', 'servico_listar_de_documento'],
  ['/api/v1/Documento/Proposta', 'servico_proposta_de_documento'],
  ['/api/v1/Documento/Regulamento', 'servico_regulamento_de_documento'],
  ['/api/v1/Dps/VerificarExigenciaDps', 'servico_verificar_exigencia_dps_de_dps'],
  ['/api/v1/Email', 'servico_recurso_de_email'],
  ['/api/v1/Email/BoletoCheckoutVida', 'servico_boleto_checkout_vida_de_email'],
  ['/api/v1/Email/BoletoPlataformaCaixaVida', 'servico_boleto_plataforma_caixa_vida_de_email'],
  ['/api/v1/Email/FinalizacaoVendaPortalVendasProtecaoDeRenda', 'servico_finalizacao_venda_portal_vendas_protecao_de_renda_de_email'],
  ['/api/v1/Endereco/cep', 'servico_cep_de_endereco'],
  ['/api/v1/Endereco/logradouro', 'servico_logradouro_de_endereco'],
  ['/api/v1/FuncionarioCef', 'servico_recurso_de_funcionario_cef'],
  ['/api/v1/Gerenciamento/Servico', 'servico_de_gerenciamento'],
  ['/api/v1/Link/GerarLinkQrCode', 'servico_gerar_link_qr_code_de_link'],
  ['/api/v1/Link/Venda', 'servico_venda_de_link'],
  ['/api/v1/Log', 'servico_recurso_de_log'],
  ['/api/v1/Mensagem/Deletar', 'servico_deletar_de_mensagem'],
  ['/api/v1/OpenInsurance/Vida', 'servico_vida_de_open_insurance'],
  ['/api/v1/Pais/atualizar', 'servico_atualizar_de_pais'],
  ['/api/v1/Parceiros/ConsultarInstituicao', 'servico_consultar_instituicao_de_parceiros'],
  ['/api/v1/Plano/ConsultarEListarPlanoViagem', 'servico_consultar_e_listar_plano_viagem_de_plano'],
  ['/api/v1/Plano/VoucherPlanoViagem', 'servico_voucher_plano_viagem_de_plano'],
  ['/api/v1/Prestamista', 'servico_recurso_de_prestamista'],
  ['/api/v1/Prestamista/sistemaOrigem', 'servico_sistema_origem_de_prestamista'],
  ['/api/v1/Produto/EscolherPlano', 'servico_escolher_plano_de_produto'],
  ['/api/v1/Produto/ListarDiasDebitoDemaisParcelas', 'servico_listar_dias_debito_demais_parcelas_de_produto'],
  ['/api/v1/Produto/ListarProdutos', 'servico_listar_produtos_de_produto'],
  ['/api/v1/Produto/Planos', 'servico_planos_de_produto'],
  ['/api/v1/Produto/Premio', 'servico_premio_de_produto'],
  ['/api/v1/Produto/ValidarPremio', 'servico_validar_premio_de_produto'],
  ['/api/v1/Proposta', 'servico_recurso_de_proposta'],
  ['/api/v1/Proposta/Agencia', 'servico_agencia_de_proposta'],
  ['/api/v1/Proposta/ComplementoDetalheApolice', 'servico_complemento_detalhe_apolice_de_proposta'],
  ['/api/v1/Proposta/ConsultarContratosSF', 'servico_consultar_contratos_sf_de_proposta'],
  ['/api/v1/Proposta/ConsultarProposta', 'servico_consultar_proposta_de_proposta'],
  ['/api/v1/Proposta/ContaDevolucao', 'servico_conta_devolucao_de_proposta'],
  ['/api/v1/Proposta/GerarNumeroProposta', 'servico_gerar_numero_proposta_de_proposta'],
  ['/api/v1/Proposta/SuperExecutiva', 'servico_super_executiva_de_proposta'],
  ['/api/v1/RegistroVenda', 'servico_cadastro_ou_atualização_de_registro_venda'],
  ['/api/v1/RegistroVenda/AssinaturaDigital', 'servico_assinatura_digital_de_registro_venda'],
  ['/api/v1/RegistroVenda/PJ', 'servico_pj_de_registro_venda'],
  ['/api/v1/RegistroVenda/StatusProposta', 'servico_status_proposta_de_registro_venda'],
  ['/api/v1/Regra/ObterCodigo', 'servico_obter_codigo_de_regra'],
  ['/api/v1/Regulamento/GerarArquivoConsultarRegulamento', 'servico_gerar_arquivo_consultar_regulamento_de_regulamento'],
  ['/api/v1/Rotinas/AtualizacaoPropostaExpiradas', 'servico_atualizacao_proposta_expiradas_de_rotinas'],
  ['/api/v1/Rotinas/AtualizarAgencia', 'servico_atualizar_agencia_de_rotinas'],
  ['/api/v1/Rotinas/AtualizarDadosFuncionarioCef', 'servico_atualizar_dados_funcionario_cef_de_rotinas'],
  ['/api/v1/Rotinas/metricas', 'servico_metricas_de_rotinas'],
  ['/api/v1/Rotinas/Relatorio', 'servico_relatorio_de_rotinas'],
  ['/api/v1/Sap/MeiosPagamento', 'servico_meios_pagamento_de_sap'],
  ['/api/v1/Simulacao/CamposObrigatoriosContratacaoMenor', 'servico_campos_obrigatorios_contratacao_menor_de_simulacao'],
  ['/api/v1/Simulacao/CodigoSias', 'servico_codigo_sias_de_simulacao'],
  ['/api/v1/Simulacao/ConsultarFamiliaProduto', 'servico_consultar_familia_produto_de_simulacao'],
  ['/api/v1/Simulacao/ConsultarFundos', 'servico_consultar_fundos_de_simulacao'],
  ['/api/v1/Simulacao/DocumentosContratacao', 'servico_documentos_contratacao_de_simulacao'],
  ['/api/v1/Simulacao/IgualdadeCpfs', 'servico_igualdade_cpfs_de_simulacao'],
  ['/api/v1/Simulacao/LaminaPdf', 'servico_lamina_pdf_de_simulacao'],
  ['/api/v1/Simulacao/ListarAssistencias', 'servico_listar_assistencias_de_simulacao'],
  ['/api/v1/Simulacao/ListarCertificadoExistenteCpf', 'servico_listar_certificado_existente_cpf_de_simulacao'],
  ['/api/v1/Simulacao/ListarOpcoesRentabilidade', 'servico_listar_opcoes_rentabilidade_de_simulacao'],
  ['/api/v1/Simulacao/ListarResponsavelContratacao', 'servico_listar_responsavel_contratacao_de_simulacao'],
  ['/api/v1/Simulacao/MensagemFatca', 'servico_mensagem_fatca_de_simulacao'],
  ['/api/v1/Simulacao/ParamCalculoDetalhadoBeneficioFiscal', 'servico_param_calculo_detalhado_beneficio_fiscal_de_simulacao'],
  ['/api/v1/Simulacao/ParamRecuperarCamposObrigatorioPrevSocio', 'servico_param_recuperar_campos_obrigatorio_prev_socio_de_simulacao'],
  ['/api/v1/Simulacao/Peculio', 'servico_peculio_de_simulacao'],
  ['/api/v1/Simulacao/PlanoIdeal', 'servico_plano_ideal_de_simulacao'],
  ['/api/v1/Simulacao/RecebimentoBeneficiario', 'servico_recebimento_beneficiario_de_simulacao'],
  ['/api/v1/Simulacao/RecuperarBaseOrigemRecurso', 'servico_recuperar_base_origem_recurso_de_simulacao'],
  ['/api/v1/Simulacao/RecuperarCamposObrigatorioPrevSocio', 'servico_recuperar_campos_obrigatorio_prev_socio_de_simulacao'],
  ['/api/v1/Simulacao/ReservaExistente', 'servico_reserva_existente_de_simulacao'],
  ['/api/v1/Simulacao/SelecaoPlanos', 'servico_selecao_planos_de_simulacao'],
  ['/api/v1/Simulacao/SimularPensao', 'servico_simular_pensao_de_simulacao'],
  ['/api/v1/Simulacao/TipoPessoa', 'servico_tipo_pessoa_de_simulacao'],
  ['/api/v1/Simulacao/TiposPortabilidades', 'servico_tipos_portabilidades_de_simulacao'],
  ['/api/v1/Simulacao/TiposSimulacoesInformacoes', 'servico_tipos_simulacoes_informacoes_de_simulacao'],
  ['/api/v1/Simulacao/TotalAcumulado', 'servico_total_acumulado_de_simulacao'],
  ['/api/v1/Simulacao/ValidarAssistenciaMulher', 'servico_validar_assistencia_mulher_de_simulacao'],
  ['/api/v1/Simulacao/ValoresMinimos', 'servico_valores_minimos_de_simulacao'],
  ['/api/v1/Simulacao/ValoresMinimosRisco', 'servico_valores_minimos_risco_de_simulacao'],
  ['/api/v1/StatusApi/desabilitar', 'servico_desabilitar_de_status_api'],
  ['/api/v1/SuperExecutiva', 'servico_recurso_de_super_executiva'],
  ['/api/v1/Usuario', 'servico_recurso_de_usuario'],
] as const;

const pagamentoEndpointAliases = [
  ['http://servicehub.caixavidaeprevidencia.intranet/GerenciadorArquivos/api/Arquivo/Preenchido', 'servico_preenchido_de_arquivo'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Assinatura/ConsultarPropostaAssinada', 'servico_consultar_proposta_assinada_de_assinatura'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Assinatura/EnviarPropostaAssinadaManual', 'servico_enviar_proposta_assinada_manual_de_assinatura'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Assinatura/SalvarDocumentoAssinado', 'servico_salvar_documento_assinado_de_assinatura'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/Autenticar/AutenticarUsuarioAD', 'servico_autenticar_usuario_ad_de_autenticar'],
  ['http://localhost:62056/api/Autenticar/ObterTokenInfo', 'servico_obter_token_info_de_autenticar'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/Boleto/ServiceHub_GerarBoleto', 'servico_service_hub_gerar_boleto_de_boleto'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Boleto/VerificarSituacaoDeBoletos', 'servico_verificar_situacao_de_boletos_de_boleto'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/Corporativo/ConsultarCep', 'servico_consultar_cep_de_corporativo'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/Corporativo/ConsultarProcessoLgpd', 'servico_consultar_processo_lgpd_de_corporativo'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Corporativo/IncluirConsentimento', 'servico_incluir_consentimento_de_corporativo'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/Corporativo/SimularProposta', 'servico_simular_proposta_de_corporativo'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Dps/SolicitarDps', 'servico_solicitar_dps_de_dps'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Dps/VerificarExigenciaDps', 'servico_verificar_exigencia_dps_de_dps'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/GenericBackEnd/GBE_ChecarNome', 'servico_gbe_checar_nome_de_generic_back_end'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/GenericBackEnd/GBE_ConsultaDadosMinimosNBI', 'servico_gbe_consulta_dados_minimos_nbi_de_generic_back_end'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/GenericBackEnd/GBE_ConsultaDadosMinimosPEP', 'servico_gbe_consulta_dados_minimos_pep_de_generic_back_end'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/GenericBackEnd/GBE_ConsultaIS_Total', 'servico_gbe_consulta_is_total_de_generic_back_end'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/GenericBackEnd/GBE_ConsultaPEPFinal', 'servico_gbe_consulta_pep_final_de_generic_back_end'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/GenericBackEnd/GBE_ConsultarContratoCredito', 'servico_gbe_consultar_contrato_credito_de_generic_back_end'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/GenericBackEnd/GBE_ConsultarDetalhePagamento_CC', 'servico_gbe_consultar_detalhe_pagamento_cc_de_generic_back_end'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/GenericBackEnd/GBE_criaTokenEnviaSMS', 'servico_gbe_cria_token_envia_sms_de_generic_back_end'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/GenericBackEnd/GBE_DebitarOnline', 'servico_gbe_debitar_online_de_generic_back_end'],
  ['http://localhost:62056/api/GenericBackEnd/GBE_ExpurgarProgramado', 'servico_gbe_expurgar_programado_de_generic_back_end'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/GenericBackEnd/GBE_InserirPropostaDps', 'servico_gbe_inserir_proposta_dps_de_generic_back_end'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/GenericBackEnd/GBE_PreVendaSolicitacoes', 'servico_gbe_pre_venda_solicitacoes_de_generic_back_end'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/GenericBackEnd/GBE_ProxyMatrizAcessoV2', 'servico_gbe_proxy_matriz_acesso_v_2_de_generic_back_end'],
  ['http://localhost:62056/api/GenericBackEnd/GBE_ProxyMatrizAcessoV3', 'servico_gbe_proxy_matriz_acesso_v_3_de_generic_back_end'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/GenericBackEnd/GBE_RealizarPagamento_CC', 'servico_gbe_realizar_pagamento_cc_de_generic_back_end'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/GenericBackEnd/GBE_RecuperarLinkPagamento_CC', 'servico_gbe_recuperar_link_pagamento_cc_de_generic_back_end'],
  ['http://servicehub.caixavidaeprevidencia.intranet/MockService/apic/api/mock/APIC_Validar_Pre_Venda_Sucesso', 'servico_apic_validar_pre_venda_sucesso_de_mock'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/MultiFundoPrevidencia/MF_Certificados', 'servico_mf_certificados_de_multi_fundo_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/PlataformaCaixa/DebitarOnlinePlataforma', 'servico_debitar_online_plataforma_de_plataforma_caixa'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/PortalAssinaturas/ConsultarDocumentos', 'servico_consultar_documentos_de_portal_assinaturas'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/PortalAssinaturas/ObterEnderecoPorCep', 'servico_obter_endereco_por_cep_de_portal_assinaturas'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/PortalAssinaturas/SolicitarAssinatura', 'servico_solicitar_assinatura_de_portal_assinaturas'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Portalassunaturas/ConsultarStatus', 'servico_consultar_status_de_portalassunaturas'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Prestamista/Calculo', 'servico_calculo_de_prestamista'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Prestamista/CalculoPrestamistaRural', 'servico_calculo_prestamista_rural_de_prestamista'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Prestamista/DetalhesContratoCredito', 'servico_detalhes_contrato_credito_de_prestamista'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/prev-adesao/adesao/listar-regime-tributario', 'servico_listar_regime_tributario_de_adesao_de_prev_adesao_2'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/prev-adesao/adesao/ListaRecebimentoBeneficiario', 'servico_lista_recebimento_beneficiario_de_adesao_de_prev_adesao'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/prev-adesao/adesao/ListarFormasPagamento', 'servico_listar_formas_pagamento_de_adesao_de_prev_adesao'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/prev-adesao/adesao/ListarFundoDiferenciado', 'servico_listar_fundo_diferenciado_de_adesao_de_prev_adesao'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/prev-adesao/adesao/ListarRegimeTributario', 'servico_listar_regime_tributario_de_adesao_de_prev_adesao'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/prev-adesao/adesao/ObterCategoriasFundos', 'servico_obter_categorias_fundos_de_adesao_de_prev_adesao'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/prev-adesao/adesao/recuperar-mensagem-fatca', 'servico_recuperar_mensagem_fatca_de_adesao_de_prev_adesao_2'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/prev-adesao/adesao/RecuperarGravidezPremiada', 'servico_recuperar_gravidez_premiada_de_adesao_de_prev_adesao'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/prev-adesao/adesao/RecuperarMensagemComunicabilidade', 'servico_recuperar_mensagem_comunicabilidade_de_adesao_de_prev_adesao'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/prev-adesao/adesao/RecuperarMensagemFatca', 'servico_recuperar_mensagem_fatca_de_adesao_de_prev_adesao'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/prev-adesao/adesao/validar-nif', 'servico_validar_nif_de_adesao_de_prev_adesao_2'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/prev-adesao/adesao/ValidarNif', 'servico_validar_nif_de_adesao_de_prev_adesao'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/AtualizarMensagemPorCodigo', 'servico_atualizar_mensagem_por_codigo_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/BuscarDadosAporte', 'servico_buscar_dados_aporte_de_previdencia'],
  ['http://localhost:62056/api/Previdencia/CalculoDetalhadoBeneficioFiscal', 'servico_calculo_detalhado_beneficio_fiscal_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/GerarArquivoConsultarRegulamento', 'servico_gerar_arquivo_consultar_regulamento_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/Previdencia/GerarProposta', 'servico_gerar_proposta_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/ListaCertificadoExistenteCpf', 'servico_lista_certificado_existente_cpf_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/Previdencia/ListarAssistenciasKiprev', 'servico_listar_assistencias_kiprev_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/ListarCategoriasFundos', 'servico_listar_categorias_fundos_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/ListarDocumentosContratacao', 'servico_listar_documentos_contratacao_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/ListarFundosDiferenciados', 'servico_listar_fundos_diferenciados_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/ListarSeguroViagemSPBVG018', 'servico_listar_seguro_viagem_spbvg_018_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/ObterEnderecoPorCep', 'servico_obter_endereco_por_cep_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/Previdencia/ObterParametrosAutoCompra', 'servico_obter_parametros_auto_compra_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/PlanoIdeal', 'servico_plano_ideal_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/PlanoIdeal/TotalAcumulado', 'servico_total_acumulado_de_plano_ideal_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/PlanoIdealContribuicaoRecorrente', 'servico_plano_ideal_contribuicao_recorrente_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/PlanoIdealTotalAcumulado', 'servico_plano_ideal_total_acumulado_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/PortabilidadeBuscarFundosEntidadeProcesso', 'servico_portabilidade_buscar_fundos_entidade_processo_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/PortabilidadeBuscarProcessoSusep', 'servico_portabilidade_buscar_processo_susep_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/PortabilidadeListarCertificadosExistente', 'servico_portabilidade_listar_certificados_existente_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/Previdencia/PRE_RecuperarValoresMinimos', 'servico_pre_recuperar_valores_minimos_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RecuperarBaseOrigemRecursos', 'servico_recuperar_base_origem_recursos_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RecuperarCodigoSias', 'servico_recuperar_codigo_sias_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RecuperarDadosProposta', 'servico_recuperar_dados_proposta_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RecuperarDiasPagamentos', 'servico_recuperar_dias_pagamentos_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RecuperarFundos', 'servico_recuperar_fundos_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RecuperarLimiteFundos', 'servico_recuperar_limite_fundos_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RecuperarPDFMare', 'servico_recuperar_pdf_mare_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RecuperarPrazosCoberturas', 'servico_recuperar_prazos_coberturas_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RecuperarQuestionario', 'servico_recuperar_questionario_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RecuperarReservaExistente', 'servico_recuperar_reserva_existente_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RecuperarRisco', 'servico_recuperar_risco_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RecuperarTiposRenda', 'servico_recuperar_tipos_renda_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RecuperarValoresCampanhas', 'servico_recuperar_valores_campanhas_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RetornarListaPaises', 'servico_retornar_lista_paises_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/RetornarTiposDeRenda', 'servico_retornar_tipos_de_renda_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/SimulacaoPlanoIdeal', 'servico_simulacao_plano_ideal_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/Previdencia/SimularPlanoPersonalizado', 'servico_simular_plano_personalizado_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/SimularReservaAcumuladaTotal', 'servico_simular_reserva_acumulada_total_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/ValidarAssistenciaMulher', 'servico_validar_assistencia_mulher_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Previdencia/ValidarIgualdadeCpfs', 'servico_validar_igualdade_cpfs_de_previdencia'],
  ['https://integracao.caixavidaeprevidencia.intranet/api/Proposta/GetCondicoesGeraisProduto', 'servico_get_condicoes_gerais_produto_de_proposta'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Proposta/PostProposta', 'servico_post_proposta_de_proposta'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/SAPServices/SAP_ConsultarMeiosPagamento', 'servico_sap_consultar_meios_pagamento_de_sap_services'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/SAPServices/SAP_ImprimeBoletoMigracaoAPIC', 'servico_sap_imprime_boleto_migracao_apic_de_sap_services'],
  ['http://servicospv.caixavidaeprevidencia.intranet/vida/api/v1/Produto/Amparo/VerificarQuantidadePropostas', 'servico_amparo_de_produto'],
  ['http://servicospv.caixavidaeprevidencia.intranet/vida/api/v1/Produto/ListarDiferenciasPlano', 'servico_listar_diferencias_plano_de_produto'],
  ['http://servicospv.caixavidaeprevidencia.intranet/vida/api/v1/Produto/7/Planos', 'servico_planos_de_produto'],
  ['http://servicospv.caixavidaeprevidencia.intranet/Vida/api/v1/Rotinas/Sensibilizacao', 'servico_sensibilizacao_de_rotinas'],
  ['http://servicospv.caixavidaeprevidencia.intranet/vida/api/v2/Produto/ValidarPremio', 'servico_validar_premio_de_produto'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Vida/ConsultaColaborador', 'servico_consulta_colaborador_de_vida'],
  ['https://integracao.caixavidaeprevidencia.com.br/api/Vida/VD_TotalProdutosPorCPF', 'servico_vd_total_produtos_por_cpf_de_vida'],
  ['https://integracao.caixavidaeprevidencia.com.br/Autenticar/ObterTokenInfo', 'servico_obter_token_info_de_autenticar_2'],
] as const;

const sortEndpointAliasesByLength = <T extends readonly (readonly [string, string])[]>(aliases: T) => [...aliases].sort(
  ([leftEndpoint], [rightEndpoint]) => rightEndpoint.length - leftEndpoint.length,
);

const sortedSensibilizacaoEndpointAliases = sortEndpointAliasesByLength(sensibilizacaoEndpointAliases);
const sortedPagamentoEndpointAliases = sortEndpointAliasesByLength(pagamentoEndpointAliases);

const replaceEndpointsByAliasInString = (value: string, aliases: readonly (readonly [string, string])[]) => {
  let nextValue = value;

  for (const [endpoint, alias] of aliases) {
    if (!nextValue.includes(endpoint)) continue;
    nextValue = nextValue.split(endpoint).join(alias);
  }

  return nextValue;
};

const replaceEndpointsByAlias = (value: unknown, aliases: readonly (readonly [string, string])[]): unknown => {
  if (typeof value === 'string') {
    return replaceEndpointsByAliasInString(value, aliases);
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceEndpointsByAlias(item, aliases));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, replaceEndpointsByAlias(entryValue, aliases)]),
  );
};
const getContextByAnalysisType = (analysisType: AnalysisType) => {
  if (analysisType === 'sensibilizacao') {
    return 'Contexto: Quero diagnosticar erro de sensibilização (repasse CVP -> SIGPF/CAIXA) e inconsistências entre integrações e base interna.';
  }

  if (analysisType === 'pagamento') {
    return 'Contexto: Quero diagnosticar o fluxo de pagamento (boleto/link, débito, status final) e inconsistências entre etapas.';
  }

  return 'Contexto: Estou usando um app que extrai dados de proposta e quero revisar/diagnosticar inconsistências.';
};

export const buildCodexPrompt = (proposalNumber: string, sanitizedData: unknown, analysisType: AnalysisType = 'padrao') => {
  const dataForPrompt = analysisType === 'sensibilizacao'
    ? replaceEndpointsByAlias(sanitizedData, sortedSensibilizacaoEndpointAliases)
    : analysisType === 'pagamento'
      ? replaceEndpointsByAlias(sanitizedData, sortedPagamentoEndpointAliases)
      : sanitizedData;
  const compact = toCompactJson(dataForPrompt);

  return [
    getContextByAnalysisType(analysisType),
    `Tipo de análise: ${analysisType}`,
    `Proposta: ${proposalNumber}`,
    '',
    'Dados (sanitizados):',
    compact,
    '',
    'Tarefas:',
    '- Identifique inconsistências ou lacunas relevantes no fluxo da proposta.',
    '- Aponte possíveis causas técnicas em ordem de probabilidade.',
    '- Sugira um checklist objetivo de validação para confirmar a causa raiz.',
    '- Recomende próximos passos de correção e quais evidências coletar.',
  ]
    .filter(Boolean)
    .join('\n');
};
