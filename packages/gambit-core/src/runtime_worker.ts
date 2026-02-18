import * as path from "@std/path";
import { loadDeck } from "./loader.ts";
import type { SavedState } from "./state.ts";
import type { PermissionDeclarationInput } from "./permissions.ts";
import { assertZodSchema, validateWithSchema } from "./schema.ts";
import type { ExecutionContext, Guardrails, LoadedDeck } from "./types.ts";

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
  runId: string;
  actionCallId: string;
  deckPath: string;
  input: unknown;
  state?: SavedState;
  initialUserMessage?: unknown;
  depth: number;
  parentActionCallId?: string;
  permissions: WirePermissionSet;
  workspacePermissions?: PermissionDeclarationInput;
  workspacePermissionsBaseDir?: string;
  sessionPermissions?: PermissionDeclarationInput;
  sessionPermissionsBaseDir?: string;
  runDeadlineMs: number;
  isRoot: boolean;
  allowRootStringInput: boolean;
};

type DeckInspectStartMessage = {
  type: "deck.inspect";
  bridgeSession: string;
  deckPath: string;
};

type WorkerDeckInspection = {
  deckPath: string;
  hasModelParams: boolean;
  permissions?: PermissionDeclarationInput;
  guardrails?: Partial<Guardrails>;
};

type SpawnResultMessage = {
  type: "spawn.result";
  requestId: string;
  result: unknown;
};

type SpawnErrorMessage = {
  type: "spawn.error";
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
  | DeckInspectStartMessage
  | SpawnResultMessage
  | SpawnErrorMessage;

const logger = console;

function randomId(prefix: string) {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `${prefix}-${suffix}`;
}

function ensureNotExpired(deadlineMs: number) {
  if (performance.now() > deadlineMs) {
    throw new Error("Timeout exceeded");
  }
}

function workerErrorPayload(err: unknown) {
  return {
    source: "worker",
    name: err instanceof Error ? err.name : undefined,
    message: err instanceof Error ? err.message : String(err),
    code: (err as { code?: unknown })?.code,
  };
}

function resolveContextSchema(deck: LoadedDeck) {
  return deck.contextSchema ?? deck.inputSchema;
}

function resolveResponseSchema(deck: LoadedDeck) {
  return deck.responseSchema ?? deck.outputSchema;
}

function ensureSchemaPresence(deck: LoadedDeck, isRoot: boolean) {
  if (!isRoot) {
    const contextSchema = resolveContextSchema(deck);
    const responseSchema = resolveResponseSchema(deck);
    if (!contextSchema || !responseSchema) {
      throw new Error(
        `Deck ${deck.path} must declare contextSchema and responseSchema (non-root)`,
      );
    }
    assertZodSchema(contextSchema, "contextSchema");
    assertZodSchema(responseSchema, "responseSchema");
  }
}

function validateInput(
  deck: LoadedDeck,
  input: unknown,
  isRoot: boolean,
  allowRootStringInput: boolean,
) {
  const contextSchema = resolveContextSchema(deck);
  if (contextSchema) {
    if (isRoot && typeof input === "string" && allowRootStringInput) {
      try {
        return validateWithSchema(contextSchema as never, input);
      } catch {
        return input;
      }
    }
    return validateWithSchema(contextSchema as never, input);
  }
  if (isRoot) {
    if (input === undefined) return "";
    if (typeof input === "string") return input;
    return input;
  }
  throw new Error(`Deck ${deck.path} requires contextSchema (non-root)`);
}

function validateOutput(
  deck: LoadedDeck,
  output: unknown,
  isRoot: boolean,
): unknown {
  const responseSchema = resolveResponseSchema(deck);
  if (responseSchema) {
    return validateWithSchema(responseSchema as never, output);
  }
  if (isRoot) {
    if (typeof output === "string") return output;
    return JSON.stringify(output);
  }
  throw new Error(`Deck ${deck.path} requires responseSchema (non-root)`);
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

const pending = new Map<string, PendingRequest>();
let activeBridgeSession: string | undefined;
let activeCompletionNonce: string | undefined;
let runInFlight = false;
let inspectInFlight = false;
const bridgePostMessage = self.postMessage.bind(self);

function postBridgeMessage(message: Record<string, unknown>) {
  if (!activeBridgeSession) {
    throw new Error("Worker bridge session not established");
  }
  bridgePostMessage({ ...message, bridgeSession: activeBridgeSession });
}

async function inspectDeck(deckPath: string): Promise<WorkerDeckInspection> {
  const deck = await loadDeck(deckPath);
  return {
    deckPath: deck.path,
    hasModelParams: Boolean(
      deck.modelParams?.model || deck.modelParams?.temperature !== undefined,
    ),
    permissions: deck.permissions,
    guardrails: deck.guardrails,
  };
}

async function runCompute(msg: RunStartMessage) {
  ensureNotExpired(msg.runDeadlineMs);
  const deck = await loadDeck(msg.deckPath);
  ensureSchemaPresence(deck, msg.isRoot);
  const validatedInput = validateInput(
    deck,
    msg.input,
    msg.isRoot,
    msg.allowRootStringInput,
  );

  if (!deck.executor) {
    throw new Error(
      `Deck ${deck.path} has no model and no executor (add run or execute to the deck definition)`,
    );
  }

  let computeState = msg.state
    ? {
      ...msg.state,
      messages: Array.isArray(msg.state.messages)
        ? msg.state.messages.map((entry) => ({
          ...entry,
          content: entry.content ?? null,
        }))
        : [],
      meta: msg.state.meta ? { ...msg.state.meta } : undefined,
      messageRefs: Array.isArray(msg.state.messageRefs)
        ? [...msg.state.messageRefs]
        : undefined,
    }
    : undefined;

  const ensureComputeState = (): SavedState => {
    if (computeState) return computeState;
    computeState = {
      runId: msg.runId,
      messages: [],
      meta: {},
      messageRefs: [],
    };
    return computeState;
  };

  const publishComputeState = () => {
    if (!computeState) return;
    postBridgeMessage({ type: "state.update", state: computeState });
  };

  const execContext: ExecutionContext = {
    runId: msg.runId,
    actionCallId: msg.actionCallId,
    parentActionCallId: msg.parentActionCallId,
    depth: msg.depth,
    input: validatedInput,
    initialUserMessage: msg.initialUserMessage,
    getSessionMeta: <T = unknown>(key: string): T | undefined => {
      if (!key) return undefined;
      return computeState?.meta?.[key] as T | undefined;
    },
    setSessionMeta: (key, value) => {
      if (!key) return;
      const state = ensureComputeState();
      const nextMeta = { ...(state.meta ?? {}) };
      if (value === undefined) {
        delete nextMeta[key];
      } else {
        nextMeta[key] = value;
      }
      state.meta = nextMeta;
      publishComputeState();
    },
    appendMessage: (message) => {
      const role = message.role;
      const content = String(message.content ?? "").trim();
      if ((role !== "user" && role !== "assistant") || !content) return;
      const state = ensureComputeState();
      state.messages = [...(state.messages ?? []), { role, content }];
      const refs = Array.isArray(state.messageRefs)
        ? [...state.messageRefs]
        : [];
      refs.push({ id: randomId("msg"), role });
      state.messageRefs = refs;
      publishComputeState();
    },
    label: deck.label,
    log: (entry) => {
      postBridgeMessage({ type: "log.entry", entry });
    },
    spawnAndWait: async (opts) => {
      ensureNotExpired(msg.runDeadlineMs);
      const childPath = path.isAbsolute(opts.path)
        ? opts.path
        : path.resolve(path.dirname(deck.path), opts.path);
      const requestId = randomId("spawn");
      const childPromise = new Promise<unknown>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
      });
      postBridgeMessage({
        type: "spawn.request",
        requestId,
        payload: {
          path: childPath,
          input: opts.input,
          initialUserMessage: Object.hasOwn(opts, "initialUserMessage")
            ? opts.initialUserMessage
            : msg.initialUserMessage,
          parentActionCallId: msg.actionCallId,
          parentPermissionsBaseDir: msg.permissions.baseDir,
          parentPermissions: msg.permissions,
          workspacePermissions: msg.workspacePermissions,
          workspacePermissionsBaseDir: msg.workspacePermissionsBaseDir,
          sessionPermissions: msg.sessionPermissions,
          sessionPermissionsBaseDir: msg.sessionPermissionsBaseDir,
          runDeadlineMs: msg.runDeadlineMs,
        },
      });
      const result = await childPromise;
      ensureNotExpired(msg.runDeadlineMs);
      return result;
    },
    fail: (opts) => {
      throw new Error(opts.message);
    },
    return: (payload) => Promise.resolve(payload),
  };

  const raw = await deck.executor(execContext);
  ensureNotExpired(msg.runDeadlineMs);
  return validateOutput(deck, raw, msg.isRoot);
}

