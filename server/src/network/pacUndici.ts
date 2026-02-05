import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import { createPacResolver } from 'pac-resolver';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { logger } from '../logger';
import { resolvePacUrlForRequest } from './pacWindows';

type PacResolver = (url: string, host: string) => string | Promise<string>;

type PacRuntime = {
  pacUrl: string;
  resolver: PacResolver;
  engine: 'pac-resolver' | 'vm';
  hash: string;
};

const DIRECTIVE_SEPARATOR = ';';
const DIRECT_AGENT_TIMEOUTS = {
  connectTimeout: 10_000,
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
};
const PAC_VM_TIMEOUT_MS = 250;
const PAC_EXEC_TIMEOUT_MS = 250;
const PAC_DECISION_TTL_MS = Number(process.env.PAC_DECISION_CACHE_MS ?? 180_000);
const PAC_TIMEOUT_MS = Number(process.env.PAC_TIMEOUT_MS ?? 4_000);

const directAgent = new Agent(DIRECT_AGENT_TIMEOUTS);
const proxyAgentCache = new Map<string, ProxyAgent>();
const runtimeCache = new Map<string, Promise<PacRuntime>>();
const hostDecisionCache = new Map<string, { dispatcher: Dispatcher; expiresAt: number; summary: string }>();

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
  const fallback = getEnvProxy('FALLBACK_PROXY_URL') || getEnvProxy('PROXY_FALLBACK_URL');
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

const stripPacComments = (pacScript: string) =>
  pacScript
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n\r]*/g, '');

const detectPacFormat = (pacScript: string) => {
  const trimmed = stripPacComments(pacScript.trim());
  const hasFunctionDeclaration = /function\s+FindProxyForURL\s*\(/.test(trimmed);
  const assignmentFunction = /(?:^|\s)(?:var|let|const)?\s*FindProxyForURL\s*=\s*function\s*\(/.test(
    trimmed,
  );
  const assignmentArrow = /(?:^|\s)(?:var|let|const)?\s*FindProxyForURL\s*=\s*\(?\s*[^)]*\s*\)?\s*=>/.test(
    trimmed,
  );

  if (hasFunctionDeclaration) {
    return { hasFindProxyForURL: true, format: 'declaration' as const };
  }
  if (assignmentFunction) {
    return { hasFindProxyForURL: true, format: 'assignment-function' as const };
  }
  if (assignmentArrow) {
    return { hasFindProxyForURL: true, format: 'assignment-arrow' as const };
  }
  return { hasFindProxyForURL: false, format: 'missing' as const };
};

const normalizePac = (pacScript: string) => {
  const trimmed = pacScript.trim();
  const { format } = detectPacFormat(trimmed);

  if (format === 'declaration') {
    return { script: trimmed, format: 'declaration' as const };
  }

  if (format === 'assignment-function' || format === 'assignment-arrow') {
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
      format,
    };
  }

  return { script: trimmed, format: 'unknown' as const };
};

const hashPacScript = (pacScript: string) =>
  crypto.createHash('sha256').update(pacScript).digest('hex');

const getErrorSummary = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const toIpInt = (ip: string) => {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
};

