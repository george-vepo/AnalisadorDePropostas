DECLARE @cod_propostas_csv VARCHAR(MAX) = @codPropostas;
-- ex: '8405430000074-7,8405430000088-1'
;
WITH propostas AS (
  SELECT DISTINCT LTRIM(RTRIM(value)) AS COD_PROPOSTA
  FROM STRING_SPLIT(@cod_propostas_csv, ',')
  WHERE LTRIM(RTRIM(value)) <> ''
),
b AS (
  SELECT pr.COD_PROPOSTA,
    pr.COD_VENDA,
    pr.COD_PRODUTO,
    pr.COD_CANAL,
    pr.COD_SESSAO,
    pr.DTH_VENDA,
    pr.COD_SISTEMA_ORIGEM,
    -- ✅ status (não remover)
    pr.STA_SITUACAO,
    pr.STA_ASSINATURA,
    pr.STA_PAGO,
    pg.COD_PAGTO,
    CASE
      pg.COD_TP_PAGAMENTO
      WHEN 'M' THEN 1
      WHEN 'A' THEN 2
      WHEN 'U' THEN 3
      ELSE NULL
    END AS COD_PERIODICIDADE,
    av.VLR_BASE,
    av.COD_PLANO
  FROM PV_040_PROPOSTA pr
    INNER JOIN propostas p ON p.COD_PROPOSTA = pr.COD_PROPOSTA
    LEFT JOIN PV_030_PAGAMENTO pg ON pg.COD_VENDA = pr.COD_VENDA
    LEFT JOIN PV_041_PROPOSTA_AUX_VIDA av ON av.COD_VENDA = pr.COD_VENDA
)
SELECT b.COD_PROPOSTA,
  j.ResultadoJson
FROM b
  CROSS APPLY (
    SELECT (
        SELECT -- ✅ ROOT: só o que é útil e não-PII
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
          IIF(
            EXISTS(
              SELECT 1
              FROM PV_129_PROPOSTA_AUX_SEGURO_VIAGEM sv
              WHERE sv.COD_VENDA = b.COD_VENDA
            ),
            1,
            0
          ) AS EH_SEGURO_VIAGEM,
          -- PV_052_PREMIO_PRODUTO (sem PII)
          ISNULL(
            (
              SELECT a.COD_PREMIO,
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
                AND a.COD_PRODUTO = b.COD_PRODUTO FOR JSON PATH
            ),
            '[]'
          ) AS PV_052_PREMIO_PRODUTO,
          -- PV_038_PRODUTO
          ISNULL(
            (
              SELECT p.COD_PRODUTO,
                p.NOM_PRODUTO,
                p.AREA_PRODUTO,
                p.COD_SIVPF,
                p.DTA_INICIO_VIG,
                p.DTA_FIM_VIG,
                p.STA_ATIVO
              FROM PV_038_PRODUTO p
              WHERE p.COD_PRODUTO = b.COD_PRODUTO FOR JSON PATH
            ),
            '[]'
          ) AS PV_038_PRODUTO,
          -- PV_040_PROPOSTA
          ISNULL(
            (
              SELECT pr.COD_VENDA,
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
              WHERE pr.COD_PROPOSTA = b.COD_PROPOSTA FOR JSON PATH
            ),
            '[]'
          ) AS PV_040_PROPOSTA,
          -- PV_041_PROPOSTA_AUX_VIDA
          ISNULL(
            (
              SELECT av.COD_VENDA,
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
              WHERE av.COD_VENDA = b.COD_VENDA FOR JSON PATH
            ),
            '[]'
          ) AS PV_041_PROPOSTA_AUX_VIDA,
          -- PV_083_PRODUTO_PERIOD_SENSIBILIZACAO
          ISNULL(
            (
              SELECT ps.COD_PERIOD_SENSIBILIZACAO,
                ps.COD_SENSIBILIZACAO,
                ps.COD_CANAL,
                ps.COD_PRODUTO,
                ps.COD_PERIODICIDADE,
                ps.COD_PLANO,
                ps.COD_MODALIDADE
              FROM PV_083_PRODUTO_PERIOD_SENSIBILIZACAO ps
              WHERE ps.COD_CANAL = b.COD_CANAL
                AND ps.COD_PERIODICIDADE = b.COD_PERIODICIDADE
                AND ps.COD_PRODUTO = b.COD_PRODUTO FOR JSON PATH
            ),
            '[]'
          ) AS PV_083_PRODUTO_PERIOD_SENSIBILIZACAO,
          -- PV_006_ASSINATURA_DIGITAL
          ISNULL(
            (
              SELECT ad.IND_TIPO_ASSINATURA,
                ad.STA_ASSINATURA
              FROM PV_006_ASSINATURA_DIGITAL ad
              WHERE ad.COD_VENDA = b.COD_VENDA FOR JSON PATH
            ),
            '[]'
          ) AS PV_006_ASSINATURA_DIGITAL,
          -- PESSOAS
          ISNULL(
            (
              SELECT pp.COD_PESSOA,
                pp.COD_PARENTESCO,
                (
                  SELECT COUNT(1)
                  FROM PV_010_BENEFICIARIO bf
                  WHERE bf.COD_PESSOA = pp.COD_PESSOA
                ) AS QTD_BENEFICIARIOS,
                IIF(
                  EXISTS(
                    SELECT 1
                    FROM PV_091_PESSOA_ESTRANGEIRA es
                    WHERE es.COD_PESSOA = pp.COD_PESSOA
                  ),
                  1,
                  0
                ) AS POSSUI_PESSOA_ESTRANGEIRA
              FROM PV_044_PROPOSTA_PESSOA pp
              WHERE pp.COD_VENDA = b.COD_VENDA FOR JSON PATH
            ),
            '[]'
          ) AS PESSOAS,
          -- PV_030_PAGAMENTO
          ISNULL(
            (
              SELECT pg.COD_PAGTO,
                pg.COD_VENDA,
                pg.COD_TP_PAGAMENTO
              FROM PV_030_PAGAMENTO pg
              WHERE pg.COD_VENDA = b.COD_VENDA FOR JSON PATH
            ),
            '[]'
          ) AS PV_030_PAGAMENTO,
          -- PV_001_ADESAO
          ISNULL(
            (
              SELECT ad2.COD_ADESAO,
                ad2.COD_FORMA_PAGTO,
                ad2.COD_PAGTO,
                ad2.DTA_VENC
              FROM PV_001_ADESAO ad2
              WHERE ad2.COD_PAGTO = b.COD_PAGTO FOR JSON PATH
            ),
            '[]'
          ) AS PV_001_ADESAO,
          -- PV_018_DEMAIS_PARCELAS
          ISNULL(
            (
              SELECT dp.COD_DM_PARC,
                dp.COD_FORMA_PAGTO,
                dp.COD_PAGTO,
                dp.NUM_DIA_VENC
              FROM PV_018_DEMAIS_PARCELAS dp
              WHERE dp.COD_PAGTO = b.COD_PAGTO FOR JSON PATH
            ),
            '[]'
          ) AS PV_018_DEMAIS_PARCELAS,
          -- PV_019_DEVOLUCAO
          ISNULL(
            (
              SELECT dv.COD_DEVOLUCAO,
                dv.COD_VENDA
              FROM PV_019_DEVOLUCAO dv
              WHERE dv.COD_VENDA = b.COD_VENDA FOR JSON PATH
            ),
            '[]'
          ) AS PV_019_DEVOLUCAO FOR JSON PATH,
          WITHOUT_ARRAY_WRAPPER
      ) AS ResultadoJson
  ) j;