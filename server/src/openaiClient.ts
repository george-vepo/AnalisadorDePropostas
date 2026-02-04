import { promises as fs } from "node:fs";
import path from "node:path";
import { Agent, ProxyAgent } from "undici";
import { logger } from "./logger";
import { resolveUndiciDispatcherFromPac } from "./network/pacUndici";
import { notePacNetworkError } from "./network/pacWindows";

type OpenAIConfig = {
  model: string;
  temperature: number;
  systemPrompt: string;
  userPromptTemplate: string;
  projectId?: string;
  proxy?: string | null | "pac"; // null => força sem proxy; string => usa proxy; undefined => padrão
};

type OpenAIRequestOptions = {
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
};

const VERBOSE_OPENAI_LOG = process.env.OPENAI_LOG_VERBOSE === "1";
const MAX_LOG_CHARS = Number(process.env.OPENAI_LOG_MAX_CHARS ?? 2000);

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENAI_RECORDS_DIR = path.join(process.cwd(), "server", "logs", "openai");

const noProxyAgent = new Agent({
  connectTimeout: 10_000,
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
});

const truncate = (value: string, max = MAX_LOG_CHARS) => {
  if (!value) return value;
  return value.length > max ? `${value.slice(0, max)}…(truncado)` : value;
};

const formatTimestamp = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

const sanitizeFilenamePart = (value: string) => {
  const cleaned = value.replace(/[^a-zA-Z0-9-_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const trimmed = cleaned.slice(0, 80);
  return trimmed || "proposta";
};

const safeJsonStringify = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unstringifiable]";
  }
};

const serializeError = (err: unknown) => {
  if (err instanceof Error) {
    const anyErr = err as any;
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: anyErr.code,
      cause: anyErr.cause ? safeJsonStringify(anyErr.cause) : undefined,
    };
  }
  return { message: safeJsonStringify(err) };
};

const extractNetworkErrorDetails = (err: unknown) => {
  if (!err || typeof err !== "object") return undefined;
  const anyErr = err as any;
  const cause = anyErr.cause;
  const source =
    cause && typeof cause === "object" ? (cause as any) : (anyErr as any);

  const code = source?.code ?? anyErr?.code;
  const errno = source?.errno ?? anyErr?.errno;
  const syscall = source?.syscall ?? anyErr?.syscall;
  const host =
    source?.host ?? source?.hostname ?? source?.address ?? anyErr?.host;
  const port = source?.port ?? anyErr?.port;

  if (!code && !errno && !syscall && !host && !port) return undefined;
  return { code, errno, syscall, host, port };
};

const isRetryableNetworkError = (err: unknown) => {
  const details = extractNetworkErrorDetails(err);
  const anyErr = err as any;
  const code = details?.code ?? anyErr?.code;
  const name = typeof anyErr?.name === "string" ? anyErr.name : "";
  const retryableCodes = new Set([
    "ECONNRESET",
    "ETIMEDOUT",
    "EPIPE",
    "ECONNREFUSED",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_ABORTED",
  ]);
  if (code && retryableCodes.has(String(code))) return true;
  if (name.includes("TimeoutError")) return true;
  return false;
};

const headersToObject = (headers: Headers) => {
  const obj: Record<string, string> = {};
  for (const [k, v] of headers.entries()) obj[k.toLowerCase()] = v;
  return obj;
};

const getProxyMode = (proxy?: string | null | "pac") => {
  if (proxy === null) return "no-proxy" as const;
  if (proxy === "pac") return "pac" as const;
  if (typeof proxy === "string" && proxy.trim()) return "proxy" as const;
  return "default" as const;
};

const resolveDispatcher = async (proxy?: string | null | "pac") => {
  // proxy === null => força conexão direta (sem proxy do ambiente)
  if (proxy === null) {
    return { dispatcher: noProxyAgent, proxyMode: "no-proxy" as const };
  }

  if (proxy === "pac") {
    return {
      dispatcher: await resolveUndiciDispatcherFromPac(OPENAI_ENDPOINT),
      proxyMode: "pac" as const,
    };
  }

  // proxy string => usa proxy explícito
  if (typeof proxy === "string" && proxy.trim()) {
    return {
      dispatcher: new ProxyAgent({
        uri: proxy.trim(),
        connectTimeout: 10_000,
        headersTimeout: 30_000,
        bodyTimeout: 30_000,
      }),
      proxyMode: "proxy" as const,
    };
  }

  // undefined => padrão (respeita env/ambiente)
  return { dispatcher: undefined, proxyMode: "default" as const };
};

