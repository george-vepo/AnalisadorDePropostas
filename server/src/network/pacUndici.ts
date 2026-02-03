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

const getEnvProxy = (key: string) =>
  process.env[key]?.trim() || process.env[key.toLowerCase()]?.trim() || '';

const getNoProxyList = () => {
  const raw = getEnvProxy('NO_PROXY');
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
};

const hostMatchesNoProxy = (hostname: string) => {
  const host = hostname.toLowerCase();
  const entries = getNoProxyList();
  if (entries.length === 0) return false;

  for (const entry of entries) {
    if (entry === '*') return true;
    const normalized = entry.replace(/^\./, '');
    const hostOnly = normalized.split(':')[0];
    if (!hostOnly) continue;
    if (host === hostOnly) return true;
    if (host.endsWith(`.${hostOnly}`)) return true;
  }
  return false;
};

const getFallbackProxyUrl = (target: URL) => {
  const fallback = getEnvProxy('PROXY_FALLBACK_URL');
  const httpsProxy = getEnvProxy('HTTPS_PROXY');
  const httpProxy = getEnvProxy('HTTP_PROXY');
  const schemeProxy =
    target.protocol === 'https:'
      ? httpsProxy || httpProxy
      : httpProxy || httpsProxy;

  return fallback || schemeProxy || '';
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

const normalizePac = (pacScript: string) => {
  const trimmed = pacScript.trim();
  const hasFunctionDeclaration = /function\s+FindProxyForURL\s*\(/.test(trimmed);
  const assignmentFunction = /(?:^|\s)(?:var|let|const)?\s*FindProxyForURL\s*=\s*function\s*\(/.test(
    trimmed,
  );
  const assignmentArrow = /(?:^|\s)(?:var|let|const)?\s*FindProxyForURL\s*=\s*\(?\s*[^)]*\s*\)?\s*=>/.test(
    trimmed,
  );

  if (hasFunctionDeclaration) {
    return { script: trimmed, format: 'declaration' as const };
  }

  if (assignmentFunction || assignmentArrow) {
    const rewritten = trimmed
      .replace(
        /(\b(?:var|let|const)?\s*)FindProxyForURL(\s*=\s*function\s*\()/,
        '$1__PAC_FIND_PROXY_FOR_URL__$2',
      )
      .replace(
        /(\b(?:var|let|const)?\s*)FindProxyForURL(\s*=\s*\(?\s*[^)]*\s*\)?\s*=>)/,
        '$1__PAC_FIND_PROXY_FOR_URL__$2',
      );
    const wrapper =
      '\nfunction FindProxyForURL(url, host) { return __PAC_FIND_PROXY_FOR_URL__(url, host); }\n';
    return {
      script: `${rewritten}${wrapper}`,
      format: assignmentFunction ? 'assignment-function' : 'assignment-arrow',
    };
  }

  return { script: trimmed, format: 'unknown' as const };
};

const getPacResolver = (pacUrl: string) => {
  const cached = resolverCache.get(pacUrl);
  if (cached) return cached;

  const resolverPromise = (async () => {
    const pacParsed = new URL(pacUrl);
    const fetchInit: { dispatcher?: Dispatcher } = {};
    if (
      pacParsed.hostname === '127.0.0.1' ||
      pacParsed.hostname === 'localhost' ||
      hostMatchesNoProxy(pacParsed.hostname)
    ) {
      fetchInit.dispatcher = directAgent;
    }

    const response = await fetch(pacUrl, fetchInit);
    const contentType = response.headers.get('content-type') ?? 'unknown';
    if (!response.ok) {
      throw new Error(`Falha ao baixar PAC (${response.status}).`);
    }
    const pacScript = await response.text();
    if (!pacScript || pacScript.length < 50) {
      throw new Error('PAC vazio/curto demais (conteúdo inválido).');
    }

    const { script: normalized, format } = normalizePac(pacScript);
    logger.info(
      {
        pacUrl: sanitizeUrl(pacUrl),
        status: response.status,
        contentType,
        bytes: pacScript.length,
        format,
        usesDirectForPacFetch: Boolean(fetchInit.dispatcher),
      },
      'PAC download result',
    );

    if (!/FindProxyForURL\s*\(/.test(normalized)) {
      throw new Error('Conteúdo baixado não parece PAC (não achei FindProxyForURL).');
    }

    try {
      return createPacResolver(normalized) as PacResolver;
    } catch (error) {
      logger.error(
        {
          pacUrl: sanitizeUrl(pacUrl),
          format,
          error: error instanceof Error ? error.message : String(error),
        },
        'Falha ao compilar PAC com pac-resolver.',
      );
      throw error;
    }
  })();

  resolverCache.set(pacUrl, resolverPromise);
  resolverPromise.catch(() => {
    resolverCache.delete(pacUrl);
  });
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

const getFallbackProxyAgent = (targetUrl: string) => {
  const target = new URL(targetUrl);
  if (hostMatchesNoProxy(target.hostname)) {
    logger.info(
      { targetUrl, hostname: target.hostname },
      'Target em NO_PROXY. Usando conexão direta.',
    );
    return directAgent;
  }

  const fallbackProxyUrl = getFallbackProxyUrl(target);
  if (!fallbackProxyUrl) {
    throw new Error(
      'Nenhum proxy de fallback configurado (PROXY_FALLBACK_URL/HTTPS_PROXY/HTTP_PROXY).',
    );
  }

  logger.warn(
    {
      targetUrl,
      fallbackProxy: sanitizeUrl(fallbackProxyUrl),
    },
    'Usando proxy de fallback após falha no PAC.',
  );
  return getProxyAgent(fallbackProxyUrl);
};

export const resolveUndiciDispatcherFromPac = async (
  targetUrl: string,
): Promise<Dispatcher | undefined> => {
  const pacUrl = process.env.PROXY_PAC_URL?.trim();
  if (!pacUrl) {
    logger.warn(
      { targetUrl },
      'PROXY_PAC_URL não definido. Usando dispatcher padrão do runtime.',
    );
    return undefined;
  }

  const resolvedTarget = new URL(targetUrl);
  let resolver: PacResolver;
  try {
    resolver = await getPacResolver(pacUrl);
  } catch (error) {
    logger.warn(
      {
        pacUrl: sanitizeUrl(pacUrl),
        targetUrl,
        error: error instanceof Error ? error.message : String(error),
      },
      'Falha ao obter resolver do PAC. Usando fallback.',
    );
    return getFallbackProxyAgent(targetUrl);
  }

  let pacResultValue = '';
  try {
    const pacResult = await resolver(targetUrl, resolvedTarget.hostname);
    pacResultValue = String(pacResult ?? '').trim();
  } catch (error) {
    logger.warn(
      {
        pacUrl: sanitizeUrl(pacUrl),
        targetUrl,
        error: error instanceof Error ? error.message : String(error),
      },
      'Falha ao executar PAC. Usando fallback.',
    );
    return getFallbackProxyAgent(targetUrl);
  }

  if (!pacResultValue) {
    logger.warn(
      { pacUrl: sanitizeUrl(pacUrl), targetUrl },
      'PAC retornou vazio. Usando fallback.',
    );
    return getFallbackProxyAgent(targetUrl);
  }
  const directives = pacResultValue
    .split(DIRECTIVE_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);

  const firstDirective = directives[0] ?? '';

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

  logger.warn(
    { targetUrl },
    'PAC sem diretivas úteis. Usando fallback.',
  );
  return getFallbackProxyAgent(targetUrl);
};
