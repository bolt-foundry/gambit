import * as path from "@std/path";
import type {
  CreateResponseRequest,
  CreateResponseResponse,
  JSONValue,
  ModelMessage,
  ModelProvider,
  ResponseEvent,
  ResponseItem,
  ResponseMessageItem,
  SavedState,
} from "@bolt-foundry/gambit-core";

export const CODEX_PREFIX = "codex-cli/";
const CODEX_THREAD_META_KEY = "codex.threadId";
const BOT_ROOT_ENV = "GAMBIT_BOT_ROOT";
const CODEX_MCP_ENV = "GAMBIT_CODEX_ENABLE_MCP";
const CODEX_DISABLE_MCP_ENV = "GAMBIT_CODEX_DISABLE_MCP";
const CODEX_REASONING_EFFORT_ENV = "GAMBIT_CODEX_REASONING_EFFORT";
const CODEX_REASONING_SUMMARY_ENV = "GAMBIT_CODEX_REASONING_SUMMARY";
const CODEX_VERBOSITY_ENV = "GAMBIT_CODEX_VERBOSITY";
const CODEX_BIN_ENV = "GAMBIT_CODEX_BIN";
const CODEX_SKIP_SANDBOX_CONFIG_ENV = "GAMBIT_CODEX_SKIP_SANDBOX_CONFIG";
const CODEX_TRANSPORT_ENV = "GAMBIT_CODEX_TRANSPORT";
const MCP_ROOT_DECK_PATH_ENV = "GAMBIT_MCP_ROOT_DECK_PATH";
const MCP_SERVER_PATH = (() => {
  try {
    const moduleUrl = new URL(import.meta.url);
    if (moduleUrl.protocol !== "file:") return null;
    return path.resolve(
      path.dirname(path.fromFileUrl(moduleUrl)),
      "../mcp_server.ts",
    );
  } catch {
    return null;
  }
})();

type CodexTurnUsage = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
};

type CodexEvent =
  | { type: "thread.started"; thread_id?: unknown }
  | {
    type: "item.completed";
    item?: {
      type?: unknown;
      text?: unknown;
    };
  }
  | { type: "turn.completed"; usage?: CodexTurnUsage }
  | { type: string; [key: string]: unknown };

type CommandOutput = {
  success: boolean;
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
};

type CommandStatusLike = {
  success: boolean;
  code: number;
};

type CodexAssistantMessage = {
  itemId: string | null;
  text: string;
};

type CommandRunner = (input: {
  args: Array<string>;
  cwd: string;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
}) => Promise<CommandOutput>;

type CodexTransport = "exec" | "app-server";

type AppServerTurnRunnerInput = {
  model: string;
  messages: Array<ModelMessage>;
  state?: SavedState;
  params?: Record<string, unknown>;
  deckPath?: string;
  signal?: AbortSignal;
  onStreamEvent?: (event: Record<string, JSONValue>) => void;
  instructions?: string;
  prompt: string;
  cwd: string;
  priorThreadId?: string;
};

