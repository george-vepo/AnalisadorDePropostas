type LoggerLike = {
  info: (obj: Record<string, unknown>, msg: string) => void;
};

const sanitizeUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = '[REDACTED]';
      parsed.password = '';
    }
    return parsed.toString();
  } catch {
    return value;
  }
};

export function initPacProxyFromEnv(logger: LoggerLike) {
  const pacUrl = process.env.PAC_URL?.trim() || process.env.PROXY_PAC_URL?.trim();
  if (!pacUrl) {
    return false;
  }

  logger.info(
    { pacUrl: sanitizeUrl(pacUrl) },
    'Proxy PAC configurado por ambiente. Resolução será feita por request.',
  );
  return true;
}
