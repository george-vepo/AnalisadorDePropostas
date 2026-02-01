const sensitiveKeys = ['cpf', 'cnpj', 'email', 'telefone', 'nome', 'des_json', 'des_envio', 'des_retorno'];

const shouldRedactKey = (key: string) => {
  const lower = key.toLowerCase();
  return sensitiveKeys.some((token) => lower.includes(token));
};

export const redactSensitive = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (shouldRedactKey(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSensitive(child);
      }
    }
    return result;
  }

  return value;
};
