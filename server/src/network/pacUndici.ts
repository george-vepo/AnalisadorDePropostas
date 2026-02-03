import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import { createPacResolver } from 'pac-resolver';
import { logger } from '../logger';

type PacResolver = (url: string, host: string) => string | Promise<string>;

const DIRECTIVE_SEPARATOR = ';';
const DIRECT_AGENT_TIMEOUTS = {
  connectTimeout: 10_000,
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
};

const directAgent = new Agent(DIRECT_AGENT_TIMEOUTS);
const proxyAgentCache = new Map<string, ProxyAgent>();
const resolverCache = new Map<string, Promise<PacResolver>>();

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

const stripCredentials = (hostPort: string) => {
  const atIndex = hostPort.lastIndexOf('@');
  return atIndex >= 0 ? hostPort.slice(atIndex + 1) : hostPort;
};

const sanitizeDirective = (directive: string) => {
  const trimmed = directive.trim();
  if (!trimmed) return '';
  const [typeRaw, rest] = trimmed.split(/\s+/, 2);
  const type = typeRaw?.toUpperCase() ?? '';
  if (!rest) return type;
  return `${type} ${stripCredentials(rest)}`;
};

const sanitizePacResult = (result: string) =>
  result
    .split(DIRECTIVE_SEPARATOR)
    .map(sanitizeDirective)
    .filter(Boolean)
    .join('; ');

const getPacResolver = (pacUrl: string) => {
  const cached = resolverCache.get(pacUrl);
  if (cached) return cached;

  const resolverPromise = (async () => {
    const response = await fetch(pacUrl);
    if (!response.ok) {
      throw new Error(`Falha ao baixar PAC (${response.status}).`);
    }
    const pacScript = await response.text();
    return createPacResolver(pacScript) as PacResolver;
  })();

  resolverCache.set(pacUrl, resolverPromise);
  return resolverPromise;
};

const parseDirective = (
  directive: string,
):
  | { type: 'DIRECT' }
  | { type: 'PROXY'; proxyUrl: string }
  | { type: 'UNSUPPORTED' }
  | null => {
  const trimmed = directive.trim();
  if (!trimmed) return null;

  const [typeRaw, rest] = trimmed.split(/\s+/, 2);
  const type = typeRaw?.toUpperCase();
  if (!type) return null;

  if (type === 'DIRECT') {
    return { type: 'DIRECT' };
  }

  if (type === 'PROXY' || type === 'HTTP' || type === 'HTTPS') {
    if (!rest) return null;
    const hostPort = stripCredentials(rest.trim());
    if (!hostPort) return null;
    const scheme = type === 'HTTPS' ? 'https' : 'http';
    return { type: 'PROXY', proxyUrl: `${scheme}://${hostPort}` };
  }

  return { type: 'UNSUPPORTED' };
};

const getProxyAgent = (proxyUrl: string) => {
  const cached = proxyAgentCache.get(proxyUrl);
  if (cached) return cached;
  const agent = new ProxyAgent({
    uri: proxyUrl,
    ...DIRECT_AGENT_TIMEOUTS,
  });
  proxyAgentCache.set(proxyUrl, agent);
  return agent;
};

export const resolveUndiciDispatcherFromPac = async (
  targetUrl: string,
): Promise<Dispatcher> => {
  const pacUrl = process.env.PROXY_PAC_URL?.trim();
  if (!pacUrl) {
    logger.warn(
      { targetUrl },
      'PROXY_PAC_URL não definido. Usando conexão direta.',
    );
    return directAgent;
  }

  const resolvedTarget = new URL(targetUrl);
  const resolver = await getPacResolver(pacUrl);
  const pacResult = await resolver(targetUrl, resolvedTarget.hostname);
  const pacResultValue = typeof pacResult === 'string' ? pacResult : '';
  const directives = pacResultValue
    .split(DIRECTIVE_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);

  const firstDirective = directives[0] ?? 'DIRECT';

  logger.info(
    {
      pacUrl: sanitizeUrl(pacUrl),
      hostname: resolvedTarget.hostname,
      pacResult: sanitizePacResult(pacResultValue),
      firstDirective: sanitizeDirective(firstDirective),
    },
    'PAC decision',
  );

  for (const directive of directives) {
    const parsed = parseDirective(directive);
    if (!parsed || parsed.type === 'UNSUPPORTED') continue;
    if (parsed.type === 'DIRECT') return directAgent;
    if (parsed.type === 'PROXY') return getProxyAgent(parsed.proxyUrl);
  }

  return directAgent;
};
