import { runDeck } from "./runtime.ts";
import type { SavedState } from "./state.ts";
import type { NormalizedPermissionSet } from "./permissions.ts";
import type {
  CreateResponseResponse,
  Guardrails,
  ModelMessage,
  ModelProvider,
  ProviderTraceEvent,
  ResponseEvent,
  TraceEvent,
} from "./types.ts";

type WireScope = true | false | Array<string>;
type WireRunScope = true | false | {
  paths: Array<string>;
  commands: Array<string>;
};
type WirePermissionSet = {
  baseDir: string;
  read: WireScope;
  write: WireScope;
  run: WireRunScope;
  net: WireScope;
  env: WireScope;
};

type RunStartMessage = {
  type: "run.start";
  bridgeSession: string;
  completionNonce: string;
  options: {
    path: string;
    input: unknown;
    inputProvided?: boolean;
    initialUserMessage?: unknown;
    isRoot?: boolean;
    guardrails?: Partial<Guardrails>;
    depth?: number;
    parentActionCallId?: string;
    runId: string;
    defaultModel?: string;
    modelOverride?: string;
    stream?: boolean;
    state?: SavedState;
    responsesMode?: boolean;
    allowRootStringInput?: boolean;
    runDeadlineMs: number;
  };
  permissionCeiling: WirePermissionSet;
};

type ModelChatResultMessage = {
  type: "model.chat.result";
  requestId: string;
  result: {
    message: ModelMessage;
    finishReason: "stop" | "tool_calls" | "length";
    toolCalls?: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }>;
    updatedState?: SavedState;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
};

type ModelResponsesResultMessage = {
  type: "model.responses.result";
  requestId: string;
  result: CreateResponseResponse;
};

type ModelResolveResultMessage = {
  type: "model.resolveModel.result";
  requestId: string;
  result: {
    model: string;
    params?: Record<string, unknown>;
  };
};

type ModelStreamMessage = {
  type: "model.chat.stream";
  requestId: string;
  chunk: string;
};

type ModelResponsesEventMessage = {
  type: "model.responses.event";
  requestId: string;
  event: ResponseEvent;
};

type ModelTraceMessage =
  | {
    type: "model.chat.trace";
    requestId: string;
    event: ProviderTraceEvent;
  }
  | {
    type: "model.responses.trace";
    requestId: string;
    event: ProviderTraceEvent;
  };

type ModelErrorMessage = {
  type:
    | "model.chat.error"
    | "model.responses.error"
    | "model.resolveModel.error";
  requestId: string;
  error: {
    source?: string;
    name?: string;
    message: string;
    code?: unknown;
  };
};

type ParentMessage =
  | RunStartMessage
  | ModelChatResultMessage
  | ModelResponsesResultMessage
  | ModelResolveResultMessage
  | ModelStreamMessage
  | ModelResponsesEventMessage
  | ModelTraceMessage
  | ModelErrorMessage;

type PendingRequest = {
  kind: "chat" | "responses" | "resolveModel";
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  onStreamText?: (chunk: string) => void;
  onStreamEvent?: (event: ResponseEvent) => void;
  onTraceEvent?: (event: ProviderTraceEvent) => void;
};

const pending = new Map<string, PendingRequest>();
let activeBridgeSession: string | undefined;
let activeCompletionNonce: string | undefined;
let runInFlight = false;
const bridgePostMessage = self.postMessage.bind(self);

function postBridgeMessage(message: Record<string, unknown>) {
  if (!activeBridgeSession) {
    throw new Error("Orchestration bridge session not established");
  }
  bridgePostMessage({ ...message, bridgeSession: activeBridgeSession });
}

function randomId(prefix: string) {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `${prefix}-${suffix}`;
}

function wireScopeToNormalized(
  scope: WireScope,
): { all: boolean; values: Set<string> } {
  if (scope === true) return { all: true, values: new Set<string>() };
  if (scope === false) return { all: false, values: new Set<string>() };
  return { all: false, values: new Set(scope) };
}

function wireRunToNormalized(
  scope: WireRunScope,
): { all: boolean; paths: Set<string>; commands: Set<string> } {
  if (scope === true) {
    return {
      all: true,
      paths: new Set<string>(),
      commands: new Set<string>(),
    };
  }
  if (scope === false) {
    return {
      all: false,
      paths: new Set<string>(),
      commands: new Set<string>(),
    };
  }
  return {
    all: false,
    paths: new Set(scope.paths),
    commands: new Set(scope.commands),
  };
}

function fromWirePermissionSet(
  set: WirePermissionSet,
): NormalizedPermissionSet {
  return {
    baseDir: set.baseDir,
    read: wireScopeToNormalized(set.read),
    write: wireScopeToNormalized(set.write),
    run: wireRunToNormalized(set.run),
    net: wireScopeToNormalized(set.net),
    env: wireScopeToNormalized(set.env),
  };
}

function workerErrorPayload(err: unknown) {
  return {
    source: "worker",
    name: err instanceof Error ? err.name : undefined,
    message: err instanceof Error ? err.message : String(err),
    code: (err as { code?: unknown })?.code,
  };
}