type AppServerTurnRunnerOutput = {
  threadId?: string;
  assistantMessages: Array<CodexAssistantMessage>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

type AppServerTurnRunner = (
  input: AppServerTurnRunnerInput,
) => Promise<AppServerTurnRunnerOutput>;

const REASONING_EFFORT_VALUES = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
const REASONING_SUMMARY_VALUES = new Set([
  "none",
  "auto",
  "concise",
  "detailed",
]);
const VERBOSITY_VALUES = new Set([
  "low",
  "medium",
  "high",
]);

function codexTransport(): CodexTransport {
  const raw = Deno.env.get(CODEX_TRANSPORT_ENV)?.trim().toLowerCase();
  if (raw === "app-server" || raw === "app_server") return "app-server";
  return "exec";
}

function runCwd(): string {
  const botRoot = Deno.env.get(BOT_ROOT_ENV);
  if (typeof botRoot === "string" && botRoot.trim().length > 0) {
    return botRoot.trim();
  }
  return Deno.cwd();
}

function shouldEnableMcpBridge(): boolean {
  const disableRaw = Deno.env.get(CODEX_DISABLE_MCP_ENV);
  if (disableRaw && parseTruthy(disableRaw)) return false;
  const enableRaw = Deno.env.get(CODEX_MCP_ENV);
  if (!enableRaw) return true;
  const normalized = enableRaw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseTruthy(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function shouldSkipCodexSandboxConfig(
  params?: Record<string, unknown>,
): boolean {
  const yolo = params?.gambitYolo;
  if (typeof yolo === "boolean") return yolo;
  const codex = asRecord(params?.codex);
  const codexSkipSandboxConfig = codex.skip_sandbox_config;
  if (typeof codexSkipSandboxConfig === "boolean") {
    return codexSkipSandboxConfig;
  }
  const envRaw = Deno.env.get(CODEX_SKIP_SANDBOX_CONFIG_ENV);
  return Boolean(envRaw && parseTruthy(envRaw));
}

function tomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function tomlStringArray(values: Array<string>): string {
  return `[${values.map(tomlString).join(",")}]`;
}

function tomlKeySegment(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value);
}

function tomlValue(value: unknown): string {
  if (typeof value === "string") return tomlString(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid Codex config number: ${value}`);
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => tomlValue(entry)).join(", ")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{ ${
      entries
        .map(([key, entry]) => `${tomlKeySegment(key)} = ${tomlValue(entry)}`)
        .join(", ")
    } }`;
  }
  throw new Error(
    `Unsupported Codex config value type: ${typeof value}.`,
  );
}

function codexAdditionalConfigArgs(
  params?: Record<string, unknown>,
): Array<string> {
  const codex = params?.codex;
  if (!codex || typeof codex !== "object" || Array.isArray(codex)) return [];
  const args: Array<string> = [];
  const visit = (prefix: Array<string>, value: unknown) => {
    if (value === undefined) return;
    if (
      value && typeof value === "object" && !Array.isArray(value)
    ) {
      const entries = Object.entries(value).sort(([a], [b]) =>
        a.localeCompare(b)
      );
      for (const [key, entry] of entries) {
        visit([...prefix, key], entry);
      }
      return;
    }
    const dottedKey = prefix.map(tomlKeySegment).join(".");
    args.push("-c", `${dottedKey}=${tomlValue(value)}`);
  };
  for (
    const [key, value] of Object.entries(codex).sort(([a], [b]) =>
      a.localeCompare(b)
    )
  ) {
    visit([key], value);
  }
  return args;
}

function codexConfigArgs(input: {
  cwd: string;
  deckPath?: string;
  params?: Record<string, unknown>;
  instructions?: string;
}): Array<string> {
  const args: Array<string> = [];
  args.push(...codexAdditionalConfigArgs(input.params));
  args.push("-c", `approval_policy=${tomlString("never")}`);
  if (!shouldSkipCodexSandboxConfig(input.params)) {
    args.push("-c", `sandbox_mode=${tomlString("workspace-write")}`);
    args.push(
      "-c",
      `sandbox_workspace_write.writable_roots=${tomlStringArray([input.cwd])}`,
    );
  }
  const params = input.params ?? {};
  const reasoning = asRecord(params.reasoning);
  const effort = typeof reasoning.effort === "string"
    ? assertEnumForCallTime({
      value: reasoning.effort,
      allowed: REASONING_EFFORT_VALUES,
      field: "reasoning.effort",
    })
    : Deno.env.get(CODEX_REASONING_EFFORT_ENV);
  if (typeof effort === "string" && effort.trim()) {
    args.push("-c", `model_reasoning_effort=${tomlString(effort.trim())}`);
  }
  const summary = typeof reasoning.summary === "string"
    ? assertEnumForCallTime({
      value: reasoning.summary,
      allowed: REASONING_SUMMARY_VALUES,
      field: "reasoning.summary",
    })
    : Deno.env.get(CODEX_REASONING_SUMMARY_ENV);
  if (typeof summary === "string" && summary.trim()) {
    args.push("-c", `model_reasoning_summary=${tomlString(summary.trim())}`);
  }
  const verbosity = typeof params.verbosity === "string"
    ? assertEnumForCallTime({
      value: params.verbosity,
      allowed: VERBOSITY_VALUES,
      field: "verbosity",
    })
    : Deno.env.get(CODEX_VERBOSITY_ENV);
  if (typeof verbosity === "string" && verbosity.trim()) {
    args.push("-c", `model_verbosity=${tomlString(verbosity.trim())}`);
  }
  if (typeof input.instructions === "string" && input.instructions.trim()) {
    args.push("-c", `instructions=${tomlString(input.instructions.trim())}`);
  }

  if (shouldEnableMcpBridge() && MCP_SERVER_PATH) {
    args.push("-c", `mcp_servers.gambit.command=${tomlString("deno")}`);
    args.push(
      "-c",
      `mcp_servers.gambit.args=${
        tomlStringArray(["run", "-A", MCP_SERVER_PATH])
      }`,
    );
    args.push("-c", `mcp_servers.gambit.cwd=${tomlString(input.cwd)}`);
    args.push(
      "-c",
      `mcp_servers.gambit.env.GAMBIT_BOT_ROOT=${tomlString(input.cwd)}`,
    );
    const rootDeckPath = input.deckPath?.trim();
    if (rootDeckPath) {
      args.push(
        "-c",
        `mcp_servers.gambit.env.${MCP_ROOT_DECK_PATH_ENV}=${
          tomlString(rootDeckPath)
        }`,
      );
    }
    args.push("-c", "mcp_servers.gambit.enabled=true");
    args.push("-c", "mcp_servers.gambit.startup_timeout_sec=30");
    args.push("-c", "mcp_servers.gambit.tool_timeout_sec=30");
  }
  return args;
}

function codexGlobalConfigArgs(configArgs: Array<string>): Array<string> {
  const args: Array<string> = [];
  for (let idx = 0; idx < configArgs.length; idx += 2) {
    if (configArgs[idx] !== "-c") continue;
    const value = configArgs[idx + 1];
    if (typeof value === "string" && value.length > 0) {
      args.push("--config", value);
    }
  }
  return args;
}

function normalizeCodexModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "";
  if (trimmed === "codex-cli") return "default";
  if (trimmed === "codex" || trimmed.startsWith("codex/")) {
    throw new Error(
      'Legacy Codex model prefix "codex" is no longer supported. Use "codex-cli/default" or "codex-cli/<model>".',
    );
  }
  if (trimmed.startsWith(CODEX_PREFIX)) {
    const stripped = trimmed.slice(CODEX_PREFIX.length).trim();
    if (!stripped) {
      throw new Error(
        'Codex model prefix requires a model segment. Use "codex-cli/default" or "codex-cli/<model>".',
      );
    }
    return stripped;
  }
  return trimmed;
}

function assertEnumForCallTime(input: {
  value: string;
  allowed: Set<string>;
  field: string;
}): string {
  const normalized = input.value.trim().toLowerCase();
  if (!normalized) return normalized;
  if (input.allowed.has(normalized)) return normalized;
  const allowed = Array.from(input.allowed).join(", ");
  throw new Error(
    `Invalid Codex call-time ${input.field}: "${input.value}". Allowed values: ${allowed}.`,
  );
}

function safeJsonObject(
  text: string,
): Record<string, JSONValue> {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, JSONValue>;
    }
  } catch {
    // ignore parse failure
  }
  return {};
}

function parseJsonValue(text: string): JSONValue {
  try {
    return JSON.parse(text) as JSONValue;
  } catch {
    return text;
  }
}

function stringifyJsonValue(value: JSONValue): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseUsageBreakdown(value: unknown): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} | undefined {
  const record = asRecord(value);
  const inputTokens = record.inputTokens;
  const outputTokens = record.outputTokens;
  const totalTokens = record.totalTokens;
  if (
    typeof inputTokens !== "number" || !Number.isFinite(inputTokens) ||
    typeof outputTokens !== "number" || !Number.isFinite(outputTokens) ||
    typeof totalTokens !== "number" || !Number.isFinite(totalTokens)
  ) {
    return undefined;
  }
  return {
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    totalTokens,
  };
}

function normalizeAppServerToolStatus(status: unknown): string {
  if (typeof status !== "string") return "";
  if (status === "inProgress") return "in_progress";
  return status;
}

function appServerThreadItemToCodexItem(
  item: Record<string, unknown>,
): Record<string, JSONValue> | null {
  const type = typeof item.type === "string" ? item.type : "";
  const id = typeof item.id === "string" ? item.id : "";
  if (!type || !id) return null;
  if (type === "agentMessage") {
    return {
      id,
      type: "agent_message",
      text: typeof item.text === "string" ? item.text : "",
    };
  }
  if (type === "reasoning") {
    return {
      id,
      type: "reasoning",
      summary: (Array.isArray(item.summary) ? item.summary : []) as JSONValue,
      content: (Array.isArray(item.content) ? item.content : []) as JSONValue,
    };
  }
  if (type === "mcpToolCall") {
    return {
      id,
      type: "mcp_tool_call",
      tool: typeof item.tool === "string" ? item.tool : "",
      server: typeof item.server === "string" ? item.server : "",
      status: normalizeAppServerToolStatus(item.status),
      arguments: (item.arguments ?? {}) as JSONValue,
      result: (item.result ?? null) as JSONValue,
      error: (item.error ?? null) as JSONValue,
    };
  }
  if (type === "commandExecution") {
    return {
      id,
      type: "command_execution",
      command: (item.command ?? "") as JSONValue,
      status: normalizeAppServerToolStatus(item.status),
      aggregated_output: typeof item.aggregatedOutput === "string"
        ? item.aggregatedOutput
        : "",
      exit_code: (item.exitCode ?? null) as JSONValue,
    };
  }
  if (type === "fileChange") {
    return {
      id,
      type: "file_change",
      status: normalizeAppServerToolStatus(item.status),
      changes: (Array.isArray(item.changes) ? item.changes : []) as JSONValue,
    };
  }
  return null;
}

