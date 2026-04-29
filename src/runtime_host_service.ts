export const RUNTIME_HOST_SERVICE_SOCKET_ENV =
  "WORKLOOP_RUNTIME_HOST_SERVICE_SOCKET";
export const RUNTIME_HOST_SERVICE_TOKEN_ENV =
  "WORKLOOP_RUNTIME_HOST_SERVICE_TOKEN";

export const CODEX_REFRESH_HOST_SERVICE_METHOD =
  "providerAuth.codex.refreshChatgptTokens";

export type RuntimeHostServiceFailureReason =
  | "host_auth_missing"
  | "login_required"
  | "refresh_failed"
  | "invalid_request"
  | "unknown_method";

export type CodexRefreshHostServiceParams = {
  previousAccountId?: string | null;
  reason: string;
};

export type CodexRefreshHostServiceResult = {
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType: string | null;
  type: "chatgptAuthTokens";
};

export type RuntimeHostServiceRequest = {
  id: string;
  method: string;
  params: Record<string, unknown>;
  token: string;
  type: "request";
};

export type RuntimeHostServiceError = {
  code: RuntimeHostServiceFailureReason;
  message: string;
};

export type RuntimeHostServiceResponse = {
  error: RuntimeHostServiceError | null;
  id: string;
  result: unknown | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeRequiredString(
  value: unknown,
  label: string,
): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`host service request is missing ${label}.`);
  }
  return normalized;
}

export function validateCodexRefreshHostServiceParams(
  value: unknown,
): CodexRefreshHostServiceParams {
  if (!isRecord(value)) {
    throw new Error("host service params must be a JSON object.");
  }
  const previousAccountId = value.previousAccountId == null
    ? null
    : normalizeOptionalString(value.previousAccountId);
  if (value.previousAccountId != null && previousAccountId == null) {
    throw new Error(
      "providerAuth.codex.refreshChatgptTokens previousAccountId must be a non-empty string when provided.",
    );
  }
  return {
    previousAccountId,
    reason: normalizeRequiredString(value.reason, "reason"),
  };
}

export function validateCodexRefreshHostServiceResult(
  value: unknown,
): CodexRefreshHostServiceResult {
  if (!isRecord(value)) {
    throw new Error("host service result must be a JSON object.");
  }
  const type = normalizeRequiredString(value.type, "type");
  if (type !== "chatgptAuthTokens") {
    throw new Error(`unexpected Codex host service result type: ${type}`);
  }
  return {
    accessToken: normalizeRequiredString(value.accessToken, "accessToken"),
    chatgptAccountId: normalizeRequiredString(
      value.chatgptAccountId,
      "chatgptAccountId",
    ),
    chatgptPlanType: value.chatgptPlanType == null
      ? null
      : normalizeRequiredString(value.chatgptPlanType, "chatgptPlanType"),
    type,
  };
}

export function validateRuntimeHostServiceMethodAndParams(input: {
  method: string;
  params: unknown;
}): {
  method: typeof CODEX_REFRESH_HOST_SERVICE_METHOD;
  params: CodexRefreshHostServiceParams;
} {
  if (input.method !== CODEX_REFRESH_HOST_SERVICE_METHOD) {
    throw new Error(`unsupported runtime host service method: ${input.method}`);
  }
  return {
    method: CODEX_REFRESH_HOST_SERVICE_METHOD,
    params: validateCodexRefreshHostServiceParams(input.params),
  };
}

async function readFirstLine(
  readable: ReadableStream<Uint8Array>,
): Promise<string | null> {
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const newlineIndex = text.indexOf("\n");
      if (newlineIndex >= 0) return text.slice(0, newlineIndex);
    }
    text += decoder.decode();
    return text.length > 0 ? text : null;
  } finally {
    reader.releaseLock();
  }
}

async function writeJsonLine(
  writable: WritableStream<Uint8Array>,
  payload: unknown,
): Promise<void> {
  const writer = writable.getWriter();
  try {
    await writer.write(
      new TextEncoder().encode(`${JSON.stringify(payload)}\n`),
    );
  } finally {
    writer.releaseLock();
  }
}

export async function callRuntimeHostService(input: {
  method: typeof CODEX_REFRESH_HOST_SERVICE_METHOD;
  params: CodexRefreshHostServiceParams;
  socketPath?: string | null;
  token?: string | null;
}): Promise<CodexRefreshHostServiceResult> {
  const socketPath = input.socketPath?.trim() ||
    Deno.env.get(RUNTIME_HOST_SERVICE_SOCKET_ENV)?.trim();
  const token = input.token?.trim() ||
    Deno.env.get(RUNTIME_HOST_SERVICE_TOKEN_ENV)?.trim();
  if (!socketPath || !token) {
    throw new Error("Workloop host service bridge is not configured.");
  }
  const request: RuntimeHostServiceRequest = {
    id: crypto.randomUUID(),
    method: input.method,
    params: input.params,
    token,
    type: "request",
  };
  const conn = await Deno.connect({ transport: "unix", path: socketPath });
  try {
    await writeJsonLine(conn.writable, request);
    const line = await readFirstLine(conn.readable);
    if (!line) {
      throw new Error(
        "Workloop host service bridge closed without a response.",
      );
    }
    const response = JSON.parse(line) as RuntimeHostServiceResponse;
    if (response.error) {
      throw new Error(`${response.error.code}: ${response.error.message}`);
    }
    return validateCodexRefreshHostServiceResult(response.result);
  } finally {
    try {
      conn.close();
    } catch {
      // ignore close races
    }
  }
}
