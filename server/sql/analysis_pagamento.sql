DECLARE @cod_propostas_csv VARCHAR(MAX) = @codPropostas; 
-- ex: '8405430000074-7,8405430000088-1';

WITH propostas AS (
  SELECT DISTINCT TRIM(value) AS COD_PROPOSTA
  FROM STRING_SPLIT(@cod_propostas_csv, ',')
  WHERE TRIM(value) <> ''
),
base AS (
  SELECT
    pr.COD_PROPOSTA,
    pr.COD_VENDA,
    pr.COD_PRODUTO,
    pr.COD_CANAL,
    pr.COD_SESSAO,
    pr.DTH_VENDA,
    pr.COD_SISTEMA_ORIGEM,
    pr.STA_SITUACAO,
    pr.STA_ASSINATURA,
    pr.STA_PAGO,
    REPLACE(pr.COD_PROPOSTA, '-', '') AS COD_PROPOSTA_NUM
  FROM PV_040_PROPOSTA pr
  INNER JOIN propostas p ON p.COD_PROPOSTA = pr.COD_PROPOSTA
),
b AS (
  SELECT
    base.*,
    pg1.COD_PAGTO,
    CASE pg1.COD_TP_PAGAMENTO
      WHEN 'M' THEN 1
      WHEN 'A' THEN 2
      WHEN 'U' THEN 3
      ELSE NULL
    END AS COD_PERIODICIDADE,
    av1.VLR_BASE,
    av1.COD_PLANO
  FROM base
  OUTER APPLY (
    -- evita multiplicar linha se tiver mais de um pagamento
    SELECT TOP (1)
      pg.COD_PAGTO,
      pg.COD_TP_PAGAMENTO
    FROM PV_030_PAGAMENTO pg
    WHERE pg.COD_VENDA = base.COD_VENDA
    ORDER BY pg.COD_PAGTO DESC
  ) pg1
  OUTER APPLY (
    -- idem pra AUX_VIDA se existir mais de um registro
    SELECT TOP (1)
      av.COD_PLANO,
      av.VLR_BASE
    FROM PV_041_PROPOSTA_AUX_VIDA av
    WHERE av.COD_VENDA = base.COD_VENDA
    ORDER BY av.COD_VENDA
  ) av1
)
SELECT
  b.COD_PROPOSTA,
  (
    SELECT
      -- ✅ ROOT
      b.COD_PROPOSTA,
      b.COD_VENDA,
      b.COD_PRODUTO,
      b.COD_CANAL,
      b.COD_PERIODICIDADE,
      b.VLR_BASE,
      b.COD_PLANO,
      b.COD_SESSAO,
      b.DTH_VENDA,
      b.COD_SISTEMA_ORIGEM,

      -- ✅ status no root (não remover)
      b.STA_SITUACAO,
      b.STA_ASSINATURA,
      b.STA_PAGO,

      CASE WHEN sv.tem IS NULL THEN 0 ELSE 1 END AS EH_SEGURO_VIAGEM,

      -- Blocos JSON (evita NULL e evita “double-encoding”)
      JSON_QUERY(COALESCE(premio.json, '[]'))      AS PV_052_PREMIO_PRODUTO,
      JSON_QUERY(COALESCE(produto.json, '[]'))     AS PV_038_PRODUTO,
      JSON_QUERY(COALESCE(proposta.json, '[]'))    AS PV_040_PROPOSTA,
      JSON_QUERY(COALESCE(auxvida.json, '[]'))     AS PV_041_PROPOSTA_AUX_VIDA,
      JSON_QUERY(COALESCE(sens.json, '[]'))        AS PV_083_PRODUTO_PERIOD_SENSIBILIZACAO,
      JSON_QUERY(COALESCE(assdig.json, '[]'))      AS PV_006_ASSINATURA_DIGITAL,
      JSON_QUERY(COALESCE(pessoas.json, '[]'))     AS PESSOAS,
      JSON_QUERY(COALESCE(pagamentos.json, '[]'))  AS PV_030_PAGAMENTO,
      JSON_QUERY(COALESCE(adesao.json, '[]'))      AS PV_001_ADESAO,
      JSON_QUERY(COALESCE(demaisparc.json, '[]'))  AS PV_018_DEMAIS_PARCELAS,
      JSON_QUERY(COALESCE(devolucao.json, '[]'))   AS PV_019_DEVOLUCAO,
      JSON_QUERY(COALESCE(logrest.json, '[]'))     AS PV_082_LOG_SERVICO_REST_EXTERNO

    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  ) AS ResultadoJson