function appServerNotificationToCodexEvent(
  method: string,
  params: Record<string, unknown>,
): Record<string, JSONValue> | null {
  if (method === "item/agentMessage/delta") {
    return {
      type: "item.delta",
      item: {
        id: typeof params.itemId === "string" ? params.itemId : "",
        type: "agent_message",
        text: typeof params.delta === "string" ? params.delta : "",
      },
    };
  }

  if (
    method === "item/reasoning/textDelta" ||
    method === "item/reasoning/summaryTextDelta"
  ) {
    return {
      type: "item.delta",
      item: {
        id: typeof params.itemId === "string" ? params.itemId : "reasoning",
        type: "reasoning",
        text: typeof params.delta === "string" ? params.delta : "",
      },
    };
  }

  if (
    method === "item/commandExecution/outputDelta" ||
    method === "item/fileChange/outputDelta"
  ) {
    const itemType = method === "item/commandExecution/outputDelta"
      ? "command_execution"
      : "file_change";
    return {
      type: "item.delta",
      item: {
        id: typeof params.itemId === "string" ? params.itemId : "",
        type: itemType,
        status: "in_progress",
        ...(itemType === "command_execution"
          ? {
            aggregated_output: typeof params.delta === "string"
              ? params.delta
              : "",
          }
          : { changes: [] }),
      },
    };
  }

  if (method === "item/mcpToolCall/progress") {
    return {
      type: "item.delta",
      item: {
        id: typeof params.itemId === "string" ? params.itemId : "",
        type: "mcp_tool_call",
        status: "in_progress",
        result: typeof params.message === "string" ? params.message : "",
      },
    };
  }

  if (method === "item/started" || method === "item/completed") {
    const item = asRecord(params.item);
    const mapped = appServerThreadItemToCodexItem(item);
    if (!mapped) return null;
    return {
      type: method === "item/started" ? "item.started" : "item.completed",
      item: mapped,
    };
  }

  return null;
}

async function defaultAppServerTurnRunner(
  input: AppServerTurnRunnerInput,
): Promise<AppServerTurnRunnerOutput> {
  const codexBin = Deno.env.get(CODEX_BIN_ENV)?.trim() || "codex";
  const spawnArgs = [
    ...codexGlobalConfigArgs(codexConfigArgs({
      cwd: input.cwd,
      deckPath: input.deckPath,
      params: input.params,
      instructions: input.instructions,
    })),
    "app-server",
  ];
  const child = new Deno.Command(codexBin, {
    args: spawnArgs,
    cwd: input.cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const abort = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  };
  if (input.signal?.aborted) {
    abort();
  } else if (input.signal) {
    input.signal.addEventListener("abort", abort, { once: true });
  }

  const encoder = new TextEncoder();
  const stdoutReader = child.stdout.getReader();
  const stderrReader = child.stderr.getReader();
  const stdinWriter = child.stdin.getWriter();
  let childExitStatus: CommandStatusLike | null = null;
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  const stderrChunks: Array<string> = [];
  const assistantMessages: Array<CodexAssistantMessage> = [];
  const assistantIndexById = new Map<string, number>();
  const turnState: {
    id?: string;
    completed: boolean;
    error?: Error;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  } = { completed: false };
  let nextRequestId = 1;
  let cleanupError: Error | null = null;
  let output: AppServerTurnRunnerOutput | null = null;
  const childStatus = child.status.then((status) => {
    childExitStatus = status;
    return status;
  });

  const appServerClosedError = () => {
    const stderr = stderrChunks.join("").trim();
    if (stderr) {
      return new Error(`codex app-server failed: ${stderr}`);
    }
    const detail = childExitStatus
      ? childExitStatus.code === 0
        ? "exited successfully"
        : `exited with code ${childExitStatus.code}`
      : "closed unexpectedly";
    return new Error(
      `Codex app-server exited before the request completed (${detail}).`,
    );
  };

  const writeMessage = async (message: Record<string, unknown>) => {
    await stdinWriter.write(encoder.encode(`${JSON.stringify(message)}\n`));
  };

  const request = (method: string, params: Record<string, unknown>) => {
    const id = String(nextRequestId++);
    const promise = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    const requestPromise = promise.finally(() => {
      pending.delete(id);
    });
    const exitPromise = childStatus.then(() => {
      if (pending.has(id)) {
        pending.delete(id);
        throw appServerClosedError();
      }
      return requestPromise;
    });
    return writeMessage({ id, method, params })
      .catch((error) => {
        pending.delete(id);
        throw error;
      })
      .then(() => Promise.race([requestPromise, exitPromise]));
  };

  const readLoop = async () => {
    const decoder = new TextDecoder();
    let buffered = "";
    while (true) {
      const { value, done } = await stdoutReader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const parts = buffered.split(/\r?\n/);
      buffered = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }
        const method = typeof parsed.method === "string" ? parsed.method : "";
        if (method) {
          if (Object.prototype.hasOwnProperty.call(parsed, "id")) {
            const requestId = String(parsed.id);
            await writeMessage({
              id: requestId,
              error: {
                code: -32601,
                message: `Unsupported app-server request: ${method}`,
              },
            });
            continue;
          }
          const params = asRecord(parsed.params);
          const pseudoEvent = appServerNotificationToCodexEvent(method, params);
          if (pseudoEvent) {
            input.onStreamEvent?.(pseudoEvent);
          }
          if (method === "item/completed") {
            const item = asRecord(params.item);
            if (item.type === "agentMessage" && typeof item.id === "string") {
              const entry: CodexAssistantMessage = {
                itemId: item.id,
                text: typeof item.text === "string" ? item.text : "",
              };
              const existing = assistantIndexById.get(item.id);
              if (typeof existing === "number") {
                assistantMessages[existing] = entry;
              } else {
                assistantIndexById.set(item.id, assistantMessages.length);
                assistantMessages.push(entry);
              }
            }
          } else if (method === "thread/tokenUsage/updated") {
            if (
              typeof params.turnId === "string" &&
              (!turnState.id || params.turnId === turnState.id)
            ) {
              turnState.usage = parseUsageBreakdown(
                asRecord(params.tokenUsage).last,
              );
            }
          } else if (method === "turn/started") {
            const turn = asRecord(params.turn);
            if (typeof turn.id === "string") {
              turnState.id = turn.id;
            }
          } else if (method === "turn/completed") {
            const turn = asRecord(params.turn);
            if (typeof turn.id === "string") {
              turnState.id = turn.id;
            }
            if (turn.status === "failed") {
              const error = asRecord(turn.error);
              const message = typeof error.message === "string" && error.message
                ? error.message
                : "Codex app-server turn failed";
              turnState.error = new Error(message);
            } else if (turn.status === "interrupted") {
              turnState.error = new DOMException("Run canceled", "AbortError");
            }
            turnState.completed = true;
          }
          continue;
        }

        if (!Object.prototype.hasOwnProperty.call(parsed, "id")) continue;
        const responseId = String(parsed.id);
        const resolver = pending.get(responseId);
        if (!resolver) continue;
        pending.delete(responseId);
        if (parsed.error) {
          const error = asRecord(parsed.error);
          const message = typeof error.message === "string" && error.message
            ? error.message
            : "Codex app-server request failed";
          resolver.reject(new Error(message));
          continue;
        }
        resolver.resolve(parsed.result);
      }
    }
  };

  const stderrLoop = (async () => {
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      stderrChunks.push(decoder.decode(value, { stream: true }));
    }
  })();

  const stdoutLoop = readLoop();

  try {
    await request("initialize", {
      clientInfo: {
        name: "gambit",
        title: "Gambit",
        version: "0.0.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    await writeMessage({ method: "initialized", params: {} });

    const model = normalizeCodexModel(input.model);
    const threadResult = input.priorThreadId
      ? await request("thread/resume", {
        threadId: input.priorThreadId,
        model: model && model !== "default" ? model : null,
        cwd: input.cwd,
        approvalPolicy: "never",
        persistExtendedHistory: false,
      }) as Record<string, unknown>
      : await request("thread/start", {
        model: model && model !== "default" ? model : null,
        cwd: input.cwd,
        approvalPolicy: "never",
        ephemeral: false,
        experimentalRawEvents: false,
        persistExtendedHistory: false,
      }) as Record<string, unknown>;

    const thread = asRecord(threadResult.thread);
    const threadId = typeof thread.id === "string"
      ? thread.id
      : input.priorThreadId;
    if (!threadId) {
      throw new Error("Codex app-server did not return a thread id.");
    }

    await request("turn/start", {
      threadId,
      input: [{ type: "text", text: input.prompt }],
      cwd: input.cwd,
      approvalPolicy: "never",
      model: model && model !== "default" ? model : null,
    });

    while (!turnState.completed) {
      if (input.signal?.aborted) {
        throw new DOMException("Run canceled", "AbortError");
      }
      if (childExitStatus) {
        await Promise.allSettled([stdoutLoop, stderrLoop]);
        if (!turnState.completed && !turnState.error) {
          turnState.error = appServerClosedError();
        }
        break;
      }
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        childStatus.then(() => undefined),
        new Promise((resolve) => {
          pollTimer = setTimeout(resolve, 10);
        }),
      ]);
      if (pollTimer !== undefined) {
        clearTimeout(pollTimer);
      }
    }

    if (turnState.error) throw turnState.error;

    output = {
      threadId,
      assistantMessages,
      usage: turnState.usage,
    };
  } finally {
    for (const { reject } of pending.values()) {
      reject(new Error("Codex app-server session closed"));
    }
    pending.clear();
    try {
      await stdinWriter.close();
    } catch {
      // ignore
    }
    await Promise.allSettled([stdoutLoop, stderrLoop, childStatus]);
    if (input.signal) {
      input.signal.removeEventListener("abort", abort);
    }
    if (
      input.signal?.aborted ||
      turnState.error instanceof DOMException &&
        turnState.error.name === "AbortError"
    ) {
      cleanupError = new DOMException("Run canceled", "AbortError");
    } else if (!turnState.completed && !turnState.error) {
      cleanupError = appServerClosedError();
    }
  }
  if (cleanupError) {
    throw cleanupError;
  }
  if (!output) {
    throw new Error("Codex app-server turn runner completed without a result.");
  }
  return output;
}

