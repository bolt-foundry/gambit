import type {
  CreateResponseRequest,
  CreateResponseResponse,
  JSONValue,
  ModelMessage,
  ModelProvider,
  ProviderTraceEvent,
  ResponseEvent,
  ResponseItem,
  ResponseMessageItem,
  SavedState,
} from "@bolt-foundry/gambit-core";

export const CLAUDE_CODE_PREFIX = "claude-code-cli/";
export const CLAUDE_CODE_ALIAS = "claude-code-cli";
const CLAUDE_CODE_BIN_ENV = "GAMBIT_CLAUDE_CODE_BIN";
const CLAUDE_CODE_PERMISSION_MODE_ENV = "GAMBIT_CLAUDE_CODE_PERMISSION_MODE";
const CLAUDE_CODE_SESSION_META_KEY = "claudeCode.sessionId";
const BOT_ROOT_ENV = "GAMBIT_BOT_ROOT";

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

function runCwd(): string {
  const botRoot = Deno.env.get(BOT_ROOT_ENV);
  if (typeof botRoot === "string" && botRoot.trim().length > 0) {
    return botRoot.trim();
  }
  return Deno.cwd();
}

function normalizeClaudeCodeModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "";
  if (trimmed === CLAUDE_CODE_ALIAS) return "default";
  if (trimmed.startsWith(CLAUDE_CODE_PREFIX)) {
    const stripped = trimmed.slice(CLAUDE_CODE_PREFIX.length).trim();
    if (!stripped) {
      throw new Error(
        'Claude Code model prefix requires a model segment. Use "claude-code-cli/default" or "claude-code-cli/<model>".',
      );
    }
    return stripped;
  }
  return trimmed;
}

function stringContent(content: ModelMessage["content"]): string {
  return typeof content === "string" ? content.trim() : "";
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

function parseNumber(input: unknown): number {
  return typeof input === "number" && Number.isFinite(input) ? input : 0;
}

function parseJsonValue(text: string): JSONValue {
  try {
    return JSON.parse(text) as JSONValue;
  } catch {
    return text;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractUsageFromRecord(
  record: Record<string, unknown> | null,
): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} | undefined {
  if (!record) return undefined;
  return {
    promptTokens: parseNumber(record.input_tokens ?? record.prompt_tokens),
    completionTokens: parseNumber(
      record.output_tokens ?? record.completion_tokens,
    ),
    totalTokens: parseNumber(record.total_tokens),
  };
}

function extractAssistantTextFromClaudeMessage(
  message: Record<string, unknown> | null,
): string {
  if (!message) return "";
  const content = message.content;
  if (!Array.isArray(content)) {
    return asString(message.text).trim();
  }
  const parts: Array<string> = [];
  for (const part of content) {
    const block = asRecord(part);
    if (!block) continue;
    const blockType = asString(block.type);
    if (
      blockType === "text" || blockType === "output_text" ||
      blockType === "assistant_text"
    ) {
      const text = asString(block.text);
      if (text) parts.push(text);
    }
  }
  return parts.join("").trim();
}

function extractBestText(input: unknown): string | undefined {
  if (typeof input === "string" && input.trim()) return input.trim();
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const direct = [
    record.result,
    record.output,
    record.text,
    record.content,
    record.response,
    record.message,
  ];
  for (const value of direct) {
    const extracted = extractBestText(value);
    if (extracted) return extracted;
  }
  return undefined;
}

function parseClaudeCodeStdout(stdout: string): {
  assistantText: string;
  sessionId?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
} {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { assistantText: "" };
  }
  const streamLines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(
    (line) => line.startsWith("{"),
  );
  if (streamLines.length > 0) {
    let assistantText = "";
    let sessionId: string | undefined;
    let usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    } | undefined;
    for (const line of streamLines) {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!parsed) continue;
      const type = asString(parsed.type);
      const nextSessionId = asString(parsed.session_id || parsed.sessionId);
      if (nextSessionId) sessionId = nextSessionId;
      usage = extractUsageFromRecord(asRecord(parsed.usage)) ?? usage ??
        extractUsageFromRecord(
          asRecord(asRecord(parsed.message)?.usage),
        );
      if (type === "assistant") {
        const messageText = extractAssistantTextFromClaudeMessage(
          asRecord(parsed.message),
        );
        if (messageText) assistantText = messageText;
      } else if (type === "result") {
        const resultText = extractBestText(parsed.result) ??
          extractBestText(parsed);
        if (resultText) assistantText = resultText;
      } else {
        const fallbackText = extractBestText(parsed);
        if (fallbackText) assistantText = fallbackText;
      }
    }
    return { assistantText, sessionId, usage };
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const usage = extractUsageFromRecord(asRecord(parsed.usage));
    const assistantText = extractBestText(parsed) ?? trimmed;
    const sessionRaw = parsed.session_id ?? parsed.sessionId;
    const sessionId = typeof sessionRaw === "string" && sessionRaw.trim()
      ? sessionRaw.trim()
      : undefined;
    return { assistantText, sessionId, usage };
  } catch {
    return { assistantText: trimmed };
  }
}