FROM b

OUTER APPLY (
  SELECT TOP (1) 1 AS tem
  FROM PV_129_PROPOSTA_AUX_SEGURO_VIAGEM sv
  WHERE sv.COD_VENDA = b.COD_VENDA
) sv

OUTER APPLY (
  SELECT (
    SELECT
      a.COD_PREMIO,
      a.COD_PRODUTO,
      a.COD_PERIODICIDADE,
      a.COD_PLANO,
      a.COD_OPCAO,
      a.VLR_IMP_SEGURADA,
      a.NUM_IDADE_MIN,
      a.NUM_IDADE_MAX,
      a.VLR_PREMIO,
      a.STA_CONJUGE,
      a.DTA_INICIO_VIG,
      a.DTA_FIM_VIG,
      a.STA_ATIVO,
      a.VALOR_SELECIONADO,
      a.QUANTIDADE_PARCELA
    FROM PV_052_PREMIO_PRODUTO a
    WHERE a.VLR_PREMIO = b.VLR_BASE
      AND a.COD_PRODUTO = b.COD_PRODUTO
    FOR JSON PATH
  ) AS json
) premio

OUTER APPLY (
  SELECT (
    SELECT
      p.COD_PRODUTO,
      p.NOM_PRODUTO,
      p.AREA_PRODUTO,
      p.COD_SIVPF,
      p.DTA_INICIO_VIG,
      p.DTA_FIM_VIG,
      p.STA_ATIVO
    FROM PV_038_PRODUTO p
    WHERE p.COD_PRODUTO = b.COD_PRODUTO
    FOR JSON PATH
  ) AS json
) produto

OUTER APPLY (
  SELECT (
    SELECT
      pr.COD_VENDA,
      pr.COD_CANAL,
      pr.COD_PRODUTO,
      pr.COD_PROPOSTA,
      pr.DTH_VENDA,
      pr.STA_SITUACAO,
      pr.STA_ASSINATURA,
      pr.STA_PAGO,
      pr.COD_SESSAO,
      pr.COD_SUB_CANAL,
      pr.COD_SISTEMA_ORIGEM,
      pr.COD_PRODUTO_LEGADO,
      pr.COD_ORIGEM_VENDA,
      pr.DES_JUST_CANC
    FROM PV_040_PROPOSTA pr
    WHERE pr.COD_PROPOSTA = b.COD_PROPOSTA
    FOR JSON PATH
  ) AS json
) proposta

OUTER APPLY (
  SELECT (
    SELECT
      av.COD_VENDA,
      av.COD_PLANO,
      av.COD_CARTEIRA,
      av.IND_COBERTURA,
      av.IND_CONJ,
      av.VLR_COBERTURA,
      av.VLR_BASE,
      av.DES_MATRIZ,
      av.PCT_MATRIZ,
      av.VLR_VENDA,
      av.NUM_PARCELAS,
      av.VLR_PARCELA,
      av.STA_HAB
    FROM PV_041_PROPOSTA_AUX_VIDA av
    WHERE av.COD_VENDA = b.COD_VENDA
    FOR JSON PATH
  ) AS json
) auxvida

OUTER APPLY (
  SELECT (
    SELECT
      ps.COD_PERIOD_SENSIBILIZACAO,
      ps.COD_SENSIBILIZACAO,
      ps.COD_CANAL,
      ps.COD_PRODUTO,
      ps.COD_PERIODICIDADE,
      ps.COD_PLANO,
      ps.COD_MODALIDADE
    FROM PV_083_PRODUTO_PERIOD_SENSIBILIZACAO ps
    WHERE ps.COD_CANAL = b.COD_CANAL
      AND ps.COD_PERIODICIDADE = b.COD_PERIODICIDADE
      AND ps.COD_PRODUTO = b.COD_PRODUTO
    FOR JSON PATH
  ) AS json
) sens

