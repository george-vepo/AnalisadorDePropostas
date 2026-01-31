# Analisador de Propostas (MVP)

Aplicação local para análise de propostas usando React + Vite no frontend e Node.js + Express no backend. O backend consulta o SQL Server com autenticação integrada do Windows, sanitiza/criptografa dados sensíveis e chama a OpenAI (Responses API).

## Requisitos

- Windows com ODBC Driver para SQL Server instalado.
- Node.js 18+.
- Acesso de rede ao SQL Server `AGSQLCVP02\\Vendas`.

## Instalação

```bash
npm install
```

## Configuração do backend

Crie `server/.env` com base em `server/.env.example`:

```bash
cp server/.env.example server/.env
```

Preencha as variáveis:

- `OPENAI_API_KEY`: chave da OpenAI.
- `OPENAI_CRYPTO_PASSPHRASE`: passphrase usada para derivação da chave AES-256-GCM.
- `DB_SERVER`: servidor SQL (ex.: `AGSQLCVP02\\Vendas`).
- `DB_DATABASE`: base (ex.: `PVDB00`).
- `DB_TRUST_SERVER_CERT`: `true` ou `false`.

## Configuração do pipeline

Edite `shared/pipeline.json` para definir:

- `privacy.allowList`: paths permitidos em texto puro (suporta arrays com `[]`).
- `privacy.crypto.enabled` e `privacy.crypto.timeWindow`.
- `openai.model`, `openai.temperature` e prompts.

## Scripts SQL

Copie o conteúdo do arquivo original `Script Analise.sql` para `server/sql/analysis.sql`.
O script deve utilizar o parâmetro `@codProposta` de forma parametrizada (sem concatenar strings).

## Executar

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

## Fluxo

1. O frontend chama `GET /api/analyze/:proposalNumber`.
2. O backend consulta o SQL Server com parâmetro `@codProposta`.
3. Os dados são normalizados, aplicam allow list e criptografia.
4. A OpenAI gera a análise.

## Testes

```bash
npm run test
```
