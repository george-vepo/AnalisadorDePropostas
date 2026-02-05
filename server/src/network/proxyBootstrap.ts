import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Agent, ProxyAgent, setGlobalDispatcher, type Dispatcher } from 'undici';
import { createPacResolver } from 'pac-resolver';

type LoggerLike = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

type RegistryProxySettings = {
  autoConfigUrl: string | null;
  proxyEnable: number;
  proxyServer: string | null;
  autoDetect: number;
};

type NetworkStrategy = 'PAC ok' | 'PAC inválido (sem listener local)' | 'PROXY explícito' | 'DIRECT';

type BootstrapNetworkResult = {
  strategy: NetworkStrategy;
  dispatcher: Dispatcher;
  registry: RegistryProxySettings | null;
};

const execFileAsync = promisify(execFile);
const PAC_FETCH_TIMEOUT_MS = 1_500;
const PAC_FETCH_RETRY_COUNT = 1;
const OPENAI_URL = 'https://api.openai.com/v1/responses';

const directAgent = new Agent({
  connectTimeout: 10_000,
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
});

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

const isLoopbackHost = (host: string) => {
  const value = host.trim().toLowerCase();
  return value === '127.0.0.1' || value === 'localhost' || value === '::1';
};

const parseErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object') return '';
  const anyErr = error as any;
  return String(anyErr.code ?? anyErr.cause?.code ?? '').toUpperCase();
};

const withTimeoutSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
};

const readWindowsInternetSettings = async (): Promise<RegistryProxySettings | null> => {
  if (process.platform !== 'win32') return null;

  const script = `
  $k = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
  [PSCustomObject]@{
    AutoConfigURL = $k.AutoConfigURL
    ProxyEnable = $k.ProxyEnable
    ProxyServer = $k.ProxyServer
    AutoDetect = $k.AutoDetect
  } | ConvertTo-Json -Compress
  `;

  const { stdout } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-Command', script],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 },
  );

  const parsed = JSON.parse(stdout || '{}') as {
    AutoConfigURL?: string;
    ProxyEnable?: number;
    ProxyServer?: string;
    AutoDetect?: number;
  };

  return {
    autoConfigUrl: parsed.AutoConfigURL?.trim() || null,
    proxyEnable: Number(parsed.ProxyEnable ?? 0),
    proxyServer: parsed.ProxyServer?.trim() || null,
    autoDetect: Number(parsed.AutoDetect ?? 0),
  };
};