OUTER APPLY (
  SELECT (
    SELECT
      ad.IND_TIPO_ASSINATURA,
      ad.STA_ASSINATURA
    FROM PV_006_ASSINATURA_DIGITAL ad
    WHERE ad.COD_VENDA = b.COD_VENDA
    FOR JSON PATH
  ) AS json
) assdig

OUTER APPLY (
  SELECT (
    SELECT
      pp.COD_PESSOA,
      pp.COD_PARENTESCO,
      (SELECT COUNT(1) FROM PV_010_BENEFICIARIO bf WHERE bf.COD_PESSOA = pp.COD_PESSOA) AS QTD_BENEFICIARIOS,
      CASE WHEN EXISTS (SELECT 1 FROM PV_091_PESSOA_ESTRANGEIRA es WHERE es.COD_PESSOA = pp.COD_PESSOA)
           THEN 1 ELSE 0 END AS POSSUI_PESSOA_ESTRANGEIRA
    FROM PV_044_PROPOSTA_PESSOA pp
    WHERE pp.COD_VENDA = b.COD_VENDA
    FOR JSON PATH
  ) AS json
) pessoas

OUTER APPLY (
  SELECT (
    SELECT
      pg.COD_PAGTO,
      pg.COD_VENDA,
      pg.COD_TP_PAGAMENTO
    FROM PV_030_PAGAMENTO pg
    WHERE pg.COD_VENDA = b.COD_VENDA
    FOR JSON PATH
  ) AS json
) pagamentos

OUTER APPLY (
  SELECT (
    SELECT
      ad2.COD_ADESAO,
      ad2.COD_FORMA_PAGTO,
      ad2.COD_PAGTO,
      ad2.DTA_VENC
    FROM PV_001_ADESAO ad2
    WHERE ad2.COD_PAGTO = b.COD_PAGTO
    FOR JSON PATH
  ) AS json
) adesao

OUTER APPLY (
  SELECT (
    SELECT
      dp.COD_DM_PARC,
      dp.COD_FORMA_PAGTO,
      dp.COD_PAGTO,
      dp.NUM_DIA_VENC
    FROM PV_018_DEMAIS_PARCELAS dp
    WHERE dp.COD_PAGTO = b.COD_PAGTO
    FOR JSON PATH
  ) AS json
) demaisparc

OUTER APPLY (
  SELECT (
    SELECT
      dv.COD_DEVOLUCAO,
      dv.COD_VENDA
    FROM PV_019_DEVOLUCAO dv
    WHERE dv.COD_VENDA = b.COD_VENDA
    FOR JSON PATH
  ) AS json
) devolucao

OUTER APPLY (
  SELECT (
    SELECT
      lsre.COD_HTTP_CHAMADA,
      lsre.DES_ENVIO,
      lsre.DES_RETORNO,
      lsre.URL_SERVICO
    FROM PV_082_LOG_SERVICO_REST_EXTERNO lsre WITH (NOLOCK)
    WHERE
      lsre.DES_ENVIO IS NOT NULL
      AND lsre.DES_ENVIO <> ''   
      AND lsre.URL_SERVICO IN (
        'https://integracao.caixavidaeprevidencia.com.br/api/Boleto/ServiceHub_GerarBoleto',
        'https://integracao.caixavidaeprevidencia.com.br/api/GenericBackEnd/GBE_DebitarOnline',
        'https://integracao.caixavidaeprevidencia.com.br/api/GenericBackEnd/GBE_GerarLink_CC',
        'https://integracao.caixavidaeprevidencia.com.br/api/GenericBackEnd/GBE_ConsultarDetalhePagamento_CC',
        'https://integracao.caixavidaeprevidencia.com.br/api/PlataformaCaixa/DebitarOnlinePlataforma',
        'https://integracao.caixavidaeprevidencia.com.br/api/GenericBackEnd/GBE_RealizarPagamento_CC'
      )
      AND COALESCE(
        JSON_VALUE(lsre.DES_ENVIO, '$.Boleto.NumeroProposta'),
        JSON_VALUE(lsre.DES_ENVIO, '$.numProposta'),
        JSON_VALUE(lsre.DES_ENVIO, '$.orderNumber')
      ) = b.COD_PROPOSTA_NUM
    FOR JSON PATH
  ) AS json
) logrest;
