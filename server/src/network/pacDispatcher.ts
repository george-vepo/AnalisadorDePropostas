import { setGlobalDispatcher } from 'undici';
import { PacProxyAgent } from 'pac-proxy-agent';

export function initPacProxyFromEnv() {
  const pacUrl = process.env.PROXY_PAC_URL;
  if (!pacUrl) {
    return false;
  }

  const agent = new PacProxyAgent(pacUrl);
  setGlobalDispatcher(agent as any);
  return true;
}
