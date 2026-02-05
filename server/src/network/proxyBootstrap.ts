import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Agent, ProxyAgent, setGlobalDispatcher, type Dispatcher } from 'undici';

export type LoggerLike = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

type RegistryBranch = 'user' | 'policy';

type RegistryProxySettings = {
  source: RegistryBranch;
  autoConfigUrl: string | null;
  proxyEnable: number;
  proxyServer: string | null;
  autoDetect: number;
};

type NetworkStrategy =
  | 'PAC ok'
  | 'PAC inválido (loopback sem listener)'
  | 'PROXY explícito'
  | 'DIRECT';

export type StartupNetworkState = {
  strategy: NetworkStrategy;
  dispatcher: Dispatcher;
  registry: RegistryProxySettings | null;
  directProbe?: {
    enabled: boolean;
    success: boolean;
    reason: string;
  };
};

const execFileAsync = promisify(execFile);
const PAC_FETCH_TIMEOUT_MS = 1_500;
const OPENAI_URL = 'https://api.openai.com/v1/responses';
const OPENAI_ORIGIN_PROBE_URL = 'https://api.openai.com:443/';

const directAgent = new Agent({
  connectTimeout: 10_000,
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
});

let lastStartupNetworkState: StartupNetworkState | null = null;

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

const withTimeoutSignal = (timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
};

const parseRegistryJson = (
  rawJson: string,
  source: RegistryBranch,
): RegistryProxySettings => {
  const parsed = JSON.parse(rawJson || '{}') as {
    AutoConfigURL?: string;
    ProxyEnable?: number;
    ProxyServer?: string;
    AutoDetect?: number;
  };

  return {
    source,
    autoConfigUrl: parsed.AutoConfigURL?.trim() || null,
    proxyEnable: Number(parsed.ProxyEnable ?? 0),
    proxyServer: parsed.ProxyServer?.trim() || null,
    autoDetect: Number(parsed.AutoDetect ?? 0),
  };
};

const readRegistryPath = async (
  path: string,
  source: RegistryBranch,
): Promise<RegistryProxySettings | null> => {
  const script = `$k = Get-ItemProperty -Path '${path}' -ErrorAction Stop\n` +
    `[PSCustomObject]@{\n` +
    `  AutoConfigURL = $k.AutoConfigURL\n` +
    `  ProxyEnable = $k.ProxyEnable\n` +
    `  ProxyServer = $k.ProxyServer\n` +
    `  AutoDetect = $k.AutoDetect\n` +
    `} | ConvertTo-Json -Compress`;

  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-Command', script],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 },
    );

    return parseRegistryJson(stdout, source);
  } catch {
    return null;
  }
};

const readWindowsInternetSettings = async (): Promise<RegistryProxySettings | null> => {
  if (process.platform !== 'win32') return null;

  const policy = await readRegistryPath(
    'HKCU:\\Software\\Policies\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
    'policy',
  );

  if (policy && (policy.autoConfigUrl || policy.proxyEnable === 1 || policy.proxyServer)) {
    return policy;
  }

  return readRegistryPath(
    'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
    'user',
  );
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

const fetchPacScript = async (pacUrl: string) => {
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
  } finally {
    clear();
  }
};

