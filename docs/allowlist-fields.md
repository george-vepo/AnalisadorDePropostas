# Allowlist de campos sensíveis (por nome)

Este projeto usa uma **allowlist baseada somente no nome do campo** para decidir o que permanece em claro. A verificação é **case-insensitive** e ignora separadores (underscore, hífen, espaços etc.). O caminho no JSON, tabela ou objeto **não** afeta a regra.

## Normalização do nome do campo

A função `normalizeFieldName(nome)` aplica a seguinte transformação:

1. Converte para string.
2. Remove acentos (`normalize('NFD')` + remoção de diacríticos).
3. `toLowerCase()`.
4. Remove tudo que não for `[a-z0-9]`.

Exemplos:

- `"COD_PROPOSTA"` → `"codproposta"`
- `"codigoProposta"` → `"codigoproposta"`
- `"canalVenda"` → `"canalvenda"`

## Comportamento da sanitização

- **Campos na allowlist**: o valor é mantido em claro.
- **Campos fora da allowlist**: o valor é criptografado com AES-256-GCM e prefixo `ENC[v1]:`.
- **Objetos/arrays**: sempre percorridos recursivamente (não “travam” a sanitização do restante).
- **Strings com JSON** (ex.: `DES_ENVIO` e `DES_RETORNO`):
  - Se o valor começa com `{` ou `[`, o código tenta `JSON.parse`.
  - Se parsear, o conteúdo interno é sanitizado e o valor volta a ser `JSON.stringify`.
  - Se for JSON “double-escaped”, uma segunda tentativa de parse é feita.
  - Se não parsear, trata como string normal.

## Lista de campos permitidos

A lista oficial de campos está em `server/config/allowlist-fields.json`.
Qualquer campo cujo **nome normalizado** esteja nessa lista permanece em claro; os demais são protegidos.