const requestModelProvider: ModelProvider = {
  chat(input) {
    const requestId = randomId("model-chat");
    const {
      onStreamText,
      onStreamEvent: _onStreamEvent,
      onTraceEvent,
      ...wireInput
    } = input;
    return new Promise<Awaited<ReturnType<ModelProvider["chat"]>>>(
      (resolve, reject) => {
        pending.set(requestId, {
          kind: "chat",
          resolve: (value) =>
            resolve(value as Awaited<ReturnType<ModelProvider["chat"]>>),
          reject: (error) => reject(error),
          onStreamText,
          onTraceEvent,
        });
        postBridgeMessage({
          type: "model.chat.request",
          requestId,
          input: wireInput,
        });
      },
    );
  },
  responses(input) {
    const requestId = randomId("model-responses");
    const { onStreamEvent, onTraceEvent, ...wireInput } = input;
    return new Promise<CreateResponseResponse>((resolve, reject) => {
      pending.set(requestId, {
        kind: "responses",
        resolve: (value) => resolve(value as CreateResponseResponse),
        reject: (error) => reject(error),
        onStreamEvent,
        onTraceEvent,
      });
      postBridgeMessage({
        type: "model.responses.request",
        requestId,
        input: wireInput,
      });
    });
  },
  resolveModel(input) {
    const requestId = randomId("model-resolve");
    return new Promise<{ model: string; params?: Record<string, unknown> }>(
      (resolve, reject) => {
        pending.set(requestId, {
          kind: "resolveModel",
          resolve: (value) =>
            resolve(
              value as { model: string; params?: Record<string, unknown> },
            ),
          reject: (error) => reject(error),
        });
        postBridgeMessage({
          type: "model.resolveModel.request",
          requestId,
          input,
        });
      },
    );
  },
};

async function runOrchestration(msg: RunStartMessage): Promise<unknown> {
  return await runDeck({
    path: msg.options.path,
    input: msg.options.input,
    inputProvided: msg.options.inputProvided,
    initialUserMessage: msg.options.initialUserMessage,
    modelProvider: requestModelProvider,
    isRoot: msg.options.isRoot,
    guardrails: msg.options.guardrails,
    depth: msg.options.depth,
    parentActionCallId: msg.options.parentActionCallId,
    runId: msg.options.runId,
    defaultModel: msg.options.defaultModel,
    modelOverride: msg.options.modelOverride,
    trace: (event: TraceEvent) => {
      postBridgeMessage({ type: "trace.event", event });
    },
    stream: msg.options.stream,
    state: msg.options.state,
    onStateUpdate: (state: SavedState) => {
      postBridgeMessage({ type: "state.update", state });
    },
    onStreamText: (chunk: string) => {
      postBridgeMessage({ type: "stream.text", chunk });
    },
    allowRootStringInput: msg.options.allowRootStringInput,
    responsesMode: msg.options.responsesMode,
    parentPermissions: fromWirePermissionSet(msg.permissionCeiling),
    runDeadlineMs: msg.options.runDeadlineMs,
    // Keep sandboxing enabled for nested runs so child compute decks are
    // executed with narrowed OS permissions derived from effective ceilings.
    workerSandbox: true,
    inOrchestrationWorker: true,
  });
}

self.addEventListener("message", (event: MessageEvent<ParentMessage>) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "run.start") {
    if (runInFlight) return;
    if (typeof data.bridgeSession !== "string" || !data.bridgeSession) return;
    if (typeof data.completionNonce !== "string" || !data.completionNonce) {
      return;
    }
    activeBridgeSession = data.bridgeSession;
    activeCompletionNonce = data.completionNonce;
    runInFlight = true;
    runOrchestration(data).then(
      (result) => {
        postBridgeMessage({
          type: "run.result",
          result,
          completionNonce: activeCompletionNonce,
        });
        runInFlight = false;
      },
      (err) => {
        postBridgeMessage({
          type: "run.error",
          error: workerErrorPayload(err),
          completionNonce: activeCompletionNonce,
        });
        runInFlight = false;
      },
    );
    return;
  }

  if (data.type === "model.chat.stream") {
    const req = pending.get(data.requestId);
    if (!req || req.kind !== "chat") return;
    req.onStreamText?.(data.chunk);
    return;
  }

  if (data.type === "model.responses.event") {
    const req = pending.get(data.requestId);
    if (!req || req.kind !== "responses") return;
    req.onStreamEvent?.(data.event);
    return;
  }

  if (data.type === "model.chat.trace") {
    const req = pending.get(data.requestId);
    if (!req || req.kind !== "chat") return;
    req.onTraceEvent?.(data.event);
    return;
  }

  if (data.type === "model.responses.trace") {
    const req = pending.get(data.requestId);
    if (!req || req.kind !== "responses") return;
    req.onTraceEvent?.(data.event);
    return;
  }

  if (data.type === "model.chat.result") {
    const req = pending.get(data.requestId);
    if (!req || req.kind !== "chat") return;
    pending.delete(data.requestId);
    req.resolve(data.result);
    return;
  }

  if (data.type === "model.responses.result") {
    const req = pending.get(data.requestId);
    if (!req || req.kind !== "responses") return;
    pending.delete(data.requestId);
    req.resolve(data.result);
    return;
  }

  if (data.type === "model.resolveModel.result") {
    const req = pending.get(data.requestId);
    if (!req || req.kind !== "resolveModel") return;
    pending.delete(data.requestId);
    req.resolve(data.result);
    return;
  }

  if (
    data.type === "model.chat.error" || data.type === "model.responses.error" ||
    data.type === "model.resolveModel.error"
  ) {
    const req = pending.get(data.requestId);
    if (!req) return;
    pending.delete(data.requestId);
    req.reject(new Error(data.error.message));
    return;
  }
});