const fetchPacScript = async (pacUrl: string) => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= PAC_FETCH_RETRY_COUNT; attempt += 1) {
    const { signal, clear } = withTimeoutSignal(PAC_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(pacUrl, {
        signal,
        dispatcher: directAgent,
      });
      if (!response.ok) {
        throw new Error(`PAC HTTP ${response.status}`);
      }
      const body = await response.text();
      if (!body.trim()) {
        throw new Error('PAC vazio');
      }
      return body;
    } catch (error) {
      lastError = error;
    } finally {
      clear();
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Falha ao baixar PAC');
};

const parsePacDecision = (decision: string) => {
  const directives = String(decision || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

  for (const directive of directives) {
    const [typeRaw, valueRaw] = directive.split(/\s+/, 2);
    const type = typeRaw?.toUpperCase();
    if (type === 'DIRECT') {
      return { mode: 'DIRECT' as const };
    }
    if ((type === 'PROXY' || type === 'HTTP' || type === 'HTTPS') && valueRaw) {
      const hostPort = valueRaw.includes('@') ? valueRaw.split('@').at(-1) ?? '' : valueRaw;
      if (hostPort) {
        return { mode: 'PROXY' as const, proxyUrl: `http://${hostPort}` };
      }
    }
  }

  return { mode: 'DIRECT' as const };
};

const selectProxyServerEntry = (proxyServer: string) => {
  const entries = proxyServer
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    const [scheme, value] = entry.includes('=') ? entry.split('=', 2) : ['', entry];
    if (scheme.toLowerCase() === 'https' && value) return value.trim();
  }
  for (const entry of entries) {
    const [scheme, value] = entry.includes('=') ? entry.split('=', 2) : ['', entry];
    if (scheme.toLowerCase() === 'http' && value) return value.trim();
  }

  const first = entries[0] ?? '';
  return first.includes('=') ? first.split('=', 2)[1]?.trim() ?? '' : first;
};

const toProxyUrl = (rawValue: string) => {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://')) return trimmed;
  if (trimmed.startsWith('https://')) return `http://${trimmed.slice('https://'.length)}`;
  return `http://${trimmed}`;
};

const ensureNoProxy = () => {
  const current = process.env.NO_PROXY ?? process.env.no_proxy ?? '';
  const entries = current
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const mustHave = ['localhost', '127.0.0.1'];
  if ((process.env.NO_PROXY_INCLUDE_OPENAI ?? '').trim() === '1') {
    mustHave.push('api.openai.com');
  }

  for (const value of mustHave) {
    if (!entries.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
      entries.push(value);
    }
  }

  const next = entries.join(',');
  process.env.NO_PROXY = next;
  process.env.no_proxy = next;
};

const resolveFromPac = async (pacUrl: string, logger: LoggerLike): Promise<BootstrapNetworkResult> => {
  const pacScript = await fetchPacScript(pacUrl);
  const resolver = createPacResolver(pacScript);
  const target = new URL(OPENAI_URL);
  const decisionRaw = await resolver(OPENAI_URL, target.hostname);
  const decision = parsePacDecision(String(decisionRaw ?? ''));

  if (decision.mode === 'PROXY') {
    const dispatcher = new ProxyAgent({ uri: decision.proxyUrl });
    setGlobalDispatcher(dispatcher);
    logger.info(
      { pacUrl: sanitizeUrl(pacUrl), decision: 'PROXY', proxy: sanitizeUrl(decision.proxyUrl) },
      'PAC ok',
    );
    return { strategy: 'PAC ok', dispatcher, registry: null };
  }

  setGlobalDispatcher(directAgent);
  logger.info(
    { pacUrl: sanitizeUrl(pacUrl), decision: 'DIRECT' },
    'PAC ok',
  );
  return { strategy: 'PAC ok', dispatcher: directAgent, registry: null };
};

export const bootstrapNetwork = async (logger: LoggerLike): Promise<BootstrapNetworkResult> => {
  ensureNoProxy();

  let registry: RegistryProxySettings | null = null;
  try {
    registry = await readWindowsInternetSettings();
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'Falha ao ler Internet Settings do Windows. Seguindo com DIRECT.',
    );
  }

  if (registry?.autoConfigUrl) {
    try {
      const pacUrl = new URL(registry.autoConfigUrl);
      const result = await resolveFromPac(pacUrl.toString(), logger);
      return { ...result, registry };
    } catch (error) {
      const autoConfigUrl = registry.autoConfigUrl;
      const isLoopbackPac = (() => {
        try {
          return isLoopbackHost(new URL(autoConfigUrl).hostname);
        } catch {
          return false;
        }
      })();
      const code = parseErrorCode(error);
      const loopbackUnavailable =
        isLoopbackPac && (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ABORT_ERR');

      if (loopbackUnavailable) {
        setGlobalDispatcher(directAgent);
        logger.warn(
          {
            autoConfigUrl: sanitizeUrl(autoConfigUrl),
            error: error instanceof Error ? error.message : String(error),
          },
          'PAC inválido (sem listener local)',
        );
        return { strategy: 'PAC inválido (sem listener local)', dispatcher: directAgent, registry };
      }

      logger.warn(
        {
          autoConfigUrl: sanitizeUrl(autoConfigUrl),
          error: error instanceof Error ? error.message : String(error),
        },
        'Falha ao usar PAC. Avaliando proxy explícito.',
      );
    }
  }

  if (registry?.proxyEnable === 1 && registry.proxyServer) {
    const selected = selectProxyServerEntry(registry.proxyServer);
    const proxyUrl = toProxyUrl(selected);
    if (proxyUrl) {
      const dispatcher = new ProxyAgent({ uri: proxyUrl });
      setGlobalDispatcher(dispatcher);
      logger.info(
        {
          proxyServer: registry.proxyServer,
          selectedProxy: sanitizeUrl(proxyUrl),
          autoDetect: registry.autoDetect,
        },
        'PROXY explícito',
      );
      return { strategy: 'PROXY explícito', dispatcher, registry };
    }
  }

  setGlobalDispatcher(directAgent);
  logger.info(
    { autoDetect: registry?.autoDetect, proxyEnable: registry?.proxyEnable },
    'DIRECT',
  );
  return { strategy: 'DIRECT', dispatcher: directAgent, registry };
};
