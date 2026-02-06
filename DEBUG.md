# Passo a passo: rodar a aplicação via debug

Este guia explica como iniciar o backend e o frontend em modo debug no VS Code usando o arquivo `.vscode/launch.json`.

## 1) Pré-requisitos

- Node.js 18+ instalado.
- Dependências instaladas:

```bash
npm install
```

## 2) Configuração do backend

1. Crie o arquivo `server/.env` a partir do exemplo:

   ```bash
   cp server/.env.example server/.env
   ```

2. Preencha as variáveis obrigatórias (conforme `README.md`), incluindo `DB_CONNECTION_STRING`.
3. Copie os scripts SQL para `server/sql/analysis_sensibilizacao.sql` e `server/sql/analysis_pagamento.sql` conforme instruções do `README.md`.

## 3) Abrir o projeto no VS Code

1. Abra a pasta do projeto no VS Code.
2. Vá até **Run and Debug** (`Ctrl+Shift+D`).

## 4) Rodar em modo debug

1. No seletor de configuração, escolha **Full Stack (Vite + API)**.
2. Clique em **Start Debugging** (`F5`).

O VS Code irá:

- Subir o backend via `npm run dev:server`.
- Subir o frontend via `npm run dev:web`.
- Abrir o Chrome com o debug apontando para `http://localhost:5173`.

## 5) Dicas rápidas

- **Backend**: coloque breakpoints no `server/src`.
- **Frontend**: coloque breakpoints nos componentes em `src/`.
- **URLs úteis**:
  - Frontend: `http://localhost:5173`
  - Backend: `http://localhost:3001`

## 6) Parar o debug

Use o botão **Stop** no VS Code para encerrar todas as sessões.
