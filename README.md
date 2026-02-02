# Analisador de Propostas (MVP)

Aplicação local para análise de propostas usando React + Vite no frontend e Node.js + Express no backend. O backend consulta o SQL Server com autenticação integrada do Windows e expõe endpoints de debug/diagnóstico.

## Requisitos

- Windows com **ODBC Driver para SQL Server (64-bit)** instalado.
- Node.js 18+ (recomendado Node 18 LTS).
- Acesso de rede ao SQL Server `AGSQLCVP02\Vendas`.
- (Se usar registry interno) acesso ao Azure Artifacts / VPN conforme padrão da empresa.

## Configuração do NPM / Proxy (IMPORTANTE em ambiente corporativo)

Se você estiver em VPN/rede corporativa e o `npm install` der erro tipo `ECONNRESET` (muito comum em `msnodesqlv8` por causa de download de headers/prebuild), configure o `.npmrc`.

1. Na raiz do repositório, copie o exemplo:

```bash
copy .npmrc.example .npmrc
```

2. Edite o arquivo `.npmrc` e preencha:

- `proxy` (se aplicável)
- `registry` (Azure Artifacts)
- `username/_password/email` (token do Artifacts conforme a Wiki)

> Dica: senha com caracteres especiais em proxy pode dar dor de cabeça; se rolar, use a recomendação da própria Wiki/link no `.npmrc.example`.

3. Garanta que **.npmrc não será commitado**:

- adicione `.npmrc` no `.gitignore` (se ainda não estiver).

Extras úteis (se continuar com reset/conexão instável):

- Force IPv4 primeiro (PowerShell):
  ```powershell
  $env:NODE_OPTIONS="--dns-result-order=ipv4first"
  ```
- Se sua rede faz inspeção SSL e o install falhar com erro de certificado:
  - preferível: configurar `cafile` apontando pro certificado corporativo
  - alternativa (menos ideal): `strict-ssl=false` (já vem no example)

## Instalação

Na raiz do repo:

```bash
npm install
```

Se você já tentou antes e “travou” com arquivos presos (EPERM), faça o cleanup antes:

```powershell
# PowerShell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm cache verify
npm install
```

## (Opcional) Rodar sem permissão de admin (Node portátil)

Se você não consegue instalar Node globalmente, dá para usar uma versão “portável” (zip) e ajustar o PATH só no terminal atual:

```powershell
$node18 = "$env:USERPROFILE\tools\node18"
$env:PATH = "$node18;$env:PATH"
node -v
npm -v
```

## Configuração do backend

Crie `server/.env` com base em `server/.env.example`:

```bash
cp server/.env.example server/.env
```

Preencha as variáveis:

- `DB_CONNECTION_STRING`: string de conexão ODBC do SQL Server (ex.: `Driver={ODBC Driver 17 for SQL Server};Server=AGSQLCVP02\\Vendas;Database=PVDB00;Trusted_Connection=Yes;TrustServerCertificate=Yes;`).
- `DB_TRUST_SERVER_CERT`: `true` ou `false` (se não estiver definido na connection string).
- `OPENAI_API_KEY`: chave de API da OpenAI.
- `OPENAI_CRYPTO_PASSPHRASE`: passphrase para criptografia dos campos fora da allow list (ex.: `cvp-local-dev-2026-02-02:um-segredo-bem-grande`).
- `DEV_ALLOW_RAW`: `true` para permitir respostas sem sanitização (opcional).
- `DEBUG_RETURN_SANITIZED`: `true` para incluir JSON sanitizado na resposta (opcional).
- `DEBUG_LOG_PAYLOAD`: `true` para logar payload sanitizado (redacted, opcional).
- `DEV_ALLOW_DIAG_OPENAI`: `true` para habilitar `/api/diag/openai` (opcional).
- `MAX_OPENAI_INPUT_BYTES`: limite de bytes antes de reduzir payload (default 150000).
- `OPENAI_TIMEOUT_MS`: timeout da OpenAI em ms (default 30000).
- `DB_REQUEST_TIMEOUT_MS`: timeout por query SQL em ms (default 30000).
- `DB_CONNECTION_TIMEOUT_MS`: timeout de conexão SQL em ms (default 10000).

