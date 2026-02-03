import { initNetworkFromEnv } from '../server/src/network/proxy';
import { logger } from '../server/src/logger';

const formatCause = (cause: unknown) => {
  if (!cause || typeof cause !== 'object') {
    return undefined;
  }

  const { code, errno, syscall } = cause as {
    code?: string;
    errno?: string | number;
    syscall?: string;
  };

  return { code, errno, syscall };
};

const run = async () => {
  initNetworkFromEnv(logger);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn(
      { hasApiKey: false },
      'OPENAI_API_KEY não definido. A chamada pode falhar por falta de autenticação.',
    );
  }

  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });

    const bodyText = await response.text();
    const snippet = bodyText.slice(0, 500);

    logger.info(
      { status: response.status, statusText: response.statusText },
      'Resposta recebida do endpoint de teste da OpenAI.',
    );
    logger.info({ snippet }, 'Trecho do body (até 500 chars).');
  } catch (error) {
    const err = error as Error & { cause?: unknown };
    logger.error(
      { message: err.message, cause: formatCause(err.cause) },
      'Falha ao executar o proxy test.',
    );
  }
};

run();