function codexToolResultForItem(
  itemType: string,
  record: Record<string, JSONValue>,
): JSONValue {
  if (itemType === "mcp_tool_call") {
    return {
      server: record.server ?? "",
      status: record.status ?? "",
      result: record.result ?? null,
      error: record.error ?? null,
    };
  }
  if (itemType === "command_execution") {
    return {
      command: record.command ?? "",
      status: record.status ?? "",
      output: record.aggregated_output ?? "",
      exit_code: record.exit_code ?? null,
    };
  }
  if (itemType === "file_change") {
    return {
      status: record.status ?? "",
      changes: record.changes ?? [],
    };
  }
  return record ?? null;
}

function emitCodexToolEvents(input: {
  event: Record<string, JSONValue>;
  emit: (event: Record<string, JSONValue>) => void;
  toolNames: Map<string, string>;
  emittedCalls: Set<string>;
  emittedTerminalResults: Set<string>;
  lastResultFingerprintByCallId: Map<string, string>;
  toolOutputIndexByCallId: Map<string, number>;
  nextOutputIndexRef: { value: number };
}): void {
  const payloadType = typeof input.event.type === "string"
    ? input.event.type
    : "";
  if (!payloadType.startsWith("item.")) return;
  const item = input.event.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return;
  const record = item as Record<string, JSONValue>;
  const itemType = typeof record.type === "string" ? record.type : "";
  const callId = typeof record.id === "string"
    ? record.id
    : typeof record.call_id === "string"
    ? record.call_id
    : "";
  if (!callId) return;

  if (itemType === "reasoning" || itemType === "agent_message") return;

  const name = typeof record.tool === "string"
    ? record.tool
    : typeof record.name === "string"
    ? record.name
    : input.toolNames.get(callId) ?? itemType;

  const normalizedArgs = (() => {
    if (itemType === "command_execution") {
      return { command: record.command ?? "" } as JSONValue;
    }
    if (itemType === "file_change") {
      return { changes: record.changes ?? [] } as JSONValue;
    }
    const rawArgs = record.arguments;
    return typeof rawArgs === "string"
      ? parseJsonValue(rawArgs)
      : rawArgs ?? {};
  })();
  const resolvedName = name ?? input.toolNames.get(callId) ?? itemType;
  const outputIndex = (() => {
    const existing = input.toolOutputIndexByCallId.get(callId);
    if (typeof existing === "number") return existing;
    const next = input.nextOutputIndexRef.value;
    input.nextOutputIndexRef.value += 1;
    input.toolOutputIndexByCallId.set(callId, next);
    return next;
  })();
  const argsText = stringifyJsonValue(normalizedArgs);

  if (!input.emittedCalls.has(callId)) {
    input.emittedCalls.add(callId);
    input.toolNames.set(callId, name);
    input.emit({
      type: "tool.call",
      actionCallId: callId,
      name,
      args: normalizedArgs,
      toolKind: "mcp_bridge",
    });
    input.emit({
      type: "response.output_item.done",
      output_index: outputIndex,
      item: {
        type: "function_call",
        id: `${callId}:call`,
        call_id: callId,
        name: resolvedName,
        arguments: argsText,
      },
    });
  }

  if (!resolvedName) return;
  const isTerminal = payloadType === "item.completed" ||
    payloadType === "item.done";
  const result = codexToolResultForItem(itemType, record);
  const resultFingerprint = stringifyJsonValue(result);
  const priorResultFingerprint = input.lastResultFingerprintByCallId.get(
    callId,
  );
  const shouldEmitProgressResult = payloadType !== "item.started" &&
    resultFingerprint !== priorResultFingerprint;
  if (shouldEmitProgressResult) {
    input.lastResultFingerprintByCallId.set(callId, resultFingerprint);
    input.emit({
      type: "tool.result",
      actionCallId: callId,
      name: resolvedName,
      result,
      toolKind: "mcp_bridge",
    });
  }
  if (!isTerminal || input.emittedTerminalResults.has(callId)) return;
  input.emittedTerminalResults.add(callId);
  input.emit({
    type: "response.output_item.done",
    output_index: outputIndex,
    item: {
      type: "function_call_output",
      id: `${callId}:output`,
      call_id: callId,
      output: stringifyJsonValue(result),
    },
  });
}

