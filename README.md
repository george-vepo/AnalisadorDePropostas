# Analisador de Propostas

Aplicação para consultar dados de proposta no banco e gerar um prompt sanitizado para uso no Codex.

## Fluxo principal

1. Frontend envia `POST /api/analyze` com `{ codProposta }`.
2. Backend consulta a proposta no SQL Server.
3. Dados são sanitizados (remoção de campos sensíveis e limites básicos de tamanho).
4. Backend monta um prompt local.
5. Resposta final: `{ ok: true, proposalNumber, prompt }`.

## Execução local

```bash
npm install
npm run dev
```

Backend requer `DB_CONNECTION_STRING` em `server/.env`.

## Build e testes

```bash
npm test
npm run build
```
