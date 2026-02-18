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
const MCP_ROOT_DECK_PATH_ENV = "GAMBIT_MCP_ROOT_DECK_PATH";
const MCP_SERVER_PATH = path.resolve(
  path.dirname(path.fromFileUrl(import.meta.url)),
  "../mcp_server.ts",
);

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

type CommandRunner = (input: {
  args: Array<string>;
  cwd: string;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
}) => Promise<CommandOutput>;

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

function runCwd(): string {
  const botRoot = Deno.env.get(BOT_ROOT_ENV);
  if (typeof botRoot === "string" && botRoot.trim().length > 0) {
    return botRoot.trim();
  }
  return Deno.cwd();
}

function shouldEnableMcpBridge(): boolean {
  const parseTruthy = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return normalized === "1" || normalized === "true" || normalized === "yes";
  };
  const disableRaw = Deno.env.get(CODEX_DISABLE_MCP_ENV);
  if (disableRaw && parseTruthy(disableRaw)) return false;
  const enableRaw = Deno.env.get(CODEX_MCP_ENV);
  if (!enableRaw) return true;
  const normalized = enableRaw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function tomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function tomlStringArray(values: Array<string>): string {
  return `[${values.map(tomlString).join(",")}]`;
}

function codexConfigArgs(input: {
  cwd: string;
  deckPath?: string;
  params?: Record<string, unknown>;
}): Array<string> {
  const args: Array<string> = [];
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

  if (shouldEnableMcpBridge()) {
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

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function emitCodexToolEvents(input: {
  event: Record<string, JSONValue>;
  emit: (event: Record<string, JSONValue>) => void;
  toolNames: Map<string, string>;
  emittedCalls: Set<string>;
  emittedResults: Set<string>;
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
  }

  if (input.emittedResults.has(callId)) return;
  const resolvedName = name ?? input.toolNames.get(callId) ?? itemType;
  if (!resolvedName) return;
  const isTerminal = payloadType === "item.completed" ||
    payloadType === "item.done";
  if (!isTerminal) return;
  input.emittedResults.add(callId);
  const result: JSONValue = (() => {
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
  })();
  input.emit({
    type: "tool.result",
    actionCallId: callId,
    name: resolvedName,
    result,
    toolKind: "mcp_bridge",
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
    summaryParts.forEach((part, idx) => {
      if (!part || typeof part !== "object") return;
      const partRecord = part as Record<string, JSONValue>;
      const text = typeof partRecord.text === "string" ? partRecord.text : "";
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
    });
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

function stringContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content.trim();
  return "";
}

function renderMessagesForPrompt(messages: Array<ModelMessage>): string {
  return messages
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
  return renderMessagesForPrompt(input.messages);
}

function parseNumber(input: unknown): number {
  return typeof input === "number" && Number.isFinite(input) ? input : 0;
}

function parseCodexStdout(stdout: string): {
  threadId?: string;
  assistantText: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
} {
  let threadId: string | undefined;
  let assistantText = "";
  let usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | undefined;

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

    if (parsed.type === "item.completed") {
      const item = parsed.item as Record<string, unknown> | undefined;
      if (!item || typeof item !== "object") continue;
      if (item.type !== "agent_message") continue;
      if (typeof item.text !== "string") continue;
      const content = item.text.trim();
      if (content) assistantText = content;
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

  return { threadId, assistantText, usage };
}

function buildUpdatedState(input: {
  priorState?: SavedState;
  messages: Array<ModelMessage>;
  assistantText: string;
  threadId?: string;
}): SavedState {
  const priorState = input.priorState;
  const baseMessages = input.messages.map((message) => ({ ...message }));
  baseMessages.push({ role: "assistant", content: input.assistantText });
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
    traces: priorState?.traces,
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
}): (event: Record<string, JSONValue>) => void {
  const toolNames = new Map<string, string>();
  const emittedCalls = new Set<string>();
  const emittedResults = new Set<string>();
  return (event) => {
    emitCodexReasoningEvents({
      event,
      emit: input.emitTool,
    });
    emitCodexToolEvents({
      event,
      emit: input.emitTool,
      toolNames,
      emittedCalls,
      emittedResults,
    });
    input.emitRaw(event);
  };
}

export function createCodexProvider(opts?: {
  runCommand?: CommandRunner;
}): ModelProvider {
  const runCommand = opts?.runCommand ?? defaultCommandRunner;
  const runChat: ModelProvider["chat"] = async (input) => {
    if (input.signal?.aborted) {
      throw new DOMException("Run canceled", "AbortError");
    }
    const streamHandler = (input.onStreamEvent || input.onTraceEvent)
      ? buildCodexStreamHandler({
        emitRaw: (event) => input.onStreamEvent?.(event),
        emitTool: (event) => {
          input.onStreamEvent?.(event);
          input.onTraceEvent?.(
            event as unknown as import("@bolt-foundry/gambit-core").ProviderTraceEvent,
          );
        },
      })
      : undefined;
    const priorThreadIdRaw = input.state?.meta?.[CODEX_THREAD_META_KEY];
    const priorThreadId = typeof priorThreadIdRaw === "string" &&
        priorThreadIdRaw.trim().length > 0
      ? priorThreadIdRaw.trim()
      : undefined;
    const model = normalizeCodexModel(input.model);
    const prompt = promptForCodexTurn({
      messages: input.messages,
      priorThreadId,
    });
    const cwd = runCwd();
    const args = priorThreadId
      ? [
        "exec",
        "resume",
        "--skip-git-repo-check",
        "--json",
      ]
      : ["exec", "--skip-git-repo-check", "--json"];
    args.push(
      ...codexConfigArgs({
        cwd,
        deckPath: input.deckPath,
        params: input.params,
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
    if (input.stream && input.onStreamText && parsed.assistantText) {
      input.onStreamText(parsed.assistantText);
    }
    const updatedState = buildUpdatedState({
      priorState: input.state,
      messages: input.messages,
      assistantText: parsed.assistantText,
      threadId,
    });

    return {
      message: { role: "assistant", content: parsed.assistantText },
      finishReason: "stop" as const,
      updatedState,
      usage: parsed.usage,
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
        ? buildCodexStreamHandler({
          emitRaw: (event) => {
            input.onStreamEvent?.({
              type: "codex.event",
              payload: event,
            } as unknown as ResponseEvent);
          },
          emitTool: (event) => {
            input.onStreamEvent?.(event as unknown as ResponseEvent);
          },
        })
        : undefined;
      const result = await runChat({
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
        onStreamEvent: streamHandler,
      });

      const output = responseItemsFromAssistantMessage(result.message);
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
          typeof result.message.content === "string" && result.message.content
        ) {
          input.onStreamEvent?.({
            type: "response.output_text.delta",
            sequence_number: 1,
            output_index: 0,
            delta: result.message.content,
          });
          input.onStreamEvent?.({
            type: "response.output_text.done",
            sequence_number: 2,
            output_index: 0,
            text: result.message.content,
          });
        }
        output.forEach((item, index) => {
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
  const prompt = promptForCodexTurn({
    messages: input.messages,
    priorThreadId,
  });
  const args = priorThreadId
    ? ["exec", "resume", "--skip-git-repo-check", "--json"]
    : ["exec", "--skip-git-repo-check", "--json"];
  args.push(
    ...codexConfigArgs({
      cwd: input.cwd ?? runCwd(),
      deckPath: input.deckPath,
      params: input.params,
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