function extractTextParts(value: JSONValue | undefined): Array<string> {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  const parts: Array<string> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, JSONValue>;
    if (typeof record.text === "string") parts.push(record.text);
  }
  return parts;
}

function extractCodexItemText(record: Record<string, JSONValue>): string {
  return typeof record.text === "string"
    ? record.text
    : extractTextParts(record.content).join("");
}

type CodexAssistantStreamState = {
  streamedText: string;
  sawAssistantTextStream: boolean;
  assistantOutputIndexByItemId: Map<string, number>;
  emittedTerminalAssistantItemIds: Set<string>;
};

function requireCodexAssistantItemId(input: {
  payloadType: string;
  record: Record<string, JSONValue>;
}): string {
  const itemId = typeof input.record.id === "string"
    ? input.record.id.trim()
    : "";
  if (itemId) return itemId;
  throw new Error(
    `Codex ${input.payloadType} agent_message is missing required item.id.`,
  );
}

function resolveCodexAssistantItemIdentity(input: {
  payloadType: string;
  record: Record<string, JSONValue>;
  assistantState: Pick<
    CodexAssistantStreamState,
    "assistantOutputIndexByItemId"
  >;
  nextOutputIndexRef: { value: number };
}): {
  itemId: string;
  outputIndex: number;
} {
  const itemId = requireCodexAssistantItemId({
    payloadType: input.payloadType,
    record: input.record,
  });
  const existing = input.assistantState.assistantOutputIndexByItemId.get(
    itemId,
  );
  if (typeof existing === "number") {
    return {
      itemId,
      outputIndex: existing,
    };
  }
  const next = input.nextOutputIndexRef.value;
  input.nextOutputIndexRef.value += 1;
  input.assistantState.assistantOutputIndexByItemId.set(itemId, next);
  return {
    itemId,
    outputIndex: next,
  };
}

function emitCodexAssistantTextEvents(input: {
  event: Record<string, JSONValue>;
  emit: (event: Record<string, JSONValue>) => void;
  emitText?: (text: string) => void;
  assistantState: CodexAssistantStreamState;
  nextOutputIndexRef: { value: number };
}): void {
  const payloadType = typeof input.event.type === "string"
    ? input.event.type
    : "";
  if (!payloadType.startsWith("item.")) return;
  const item = input.event.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return;
  const record = item as Record<string, JSONValue>;
  if (record.type !== "agent_message") return;

  const { itemId, outputIndex } = resolveCodexAssistantItemIdentity({
    payloadType,
    record,
    assistantState: input.assistantState,
    nextOutputIndexRef: input.nextOutputIndexRef,
  });
  const text = extractCodexItemText(record);
  if (!text) return;

  if (payloadType === "item.delta") {
    input.assistantState.sawAssistantTextStream = true;
    input.assistantState.streamedText += text;
    input.emit({
      type: "response.output_text.delta",
      output_index: outputIndex,
      delta: text,
      item_id: itemId,
    });
    input.emitText?.(text);
    return;
  }

  if (payloadType === "item.completed" || payloadType === "item.done") {
    const hadPriorAssistantDelta = input.assistantState.sawAssistantTextStream;
    input.assistantState.sawAssistantTextStream = true;
    input.assistantState.streamedText = text;
    input.emit({
      type: "response.output_text.done",
      output_index: outputIndex,
      text,
      item_id: itemId,
    });
    if (!input.assistantState.emittedTerminalAssistantItemIds.has(itemId)) {
      input.assistantState.emittedTerminalAssistantItemIds.add(itemId);
      input.emit({
        type: "response.output_item.done",
        output_index: outputIndex,
        item: {
          type: "message",
          role: "assistant",
          id: itemId,
          content: [{ type: "output_text", text }],
        },
      });
    }
    if (!hadPriorAssistantDelta) {
      input.emitText?.(text);
    }
  }
}

function emitCodexReasoningEvents(input: {
  event: Record<string, JSONValue>;
  emit: (event: Record<string, JSONValue>) => void;
}): void {
  const payloadType = typeof input.event.type === "string"
    ? input.event.type
    : "";
  if (!payloadType.startsWith("item.")) return;
  const item = input.event.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return;
  const record = item as Record<string, JSONValue>;
  if (record.type !== "reasoning") return;

  const itemId = typeof record.id === "string" ? record.id : "reasoning";
  const outputIndex = 0;
  const contentIndex = 0;

  if (payloadType === "item.delta") {
    const deltaText = typeof record.text === "string"
      ? record.text
      : extractTextParts(record.content).join("");
    if (deltaText) {
      input.emit({
        type: "response.reasoning.delta",
        output_index: outputIndex,
        item_id: itemId,
        content_index: contentIndex,
        delta: deltaText,
      });
    }
  }

  if (payloadType === "item.completed" || payloadType === "item.done") {
    const doneText = typeof record.text === "string"
      ? record.text
      : extractTextParts(record.content).join("");
    input.emit({
      type: "response.reasoning.done",
      output_index: outputIndex,
      item_id: itemId,
      content_index: contentIndex,
      text: doneText,
    });
    const summaryParts = Array.isArray(record.summary) ? record.summary : [];
    const summaryTexts: Array<string> = [];
    summaryParts.forEach((part, idx) => {
      if (!part || typeof part !== "object") return;
      const partRecord = part as Record<string, JSONValue>;
      const text = typeof partRecord.text === "string" ? partRecord.text : "";
      summaryTexts.push(text);
      input.emit({
        type: "response.reasoning_summary_part.added",
        output_index: outputIndex,
        item_id: itemId,
        summary_index: idx,
        part: {
          type: "summary_text",
          text,
        },
      });
      input.emit({
        type: "response.reasoning_summary_part.done",
        output_index: outputIndex,
        item_id: itemId,
        summary_index: idx,
        part: {
          type: "summary_text",
          text,
        },
      });
      input.emit({
        type: "response.reasoning_summary_text.delta",
        output_index: outputIndex,
        item_id: itemId,
        summary_index: idx,
        delta: text,
      });
    });
    if (summaryTexts.length > 0) {
      input.emit({
        type: "response.reasoning_summary_text.done",
        output_index: outputIndex,
        item_id: itemId,
        summary_index: 0,
        text: summaryTexts.join("\n").trim(),
      });
    }
  }
}

