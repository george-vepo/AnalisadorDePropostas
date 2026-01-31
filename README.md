# Analisador de Propostas (MVP)

Aplicação local para análise de propostas usando React + Vite no frontend e Node.js + Express no backend. O backend consulta o SQL Server com autenticação integrada do Windows e expõe um endpoint JSON para debug.

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

- `DB_SERVER`: servidor SQL (ex.: `AGSQLCVP02\\Vendas`).
- `DB_DATABASE`: base (ex.: `PVDB00`).
- `DB_TRUST_SERVER_CERT`: `true` ou `false`.
- `OPENAI_API_KEY`: chave de API da OpenAI.
- `OPENAI_CRYPTO_PASSPHRASE`: passphrase para criptografia dos campos fora da allow list.
- `DEV_ALLOW_RAW`: `true` para permitir respostas sem sanitização (opcional).
- `DEBUG_RETURN_SANITIZED`: `true` para incluir JSON sanitizado na resposta (opcional).

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

1. O frontend chama `GET /api/analyze/:codProposta`.
2. O backend consulta o SQL Server com parâmetro `@codProposta`.
3. O backend normaliza, sanitiza/criptografa e chama a OpenAI.
4. O backend retorna a análise em texto.

## Endpoints

- `GET /api/analysis/:codProposta`: retorno bruto dos dados do SQL (debug).
- `GET /api/analyze/:codProposta`: pipeline completo com OpenAI.
- `GET /api/analyze/:codProposta?mode=sanitized`: retorna JSON sanitizado sem chamar a OpenAI.

## Testes

```bash
npm run test
```