## Scripts SQL

1. Copie o conteúdo do arquivo original `Script Analise.sql` para `server/sql/analysis.sql`.

2. Garanta que o script use parâmetro **sem concatenação de string**:

- o SQL deve referenciar `@codProposta` (ou atribuir `@cod_proposta = @codProposta`)
- o Node deve passar via `request.input('codProposta', sql.VarChar, codProposta)`

## Config do pipeline

O comportamento da sanitização/criptografia e os prompts ficam em `server/config/pipeline.json`.

Pontos que você normalmente ajusta:

- `privacy.allowList`: paths que podem ficar em claro (o resto vira `ENC[...]` ou `REDACTED`)
- `privacy.normalizer`: limites de payload (arrays, strings, depth)
- `openai.*`: modelo, temperature e prompts

## Limpeza de payload para OpenAI

Antes de enviar dados para a OpenAI, o backend aplica uma limpeza extra para reduzir payloads e remover “ruído” (tokens/JWT/base64/hex, blobs grandes e strings gigantes). A allowlist de campos permitidos fica em `server/config/allowlist-fields.json`.

Limites padrão (com override via env):

- `OPENAI_PAYLOAD_MAX_ARRAY_ITEMS` (default: 10)
- `OPENAI_PAYLOAD_MAX_STRING` (default: 500)
- `OPENAI_PAYLOAD_MAX_MESSAGE` (default: 2000)
- `OPENAI_PAYLOAD_MAX_STACKTRACE` (default: 2000)

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
- `GET /api/analyze/:codProposta?mode=dry-run`: executa SQL + sanitização sem OpenAI.
- `GET /api/config/validate`: valida `server/config/pipeline.json`.
- `GET /api/health`: healthcheck básico do backend.
- `GET /api/diag/db`: diagnóstico de conexão com SQL Server.
- `GET /api/diag/openai`: diagnóstico de OpenAI (requer `DEV_ALLOW_DIAG_OPENAI=true`).

## Teste manual (o básico pra garantir que “tá vivo”)

1. Validar config:

- abrir no navegador: `GET /api/config/validate`

2. Testar conexão com SQL:

- `GET /api/diag/db`

3. Rodar o pipeline sem custo da OpenAI (sanitização):

- `GET /api/analyze/SEU_COD?mode=sanitized`

4. Rodar o pipeline sem custo da OpenAI (SQL + sanitizer, valida tempos):

- `GET /api/analyze/SEU_COD?mode=dry-run`

5. Rodar análise completa:

- no frontend, informe o código e clique em **Analisar**
- ou direto no backend: `GET /api/analyze/SEU_COD`

## Checklist de depuração rápida

1. Validar config:
   - `GET /api/config/validate`
2. Testar conexão com SQL:
   - `GET /api/diag/db`
3. Rodar dry-run do pipeline:
   - `GET /api/analyze/:codProposta?mode=dry-run`
4. Ajustar timeouts/limites:
   - `MAX_OPENAI_INPUT_BYTES`
   - `DB_REQUEST_TIMEOUT_MS`
   - `OPENAI_TIMEOUT_MS`

## Problemas comuns

- `ECONNRESET` baixando `node-*-headers.tar.gz` (msnodesqlv8 / node-gyp):
  - quase sempre é proxy/registry. Configure `.npmrc` (seção acima)
  - tente `NODE_OPTIONS=--dns-result-order=ipv4first`

- `EPERM: operation not permitted` removendo `node_modules`:
  - feche VS Code/terminals que estejam usando arquivos
  - rode o cleanup com `Remove-Item -Recurse -Force`

- Build from source (quando não existe prebuild compatível):
  - você pode precisar de Visual Studio Build Tools + Python compatível com node-gyp
  - mas em geral, com `.npmrc` correto, o `prebuild-install` resolve sem compilar

## Testes

```bash
npm run test
```