function responseItemsToChatMessages(
  items: Array<ResponseItem>,
  instructions?: string,
): Array<ModelMessage> {
  const messages: Array<ModelMessage> = [];
  if (typeof instructions === "string" && instructions.trim().length > 0) {
    messages.push({ role: "system", content: instructions });
  }
  for (const item of items) {
    if (item.type === "message") {
      const content = item.content.map((part) => part.text).join("");
      messages.push({ role: item.role, content });
      continue;
    }
    if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: item.call_id,
          type: "function",
          function: { name: item.name, arguments: item.arguments },
        }],
      });
      continue;
    }
    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        content: item.output,
        tool_call_id: item.call_id,
      });
    }
  }
  return messages;
}

function responseItemsFromAssistantMessage(
  message: ModelMessage,
): Array<ResponseItem> {
  const output: Array<ResponseItem> = [];
  if (typeof message.content === "string" && message.content.length > 0) {
    output.push(
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: message.content }],
      } satisfies ResponseMessageItem,
    );
  }
  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      output.push({
        type: "function_call",
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      });
    }
  }
  return output;
}

function responseItemsFromAssistantMessages(
  messages: Array<CodexAssistantMessage>,
): Array<ResponseItem> {
  return messages
    .filter((message) => message.text.length > 0)
    .map((message) =>
      ({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: message.text }],
        ...(message.itemId ? { id: message.itemId } : {}),
      }) satisfies ResponseMessageItem
    );
}

function stringContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  return "";
}

function codexInstructionsForMessages(messages: Array<ModelMessage>): string {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => stringContent(message.content))
    .filter(Boolean)
    .join("\n\n");
}

