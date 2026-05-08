export const RUNTIME_HOST_SERVICE_SOCKET_ENV =
  "GAMBIT_RUNTIME_HOST_SERVICE_SOCKET";
export const RUNTIME_HOST_SERVICE_TOKEN_ENV =
  "GAMBIT_RUNTIME_HOST_SERVICE_TOKEN";

export const CODEX_REFRESH_HOST_SERVICE_METHOD =
  "providerAuth.codex.refreshChatgptTokens";
export const CREATE_WRITEBACK_PREVIEW_HOST_SERVICE_METHOD =
  "workloop.writebacks.createPreview";
export const WORKLOOP_TASKS_DRAFT_HOST_SERVICE_METHOD = "workloop.tasks.draft";
export const WORKLOOP_TASKS_QUEUE_HOST_SERVICE_METHOD = "workloop.tasks.queue";

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

export type CreateWritebackPreviewHostServiceParams = {
  summary: string;
  workspaceRoot: string;
  changedPaths?: Array<string>;
};

export type WorkloopTasksDraftHostServiceParams = {
  acceptanceCriteria?: Array<string>;
  purpose?: string | null;
  request: string;
  scopePath?: string | null;
  targetCoworker: string;
  taskId?: string | null;
  title: string;
};

export type WorkloopTasksQueueHostServiceParams = {
  acceptanceCriteria?: Array<string>;
  request?: string | null;
  scopePath?: string | null;
  targetCoworker: string;
  taskId?: string | null;
  title?: string | null;
};

export type RuntimeHostServiceMethod =
  | typeof CODEX_REFRESH_HOST_SERVICE_METHOD
  | typeof CREATE_WRITEBACK_PREVIEW_HOST_SERVICE_METHOD
  | typeof WORKLOOP_TASKS_DRAFT_HOST_SERVICE_METHOD
  | typeof WORKLOOP_TASKS_QUEUE_HOST_SERVICE_METHOD;

export type RuntimeHostServiceParams =
  | CodexRefreshHostServiceParams
  | CreateWritebackPreviewHostServiceParams
  | WorkloopTasksDraftHostServiceParams
  | WorkloopTasksQueueHostServiceParams;

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

function normalizeStringArray(value: unknown, label: string): Array<string> {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array when provided.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`${label}[${index}] must be a non-empty string.`);
    }
    return entry.trim();
  });
}

export function validateCreateWritebackPreviewHostServiceParams(
  value: unknown,
): CreateWritebackPreviewHostServiceParams {
  if (!isRecord(value)) {
    throw new Error("host service params must be a JSON object.");
  }
  return {
    summary: normalizeRequiredString(value.summary, "summary"),
    workspaceRoot: normalizeRequiredString(
      value.workspaceRoot,
      "workspaceRoot",
    ),
    changedPaths: normalizeStringArray(value.changedPaths, "changedPaths"),
  };
}

function normalizeNullableOptionalString(
  value: unknown,
  label: string,
): string | null | undefined {
  if (value == null) return value === null ? null : undefined;
  return normalizeRequiredString(value, label);
}

export function validateWorkloopTasksDraftHostServiceParams(
  value: unknown,
): WorkloopTasksDraftHostServiceParams {
  if (!isRecord(value)) {
    throw new Error("host service params must be a JSON object.");
  }
  return {
    acceptanceCriteria: normalizeStringArray(
      value.acceptanceCriteria,
      "acceptanceCriteria",
    ),
    purpose: normalizeNullableOptionalString(value.purpose, "purpose"),
    request: normalizeRequiredString(value.request, "request"),
    scopePath: normalizeNullableOptionalString(value.scopePath, "scopePath"),
    targetCoworker: normalizeRequiredString(
      value.targetCoworker,
      "targetCoworker",
    ),
    taskId: normalizeNullableOptionalString(value.taskId, "taskId"),
    title: normalizeRequiredString(value.title, "title"),
  };
}

export function validateWorkloopTasksQueueHostServiceParams(
  value: unknown,
): WorkloopTasksQueueHostServiceParams {
  if (!isRecord(value)) {
    throw new Error("host service params must be a JSON object.");
  }
  return {
    acceptanceCriteria: normalizeStringArray(
      value.acceptanceCriteria,
      "acceptanceCriteria",
    ),
    request: normalizeNullableOptionalString(value.request, "request"),
    scopePath: normalizeNullableOptionalString(value.scopePath, "scopePath"),
    targetCoworker: normalizeRequiredString(
      value.targetCoworker,
      "targetCoworker",
    ),
    taskId: normalizeNullableOptionalString(value.taskId, "taskId"),
    title: normalizeNullableOptionalString(value.title, "title"),
  };
}

