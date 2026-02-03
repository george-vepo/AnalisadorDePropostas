import type { Dispatcher } from 'undici';
import { setGlobalDispatcher } from 'undici';
import { PacProxyAgent } from 'pac-proxy-agent';

type LoggerLike = {
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

const isUndiciDispatcher = (candidate: unknown): candidate is Dispatcher =>
  Boolean(candidate) && typeof (candidate as Dispatcher).dispatch === 'function';

export function initPacProxyFromEnv(logger: LoggerLike) {
  const pacUrl = process.env.PROXY_PAC_URL?.trim();
  if (!pacUrl) {
    return false;
  }

  let agent: unknown;
  try {
    agent = new PacProxyAgent(pacUrl);
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error), pacUrl },
      'Falha ao criar PacProxyAgent. Proxy PAC ignorado.',
    );
    return false;
  }

  if (!isUndiciDispatcher(agent)) {
    logger.warn(
      { pacUrl },
      'PacProxyAgent não implementa Dispatcher do Undici. Proxy PAC ignorado.',
    );
    return false;
  }

  setGlobalDispatcher(agent);
  return true;
}
