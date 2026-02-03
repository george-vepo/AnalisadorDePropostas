import { Agent, setGlobalDispatcher } from 'undici';

const PROXY_ENV_VARS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'NODE_USE_ENV_PROXY',
] as const;

const clearProxyEnvVars = (): string[] => {
  const removed: string[] = [];

  for (const name of PROXY_ENV_VARS) {
    if (process.env[name] !== undefined) {
      removed.push(name);
      delete process.env[name];
    }
  }

  return removed;
};

const removedProxyEnvVars = clearProxyEnvVars();
if (removedProxyEnvVars.length > 0) {
  console.log(
    'Proxy desabilitado por padrão (env vars de proxy limpas):',
    removedProxyEnvVars.join(', '),
  );
}

setGlobalDispatcher(
  new Agent({
    connectTimeout: 10_000,
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 120_000,
  }),
);

const run = async (): Promise<void> => {
  try {
    const response = await fetch('https://api.openai.com/v1/models');
    const body = await response.text();

    console.log('Status:', response.status);
    console.log('Body snippet:', body.slice(0, 200));
  } catch (error) {
    const err = error as Error & {
      cause?: { code?: string; errno?: string; syscall?: string };
    };

    console.error('Erro ao executar network test:', err.message);
    if (err.cause) {
      console.error('Detalhes da causa:', {
        code: err.cause.code,
        errno: err.cause.errno,
        syscall: err.cause.syscall,
      });
    }
  }
};

await run();