export function validateRuntimeHostServiceMethodAndParams(input: {
  method: string;
  params: unknown;
}):
  | {
    method: typeof CODEX_REFRESH_HOST_SERVICE_METHOD;
    params: CodexRefreshHostServiceParams;
  }
  | {
    method: typeof CREATE_WRITEBACK_PREVIEW_HOST_SERVICE_METHOD;
    params: CreateWritebackPreviewHostServiceParams;
  }
  | {
    method: typeof WORKLOOP_TASKS_DRAFT_HOST_SERVICE_METHOD;
    params: WorkloopTasksDraftHostServiceParams;
  }
  | {
    method: typeof WORKLOOP_TASKS_QUEUE_HOST_SERVICE_METHOD;
    params: WorkloopTasksQueueHostServiceParams;
  } {
  switch (input.method) {
    case CODEX_REFRESH_HOST_SERVICE_METHOD:
      return {
        method: CODEX_REFRESH_HOST_SERVICE_METHOD,
        params: validateCodexRefreshHostServiceParams(input.params),
      };
    case CREATE_WRITEBACK_PREVIEW_HOST_SERVICE_METHOD:
      return {
        method: CREATE_WRITEBACK_PREVIEW_HOST_SERVICE_METHOD,
        params: validateCreateWritebackPreviewHostServiceParams(input.params),
      };
    case WORKLOOP_TASKS_DRAFT_HOST_SERVICE_METHOD:
      return {
        method: WORKLOOP_TASKS_DRAFT_HOST_SERVICE_METHOD,
        params: validateWorkloopTasksDraftHostServiceParams(input.params),
      };
    case WORKLOOP_TASKS_QUEUE_HOST_SERVICE_METHOD:
      return {
        method: WORKLOOP_TASKS_QUEUE_HOST_SERVICE_METHOD,
        params: validateWorkloopTasksQueueHostServiceParams(input.params),
      };
    default:
      throw new Error(
        `unsupported runtime host service method: ${input.method}`,
      );
  }
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

function connectRuntimeHostService(endpoint: string): Promise<Deno.Conn> {
  if (!endpoint.startsWith("tcp://")) {
    return Deno.connect({ transport: "unix", path: endpoint });
  }
  const url = new URL(endpoint);
  const port = Number(url.port);
  if (!url.hostname || !Number.isInteger(port) || port <= 0) {
    throw new Error(`invalid Workloop host service TCP endpoint: ${endpoint}`);
  }
  return Deno.connect({
    hostname: url.hostname,
    port,
    transport: "tcp",
  });
}

export async function callRuntimeHostServiceRaw(input: {
  method: RuntimeHostServiceMethod;
  params: RuntimeHostServiceParams;
  socketPath?: string | null;
  token?: string | null;
}): Promise<unknown> {
  const socketPath = input.socketPath?.trim() ||
    Deno.env.get(RUNTIME_HOST_SERVICE_SOCKET_ENV)?.trim();
  const token = input.token?.trim() ||
    Deno.env.get(RUNTIME_HOST_SERVICE_TOKEN_ENV)?.trim();
  if (!socketPath || !token) {
    throw new Error("Runtime host service bridge is not configured.");
  }
  const request: RuntimeHostServiceRequest = {
    id: crypto.randomUUID(),
    method: input.method,
    params: input.params,
    token,
    type: "request",
  };
  const conn = await connectRuntimeHostService(socketPath);
  try {
    await writeJsonLine(conn.writable, request);
    const line = await readFirstLine(conn.readable);
    if (!line) {
      throw new Error(
        "Runtime host service bridge closed without a response.",
      );
    }
    const response = JSON.parse(line) as RuntimeHostServiceResponse;
    if (response.error) {
      throw new Error(`${response.error.code}: ${response.error.message}`);
    }
    return response.result;
  } finally {
    try {
      conn.close();
    } catch {
      // ignore close races
    }
  }
}

export async function callRuntimeHostService(input: {
  method: typeof CODEX_REFRESH_HOST_SERVICE_METHOD;
  params: CodexRefreshHostServiceParams;
  socketPath?: string | null;
  token?: string | null;
}): Promise<CodexRefreshHostServiceResult> {
  return validateCodexRefreshHostServiceResult(
    await callRuntimeHostServiceRaw(input),
  );
}
