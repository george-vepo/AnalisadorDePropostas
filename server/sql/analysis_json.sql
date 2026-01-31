-- Script Analise JSON (FOR JSON PATH)
-- Retorna 1 linha e 1 coluna ("data") com JSON único.

DECLARE @cod_proposta VARCHAR(50);
SET @cod_proposta = @codProposta;

SELECT (
  SELECT
    JSON_QUERY(
      (
        SELECT TOP (1)
          pr.COD_PROPOSTA,
          pr.COD_VENDA,
          pr.COD_PRODUTO,
          pr.DTH_VENDA,
          pr.DTH_CADASTRO,
          pr.DTH_ALTERACAO,
          pr.STA_SITUACAO,
          pr.STA_ASSINATURA,
          pr.STA_PAGO,
          pr.DTA_SENSIBILIZACAO,
          pr.DES_ERRO_SENSIBILIZACAO,
          pr.COD_SISTEMA_ORIGEM,
          pr.COD_CANAL
        FROM PV_040_PROPOSTA pr
        WHERE pr.COD_PROPOSTA = @cod_proposta
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
      )
    ) AS proposta,
    JSON_QUERY(
      (
        SELECT TOP (1)
          pr.COD_PRODUTO,
          pr.COD_VENDA
        FROM PV_040_PROPOSTA pr
        WHERE pr.COD_PROPOSTA = @cod_proposta
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
      )
    ) AS produto,
    JSON_QUERY(
      (
        SELECT TOP (1)
          pg.COD_PROPOSTA,
          pg.COD_FORMA_PAGAMENTO,
          pg.VLR_ENTRADA,
          pg.QTD_PARCELAS,
          pg.DTA_PAGAMENTO,
          pg.STA_PAGAMENTO
        FROM PV_041_PAGAMENTO pg
        WHERE pg.COD_PROPOSTA = @cod_proposta
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
      )
    ) AS pagamento,
    JSON_QUERY(
      (
        SELECT TOP (1)
          ad.COD_PROPOSTA,
          ad.STA_ADESAO,
          ad.DTH_ADESAO
        FROM PV_042_ADESAO ad
        WHERE ad.COD_PROPOSTA = @cod_proposta
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
      )
    ) AS adesao,
    JSON_QUERY(
      (
        SELECT TOP (200)
          pa.NUM_PARCELA,
          pa.DTA_VENCIMENTO,
          pa.VLR_PARCELA,
          pa.STA_PAGO
        FROM PV_043_PARCELAS pa
        WHERE pa.COD_PROPOSTA = @cod_proposta
        ORDER BY pa.NUM_PARCELA ASC
        FOR JSON PATH
      )
    ) AS demaisParcelas,
    JSON_QUERY(
      (
        SELECT TOP (200)
          asd.COD_PROPOSTA,
          asd.DTH_EVENTO,
          asd.STA_ASSINATURA,
          asd.DES_ORIGEM
        FROM PV_044_ASSINATURA_DIGITAL asd
        WHERE asd.COD_PROPOSTA = @cod_proposta
        ORDER BY asd.DTH_EVENTO DESC
        FOR JSON PATH
      )
    ) AS assinaturaDigital,
    JSON_QUERY(
      (
        SELECT TOP (200)
          it.COD_PROPOSTA,
          it.DTH_EVENTO,
          it.DES_INTEGRACAO,
          it.STA_STATUS,
          it.DES_MENSAGEM
        FROM PV_045_INTEGRACOES it
        WHERE it.COD_PROPOSTA = @cod_proposta
        ORDER BY it.DTH_EVENTO DESC
        FOR JSON PATH
      )
    ) AS integracoes,
    JSON_QUERY(
      (
        SELECT TOP (50)
          lg.DTH_ACESSO,
          lg.DES_TIPO,
          lg.DES_ORIGEM,
          lg.STA_STATUS,
          lg.DES_ERRO_TECNICO
        FROM PV_027_LOG_ACESSO lg
        WHERE lg.COD_PROPOSTA = @cod_proposta
        ORDER BY lg.DTH_ACESSO DESC
        FOR JSON PATH
      )
    ) AS logs,
    JSON_QUERY(
      (
        SELECT TOP (200)
          er.COD_ERRO,
          er.DES_ERRO,
          er.DTH_ERRO
        FROM PV_046_ERROS er
        WHERE er.COD_PROPOSTA = @cod_proposta
        ORDER BY er.DTH_ERRO DESC
        FOR JSON PATH
      )
    ) AS erros
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS data;