const fetchWithDispatcher = async (
  url: string,
  init: RequestInit,
  dispatcher?: any,
) => {
  const fetchInit: RequestInit & { dispatcher?: any } = { ...init };
  if (dispatcher) fetchInit.dispatcher = dispatcher;
  return fetch(url, fetchInit);
};

const renderTemplate = (template: string, values: Record<string, string>) => {
  return Object.entries(values).reduce((result, [key, value]) => {
    return result.replaceAll(`{{${key}}}`, value);
  }, template);
};

const extractOutputText = (payload: any): string => {
  if (payload?.output_text) return payload.output_text as string;

  if (Array.isArray(payload?.output)) {
    const chunks = payload.output.flatMap((item: any) => {
      if (!Array.isArray(item?.content)) return [];
      return item.content
        .filter(
          (content: any) =>
            content?.type === "output_text" || content?.type === "text",
        )
        .map((content: any) => content?.text ?? "");
    });
    if (chunks.length > 0) return chunks.join("");
  }

  return "";
};

const buildRequestBody = (
  config: OpenAIConfig,
  userPrompt: string,
): Record<string, unknown> => {
  return {
    model: config.model,
    temperature: config.temperature,
    instructions: config.systemPrompt,
    input: userPrompt,
  };
};

const writeOpenAIRecord = async (params: {
  proposalNumber: string;
  timestamp: Date;
  requestBody: Record<string, unknown>;
  responseBody: string;
}) => {
  const safeProposalNumber = sanitizeFilenamePart(params.proposalNumber);
  const filename = `${safeProposalNumber}-${formatTimestamp(params.timestamp)}.txt`;
  const content = [
    `Proposta: ${params.proposalNumber}`,
    `DataHora: ${params.timestamp.toISOString()}`,
    "",
    "Requisicao:",
    JSON.stringify(params.requestBody, null, 2),
    "",
    "Resposta:",
    params.responseBody,
    "",
  ].join("\n");

  await fs.mkdir(OPENAI_RECORDS_DIR, { recursive: true });
  await fs.writeFile(path.join(OPENAI_RECORDS_DIR, filename), content, "utf8");
};

const summarizeRequestBodyForLog = (body: Record<string, unknown>) => {
  const model = String(body.model ?? "");
  const temperature = body.temperature;
  const instructions =
    typeof body.instructions === "string" ? body.instructions : "";
  const input = typeof body.input === "string" ? body.input : "";

  return {
    model,
    temperature,
    instructionsLen: instructions.length,
    inputLen: input.length,
    ...(VERBOSE_OPENAI_LOG
      ? {
          instructionsPreview: truncate(instructions),
          inputPreview: truncate(input),
        }
      : {}),
  };
};

const shouldRetry = (status: number) => status === 429 || status >= 500;

type PostOpenAIResult = {
  response: Response;
  payload: any;
  rawText: string;
  durationMs: number;
  requestId?: string;
};