function buildUpdatedState(input: {
  priorState?: SavedState;
  messages: Array<ModelMessage>;
  assistantText: string;
  sessionId?: string;
}): SavedState {
  const priorState = input.priorState;
  const baseMessages = input.messages.map((message) => ({ ...message }));
  baseMessages.push({ role: "assistant", content: input.assistantText });
  const meta = { ...(priorState?.meta ?? {}) };
  if (input.sessionId) {
    meta[CLAUDE_CODE_SESSION_META_KEY] = input.sessionId;
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
  const claudeBin = Deno.env.get(CLAUDE_CODE_BIN_ENV)?.trim() || "claude";
  const child = new Deno.Command(claudeBin, {
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
      if (!value) continue;
      chunks.push(value);
      if (onLine) {
        buffered += decoder.decode(value, { stream: true });
        const parts = buffered.split(/\r?\n/);
        buffered = parts.pop() ?? "";
        for (const line of parts) onLine(line);
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

function buildClaudeStreamHandler(input: {
  emitRaw: (event: Record<string, JSONValue>) => void;
  emitNormalized: (event: Record<string, JSONValue>) => void;
}): (event: Record<string, JSONValue>) => void {
  const toolNames = new Map<string, string>();
  const emittedCalls = new Set<string>();
  const emittedResults = new Set<string>();
  const reasoningTextById = new Map<string, string>();

  const emitToolCall = (value: Record<string, unknown>) => {
    const actionCallId = asString(value.id || value.call_id);
    if (!actionCallId || emittedCalls.has(actionCallId)) return;
    const name = asString(value.name || value.tool) || "tool";
    emittedCalls.add(actionCallId);
    toolNames.set(actionCallId, name);
    input.emitNormalized({
      type: "tool.call",
      actionCallId,
      name,
      args: (() => {
        const rawArgs = value.input ?? value.arguments ?? {};
        if (typeof rawArgs === "string") return parseJsonValue(rawArgs);
        return rawArgs as JSONValue;
      })(),
      toolKind: "mcp_bridge",
    });
  };

  const emitToolResult = (value: Record<string, unknown>) => {
    const actionCallId = asString(
      value.tool_use_id || value.call_id || value.id,
    );
    if (!actionCallId || emittedResults.has(actionCallId)) return;
    emittedResults.add(actionCallId);
    const name = toolNames.get(actionCallId) || "tool";
    input.emitNormalized({
      type: "tool.result",
      actionCallId,
      name,
      result: (value.content ?? value.result ?? value) as JSONValue,
      toolKind: "mcp_bridge",
    });
  };

  const emitReasoning = (
    value: Record<string, unknown>,
    fallbackId: string,
  ) => {
    const reasoningId = asString(value.id) || fallbackId;
    const text = asString(value.thinking || value.text).trim();
    if (!text) return;
    const previous = reasoningTextById.get(reasoningId) ?? "";
    if (text !== previous && text.startsWith(previous) && previous.length > 0) {
      input.emitNormalized({
        type: "response.reasoning.delta",
        output_index: 0,
        item_id: reasoningId,
        content_index: 0,
        delta: text.slice(previous.length),
      });
    }
    reasoningTextById.set(reasoningId, text);
    input.emitNormalized({
      type: "response.reasoning.done",
      output_index: 0,
      item_id: reasoningId,
      content_index: 0,
      text,
    });
  };

  return (event) => {
    const type = asString(event.type);
    if (type === "assistant") {
      const message = asRecord(event.message);
      const content = Array.isArray(message?.content) ? message.content : [];
      const messageId = asString(message?.id) || "assistant";
      for (let idx = 0; idx < content.length; idx += 1) {
        const block = asRecord(content[idx]);
        if (!block) continue;
        const blockType = asString(block.type);
        if (blockType === "tool_use" || blockType === "server_tool_use") {
          emitToolCall(block);
          continue;
        }
        if (blockType === "thinking" || blockType === "redacted_thinking") {
          emitReasoning(block, `${messageId}:reasoning:${idx}`);
        }
      }
    } else if (type === "user") {
      const message = asRecord(event.message);
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const part of content) {
        const block = asRecord(part);
        if (!block) continue;
        const blockType = asString(block.type);
        if (
          blockType === "tool_result" ||
          blockType === "code_execution_tool_result"
        ) {
          emitToolResult(block);
        }
      }
    }

    input.emitRaw(event);
  };
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

export function createClaudeCodeProvider(opts?: {
  runCommand?: CommandRunner;
}): ModelProvider {
  const runCommand = opts?.runCommand ?? defaultCommandRunner;
  const runChat: ModelProvider["chat"] = async (input) => {
    if (input.signal?.aborted) {
      throw new DOMException("Run canceled", "AbortError");
    }
    const streamHandler = (input.onStreamEvent || input.onTraceEvent)
      ? buildClaudeStreamHandler({
        emitRaw: (event) => input.onStreamEvent?.(event),
        emitNormalized: (event) => {
          input.onStreamEvent?.(event);
          if (asString(event.type).startsWith("tool.")) {
            input.onTraceEvent?.(event as ProviderTraceEvent);
          }
        },
      })
      : undefined;
    const priorSessionIdRaw = input.state?.meta?.[CLAUDE_CODE_SESSION_META_KEY];
    const priorSessionId = typeof priorSessionIdRaw === "string" &&
        priorSessionIdRaw.trim().length > 0
      ? priorSessionIdRaw.trim()
      : undefined;
    const model = normalizeClaudeCodeModel(input.model);
    const prompt = renderMessagesForPrompt(input.messages);
    const cwd = runCwd();
    const permissionMode = Deno.env.get(CLAUDE_CODE_PERMISSION_MODE_ENV)
      ?.trim() || "bypassPermissions";
    const args: Array<string> = [
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--permission-mode",
      permissionMode,
    ];
    if (model && model !== "default") {
      args.push("--model", model);
    }
    if (priorSessionId) {
      args.push("--resume", priorSessionId);
    }
    args.push(prompt);
    const handleStdoutLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          streamHandler?.(parsed as Record<string, JSONValue>);
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
        `claude --print failed (exit ${out.code}): ${
          stderr.trim() || stdout.trim()
        }`,
      );
    }
    const parsed = parseClaudeCodeStdout(stdout);
    const sessionId = parsed.sessionId ?? priorSessionId;
    if (input.stream && input.onStreamText && parsed.assistantText) {
      input.onStreamText(parsed.assistantText);
    }
    const updatedState = buildUpdatedState({
      priorState: input.state,
      messages: input.messages,
      assistantText: parsed.assistantText,
      sessionId,
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
        ? buildClaudeStreamHandler({
          emitRaw: (event) => {
            const rawEvent = {
              type: "claude.event",
              payload: event,
            };
            // Cast through unknown because ResponseEvent does not model this
            // provider-specific raw event shape, but we intentionally forward it.
            input.onStreamEvent?.(rawEvent as unknown as ResponseEvent);
          },
          emitNormalized: (event) => {
            input.onStreamEvent?.(event as ResponseEvent);
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
      const responseId = `claude-code-cli-${crypto.randomUUID()}`;
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

export function parseClaudeCodeArgsForTest(input: {
  model: string;
  state?: SavedState;
  messages: Array<ModelMessage>;
}): Array<string> {
  const priorSessionIdRaw = input.state?.meta?.[CLAUDE_CODE_SESSION_META_KEY];
  const priorSessionId = typeof priorSessionIdRaw === "string" &&
      priorSessionIdRaw.trim().length > 0
    ? priorSessionIdRaw.trim()
    : undefined;
  const model = normalizeClaudeCodeModel(input.model);
  const prompt = renderMessagesForPrompt(input.messages);
  const permissionMode = Deno.env.get(CLAUDE_CODE_PERMISSION_MODE_ENV)
    ?.trim() || "bypassPermissions";
  const args = [
    "--print",
    "--verbose",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--permission-mode",
    permissionMode,
  ];
  if (model && model !== "default") {
    args.push("--model", model);
  }
  if (priorSessionId) {
    args.push("--resume", priorSessionId);
  }
  args.push(prompt);
  return args;
}

export function parseClaudeCodeStdoutForTest(stdout: string): {
  assistantText: string;
  sessionId?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
} {
  return parseClaudeCodeStdout(stdout);
}