const resolvePacProxy = async (pacUrl: string): Promise<{ mode: 'DIRECT' } | { mode: 'PROXY'; proxyUrl: string }> => {
  const pacResolverModule = await import('pac-resolver');
  const pacScript = await fetchPacScript(pacUrl);
  const resolver = pacResolverModule.createPacResolver(pacScript);
  const target = new URL(OPENAI_URL);
  const decisionRaw = await resolver(OPENAI_URL, target.hostname);
  return parsePacDecision(String(decisionRaw ?? ''));
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

const setDirectDispatcher = () => {
  setGlobalDispatcher(directAgent);
  return directAgent;
};

const maybeProbeDirectOpenAI = async (logger: LoggerLike) => {
  if ((process.env.NETWORK_DIRECT_PROBE ?? '1').trim() !== '1') {
    return { enabled: false, success: false, reason: 'disabled by env' };
  }

  const { signal, clear } = withTimeoutSignal(Number(process.env.NETWORK_DIRECT_PROBE_TIMEOUT_MS ?? 1500));
  try {
    const response = await fetch(OPENAI_ORIGIN_PROBE_URL, {
      method: 'HEAD',
      signal,
      dispatcher: directAgent,
    });

    logger.info(
      { status: response.status, target: OPENAI_ORIGIN_PROBE_URL },
      'Probe DIRECT para api.openai.com concluído.',
    );
    return { enabled: true, success: true, reason: `status ${response.status}` };
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'Probe DIRECT para api.openai.com falhou.',
    );
    return { enabled: true, success: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clear();
  }
};

export const getStartupNetworkState = () => lastStartupNetworkState;

export const configureNetworkOnStartup = async (logger: LoggerLike): Promise<StartupNetworkState> => {
  let registry: RegistryProxySettings | null = null;
  try {
    registry = await readWindowsInternetSettings();
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'Falha ao ler Internet Settings/Policies do Windows.',
    );
  }

  if (registry?.autoConfigUrl) {
    try {
      const pacUrl = new URL(registry.autoConfigUrl);
      if (isLoopbackHost(pacUrl.hostname) && pacUrl.port) {
        const { signal, clear } = withTimeoutSignal(700);
        try {
          await fetch(pacUrl.toString(), { method: 'HEAD', signal, dispatcher: directAgent });
        } finally {
          clear();
        }
      }

      const pacDecision = await resolvePacProxy(pacUrl.toString());
      if (pacDecision.mode === 'PROXY') {
        const dispatcher = new ProxyAgent({ uri: pacDecision.proxyUrl });
        setGlobalDispatcher(dispatcher);
        const result: StartupNetworkState = {
          strategy: 'PAC ok',
          dispatcher,
          registry,
        };
        lastStartupNetworkState = result;
        logger.info(
          {
            source: registry.source,
            autoConfigUrl: sanitizeUrl(registry.autoConfigUrl),
            pacDecision: 'PROXY',
            selectedProxy: sanitizeUrl(pacDecision.proxyUrl),
          },
          'Rede inicializada com PAC válido.',
        );
        return result;
      }

      const dispatcher = setDirectDispatcher();
      const directProbe = await maybeProbeDirectOpenAI(logger);
      const result: StartupNetworkState = {
        strategy: 'PAC ok',
        dispatcher,
        registry,
        directProbe,
      };
      lastStartupNetworkState = result;
      logger.info(
        {
          source: registry.source,
          autoConfigUrl: sanitizeUrl(registry.autoConfigUrl),
          pacDecision: 'DIRECT',
        },
        'PAC retornou DIRECT. Mantendo conexão direta.',
      );
      return result;
    } catch (error) {
      const parsedPac = (() => {
        try {
          return new URL(registry.autoConfigUrl as string);
        } catch {
          return null;
        }
      })();
      const isLoopbackPac = parsedPac ? isLoopbackHost(parsedPac.hostname) : false;

      if (isLoopbackPac) {
        const dispatcher = setDirectDispatcher();
        const directProbe = await maybeProbeDirectOpenAI(logger);
        const result: StartupNetworkState = {
          strategy: 'PAC inválido (loopback sem listener)',
          dispatcher,
          registry,
          directProbe,
        };
        lastStartupNetworkState = result;
        logger.warn(
          {
            source: registry.source,
            autoConfigUrl: sanitizeUrl(registry.autoConfigUrl),
            error: error instanceof Error ? error.message : String(error),
            action: 'DIRECT sem fallback',
          },
          'PAC loopback inválido detectado. Ignorando fallback de proxy.',
        );
        return result;
      }

      logger.warn(
        {
          source: registry.source,
          autoConfigUrl: sanitizeUrl(registry.autoConfigUrl),
          error: error instanceof Error ? error.message : String(error),
        },
        'Falha ao processar PAC. Avaliando ProxyServer explícito.',
      );
    }
  }

  if (registry?.proxyEnable === 1 && registry.proxyServer) {
    const selected = selectProxyServerEntry(registry.proxyServer);
    const proxyUrl = toProxyUrl(selected);
    if (proxyUrl) {
      const dispatcher = new ProxyAgent({ uri: proxyUrl });
      setGlobalDispatcher(dispatcher);
      const result: StartupNetworkState = {
        strategy: 'PROXY explícito',
        dispatcher,
        registry,
      };
      lastStartupNetworkState = result;
      logger.info(
        {
          source: registry.source,
          proxyEnable: registry.proxyEnable,
          proxyServer: registry.proxyServer,
          selectedProxy: sanitizeUrl(proxyUrl),
        },
        'Rede inicializada com ProxyServer explícito.',
      );
      return result;
    }
  }

  const dispatcher = setDirectDispatcher();
  const directProbe = await maybeProbeDirectOpenAI(logger);
  const result: StartupNetworkState = {
    strategy: 'DIRECT',
    dispatcher,
    registry,
    directProbe,
  };
  lastStartupNetworkState = result;
  logger.info(
    {
      source: registry?.source,
      proxyEnable: registry?.proxyEnable,
      hasAutoConfigUrl: Boolean(registry?.autoConfigUrl),
      reason: 'ProxyEnable desativado, ProxyServer ausente, ou sem settings do Windows.',
    },
    'Rede inicializada em modo DIRECT.',
  );

  return result;
};

export const bootstrapNetwork = configureNetworkOnStartup;