const postOpenAI = async (
  body: Record<string, unknown>,
  apiKey: string,
  options: OpenAIRequestOptions,
  projectId?: string,
  proxy?: string | null | "pac",
): Promise<PostOpenAIResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (projectId) headers["OpenAI-Project"] = projectId;

  const { dispatcher, proxyMode } = await resolveDispatcher(proxy);

  const start = Date.now();
  try {
    if (VERBOSE_OPENAI_LOG) {
      logger.debug(
        {
          endpoint: OPENAI_ENDPOINT,
          timeoutMs: options.timeoutMs,
          proxyMode,
          requestBody: summarizeRequestBodyForLog(body),
        },
        "OpenAI request: sending",
      );
    } else {
      logger.info(
        {
          endpoint: OPENAI_ENDPOINT,
          timeoutMs: options.timeoutMs,
          proxyMode,
          requestBody: summarizeRequestBodyForLog(body),
        },
        "OpenAI request: sending",
      );
    }

    const fetchInit: any = {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    };
    const response = await fetchWithDispatcher(
      OPENAI_ENDPOINT,
      fetchInit,
      dispatcher,
    );

    const rawText = await response.text();
    let payload: any = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }

    const durationMs = Date.now() - start;
    const requestId = response.headers.get("x-request-id") ?? undefined;

    if (VERBOSE_OPENAI_LOG) {
      logger.debug(
        {
          status: response.status,
          ok: response.ok,
          durationMs,
          requestId,
          responseHeaders: headersToObject(response.headers),
          rawTextLen: rawText?.length ?? 0,
        },
        "OpenAI request: received response",
      );
    } else {
      logger.info(
        {
          status: response.status,
          ok: response.ok,
          durationMs,
          requestId,
          rawTextLen: rawText?.length ?? 0,
        },
        "OpenAI request: received response",
      );
    }

    return { response, payload, rawText, durationMs, requestId };
  } catch (error) {
    const durationMs = Date.now() - start;
    const err = serializeError(error);
    const networkError = extractNetworkErrorDetails(error);

    // AbortError normalmente é timeout
    const isAbort =
      typeof error === "object" &&
      error !== null &&
      (error as any).name === "AbortError";

    logger.error(
      {
        durationMs,
        timeoutMs: options.timeoutMs,
        proxyMode,
        err,
        isTimeout: isAbort,
        isNetworkError: Boolean(networkError),
        networkError,
      },
      "Erro de rede na requisição para OpenAI",
    );

    // IMPORTANTÍSSIMO: não engolir o erro, senão o retry quebra
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const postOpenAIWithRetry = async (
  body: Record<string, unknown>,
  apiKey: string,
  options: OpenAIRequestOptions,
  projectId?: string,
  proxy?: string | null | "pac",
) => {
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= options.maxRetries) {
    const attemptStart = Date.now();

    try {
      logger.info(
        {
          attempt: attempt + 1,
          maxRetries: options.maxRetries,
          retryBackoffMs: options.retryBackoffMs,
          requestBody: summarizeRequestBodyForLog(body),
        },
        "OpenAI: attempt started",
      );

      const result = await postOpenAI(body, apiKey, options, projectId, proxy);

      if (
        result?.response &&
        !result.response.ok &&
        shouldRetry(result.response.status) &&
        attempt < options.maxRetries
      ) {
        const backoffMs = options.retryBackoffMs * (attempt + 1);

        logger.warn?.(
          {
            attempt: attempt + 1,
            status: result.response.status,
            requestId: result.requestId,
            durationMs: Date.now() - attemptStart,
            backoffMs,
            retryReason: "status_retryable",
            errorBody: VERBOSE_OPENAI_LOG
              ? truncate(result.rawText)
              : undefined,
          },
          "OpenAI: retrying due to status",
        );

        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        attempt += 1;
        continue;
      }

      if (!result?.response) {
        throw new Error("OpenAI response ausente.");
      }

      return result;
    } catch (error) {
      lastError = error;
      const retryableNetwork = isRetryableNetworkError(error);
      if (retryableNetwork && config.proxy === "pac") {
        notePacNetworkError(error);
      }

      if (attempt >= options.maxRetries) {
        logger.error(
          {
            attempt: attempt + 1,
            durationMs: Date.now() - attemptStart,
            err: serializeError(error),
          },
          "OpenAI: attempt failed and no retries left",
        );
        throw error;
      }

      const backoffMs = options.retryBackoffMs * (attempt + 1);

      logger.warn?.(
        {
          attempt: attempt + 1,
          durationMs: Date.now() - attemptStart,
          backoffMs,
          retryReason: retryableNetwork ? "network_error" : "exception",
          retryableNetwork,
          err: serializeError(error),
        },
        "OpenAI: retrying due to exception",
      );

      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      attempt += 1;
    }
  }

  throw lastError ?? new Error("Erro desconhecido ao chamar OpenAI.");
};