const createPacHelpers = () => ({
  isPlainHostName: (host: string) => !host.includes('.'),
  dnsDomainIs: (host: string, domain: string) => host.endsWith(domain),
  localHostOrDomainIs: (host: string, hostDom: string) =>
    host === hostDom || host === hostDom.split('.')[0],
  dnsDomainLevels: (host: string) => host.split('.').length - 1,
  shExpMatch: (str: string, shexp: string) => {
    const escaped = shexp.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`, 'i');
    return regex.test(str);
  },
  dnsResolve: (host: string) => (toIpInt(host) === null ? '' : host),
  myIpAddress: () => '127.0.0.1',
  isInNet: (ipAddr: string, pattern: string, mask: string) => {
    const ip = toIpInt(ipAddr);
    const pat = toIpInt(pattern);
    const maskInt = toIpInt(mask);
    if (ip === null || pat === null || maskInt === null) return false;
    return (ip & maskInt) === (pat & maskInt);
  },
});

const createVmPacResolver = (pacScript: string): PacResolver => {
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });

  Object.assign(context, createPacHelpers());
  const script = new vm.Script(pacScript, { filename: 'proxy.pac' });
  script.runInContext(context, { timeout: PAC_VM_TIMEOUT_MS });

  if (typeof (context as { FindProxyForURL?: unknown }).FindProxyForURL !== 'function') {
    throw new Error('PAC não define FindProxyForURL após execução.');
  }

  return async (url: string, host: string) => {
    (context as { __url?: string }).__url = url;
    (context as { __host?: string }).__host = host;
    return vm.runInContext('FindProxyForURL(__url, __host)', context, {
      timeout: PAC_EXEC_TIMEOUT_MS,
    }) as string;
  };
};

const createPacResolverFromScript = (pacScript: string, format: string) => {
  try {
    return { resolver: createPacResolver(pacScript) as PacResolver, engine: 'pac-resolver' as const };
  } catch (error) {
    logger.warn(
      { error: getErrorSummary(error), format },
      'Falha ao compilar PAC com pac-resolver. Tentando VM.',
    );
  }
  return { resolver: createVmPacResolver(pacScript), engine: 'vm' as const };
};

const abortSignal = (timeoutMs: number) => {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
};

const isPacContentInvalid = (pacScript: string, contentType: string) => {
  const normalizedContentType = contentType.toLowerCase();
  const trimmed = pacScript.trim();
  if (!trimmed) return true;
  if (normalizedContentType.includes('text/html')) return true;
  if (trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html')) return true;
  return false;
};

const getPacRuntime = (pacUrl: string) => {
  const cached = runtimeCache.get(pacUrl);
  if (cached) return cached;

  const resolverPromise = (async () => {
    const startedAt = Date.now();
    const response = await fetch(pacUrl, {
      signal: abortSignal(Number.isFinite(PAC_TIMEOUT_MS) ? PAC_TIMEOUT_MS : 4_000),
    });
    const contentType = response.headers.get('content-type') ?? 'unknown';
    if (!response.ok) {
      throw new Error(`Falha ao baixar PAC (${response.status}).`);
    }
    const pacScript = await response.text();
    if (typeof pacScript !== 'string') {
      throw new Error('PAC inválido: conteúdo não textual.');
    }
    if (isPacContentInvalid(pacScript, contentType)) {
      throw new Error('PAC inválido: vazio ou HTML de erro.');
    }

    const { script: normalized, format } = normalizePac(pacScript);
    const { hasFindProxyForURL, format: detectedFormat } = detectPacFormat(pacScript);
    if (!hasFindProxyForURL) {
      throw new Error('Conteúdo baixado não parece PAC (FindProxyForURL ausente).');
    }

    const compileStartAt = Date.now();
    const { resolver, engine } = createPacResolverFromScript(normalized, format);
    const hash = hashPacScript(pacScript);

    logger.info(
      {
        pacUrl: sanitizeUrl(pacUrl),
        status: response.status,
        contentType,
        bytes: pacScript.length,
        format: detectedFormat,
        normalizedFormat: format,
        hasFindProxyForURL,
        hash,
        downloadMs: compileStartAt - startedAt,
        compileMs: Date.now() - compileStartAt,
        totalMs: Date.now() - startedAt,
        engine,
      },
      'PAC carregado e compilado.',
    );

    return { pacUrl, resolver, engine, hash };
  })();

  runtimeCache.set(pacUrl, resolverPromise);
  resolverPromise.catch(() => {
    runtimeCache.delete(pacUrl);
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

  if (type === 'SOCKS' || type === 'SOCKS5') {
    if (!rest) return null;
    const hostPort = stripCredentials(rest.trim());
    if (!hostPort) return null;
    return { type: 'PROXY', proxyUrl: `socks://${hostPort}` };
  }

  return { type: 'UNSUPPORTED' };
};

const withProxyCredentials = (proxyUrl: string) => {
  const username = getEnvProxy('PROXY_USER');
  const password = getEnvProxy('PROXY_PASS');
  if (!username) return proxyUrl;
  try {
    const parsed = new URL(proxyUrl);
    if (!parsed.username) {
      parsed.username = username;
      if (password) parsed.password = password;
    }
    return parsed.toString();
  } catch {
    return proxyUrl;
  }
};

const getProxyAgent = (proxyUrl: string) => {
  const proxyWithAuth = withProxyCredentials(proxyUrl);
  const cached = proxyAgentCache.get(proxyWithAuth);
  if (cached) return cached;
  const agent = new ProxyAgent({
    uri: proxyWithAuth,
    ...DIRECT_AGENT_TIMEOUTS,
  });
  proxyAgentCache.set(proxyWithAuth, agent);
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
    logger.warn(
      { targetUrl },
      'Nenhum proxy de fallback configurado. Usando conexão direta.',
    );
    return directAgent;
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

const getDecisionCacheKey = (pacUrl: string, target: URL) => `${pacUrl}::${target.protocol}//${target.hostname}`;

export const resolveDispatcherForUrl = async (
  targetUrl: string,
): Promise<Dispatcher> => {
  const resolvedTarget = new URL(targetUrl);

  if (hostMatchesNoProxy(resolvedTarget.hostname)) {
    logger.info(
      { targetUrl, hostname: resolvedTarget.hostname },
      'Target em NO_PROXY. Ignorando PAC.',
    );
    return directAgent;
  }

  const pacUrl = await resolvePacUrlForRequest(`request:${resolvedTarget.hostname}`);
  if (!pacUrl) {
    logger.warn({ targetUrl }, 'PAC URL ausente. Aplicando fallback.');
    return getFallbackProxyAgent(targetUrl);
  }

  const cacheKey = getDecisionCacheKey(pacUrl, resolvedTarget);
  const cachedDecision = hostDecisionCache.get(cacheKey);
  if (cachedDecision && cachedDecision.expiresAt > Date.now()) {
    logger.info(
      { pacUrl: sanitizeUrl(pacUrl), hostname: resolvedTarget.hostname, decision: cachedDecision.summary, cacheHit: true },
      'PAC decision cache hit.',
    );
    return cachedDecision.dispatcher;
  }

  let runtime: PacRuntime;
  try {
    runtime = await getPacRuntime(pacUrl);
  } catch (error) {
    logger.warn(
      {
        pacUrl: sanitizeUrl(pacUrl),
        targetUrl,
        error: error instanceof Error ? error.message : String(error),
      },
      'Falha ao obter runtime do PAC. Usando fallback.',
    );
    return getFallbackProxyAgent(targetUrl);
  }

  let pacResultValue = '';
  try {
    const pacResult = await runtime.resolver(targetUrl, resolvedTarget.hostname);
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

  logger.info(
    {
      pacUrl: sanitizeUrl(pacUrl),
      hostname: resolvedTarget.hostname,
      pacResult: sanitizePacResult(pacResultValue),
      firstDirective: sanitizeDirective(directives[0] ?? ''),
      engine: runtime.engine,
      hash: runtime.hash,
    },
    'PAC decision',
  );

  for (const directive of directives) {
    const parsed = parseDirective(directive);
    if (!parsed || parsed.type === 'UNSUPPORTED') continue;
    if (parsed.type === 'DIRECT') {
      hostDecisionCache.set(cacheKey, {
        dispatcher: directAgent,
        expiresAt: Date.now() + PAC_DECISION_TTL_MS,
        summary: 'DIRECT',
      });
      return directAgent;
    }
    if (parsed.type === 'PROXY') {
      const proxyAgent = getProxyAgent(parsed.proxyUrl);
      hostDecisionCache.set(cacheKey, {
        dispatcher: proxyAgent,
        expiresAt: Date.now() + PAC_DECISION_TTL_MS,
        summary: sanitizeUrl(parsed.proxyUrl),
      });
      return proxyAgent;
    }
  }

  logger.warn(
    { targetUrl, pacUrl: sanitizeUrl(pacUrl) },
    'PAC sem diretivas úteis. Usando fallback.',
  );
  return getFallbackProxyAgent(targetUrl);
};

export const resolveUndiciDispatcherFromPac = resolveDispatcherForUrl;

export const __test__ = {
  detectPacFormat,
  normalizePac,
  createPacResolverFromScript,
  parseDirective,
};
