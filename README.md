# Analisador de Propostas (MVP)

MVP em React + Vite + TypeScript para analisar propostas. A aplicação consulta um backend HTTP, sanitiza dados sensíveis e envia o JSON sanitizado para a OpenAI (Responses API).

## Requisitos

- Node.js 18+ (para Vite e WebCrypto no browser)

## Instalação

```bash
npm install
```

## Configuração de variáveis locais

Crie um arquivo `.env.local` na raiz do projeto com base em `.env.example`:

```bash
cp .env.example .env.local
```

Preencha as chaves necessárias:

- `VITE_OPENAI_API_KEY`: obrigatório para a chamada à OpenAI.
- `VITE_BACKEND_TOKEN`: opcional (token Bearer enviado ao backend).
- `VITE_CRYPTO_PASSPHRASE`: recomendado se `privacy.crypto.enabled=true`.

## Configuração do pipeline

Edite `src/config/pipeline.json`:

- `backend.baseUrl`: URL do backend.
- `backend.analysisEndpoint`: endpoint com `{{proposalNumber}}`.
- `backend.authHeaderTemplate`: template opcional para Authorization (ex.: `Bearer {{token}}`).
- `privacy.allowList`: paths em dot notation, com arrays usando `[]` (ex.: `errors[].code`).
- `privacy.crypto.enabled`: habilita criptografia.
- `privacy.crypto.timeWindow`: `hour` ou `day`.
- `privacy.crypto.format`: formato do valor criptografado.
- `openai.*`: prompts e parâmetros da OpenAI.

## Executar

```bash
npm run dev
```

Acesse `http://localhost:5173`.

## Observações de CORS

Se o backend bloquear CORS, você pode:

- Configurar CORS no backend.
- Ou adicionar um proxy no Vite (ver `server.proxy` em `vite.config.ts`).

## Testes

```bash
npm run test
```