export const analyzeWithOpenAIText = async (
  proposalNumber: string,
  sanitizedPayload: unknown,
  config: OpenAIConfig,
  apiKey: string,
  requestOptions: OpenAIRequestOptions,
): Promise<{ text: string; raw: unknown }> => {
  const formatProposalNumber = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    if (trimmed.includes('-')) return trimmed;
    if (trimmed.length === 1) return trimmed;
    return `${trimmed.slice(0, -1)}-${trimmed.slice(-1)}`;
  };
  const formattedProposalNumber = formatProposalNumber(proposalNumber);
  const dataJson = JSON.stringify(sanitizedPayload);
  const userPrompt = renderTemplate(config.userPromptTemplate, {
    proposalNumber: formattedProposalNumber,
    dataJson,
  });
  const requestBody = buildRequestBody(config, userPrompt);

  const projectId =
    config.projectId?.trim() || process.env.OPENAI_PROJECT_ID?.trim();

  const baseLogCtx = {
    proposalNumber,
    model: config.model,
    temperature: config.temperature,
    hasProjectId: Boolean(projectId),
    timeoutMs: requestOptions.timeoutMs,
    maxRetries: requestOptions.maxRetries,
    retryBackoffMs: requestOptions.retryBackoffMs,
    proxyMode: getProxyMode(config.proxy),
    systemPromptLen: config.systemPrompt?.length ?? 0,
    userPromptLen: userPrompt.length,
    dataJsonLen: dataJson.length,
  };

  logger.info(baseLogCtx, "Calling OpenAI");

  let response: Response;
  let payload: any;
  let rawText: string;
  let durationMs: number | undefined;
  let requestId: string | undefined;

  const start = Date.now();
  try {
    ({ response, payload, rawText, durationMs, requestId } =
      await postOpenAIWithRetry(
        requestBody,
        apiKey,
        requestOptions,
        projectId,
        config.proxy,
      ));

    logger.info(
      {
        ...baseLogCtx,
        status: response.status,
        requestId,
        durationMs: durationMs ?? Date.now() - start,
      },
      "OpenAI response received",
    );
  } catch (error) {
    logger.error(
      {
        ...baseLogCtx,
        err: serializeError(error),
        totalDurationMs: Date.now() - start,
      },
      "OpenAI request failed",
    );
    throw error;
  }

  if (!response.ok) {
    const errorBody = payload ?? rawText;

    logger.error(
      {
        ...baseLogCtx,
        status: response.status,
        requestId,
        durationMs: durationMs ?? Date.now() - start,
        errorBody: VERBOSE_OPENAI_LOG
          ? truncate(safeJsonStringify(errorBody))
          : undefined,
      },
      "OpenAI response error",
    );

    throw new Error(`OpenAI error: ${response.status} ${rawText}`);
  }

  if (payload?.error) {
    logger.error(
      {
        ...baseLogCtx,
        status: response.status,
        requestId,
        durationMs: durationMs ?? Date.now() - start,
        errorBody: VERBOSE_OPENAI_LOG
          ? truncate(safeJsonStringify(payload.error))
          : undefined,
      },
      "OpenAI response error (payload.error)",
    );

    throw new Error(payload.error.message ?? "Erro retornado pela OpenAI.");
  }

  const text = extractOutputText(payload ?? {}).trim();

  logger.info(
    {
      ...baseLogCtx,
      requestId,
      durationMs: durationMs ?? Date.now() - start,
      outputTextLen: text.length,
      rawTextLen: rawText?.length ?? 0,
      ...(VERBOSE_OPENAI_LOG ? { outputPreview: truncate(text) } : {}),
    },
    "OpenAI: output extracted",
  );

  try {
    const responseBody =
      rawText && rawText.trim() ? rawText : safeJsonStringify(payload ?? {});
    await writeOpenAIRecord({
      proposalNumber,
      timestamp: new Date(),
      requestBody,
      responseBody,
    });
  } catch (error) {
    logger.warn(
      {
        ...baseLogCtx,
        err: serializeError(error),
      },
      "Falha ao registrar requisicao e resposta da OpenAI",
    );
  }

  if (text) {
    return { text, raw: payload };
  }

  return { text: JSON.stringify(payload ?? {}), raw: payload };
};