self.addEventListener("message", (event: MessageEvent<ParentMessage>) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "spawn.result") {
    const pendingRequest = pending.get(data.requestId);
    if (!pendingRequest) return;
    pending.delete(data.requestId);
    pendingRequest.resolve(data.result);
    return;
  }

  if (data.type === "spawn.error") {
    const pendingRequest = pending.get(data.requestId);
    if (!pendingRequest) return;
    pending.delete(data.requestId);
    pendingRequest.reject(new Error(data.error.message));
    return;
  }

  if (data.type === "deck.inspect") {
    if (inspectInFlight) return;
    if (typeof data.bridgeSession !== "string" || !data.bridgeSession) return;
    activeBridgeSession = data.bridgeSession;
    inspectInFlight = true;
    inspectDeck(data.deckPath).then(
      (result) => {
        postBridgeMessage({ type: "deck.inspect.result", result });
        inspectInFlight = false;
      },
      (err) => {
        logger.error("[gambit-worker] deck inspection failed", err);
        postBridgeMessage({
          type: "deck.inspect.error",
          error: workerErrorPayload(err),
        });
        inspectInFlight = false;
      },
    );
    return;
  }

  if (data.type !== "run.start") return;
  if (runInFlight) return;
  if (typeof data.bridgeSession !== "string" || !data.bridgeSession) return;
  if (typeof data.completionNonce !== "string" || !data.completionNonce) return;
  activeBridgeSession = data.bridgeSession;
  activeCompletionNonce = data.completionNonce;
  runInFlight = true;

  runCompute(data).then(
    (result) => {
      postBridgeMessage({
        type: "run.result",
        result,
        completionNonce: activeCompletionNonce,
      });
      runInFlight = false;
    },
    (err) => {
      logger.error("[gambit-worker] compute execution failed", err);
      postBridgeMessage({
        type: "run.error",
        error: workerErrorPayload(err),
        completionNonce: activeCompletionNonce,
      });
      runInFlight = false;
    },
  );
});