function renderNonSystemMessagesForPrompt(
  messages: Array<ModelMessage>,
): string {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      const content = stringContent(message.content);
      if (!content) return "";
      return `${message.role.toUpperCase()}:\n${content}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function latestUserPrompt(messages: Array<ModelMessage>): string {
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const msg = messages[idx];
    if (msg.role !== "user") continue;
    const content = stringContent(msg.content);
    if (content) return content;
  }
  return "";
}

function promptForCodexTurn(input: {
  messages: Array<ModelMessage>;
  priorThreadId?: string;
}): string {
  if (input.priorThreadId) {
    // Thread resume should be incremental: only send the newest user turn.
    return latestUserPrompt(input.messages);
  }
  const nonSystemMessages = input.messages.filter((message) =>
    message.role !== "system"
  );
  const latestUser = latestUserPrompt(nonSystemMessages);
  if (
    nonSystemMessages.length <= 1 &&
    nonSystemMessages.every((message) => message.role === "user")
  ) {
    return latestUser;
  }
  return renderNonSystemMessagesForPrompt(nonSystemMessages);
}

function parseNumber(input: unknown): number {
  return typeof input === "number" && Number.isFinite(input) ? input : 0;
}

function parseCodexStdout(stdout: string): {
  threadId?: string;
  assistantText: string;
  assistantMessages: Array<CodexAssistantMessage>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
} {
  let threadId: string | undefined;
  const assistantMessages: Array<CodexAssistantMessage> = [];
  let usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | undefined;
  const assistantState: CodexAssistantStreamState = {
    streamedText: "",
    sawAssistantTextStream: false,
    assistantOutputIndexByItemId: new Map<string, number>(),
    emittedTerminalAssistantItemIds: new Set<string>(),
  };
  const nextOutputIndexRef = { value: 0 };

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: CodexEvent | null = null;
    try {
      parsed = JSON.parse(trimmed) as CodexEvent;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;

    if (parsed.type === "thread.started") {
      if (typeof parsed.thread_id === "string" && parsed.thread_id.trim()) {
        threadId = parsed.thread_id.trim();
      }
      continue;
    }

    if (
      parsed.type === "item.delta" || parsed.type === "item.completed" ||
      parsed.type === "item.done"
    ) {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (!item || typeof item !== "object") continue;
      if (item.type !== "agent_message") continue;
      const { itemId } = resolveCodexAssistantItemIdentity({
        payloadType: parsed.type,
        record: item as Record<string, JSONValue>,
        assistantState,
        nextOutputIndexRef,
      });
      if (parsed.type === "item.delta") continue;
      const content = typeof item.text === "string"
        ? item.text.trim()
        : Array.isArray(item.content)
        ? item.content
          .filter((entry) => entry && typeof entry === "object")
          .map((entry) => {
            const record = entry as Record<string, unknown>;
            return typeof record.text === "string" ? record.text : "";
          })
          .join("")
          .trim()
        : "";
      if (content) {
        assistantMessages.push({
          itemId,
          text: content,
        });
      }
      continue;
    }

    if (parsed.type === "turn.completed") {
      const rawUsage = parsed.usage as Record<string, unknown> | undefined;
      if (!rawUsage || typeof rawUsage !== "object") continue;
      usage = {
        promptTokens: parseNumber(rawUsage.input_tokens),
        completionTokens: parseNumber(rawUsage.output_tokens),
        totalTokens: parseNumber(rawUsage.total_tokens),
      };
    }
  }

  return {
    threadId,
    assistantText: assistantMessages.map((message) => message.text).join(""),
    assistantMessages,
    usage,
  };
}

function buildUpdatedState(input: {
  priorState?: SavedState;
  messages: Array<ModelMessage>;
  assistantText: string;
  assistantMessages?: Array<CodexAssistantMessage>;
  threadId?: string;
}): SavedState {
  const priorState = input.priorState;
  const baseMessages = input.messages.map((message) => ({ ...message }));
  if (input.assistantMessages && input.assistantMessages.length > 0) {
    baseMessages.push(
      ...input.assistantMessages.map((message) => ({
        role: "assistant" as const,
        content: message.text,
      })),
    );
  } else {
    baseMessages.push({ role: "assistant", content: input.assistantText });
  }
  const meta = { ...(priorState?.meta ?? {}) };
  if (input.threadId) {
    meta[CODEX_THREAD_META_KEY] = input.threadId;
  }
  return {
    runId: priorState?.runId ?? crypto.randomUUID(),
    messages: baseMessages,
    format: priorState?.format ?? "chat",
    items: priorState?.items,
    messageRefs: priorState?.messageRefs,
    feedback: priorState?.feedback,
    meta,
    notes: priorState?.notes,
    conversationScore: priorState?.conversationScore,
  };
}

function defaultCommandRunner(input: {
  args: Array<string>;
  cwd: string;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
}): Promise<CommandOutput> {
  const codexBin = Deno.env.get(CODEX_BIN_ENV)?.trim() || "codex";
  const child = new Deno.Command(codexBin, {
    args: input.args,
    cwd: input.cwd,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const abort = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  };
  if (input.signal?.aborted) {
    abort();
  } else if (input.signal) {
    input.signal.addEventListener("abort", abort, { once: true });
  }
  const readStream = async (
    stream: ReadableStream<Uint8Array> | null,
    onLine?: (line: string) => void,
  ): Promise<Uint8Array> => {
    if (!stream) return new Uint8Array();
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks: Array<Uint8Array> = [];
    let buffered = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        if (onLine) {
          buffered += decoder.decode(value, { stream: true });
          const parts = buffered.split(/\r?\n/);
          buffered = parts.pop() ?? "";
          for (const line of parts) onLine(line);
        }
      }
    }
    if (onLine && buffered.trim()) onLine(buffered);
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  };
  return Promise.all([
    child.status,
    readStream(child.stdout, input.onStdoutLine),
    readStream(child.stderr),
  ]).then(([status, stdout, stderr]) => ({
    success: status.success,
    code: status.code,
    stdout,
    stderr,
  })).finally(() => {
    if (input.signal) {
      input.signal.removeEventListener("abort", abort);
    }
  });
}

function buildCodexStreamHandler(input: {
  emitRaw: (event: Record<string, JSONValue>) => void;
  emitTool: (event: Record<string, JSONValue>) => void;
  emitText?: (text: string) => void;
  assistantState: CodexAssistantStreamState;
}): (event: Record<string, JSONValue>) => void {
  const toolNames = new Map<string, string>();
  const emittedCalls = new Set<string>();
  const emittedTerminalResults = new Set<string>();
  const lastResultFingerprintByCallId = new Map<string, string>();
  const toolOutputIndexByCallId = new Map<string, number>();
  const nextOutputIndexRef = { value: 0 };
  return (event) => {
    emitCodexAssistantTextEvents({
      event,
      emit: input.emitTool,
      emitText: input.emitText,
      assistantState: input.assistantState,
      nextOutputIndexRef,
    });
    emitCodexReasoningEvents({
      event,
      emit: input.emitTool,
    });
    emitCodexToolEvents({
      event,
      emit: input.emitTool,
      toolNames,
      emittedCalls,
      emittedTerminalResults,
      lastResultFingerprintByCallId,
      toolOutputIndexByCallId,
      nextOutputIndexRef,
    });
    input.emitRaw(event);
  };
}

export function createCodexProvider(opts?: {
  runCommand?: CommandRunner;
  runAppServerTurn?: AppServerTurnRunner;
}): ModelProvider {
  const runCommand = opts?.runCommand ?? defaultCommandRunner;
  const runAppServerTurn = opts?.runAppServerTurn ?? defaultAppServerTurnRunner;
  const runCodexTurn = async (
    input: Parameters<NonNullable<ModelProvider["chat"]>>[0],
  ): Promise<
    Awaited<ReturnType<NonNullable<ModelProvider["chat"]>>> & {
      assistantMessages: Array<CodexAssistantMessage>;
    }
  > => {
    if (input.signal?.aborted) {
      throw new DOMException("Run canceled", "AbortError");
    }
    const assistantState: CodexAssistantStreamState = {
      streamedText: "",
      sawAssistantTextStream: false,
      assistantOutputIndexByItemId: new Map<string, number>(),
      emittedTerminalAssistantItemIds: new Set<string>(),
    };
    const streamHandler = (input.onStreamEvent || input.onTraceEvent ||
        (input.stream && input.onStreamText))
      ? buildCodexStreamHandler({
        emitRaw: (event) => input.onStreamEvent?.(event),
        emitTool: (event) => {
          input.onStreamEvent?.(event);
          input.onTraceEvent?.(
            // this predates the lint rule
            event as unknown as import("@bolt-foundry/gambit-core").ProviderTraceEvent,
          );
        },
        emitText: input.stream
          ? (text) => input.onStreamText?.(text)
          : undefined,
        assistantState,
      })
      : undefined;
    const priorThreadIdRaw = input.state?.meta?.[CODEX_THREAD_META_KEY];
    const priorThreadId = typeof priorThreadIdRaw === "string" &&
        priorThreadIdRaw.trim().length > 0
      ? priorThreadIdRaw.trim()
      : undefined;
    const model = normalizeCodexModel(input.model);
    const instructions = codexInstructionsForMessages(input.messages);
    const prompt = promptForCodexTurn({
      messages: input.messages,
      priorThreadId,
    });
    const cwd = runCwd();
    if (codexTransport() === "app-server") {
      const result = await runAppServerTurn({
        model: input.model,
        messages: input.messages,
        state: input.state,
        params: input.params,
        deckPath: input.deckPath,
        signal: input.signal,
        onStreamEvent: streamHandler,
        instructions,
        prompt,
        cwd,
        priorThreadId,
      });
      const assistantText = result.assistantMessages.map((message) =>
        message.text
      )
        .join("");
      if (
        input.stream && input.onStreamText && assistantText &&
        !assistantState.sawAssistantTextStream
      ) {
        input.onStreamText(assistantText);
      }
      const updatedState = buildUpdatedState({
        priorState: input.state,
        messages: input.messages,
        assistantText,
        assistantMessages: result.assistantMessages,
        threadId: result.threadId ?? priorThreadId,
      });
      return {
        message: { role: "assistant", content: assistantText },
        finishReason: "stop" as const,
        updatedState,
        usage: result.usage,
        assistantMessages: result.assistantMessages,
      };
    }
    const skipSandboxConfig = shouldSkipCodexSandboxConfig(input.params);
    const args = priorThreadId
      ? [
        "exec",
        "resume",
        "--skip-git-repo-check",
        "--json",
      ]
      : ["exec", "--skip-git-repo-check", "--json"];
    if (skipSandboxConfig) {
      args.push("--yolo");
    }
    args.push(
      ...codexConfigArgs({
        cwd,
        deckPath: input.deckPath,
        params: input.params,
        instructions,
      }),
    );
    if (model && model !== "default") {
      args.push("-m", model);
    }
    if (priorThreadId) {
      args.push(priorThreadId);
    }
    args.push(prompt);
    const handleStdoutLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
          streamHandler
        ) {
          streamHandler(parsed as Record<string, JSONValue>);
        }
      } catch {
        // ignore malformed/non-json lines
      }
    };
    const out = await runCommand({
      args,
      cwd,
      signal: input.signal,
      onStdoutLine: streamHandler ? handleStdoutLine : undefined,
    });
    if (input.signal?.aborted) {
      throw new DOMException("Run canceled", "AbortError");
    }
    const stdout = new TextDecoder().decode(out.stdout);
    const stderr = new TextDecoder().decode(out.stderr);
    if (!out.success) {
      throw new Error(
        `codex exec failed (exit ${out.code}): ${
          stderr.trim() || stdout.trim()
        }`,
      );
    }
    const parsed = parseCodexStdout(stdout);
    const threadId = parsed.threadId ?? priorThreadId;
    if (
      input.stream && input.onStreamText && parsed.assistantText &&
      !assistantState.sawAssistantTextStream
    ) {
      input.onStreamText(parsed.assistantText);
    }
    const updatedState = buildUpdatedState({
      priorState: input.state,
      messages: input.messages,
      assistantText: parsed.assistantText,
      assistantMessages: parsed.assistantMessages,
      threadId,
    });

    return {
      message: { role: "assistant", content: parsed.assistantText },
      finishReason: "stop" as const,
      updatedState,
      usage: parsed.usage,
      assistantMessages: parsed.assistantMessages,
    };
  };
  const runChat: ModelProvider["chat"] = async (input) => {
    const result = await runCodexTurn(input);
    return {
      message: result.message,
      finishReason: result.finishReason,
      updatedState: result.updatedState,
      usage: result.usage,
    };
  };

  return {
    async responses(input: {
      request: CreateResponseRequest;
      state?: SavedState;
      deckPath?: string;
      signal?: AbortSignal;
      onStreamEvent?: (event: ResponseEvent) => void;
    }): Promise<CreateResponseResponse> {
      const streamHandler = input.onStreamEvent
        ? (() => {
          const assistantState: CodexAssistantStreamState = {
            streamedText: "",
            sawAssistantTextStream: false,
            assistantOutputIndexByItemId: new Map<string, number>(),
            emittedTerminalAssistantItemIds: new Set<string>(),
          };
          return {
            assistantState,
            handle: buildCodexStreamHandler({
              emitRaw: (event) => {
                input.onStreamEvent?.({
                  type: "codex.event",
                  payload: event,
                  // this predates the lint rule
                } as unknown as ResponseEvent);
              },
              emitTool: (event) => {
                // this predates the lint rule
                input.onStreamEvent?.(event as unknown as ResponseEvent);
              },
              assistantState,
            }),
          };
        })()
        : undefined;
      const result = await runCodexTurn({
        model: input.request.model,
        messages: responseItemsToChatMessages(
          input.request.input,
          input.request.instructions,
        ),
        stream: input.request.stream,
        params: input.request.params,
        state: input.state,
        deckPath: input.deckPath,
        signal: input.signal,
        onStreamEvent: streamHandler?.handle,
      });

      const output = result.assistantMessages.length > 0
        ? responseItemsFromAssistantMessages(result.assistantMessages)
        : responseItemsFromAssistantMessage(result.message);
      const responseId = `codex-${crypto.randomUUID()}`;
      const createdAt = Math.floor(Date.now() / 1000);
      if (input.request.stream) {
        input.onStreamEvent?.({
          type: "response.created",
          sequence_number: 0,
          response: {
            id: responseId,
            object: "response",
            model: input.request.model,
            created_at: createdAt,
            created: createdAt,
            status: "in_progress",
            output: [],
            error: null,
          },
        });
        if (
          !streamHandler?.assistantState.sawAssistantTextStream
        ) {
          const fallbackMessages = result.assistantMessages.length > 0
            ? result.assistantMessages
            : typeof result.message.content === "string" &&
                result.message.content
            ? [{ itemId: null, text: result.message.content }]
            : [];
          fallbackMessages.forEach((message, index) => {
            if (!message.text) return;
            input.onStreamEvent?.({
              type: "response.output_text.delta",
              sequence_number: 1 + (index * 2),
              output_index: index,
              delta: message.text,
              ...(message.itemId ? { item_id: message.itemId } : {}),
            });
            input.onStreamEvent?.({
              type: "response.output_text.done",
              sequence_number: 2 + (index * 2),
              output_index: index,
              text: message.text,
              ...(message.itemId ? { item_id: message.itemId } : {}),
            });
          });
        }
        output.forEach((item, index) => {
          if (
            item.type === "message" &&
            item.role === "assistant" &&
            typeof item.id === "string" &&
            streamHandler?.assistantState.emittedTerminalAssistantItemIds.has(
              item.id,
            )
          ) {
            return;
          }
          input.onStreamEvent?.({
            type: "response.output_item.added",
            sequence_number: 3 + (index * 2),
            output_index: index,
            item,
          });
          input.onStreamEvent?.({
            type: "response.output_item.done",
            sequence_number: 4 + (index * 2),
            output_index: index,
            item,
          });
        });
      }

      const response: CreateResponseResponse = {
        id: responseId,
        object: "response",
        model: input.request.model,
        created_at: createdAt,
        created: createdAt,
        status: "completed",
        output,
        usage: result.usage,
        error: null,
        updatedState: result.updatedState,
      };
      if (input.request.stream) {
        input.onStreamEvent?.({
          type: "response.completed",
          sequence_number: 1000,
          response,
        });
      }
      return response;
    },
    chat: runChat,
  };
}

export function parseCodexArgsForTest(input: {
  model: string;
  state?: SavedState;
  messages: Array<ModelMessage>;
  params?: Record<string, unknown>;
  cwd?: string;
  deckPath?: string;
}): Array<string> {
  const priorThreadIdRaw = input.state?.meta?.[CODEX_THREAD_META_KEY];
  const priorThreadId = typeof priorThreadIdRaw === "string" &&
      priorThreadIdRaw.trim().length > 0
    ? priorThreadIdRaw.trim()
    : undefined;
  const model = normalizeCodexModel(input.model);
  const instructions = codexInstructionsForMessages(input.messages);
  const prompt = promptForCodexTurn({
    messages: input.messages,
    priorThreadId,
  });
  const skipSandboxConfig = shouldSkipCodexSandboxConfig(input.params);
  const args = priorThreadId
    ? ["exec", "resume", "--skip-git-repo-check", "--json"]
    : ["exec", "--skip-git-repo-check", "--json"];
  if (skipSandboxConfig) {
    args.push("--yolo");
  }
  args.push(
    ...codexConfigArgs({
      cwd: input.cwd ?? runCwd(),
      deckPath: input.deckPath,
      params: input.params,
      instructions,
    }),
  );
  if (model && model !== "default") {
    args.push("-m", model);
  }
  if (priorThreadId) args.push(priorThreadId);
  args.push(prompt);
  return args;
}

export function parseCodexStdoutForTest(stdout: string): {
  threadId?: string;
  assistantText: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
} {
  return parseCodexStdout(stdout);
}

export function safeJsonForTest(text: string): Record<string, JSONValue> {
  return safeJsonObject(text);
}
