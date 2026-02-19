import * as path from "@std/path";
import {
  DEFAULT_GUARDRAILS,
  DEFAULT_STATUS_DELAY_MS,
  GAMBIT_TOOL_COMPLETE,
  GAMBIT_TOOL_CONTEXT,
  GAMBIT_TOOL_END,
  GAMBIT_TOOL_INIT,
  GAMBIT_TOOL_RESPOND,
} from "./constants.ts";
import { loadDeck } from "./loader.ts";
import {
  canReadPath,
  canRunCommand,
  canRunPath,
  canWritePath,
  intersectPermissions,
  resolveEffectivePermissions,
} from "./permissions.ts";
import {
  ExecToolUnsupportedHostError,
  executeBuiltinCommand,
} from "./runtime_exec_host.ts";
import {
  createWorkerSandboxBridge,
  isWorkerSandboxHostSupported,
  type WorkerBridgeEvent,
  type WorkerSandboxPermissionSet,
  WorkerSandboxUnsupportedHostError,
} from "./runtime_worker_host.ts";
import { assertZodSchema, toJsonSchema, validateWithSchema } from "./schema.ts";
import type {
  CreateResponseRequest,
  CreateResponseResponse,
  ExecutionContext,
  Guardrails,
  JSONValue,
  LoadedDeck,
  ModelMessage,
  ModelProvider,
  ResponseEvent,
  ResponseItem,
  ResponseToolDefinition,
  ToolCallResult,
  ToolDefinition,
  ToolKind,
} from "./types.ts";
import type { MessageRef, SavedState } from "./state.ts";
import type {
  NormalizedPermissionSet,
  PermissionDeclarationInput,
  PermissionTrace,
} from "./permissions.ts";

export type GambitEndSignal = {
  __gambitEnd: true;
  payload?: unknown;
  status?: number;
  message?: string;
  code?: string;
  meta?: Record<string, unknown>;
};

export function isGambitEndSignal(value: unknown): value is GambitEndSignal {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { __gambitEnd?: unknown }).__gambitEnd === true,
  );
}

const logger = console;

function randomId(prefix: string) {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  // Keep IDs short enough for OpenAI/OpenRouter tool_call id limits (~40 chars).
  return `${prefix}-${suffix}`;
}

type IdleController = {
  touch: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
};

export type RunOptions = {
  path: string;
  input: unknown;
  inputProvided?: boolean;
  initialUserMessage?: unknown;
  modelProvider: ModelProvider;
  isRoot?: boolean;
  guardrails?: Partial<Guardrails>;
  depth?: number;
  parentActionCallId?: string;
  runId?: string;
  defaultModel?: string;
  modelOverride?: string;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  repl?: boolean;
  stream?: boolean;
  state?: SavedState;
  onStateUpdate?: (state: SavedState) => void;
  onStreamText?: (chunk: string) => void;
  allowRootStringInput?: boolean;
  responsesMode?: boolean;
  workspacePermissions?: PermissionDeclarationInput;
  workspacePermissionsBaseDir?: string;
  sessionPermissions?: PermissionDeclarationInput;
  sessionPermissionsBaseDir?: string;
  parentPermissions?: NormalizedPermissionSet;
  referencePermissions?: PermissionDeclarationInput;
  referencePermissionsBaseDir?: string;
  runDeadlineMs?: number;
  workerSandbox?: boolean;
  inOrchestrationWorker?: boolean;
  signal?: AbortSignal;
  onCancel?: () => unknown | Promise<unknown>;
  onTool?: (input: {
    name: string;
    args: Record<string, unknown>;
    runId: string;
    actionCallId: string;
    parentActionCallId?: string;
    deckPath: string;
  }) => unknown | Promise<unknown>;
};

const WORKER_SANDBOX_ENV = "GAMBIT_DECK_WORKER_SANDBOX";
const WORKER_TIMEOUT_MESSAGE = "Timeout exceeded";
const RUN_CANCELED_MESSAGE = "Run canceled";
const WORKER_SANDBOX_SIGNAL_UNSUPPORTED_MESSAGE =
  "workerSandbox is unsupported when `signal` is provided.";
const INSPECT_WORKER_TIMEOUT_MS = 1_500;
const INSPECT_WORKER_TIMEOUT_MESSAGE = "Deck inspection timed out";
const BUILTIN_TOOL_READ_FILE = "read_file";
const BUILTIN_TOOL_LIST_DIR = "list_dir";
const BUILTIN_TOOL_GREP_FILES = "grep_files";
const BUILTIN_TOOL_APPLY_PATCH = "apply_patch";
const BUILTIN_TOOL_EXEC = "exec";
const BUILTIN_TOOL_NAMES = new Set<string>([
  BUILTIN_TOOL_READ_FILE,
  BUILTIN_TOOL_LIST_DIR,
  BUILTIN_TOOL_GREP_FILES,
  BUILTIN_TOOL_APPLY_PATCH,
  BUILTIN_TOOL_EXEC,
]);
const TRUSTED_SCHEMA_IMPORT_PREFIXES = [
  "@bolt-foundry/gambit-core/schemas",
  "gambit://schemas",
];

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

type WorkerDeckInspection = {
  deckPath: string;
  hasModelParams: boolean;
  permissions?: PermissionDeclarationInput;
  guardrails?: Partial<Guardrails>;
};

export class RunCanceledError extends Error {
  code = "run_canceled";

  constructor(message = RUN_CANCELED_MESSAGE) {
    super(message);
    this.name = "RunCanceledError";
  }
}

class WorkerSandboxSignalUnsupportedError extends Error {
  code = "worker_sandbox_signal_unsupported";

  constructor(message = WORKER_SANDBOX_SIGNAL_UNSUPPORTED_MESSAGE) {
    super(message);
    this.name = "WorkerSandboxSignalUnsupportedError";
  }
}

export function isRunCanceledError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  const code = (err as { code?: unknown }).code;
  if (name === "RunCanceledError" || code === "run_canceled") return true;
  if (name === "AbortError") return true;
  return false;
}

function shouldUseWorkerSandbox(): boolean {
  let raw: string | undefined;
  try {
    raw = Deno.env.get(WORKER_SANDBOX_ENV);
  } catch {
    return false;
  }
  raw = raw?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function normalizedScopeToWire(scope: {
  all: boolean;
  values: Set<string>;
}): WireScope {
  if (scope.all) return true;
  if (scope.values.size === 0) return false;
  return Array.from(scope.values).sort();
}

function normalizedRunToWire(scope: {
  all: boolean;
  paths: Set<string>;
  commands: Set<string>;
}): WireRunScope {
  if (scope.all) return true;
  if (scope.paths.size === 0 && scope.commands.size === 0) return false;
  return {
    paths: Array.from(scope.paths).sort(),
    commands: Array.from(scope.commands).sort(),
  };
}

function toWirePermissionSet(set: NormalizedPermissionSet): WirePermissionSet {
  return {
    baseDir: set.baseDir,
    read: normalizedScopeToWire(set.read),
    write: normalizedScopeToWire(set.write),
    run: normalizedRunToWire(set.run),
    net: normalizedScopeToWire(set.net),
    env: normalizedScopeToWire(set.env),
  };
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

function normalizePermissionBaseDir(
  set: NormalizedPermissionSet,
  baseDir: string,
): NormalizedPermissionSet {
  return {
    ...set,
    baseDir,
    read: { all: set.read.all, values: new Set(set.read.values) },
    write: { all: set.write.all, values: new Set(set.write.values) },
    run: {
      all: set.run.all,
      paths: new Set(set.run.paths),
      commands: new Set(set.run.commands),
    },
    net: { all: set.net.all, values: new Set(set.net.values) },
    env: { all: set.env.all, values: new Set(set.env.values) },
  };
}

function deadlineForRun(
  guardrails: Guardrails,
  existing?: number,
): number {
  const timeoutDeadline = performance.now() + guardrails.timeoutMs;
  if (typeof existing === "number" && Number.isFinite(existing)) {
    return Math.min(existing, timeoutDeadline);
  }
  return timeoutDeadline;
}

function ensureNotExpired(deadlineMs: number) {
  if (performance.now() > deadlineMs) {
    throw new Error(WORKER_TIMEOUT_MESSAGE);
  }
}

function throwIfCanceled(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (typeof reason === "string" && reason.trim().length > 0) {
    throw new RunCanceledError(reason);
  }
  if (reason instanceof Error && reason.message.trim().length > 0) {
    throw new RunCanceledError(reason.message);
  }
  throw new RunCanceledError();
}

function ensureRunActive(deadlineMs: number, signal?: AbortSignal) {
  throwIfCanceled(signal);
  ensureNotExpired(deadlineMs);
}

function isTrustedSchemaImportKey(key: string): boolean {
  const normalized = key.trim();
  if (!normalized) return false;
  return TRUSTED_SCHEMA_IMPORT_PREFIXES.some((prefix) =>
    normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

function tryReadWorkspaceConfigPath(deckPath: string): string | undefined {
  const startDir = path.dirname(path.resolve(deckPath));
  let current = startDir;
  while (true) {
    const denoJson = path.join(current, "deno.json");
    const denoJsonc = path.join(current, "deno.jsonc");
    try {
      if (Deno.statSync(denoJson).isFile) return denoJson;
    } catch {
      // continue search
    }
    try {
      if (Deno.statSync(denoJsonc).isFile) return denoJsonc;
    } catch {
      // continue search
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function readWorkspaceImportMapKeys(configPath: string): Array<string> {
  const text = Deno.readTextFileSync(configPath);
  const parsed = parseWorkspaceConfig(text) as { imports?: unknown };
  if (
    !parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
    !parsed.imports || typeof parsed.imports !== "object" ||
    Array.isArray(parsed.imports)
  ) {
    return [];
  }
  return Object.keys(parsed.imports as Record<string, unknown>);
}

function parseWorkspaceConfig(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const stripped = stripJsonComments(text);
    return JSON.parse(stripped);
  }
}

function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let escapeNext = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function enforceTrustedSchemaImportMapPolicy(deckPath: string) {
  if (deckPath.startsWith("gambit://")) return;
  const configPath = tryReadWorkspaceConfigPath(deckPath);
  if (!configPath) return;
  const violations = readWorkspaceImportMapKeys(configPath).filter((key) =>
    isTrustedSchemaImportKey(key)
  );
  if (violations.length === 0) return;
  throw new Error(
    `[gambit] trust-boundary violation: workspace import map at ${configPath} remaps trusted schema namespace (${
      violations.join(", ")
    })`,
  );
}

export async function runDeck(opts: RunOptions): Promise<unknown> {
  const guardrails: Guardrails = {
    ...DEFAULT_GUARDRAILS,
    ...opts.guardrails,
  };
  const depth = opts.depth ?? 0;
  const inferredRoot = opts.isRoot ??
    (!opts.parentActionCallId && depth === 0);
  if (depth >= guardrails.maxDepth) {
    throw new Error(`Max depth ${guardrails.maxDepth} exceeded`);
  }
  const runId = opts.runId ?? opts.state?.runId ?? randomId("run");
  enforceTrustedSchemaImportMapPolicy(opts.path);
  const workerSandboxRequested = opts.workerSandbox ??
    shouldUseWorkerSandbox();
  if (workerSandboxRequested && !isWorkerSandboxHostSupported()) {
    throw new WorkerSandboxUnsupportedHostError();
  }
  if (workerSandboxRequested && opts.signal) {
    throw new WorkerSandboxSignalUnsupportedError();
  }
  const workerSandbox = workerSandboxRequested;
  const isRoot = Boolean(inferredRoot);
  const shouldEmitRun = opts.depth === undefined || opts.depth === 0;
  let canceled = false;
  let cancelHandled = false;
  const handleCancel = async () => {
    if (cancelHandled) return;
    cancelHandled = true;
    if (!opts.onCancel) return;
    try {
      await opts.onCancel();
    } catch (err) {
      logger.warn(
        `[gambit] runDeck onCancel callback failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };
  try {
    throwIfCanceled(opts.signal);
    if (workerSandbox) {
      const preInspectRunDeadlineMs = deadlineForRun(
        guardrails,
        opts.runDeadlineMs,
      );
      ensureRunActive(preInspectRunDeadlineMs, opts.signal);
      const inspectedDeck = await inspectDeckInWorker(
        opts.path,
        preInspectRunDeadlineMs,
      );
      const deckDir = path.dirname(inspectedDeck.deckPath);
      const permissions = resolveEffectivePermissions({
        baseDir: deckDir,
        parent: opts.parentPermissions,
        workspace: opts.workspacePermissions
          ? {
            baseDir: opts.workspacePermissionsBaseDir ?? deckDir,
            permissions: opts.workspacePermissions,
          }
          : undefined,
        declaration: inspectedDeck.permissions
          ? { baseDir: deckDir, permissions: inspectedDeck.permissions }
          : undefined,
        reference: opts.referencePermissions
          ? {
            baseDir: opts.referencePermissionsBaseDir ?? deckDir,
            permissions: opts.referencePermissions,
          }
          : undefined,
        session: opts.sessionPermissions
          ? {
            baseDir: opts.sessionPermissionsBaseDir ?? Deno.cwd(),
            permissions: opts.sessionPermissions,
          }
          : undefined,
      });
      const effectiveGuardrails: Guardrails = {
        ...guardrails,
        ...(inspectedDeck.guardrails ?? {}),
      };
      const runDeadlineMs = deadlineForRun(
        effectiveGuardrails,
        opts.runDeadlineMs,
      );
      ensureRunActive(runDeadlineMs, opts.signal);
      const resolvedInput = resolveInputWithoutDeck({
        input: opts.input,
        state: opts.state,
        isRoot,
        initialUserMessage: opts.initialUserMessage,
      });

      if (!inspectedDeck.hasModelParams) {
        if (shouldEmitRun) {
          opts.trace?.({
            type: "run.start",
            runId,
            deckPath: inspectedDeck.deckPath,
            input: resolvedInput as unknown as import("./types.ts").JSONValue,
            initialUserMessage: opts
              .initialUserMessage as unknown as import("./types.ts").JSONValue,
            permissions: permissions.trace,
          });
        }

        return await runComputeDeckInWorker({
          deckPath: inspectedDeck.deckPath,
          guardrails: effectiveGuardrails,
          depth,
          runId,
          initialUserMessage: opts.initialUserMessage,
          parentActionCallId: opts.parentActionCallId,
          modelProvider: opts.modelProvider,
          input: resolvedInput,
          defaultModel: opts.defaultModel,
          modelOverride: opts.modelOverride,
          trace: opts.trace,
          stream: opts.stream,
          state: opts.state,
          onStateUpdate: opts.onStateUpdate,
          onStreamText: opts.onStreamText,
          responsesMode: opts.responsesMode,
          permissions: permissions.effective,
          permissionsTrace: permissions.trace,
          workspacePermissions: opts.workspacePermissions,
          workspacePermissionsBaseDir: opts.workspacePermissionsBaseDir,
          sessionPermissions: opts.sessionPermissions,
          sessionPermissionsBaseDir: opts.sessionPermissionsBaseDir,
          runDeadlineMs,
          isRoot,
          allowRootStringInput: opts.allowRootStringInput ?? false,
          signal: opts.signal,
        });
      }

      if (!opts.inOrchestrationWorker) {
        return await runLlmDeckInWorker({
          deckPath: inspectedDeck.deckPath,
          guardrails: effectiveGuardrails,
          depth,
          runId,
          parentActionCallId: opts.parentActionCallId,
          modelProvider: opts.modelProvider,
          input: resolvedInput,
          inputProvided: opts.inputProvided ?? true,
          initialUserMessage: opts.initialUserMessage,
          defaultModel: opts.defaultModel,
          modelOverride: opts.modelOverride,
          trace: opts.trace,
          stream: opts.stream,
          state: opts.state,
          onStateUpdate: opts.onStateUpdate,
          onStreamText: opts.onStreamText,
          responsesMode: opts.responsesMode,
          permissions: permissions.effective,
          permissionsTrace: permissions.trace,
          workspacePermissions: opts.workspacePermissions,
          workspacePermissionsBaseDir: opts.workspacePermissionsBaseDir,
          sessionPermissions: opts.sessionPermissions,
          sessionPermissionsBaseDir: opts.sessionPermissionsBaseDir,
          runDeadlineMs,
          workerSandbox,
          allowRootStringInput: opts.allowRootStringInput,
          isRoot,
          signal: opts.signal,
        });
      }
    }

    const deck = await loadDeck(opts.path);
    const permissions = resolveEffectivePermissions({
      baseDir: path.dirname(deck.path),
      parent: opts.parentPermissions,
      workspace: opts.workspacePermissions
        ? {
          baseDir: opts.workspacePermissionsBaseDir ?? path.dirname(deck.path),
          permissions: opts.workspacePermissions,
        }
        : undefined,
      declaration: deck.permissions
        ? { baseDir: path.dirname(deck.path), permissions: deck.permissions }
        : undefined,
      reference: opts.referencePermissions
        ? {
          baseDir: opts.referencePermissionsBaseDir ?? path.dirname(deck.path),
          permissions: opts.referencePermissions,
        }
        : undefined,
      session: opts.sessionPermissions
        ? {
          baseDir: opts.sessionPermissionsBaseDir ?? Deno.cwd(),
          permissions: opts.sessionPermissions,
        }
        : undefined,
    });
    const deckGuardrails = deck.guardrails ?? {};
    const effectiveGuardrails: Guardrails = {
      ...guardrails,
      ...deckGuardrails,
    };
    const runDeadlineMs = deadlineForRun(
      effectiveGuardrails,
      opts.runDeadlineMs,
    );
    ensureRunActive(runDeadlineMs, opts.signal);

    ensureSchemaPresence(deck, isRoot);

    const resolvedInput = resolveInput({
      deck,
      input: opts.input,
      state: opts.state,
      isRoot,
      initialUserMessage: opts.initialUserMessage,
    });
    const validatedInput = validateInput(
      deck,
      resolvedInput,
      isRoot,
      opts.allowRootStringInput ?? false,
    );
    const useOrchestrationWorker = workerSandbox &&
      !opts.inOrchestrationWorker &&
      isRoot &&
      !opts.onTool &&
      Boolean(
        deck.modelParams?.model || deck.modelParams?.temperature !== undefined,
      );
    if (useOrchestrationWorker) {
      return await runLlmDeckInWorker({
        deckPath: deck.path,
        guardrails: effectiveGuardrails,
        depth,
        runId,
        parentActionCallId: opts.parentActionCallId,
        modelProvider: opts.modelProvider,
        input: validatedInput,
        inputProvided: opts.inputProvided ?? true,
        initialUserMessage: opts.initialUserMessage,
        defaultModel: opts.defaultModel,
        modelOverride: opts.modelOverride,
        trace: opts.trace,
        stream: opts.stream,
        state: opts.state,
        onStateUpdate: opts.onStateUpdate,
        onStreamText: opts.onStreamText,
        responsesMode: opts.responsesMode,
        permissions: permissions.effective,
        permissionsTrace: permissions.trace,
        workspacePermissions: opts.workspacePermissions,
        workspacePermissionsBaseDir: opts.workspacePermissionsBaseDir,
        sessionPermissions: opts.sessionPermissions,
        sessionPermissionsBaseDir: opts.sessionPermissionsBaseDir,
        runDeadlineMs,
        workerSandbox,
        allowRootStringInput: opts.allowRootStringInput,
        isRoot,
        signal: opts.signal,
      });
    }
    if (shouldEmitRun) {
      opts.trace?.({
        type: "run.start",
        runId,
        deckPath: deck.path,
        input: validatedInput as unknown as import("./types.ts").JSONValue,
        initialUserMessage: opts
          .initialUserMessage as unknown as import("./types.ts").JSONValue,
        permissions: permissions.trace,
      });
    }

    if (
      deck.modelParams?.model || deck.modelParams?.temperature !== undefined
    ) {
      return await runLlmDeck({
        deck,
        guardrails: effectiveGuardrails,
        depth,
        runId,
        parentActionCallId: opts.parentActionCallId,
        modelProvider: opts.modelProvider,
        input: validatedInput,
        inputProvided: opts.inputProvided ?? true,
        initialUserMessage: opts.initialUserMessage,
        defaultModel: opts.defaultModel,
        modelOverride: opts.modelOverride,
        trace: opts.trace,
        stream: opts.stream,
        state: opts.state,
        onStateUpdate: opts.onStateUpdate,
        onStreamText: opts.onStreamText,
        responsesMode: opts.responsesMode,
        permissions: permissions.effective,
        permissionsTrace: permissions.trace,
        workspacePermissions: opts.workspacePermissions,
        workspacePermissionsBaseDir: opts.workspacePermissionsBaseDir,
        sessionPermissions: opts.sessionPermissions,
        sessionPermissionsBaseDir: opts.sessionPermissionsBaseDir,
        runDeadlineMs,
        workerSandbox,
        onTool: opts.onTool,
        signal: opts.signal,
      });
    }

    if (!deck.executor) {
      throw new Error(
        `Deck ${deck.path} has no model and no executor (add run or execute to the deck definition)`,
      );
    }

    return await runComputeDeck({
      deck,
      guardrails: effectiveGuardrails,
      depth,
      runId,
      initialUserMessage: opts.initialUserMessage,
      parentActionCallId: opts.parentActionCallId,
      modelProvider: opts.modelProvider,
      input: validatedInput,
      defaultModel: opts.defaultModel,
      modelOverride: opts.modelOverride,
      trace: opts.trace,
      stream: opts.stream,
      state: opts.state,
      onStateUpdate: opts.onStateUpdate,
      onStreamText: opts.onStreamText,
      responsesMode: opts.responsesMode,
      permissions: permissions.effective,
      permissionsTrace: permissions.trace,
      workspacePermissions: opts.workspacePermissions,
      workspacePermissionsBaseDir: opts.workspacePermissionsBaseDir,
      sessionPermissions: opts.sessionPermissions,
      sessionPermissionsBaseDir: opts.sessionPermissionsBaseDir,
      runDeadlineMs,
      workerSandbox,
      onTool: opts.onTool,
      signal: opts.signal,
    });
  } catch (err) {
    if (isRunCanceledError(err)) {
      canceled = true;
      await handleCancel();
    }
    throw err;
  } finally {
    if (shouldEmitRun) {
      opts.trace?.({ type: "run.end", runId });
    }
    if (opts.signal?.aborted && !canceled) {
      await handleCancel();
    }
  }
}

function toProviderParams(
  params: import("./types.ts").ModelParams | undefined,
): Record<string, unknown> | undefined {
  if (!params) return undefined;
  const {
    model: _model,
    temperature,
    top_p,
    frequency_penalty,
    presence_penalty,
    max_tokens,
    verbosity,
    reasoning,
  } = params;
  const out: Record<string, unknown> = {};
  if (temperature !== undefined) out.temperature = temperature;
  if (top_p !== undefined) out.top_p = top_p;
  if (frequency_penalty !== undefined) {
    out.frequency_penalty = frequency_penalty;
  }
  if (presence_penalty !== undefined) out.presence_penalty = presence_penalty;
  if (max_tokens !== undefined) out.max_tokens = max_tokens;
  if (verbosity !== undefined) out.verbosity = verbosity;
  if (reasoning !== undefined) out.reasoning = reasoning;
  return Object.keys(out).length ? out : undefined;
}

async function resolveModelChoice(args: {
  model: string | Array<string>;
  params?: Record<string, unknown>;
  modelProvider: ModelProvider;
  deckPath: string;
}): Promise<{ model: string; params?: Record<string, unknown> }> {
  const resolver = args.modelProvider.resolveModel;
  if (resolver) {
    return await resolver({
      model: args.model,
      params: args.params,
      deckPath: args.deckPath,
    });
  }
  if (Array.isArray(args.model)) {
    const first = args.model.find((entry) =>
      typeof entry === "string" && entry.trim().length > 0
    );
    if (!first) {
      throw new Error(`No model configured for deck ${args.deckPath}`);
    }
    return { model: first, params: args.params };
  }
  if (!args.model || !args.model.trim()) {
    throw new Error(`No model configured for deck ${args.deckPath}`);
  }
  return { model: args.model, params: args.params };
}

function resolveContextSchema(deck: LoadedDeck) {
  return deck.contextSchema ?? deck.inputSchema;
}

function resolveResponseSchema(deck: LoadedDeck) {
  return deck.responseSchema ?? deck.outputSchema;
}

function isContextToolName(name: string): boolean {
  return name === GAMBIT_TOOL_CONTEXT || name === GAMBIT_TOOL_INIT;
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

function resolveInput(args: {
  deck: LoadedDeck;
  input: unknown;
  state?: SavedState;
  isRoot: boolean;
  initialUserMessage?: unknown;
}) {
  if (args.input !== undefined) return args.input;
  if (!args.isRoot) return args.input;

  const persisted = extractContextInput(args.state);
  if (persisted !== undefined) return persisted;

  if (args.initialUserMessage !== undefined) {
    const schema = resolveContextSchema(args.deck) as {
      safeParse?: (v: unknown) => {
        success: boolean;
        data?: unknown;
      };
    } | undefined;
    if (schema?.safeParse) {
      const candidates: Array<unknown> = [undefined, {}, ""];
      for (const candidate of candidates) {
        try {
          const result = schema.safeParse(candidate);
          if (result?.success) return candidate;
        } catch {
          // ignore and try next candidate
        }
      }
    }
    return "";
  }

  return args.input;
}

function resolveInputWithoutDeck(args: {
  input: unknown;
  state?: SavedState;
  isRoot: boolean;
  initialUserMessage?: unknown;
}) {
  if (args.input !== undefined) return args.input;
  if (!args.isRoot) return args.input;

  const persisted = extractContextInput(args.state);
  if (persisted !== undefined) return persisted;

  if (args.initialUserMessage !== undefined) {
    return "";
  }

  return args.input;
}

function extractContextInput(state?: SavedState): unknown {
  if (!state) return undefined;
  if (state.format === "responses" && Array.isArray(state.items)) {
    return extractContextInputFromItems(state.items);
  }
  if (!state.messages) return undefined;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const msg = state.messages[i];
    if (msg.role === "tool" && isContextToolName(msg.name ?? "")) {
      const content = msg.content;
      if (typeof content !== "string") return undefined;
      try {
        return JSON.parse(content);
      } catch {
        return content;
      }
    }
  }
  return undefined;
}

function extractContextInputFromItems(items: Array<ResponseItem>): unknown {
  const contextToolNames = new Set([GAMBIT_TOOL_CONTEXT, GAMBIT_TOOL_INIT]);
  const callNameById = new Map<string, string>();
  for (const item of items) {
    if (item.type === "function_call") {
      callNameById.set(item.call_id, item.name);
    }
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type !== "function_call_output") continue;
    const name = callNameById.get(item.call_id);
    if (!name || !contextToolNames.has(name)) continue;
    try {
      return JSON.parse(item.output);
    } catch {
      return item.output;
    }
  }
  return undefined;
}

function messagesFromResponseItems(
  items: Array<ResponseItem>,
): Array<ModelMessage> {
  const messages: Array<ModelMessage> = [];
  const callNameById = new Map<string, string>();
  for (const item of items) {
    if (item.type === "message") {
      const text = item.content.map((part) => part.text).join("");
      messages.push({
        role: item.role,
        content: text || null,
      });
      continue;
    }
    if (item.type === "function_call") {
      callNameById.set(item.call_id, item.name);
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
        name: callNameById.get(item.call_id),
        tool_call_id: item.call_id,
        content: item.output,
      });
    }
  }
  return messages;
}

function responseItemsFromMessages(
  messages: Array<ModelMessage>,
): Array<ResponseItem> {
  const items: Array<ResponseItem> = [];
  for (const message of messages) {
    if (message.role === "tool") {
      if (!message.tool_call_id || message.content === null) continue;
      items.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: String(message.content),
      });
      continue;
    }
    const contentText = message.content ?? "";
    if (typeof contentText === "string" && contentText.length > 0) {
      items.push({
        type: "message",
        role: message.role,
        content: [{
          type: message.role === "assistant" ? "output_text" : "input_text",
          text: contentText,
        }],
      });
    }
    if (message.role === "assistant" && message.tool_calls) {
      for (const call of message.tool_calls) {
        items.push({
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
    }
  }
  return items;
}

function safeJsonArgs(value: string): Record<string, JSONValue> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, JSONValue>;
    }
  } catch {
    // ignore
  }
  return {};
}

function asToolKind(value: unknown, fallback: ToolKind): ToolKind {
  if (
    value === "action" || value === "external" || value === "mcp_bridge" ||
    value === "internal"
  ) {
    return value;
  }
  return fallback;
}

function projectStreamToolTraceEvents(input: {
  streamEvent: Record<string, JSONValue>;
  runId: string;
  parentActionCallId: string;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  emittedCalls: Set<string>;
  emittedResults: Set<string>;
  toolNames: Map<string, string>;
}): void {
  if (!input.trace) return;
  const type = typeof input.streamEvent.type === "string"
    ? input.streamEvent.type
    : "";
  if (type !== "tool.call" && type !== "tool.result") return;
  const actionCallId = typeof input.streamEvent.actionCallId === "string"
    ? input.streamEvent.actionCallId
    : "";
  const name = typeof input.streamEvent.name === "string"
    ? input.streamEvent.name
    : input.toolNames.get(actionCallId) ?? "";
  if (!actionCallId || !name) return;

  if (type === "tool.call") {
    if (input.emittedCalls.has(actionCallId)) return;
    input.emittedCalls.add(actionCallId);
    input.toolNames.set(actionCallId, name);
    const args = "args" in input.streamEvent
      ? (input.streamEvent.args ?? {}) as JSONValue
      : {};
    const toolKind = asToolKind(input.streamEvent.toolKind, "mcp_bridge");
    input.trace({
      type: "tool.call",
      runId: input.runId,
      actionCallId,
      name,
      args,
      toolKind,
      parentActionCallId: input.parentActionCallId,
    });
    return;
  }

  if (input.emittedResults.has(actionCallId)) return;
  input.emittedResults.add(actionCallId);
  const result = "result" in input.streamEvent
    ? (input.streamEvent.result ?? null) as JSONValue
    : null;
  const toolKind = asToolKind(input.streamEvent.toolKind, "mcp_bridge");
  input.trace({
    type: "tool.result",
    runId: input.runId,
    actionCallId,
    name,
    result,
    toolKind,
    parentActionCallId: input.parentActionCallId,
  });
}

function traceOpenResponsesStreamEvent(input: {
  streamEvent: Record<string, JSONValue>;
  runId: string;
  actionCallId: string;
  deckPath?: string;
  model?: string;
  parentActionCallId?: string;
  trace?: (event: import("./types.ts").TraceEvent) => void;
}): boolean {
  if (!input.trace) return false;
  const type = typeof input.streamEvent.type === "string"
    ? input.streamEvent.type
    : "";
  if (!type.startsWith("response.")) return false;
  const rawMeta = input.streamEvent._gambit;
  const existingMeta = rawMeta && typeof rawMeta === "object" &&
      !Array.isArray(rawMeta)
    ? rawMeta as Record<string, JSONValue>
    : {};
  input.trace(
    {
      ...input.streamEvent,
      type,
      _gambit: {
        ...existingMeta,
        run_id: input.runId,
        action_call_id: input.actionCallId,
        parent_action_call_id: input.parentActionCallId,
        deck_path: input.deckPath,
        model: input.model,
      },
    } as import("./types.ts").TraceEvent,
  );
  return true;
}

function mapResponseOutput(
  output: Array<ResponseItem>,
): {
  message: ModelMessage;
  toolCalls?: Array<
    { id: string; name: string; args: Record<string, JSONValue> }
  >;
} {
  const toolCalls: Array<
    { id: string; name: string; args: Record<string, JSONValue> }
  > = [];
  const textParts: Array<string> = [];
  for (const item of output) {
    if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id,
        name: item.name,
        args: safeJsonArgs(item.arguments),
      });
      continue;
    }
    if (item.type === "message" && item.role === "assistant") {
      for (const part of item.content) {
        if (part.type === "output_text") {
          textParts.push(part.text);
        }
      }
    }
  }
  return {
    message: {
      role: "assistant",
      content: textParts.length ? textParts.join("") : null,
    },
    toolCalls: toolCalls.length ? toolCalls : undefined,
  };
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

type RuntimeCtxBase = {
  deck: LoadedDeck;
  guardrails: Guardrails;
  depth: number;
  runId: string;
  inputProvided?: boolean;
  initialUserMessage?: unknown;
  parentActionCallId?: string;
  modelProvider: ModelProvider;
  input: unknown;
  defaultModel?: string;
  modelOverride?: string;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  stream?: boolean;
  state?: SavedState;
  onStateUpdate?: (state: SavedState) => void;
  onStreamText?: (chunk: string) => void;
  responsesMode?: boolean;
  permissions: NormalizedPermissionSet;
  permissionsTrace: PermissionTrace;
  workspacePermissions?: PermissionDeclarationInput;
  workspacePermissionsBaseDir?: string;
  sessionPermissions?: PermissionDeclarationInput;
  sessionPermissionsBaseDir?: string;
  runDeadlineMs: number;
  workerSandbox: boolean;
  signal?: AbortSignal;
  onTool?: RunOptions["onTool"];
};

type WorkerRuntimeCtx = Omit<RuntimeCtxBase, "deck" | "workerSandbox"> & {
  deckPath: string;
  isRoot: boolean;
  allowRootStringInput: boolean;
};

async function runComputeDeck(ctx: RuntimeCtxBase): Promise<unknown> {
  if (ctx.workerSandbox) {
    return await runComputeDeckInWorker({
      guardrails: ctx.guardrails,
      depth: ctx.depth,
      runId: ctx.runId,
      inputProvided: ctx.inputProvided,
      initialUserMessage: ctx.initialUserMessage,
      parentActionCallId: ctx.parentActionCallId,
      modelProvider: ctx.modelProvider,
      input: ctx.input,
      defaultModel: ctx.defaultModel,
      modelOverride: ctx.modelOverride,
      trace: ctx.trace,
      stream: ctx.stream,
      state: ctx.state,
      onStateUpdate: ctx.onStateUpdate,
      onStreamText: ctx.onStreamText,
      responsesMode: ctx.responsesMode,
      permissions: ctx.permissions,
      permissionsTrace: ctx.permissionsTrace,
      workspacePermissions: ctx.workspacePermissions,
      workspacePermissionsBaseDir: ctx.workspacePermissionsBaseDir,
      sessionPermissions: ctx.sessionPermissions,
      sessionPermissionsBaseDir: ctx.sessionPermissionsBaseDir,
      runDeadlineMs: ctx.runDeadlineMs,
      deckPath: ctx.deck.path,
      isRoot: ctx.depth === 0 && !ctx.parentActionCallId,
      allowRootStringInput: false,
      signal: ctx.signal,
    });
  }
  return await runComputeDeckInProcess(ctx);
}

function toDenoPermissionList(scope: {
  all: boolean;
  values: Set<string>;
}): true | false | Array<string> {
  if (scope.all) return true;
  if (scope.values.size === 0) return false;
  return Array.from(scope.values).sort();
}

function toDenoRunPermission(scope: {
  all: boolean;
  paths: Set<string>;
  commands: Set<string>;
}): true | false | Array<string> {
  if (scope.all) return true;
  const values = new Set<string>([
    ...Array.from(scope.paths),
    ...Array.from(scope.commands),
  ]);
  if (values.size === 0) return false;
  return Array.from(values).sort();
}

const IMPORT_SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const RESOLVABLE_MODULE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
];

function stripSpecifierSuffix(specifier: string): string {
  let out = specifier;
  const q = out.indexOf("?");
  if (q >= 0) out = out.slice(0, q);
  const h = out.indexOf("#");
  if (h >= 0) out = out.slice(0, h);
  return out.trim();
}

function isIdentifierStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

function isIdentifierContinue(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") {
        i++;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length) {
        if (source[i] === "*" && source[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }
    break;
  }
  return i;
}

function readIdentifier(
  source: string,
  start: number,
): { value: string; end: number } | undefined {
  if (start >= source.length) return undefined;
  if (!isIdentifierStart(source[start])) return undefined;
  let i = start + 1;
  while (i < source.length && isIdentifierContinue(source[i])) i++;
  return { value: source.slice(start, i), end: i };
}

function readStringLiteral(
  source: string,
  start: number,
): { value: string; end: number } | undefined {
  const quote = source[start];
  if (quote !== "'" && quote !== '"') return undefined;
  let i = start + 1;
  let value = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      if (i + 1 >= source.length) return undefined;
      value += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === quote) return { value, end: i + 1 };
    if (ch === "\n" || ch === "\r") return undefined;
    value += ch;
    i++;
  }
  return undefined;
}

function skipTemplateExpression(source: string, start: number): number {
  let i = start;
  let depth = 1;
  while (i < source.length && depth > 0) {
    i = skipWhitespaceAndComments(source, i);
    if (i >= source.length) break;
    const ch = source[i];
    if (ch === "'" || ch === '"') {
      const stringLiteral = readStringLiteral(source, i);
      i = stringLiteral ? stringLiteral.end : i + 1;
      continue;
    }
    if (ch === "`") {
      i = skipTemplateLiteral(source, i);
      continue;
    }
    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      depth--;
      i++;
      continue;
    }
    i++;
  }
  return i;
}

function skipTemplateLiteral(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return i + 1;
    if (ch === "$" && source[i + 1] === "{") {
      i = skipTemplateExpression(source, i + 2);
      continue;
    }
    i++;
  }
  return i;
}

function readSpecifierAfterFrom(
  source: string,
  start: number,
): { specifier?: string; end: number } {
  const i = skipWhitespaceAndComments(source, start);
  const stringLiteral = readStringLiteral(source, i);
  if (!stringLiteral) return { end: i };
  return { specifier: stringLiteral.value, end: stringLiteral.end };
}

function readImportCallSpecifier(
  source: string,
  start: number,
): { specifier?: string; end: number } {
  let i = skipWhitespaceAndComments(source, start);
  if (source[i] !== "(") return { end: i };
  i = skipWhitespaceAndComments(source, i + 1);
  const stringLiteral = readStringLiteral(source, i);
  if (!stringLiteral) return { end: i };
  i = skipWhitespaceAndComments(source, stringLiteral.end);
  if (source[i] === ")") i++;
  return { specifier: stringLiteral.value, end: i };
}

function readImportOrExportStatementSpecifier(
  source: string,
  start: number,
  keyword: "import" | "export",
): { specifier?: string; end: number } {
  let i = skipWhitespaceAndComments(source, start);

  if (keyword === "import") {
    if (source[i] === ".") return { end: i + 1 }; // import.meta
    const sideEffectImport = readStringLiteral(source, i);
    if (sideEffectImport) {
      return { specifier: sideEffectImport.value, end: sideEffectImport.end };
    }
  }

  let depth = 0;
  while (i < source.length) {
    i = skipWhitespaceAndComments(source, i);
    if (i >= source.length) break;
    const ch = source[i];

    if (ch === "'" || ch === '"') {
      const stringLiteral = readStringLiteral(source, i);
      i = stringLiteral ? stringLiteral.end : i + 1;
      continue;
    }
    if (ch === "`") {
      i = skipTemplateLiteral(source, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth > 0) depth--;
      i++;
      continue;
    }
    if (depth === 0) {
      if (ch === ";") return { end: i + 1 };
      const identifier = readIdentifier(source, i);
      if (identifier?.value === "from") {
        return readSpecifierAfterFrom(source, identifier.end);
      }
      if (identifier) {
        i = identifier.end;
        continue;
      }
    }
    i++;
  }
  return { end: i };
}

function extractModuleSpecifiers(source: string): Set<string> {
  const out = new Set<string>();
  let i = 0;
  while (i < source.length) {
    i = skipWhitespaceAndComments(source, i);
    if (i >= source.length) break;

    const ch = source[i];
    if (ch === "'" || ch === '"') {
      const stringLiteral = readStringLiteral(source, i);
      i = stringLiteral ? stringLiteral.end : i + 1;
      continue;
    }
    if (ch === "`") {
      i = skipTemplateLiteral(source, i);
      continue;
    }

    const identifier = readIdentifier(source, i);
    if (!identifier) {
      i++;
      continue;
    }

    if (identifier.value === "import") {
      const afterImport = skipWhitespaceAndComments(source, identifier.end);
      if (source[afterImport] === "(") {
        const result = readImportCallSpecifier(source, afterImport);
        if (result.specifier) out.add(result.specifier);
        i = Math.max(result.end, afterImport + 1);
        continue;
      }
      const result = readImportOrExportStatementSpecifier(
        source,
        identifier.end,
        "import",
      );
      if (result.specifier) out.add(result.specifier);
      i = Math.max(result.end, identifier.end);
      continue;
    }

    if (identifier.value === "export") {
      const result = readImportOrExportStatementSpecifier(
        source,
        identifier.end,
        "export",
      );
      if (result.specifier) out.add(result.specifier);
      i = Math.max(result.end, identifier.end);
      continue;
    }

    i = identifier.end;
  }
  return out;
}

function resolveExistingModulePath(candidate: string): string | undefined {
  const resolved = path.resolve(candidate);
  const candidates = new Set<string>([resolved]);
  if (!path.extname(resolved)) {
    for (const ext of RESOLVABLE_MODULE_EXTENSIONS) {
      candidates.add(`${resolved}${ext}`);
      candidates.add(path.join(resolved, `index${ext}`));
    }
  }
  for (const filePath of candidates) {
    try {
      if (Deno.statSync(filePath).isFile) {
        return path.resolve(filePath);
      }
    } catch {
      // ignore unresolved module candidates
    }
  }
  return undefined;
}

function resolveLocalImportPath(
  importerPath: string,
  specifier: string,
): string | undefined {
  const cleaned = stripSpecifierSuffix(specifier);
  if (!cleaned) return undefined;
  if (cleaned.startsWith("file://")) {
    try {
      return resolveExistingModulePath(path.fromFileUrl(cleaned));
    } catch {
      return undefined;
    }
  }
  if (
    !(cleaned.startsWith("./") || cleaned.startsWith("../") ||
      path.isAbsolute(cleaned))
  ) {
    return undefined;
  }
  const base = path.isAbsolute(cleaned)
    ? cleaned
    : path.resolve(path.dirname(importerPath), cleaned);
  return resolveExistingModulePath(base);
}

function collectLocalImportGraph(entryPath: string): Set<string> {
  const visited = new Set<string>();
  const queue: Array<string> = [path.resolve(entryPath)];

  while (queue.length > 0) {
    const current = queue.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const ext = path.extname(current).toLowerCase();
    if (!IMPORT_SOURCE_EXTENSIONS.has(ext)) {
      continue;
    }

    let source: string;
    try {
      source = Deno.readTextFileSync(current);
    } catch {
      continue;
    }

    const specifiers = extractModuleSpecifiers(source);
    for (const specifier of specifiers) {
      const resolved = resolveLocalImportPath(current, specifier);
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return visited;
}

const WORKER_ENTRY_PATHS = [
  "./runtime_worker.ts",
  "./runtime_orchestration_worker.ts",
].map((relative) => path.fromFileUrl(new URL(relative, import.meta.url)));
const BUILTIN_SCHEMAS_DIR = path.resolve(
  path.dirname(path.fromFileUrl(import.meta.url)),
  "../schemas",
);
const BUILTIN_SNIPPETS_DIR = path.resolve(
  path.dirname(path.fromFileUrl(import.meta.url)),
  "../snippets",
);

let builtinSchemaBootstrapCache: Array<string> | undefined;
function builtinSchemaBootstrapReads(): Array<string> {
  if (builtinSchemaBootstrapCache) return builtinSchemaBootstrapCache;
  const schemaModules: Array<string> = [];
  const stack: Array<string> = [BUILTIN_SCHEMAS_DIR];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: Array<Deno.DirEntry> = [];
    try {
      entries = Array.from(Deno.readDirSync(current));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory) {
        stack.push(target);
        continue;
      }
      if (!entry.isFile) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== ".ts") continue;
      schemaModules.push(target);
    }
  }
  builtinSchemaBootstrapCache = Array.from(
    new Set<string>(
      schemaModules.flatMap((entry) =>
        Array.from(collectLocalImportGraph(entry))
      ),
    ),
  ).sort();
  return builtinSchemaBootstrapCache;
}

let builtinSnippetBootstrapCache: Array<string> | undefined;
function builtinSnippetBootstrapReads(): Array<string> {
  if (builtinSnippetBootstrapCache) return builtinSnippetBootstrapCache;
  const snippetFiles: Array<string> = [];
  const stack: Array<string> = [BUILTIN_SNIPPETS_DIR];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: Array<Deno.DirEntry> = [];
    try {
      entries = Array.from(Deno.readDirSync(current));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory) {
        stack.push(target);
        continue;
      }
      if (!entry.isFile) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== ".md") continue;
      snippetFiles.push(target);
    }
  }
  builtinSnippetBootstrapCache = Array.from(new Set(snippetFiles)).sort();
  return builtinSnippetBootstrapCache;
}

function workerBootstrapReadAllowlist(deckPath: string): Array<string> {
  return Array.from(
    new Set<string>([
      ...Array.from(collectLocalImportGraph(deckPath)),
      ...WORKER_ENTRY_PATHS.flatMap((entry) =>
        Array.from(collectLocalImportGraph(entry))
      ),
      ...builtinSchemaBootstrapReads(),
      ...builtinSnippetBootstrapReads(),
    ]),
  ).sort();
}

let trustedWorkerBootstrapCache: Array<string> | undefined;
function trustedWorkerBootstrapReads(): Array<string> {
  if (trustedWorkerBootstrapCache) return trustedWorkerBootstrapCache;
  const definitionsPath = path.fromFileUrl(
    new URL("./definitions.ts", import.meta.url),
  );
  const modPath = path.fromFileUrl(new URL("../mod.ts", import.meta.url));
  trustedWorkerBootstrapCache = Array.from(
    new Set<string>([
      ...WORKER_ENTRY_PATHS.flatMap((entry) =>
        Array.from(collectLocalImportGraph(entry))
      ),
      ...Array.from(collectLocalImportGraph(definitionsPath)),
      ...Array.from(collectLocalImportGraph(modPath)),
      ...builtinSchemaBootstrapReads(),
      ...builtinSnippetBootstrapReads(),
    ]),
  ).sort();
  return trustedWorkerBootstrapCache;
}

function pathMatchesPermissionRoot(root: string, target: string): boolean {
  if (root === target) return true;
  const rel = path.relative(root, target);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function constrainBootstrapReads(
  permissions: NormalizedPermissionSet,
  roots: Array<string>,
  trustedReads: Set<string>,
  reads: Array<string>,
): Array<string> {
  const allowedRoots = [
    ...roots.map((entry) => path.resolve(entry)),
    ...Array.from(permissions.read.values).map((entry) =>
      path.resolve(permissions.baseDir, entry)
    ),
  ];
  if (permissions.read.all) {
    return Array.from(new Set(reads)).sort();
  }
  if (allowedRoots.length === 0) return [];
  return reads.filter((entry) => {
    const target = path.resolve(permissions.baseDir, entry);
    if (trustedReads.has(target)) return true;
    return allowedRoots.some((root) => pathMatchesPermissionRoot(root, target));
  });
}

function buildWorkerPermissions(
  permissions: NormalizedPermissionSet,
  deckPath: string,
): WorkerSandboxPermissionSet {
  const workerDirs = WORKER_ENTRY_PATHS.map((entry) => path.dirname(entry));
  const bootstrapReads = constrainBootstrapReads(
    permissions,
    [path.dirname(deckPath), ...workerDirs],
    new Set(trustedWorkerBootstrapReads()),
    workerBootstrapReadAllowlist(deckPath),
  );
  const mergedRead = permissions.read.all ? true : Array.from(
    new Set<string>([
      ...Array.from(permissions.read.values),
      ...bootstrapReads,
    ]),
  ).sort();
  return {
    permissions: {
      read: mergedRead === true
        ? true
        : mergedRead.length > 0
        ? mergedRead
        : false,
      write: toDenoPermissionList(permissions.write),
      run: toDenoRunPermission(permissions.run),
      net: toDenoPermissionList(permissions.net),
      env: toDenoPermissionList(permissions.env),
      // Worker module graphs include JSR dependencies (e.g. @std/*). Allow
      // manifest resolution without widening deck runtime file/run permissions.
      import: ["jsr.io:443"],
    },
  };
}

function buildDeckInspectWorkerPermissions(
  deckPath: string,
): WorkerSandboxPermissionSet {
  const deckDir = path.dirname(deckPath);
  const workerDirs = WORKER_ENTRY_PATHS.map((entry) => path.dirname(entry));
  const inspectSeedPermissions: NormalizedPermissionSet = {
    baseDir: deckDir,
    read: { all: false, values: new Set<string>() },
    write: { all: false, values: new Set<string>() },
    run: { all: false, paths: new Set<string>(), commands: new Set<string>() },
    net: { all: false, values: new Set<string>() },
    env: { all: false, values: new Set<string>() },
  };
  const bootstrapReads = constrainBootstrapReads(
    inspectSeedPermissions,
    [path.dirname(deckPath), ...workerDirs],
    new Set(trustedWorkerBootstrapReads()),
    workerBootstrapReadAllowlist(deckPath),
  );
  const inspectReads = Array.from(
    new Set<string>([deckDir, ...bootstrapReads]),
  ).sort();
  return {
    permissions: {
      read: inspectReads.length > 0 ? inspectReads : false,
      write: false,
      run: false,
      net: false,
      env: false,
    },
  };
}

async function inspectDeckInWorker(
  deckPath: string,
  runDeadlineMs?: number,
): Promise<WorkerDeckInspection> {
  if (typeof runDeadlineMs === "number" && Number.isFinite(runDeadlineMs)) {
    ensureNotExpired(runDeadlineMs);
  }
  const bridgeSession = randomId("bridge");
  const worker = createWorkerSandboxBridge(
    new URL("./runtime_worker.ts", import.meta.url).href,
    buildDeckInspectWorkerPermissions(deckPath),
  );
  let settled = false;
  const clearAndTerminate = () => {
    try {
      worker.terminate();
    } catch {
      // ignore
    }
  };
  let timeoutId: number | undefined;

  const outcome = new Promise<WorkerDeckInspection>((resolve, reject) => {
    const finishResolve = (value: WorkerDeckInspection) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      resolve(value);
    };
    const finishReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      reject(err);
    };

    const deadlineConstrained = typeof runDeadlineMs === "number" &&
      Number.isFinite(runDeadlineMs);
    const timeoutMs = deadlineConstrained
      ? Math.max(
        0,
        Math.min(
          INSPECT_WORKER_TIMEOUT_MS,
          Math.floor(runDeadlineMs - performance.now()),
        ),
      )
      : INSPECT_WORKER_TIMEOUT_MS;
    const timeoutMessage = deadlineConstrained &&
        timeoutMs < INSPECT_WORKER_TIMEOUT_MS
      ? WORKER_TIMEOUT_MESSAGE
      : INSPECT_WORKER_TIMEOUT_MESSAGE;
    timeoutId = setTimeout(() => {
      finishReject(new Error(timeoutMessage));
      clearAndTerminate();
    }, timeoutMs) as unknown as number;

    worker.addEventListener("error", (event: WorkerBridgeEvent) => {
      event.preventDefault?.();
      finishReject(
        event.error ??
          new Error(
            typeof event.message === "string"
              ? event.message
              : "Worker execution failed",
          ),
      );
    });

    worker.addEventListener("messageerror", () => {
      finishReject(new Error("Worker bridge message serialization failed"));
    });

    worker.addEventListener("message", (event: WorkerBridgeEvent) => {
      const msg = event.data as Record<string, unknown>;
      const receivedSession = typeof msg.bridgeSession === "string"
        ? msg.bridgeSession
        : "";
      if (receivedSession !== bridgeSession) {
        if (typeof msg.type === "string") {
          logger.warn(
            `[gambit] rejected inspect-worker message with mismatched bridge session (type=${msg.type})`,
          );
        }
        return;
      }
      const type = typeof msg.type === "string" ? msg.type : "";
      if (type === "deck.inspect.result") {
        finishResolve((msg as { result: WorkerDeckInspection }).result);
        return;
      }
      if (type === "deck.inspect.error" || type === "run.error") {
        finishReject(normalizeWorkerError((msg as { error?: unknown }).error));
      }
    });
  });

  try {
    worker.postMessage({ type: "deck.inspect", bridgeSession, deckPath });
    return await outcome;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    clearAndTerminate();
  }
}

function normalizeWorkerError(err: unknown): Error {
  if (!err || typeof err !== "object") {
    return new Error(String(err));
  }
  const rec = err as Record<string, unknown>;
  const message =
    typeof rec.message === "string" && rec.message.trim().length > 0
      ? rec.message
      : "Worker execution failed";
  const code = typeof rec.code === "string" ? rec.code : undefined;
  const name = typeof rec.name === "string" ? rec.name : undefined;
  const source = typeof rec.source === "string" ? rec.source : undefined;
  const out = new Error(
    source ? `[${source}] ${message}${code ? ` (${code})` : ""}` : message,
  );
  if (name) out.name = name;
  return out;
}

type OrchestrationRunStartMessage = {
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

type OrchestrationModelChatRequest = {
  type: "model.chat.request";
  bridgeSession: string;
  requestId: string;
  input: {
    model: string;
    messages: Array<ModelMessage>;
    tools?: Array<ToolDefinition>;
    stream?: boolean;
    state?: SavedState;
    deckPath?: string;
    params?: Record<string, unknown>;
  };
};

type OrchestrationModelResponsesRequest = {
  type: "model.responses.request";
  bridgeSession: string;
  requestId: string;
  input: {
    request: CreateResponseRequest;
    state?: SavedState;
    deckPath?: string;
  };
};

type OrchestrationModelResolveRequest = {
  type: "model.resolveModel.request";
  bridgeSession: string;
  requestId: string;
  input: {
    model: string | Array<string>;
    params?: Record<string, unknown>;
    deckPath?: string;
  };
};

type OrchestrationWorkerMessageToParent =
  | {
    type: "trace.event";
    bridgeSession: string;
    event: import("./types.ts").TraceEvent;
  }
  | { type: "state.update"; bridgeSession: string; state: SavedState }
  | { type: "stream.text"; bridgeSession: string; chunk: string }
  | OrchestrationModelChatRequest
  | OrchestrationModelResponsesRequest
  | OrchestrationModelResolveRequest
  | {
    type: "run.result";
    bridgeSession: string;
    completionNonce?: string;
    result: unknown;
  }
  | {
    type: "run.error";
    bridgeSession: string;
    completionNonce?: string;
    error: unknown;
  };

type OrchestrationParentMessage =
  | OrchestrationRunStartMessage
  | {
    type: "model.chat.result";
    requestId: string;
    result: Awaited<ReturnType<ModelProvider["chat"]>>;
  }
  | {
    type: "model.responses.result";
    requestId: string;
    result: CreateResponseResponse;
  }
  | {
    type: "model.resolveModel.result";
    requestId: string;
    result: {
      model: string;
      params?: Record<string, unknown>;
    };
  }
  | {
    type: "model.chat.stream";
    requestId: string;
    chunk: string;
  }
  | {
    type: "model.responses.event";
    requestId: string;
    event: ResponseEvent;
  }
  | {
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

async function runLlmDeckInWorker(
  ctx: Omit<RuntimeCtxBase, "deck"> & {
    deckPath: string;
    initialUserMessage?: unknown;
    inputProvided?: boolean;
    allowRootStringInput?: boolean;
    isRoot: boolean;
  },
): Promise<unknown> {
  throwIfCanceled(ctx.signal);
  const bridgeSession = randomId("bridge");
  const completionNonce = randomId("done");
  const worker = createWorkerSandboxBridge(
    new URL("./runtime_orchestration_worker.ts", import.meta.url).href,
    buildWorkerPermissions(ctx.permissions, ctx.deckPath),
  );

  let settled = false;
  const clearAndTerminate = () => {
    try {
      worker.terminate();
    } catch {
      // ignore
    }
  };
  let timeoutId: number | undefined;

  const outcome = new Promise<unknown>((resolve, reject) => {
    const finishResolve = (value: unknown) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      resolve(value);
    };
    const finishReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      reject(err);
    };

    const remainingMs = Math.max(
      0,
      Math.floor(ctx.runDeadlineMs - performance.now()),
    );
    timeoutId = setTimeout(() => {
      finishReject(new Error(WORKER_TIMEOUT_MESSAGE));
      clearAndTerminate();
    }, remainingMs) as unknown as number;

    worker.addEventListener("error", (event: WorkerBridgeEvent) => {
      event.preventDefault?.();
      finishReject(
        event.error ??
          new Error(
            typeof event.message === "string"
              ? event.message
              : "Worker execution failed",
          ),
      );
    });

    worker.addEventListener("messageerror", () => {
      finishReject(new Error("Worker bridge message serialization failed"));
    });

    worker.addEventListener("message", (event: WorkerBridgeEvent) => {
      const msg = event.data as OrchestrationWorkerMessageToParent;
      if (!msg || typeof msg !== "object") return;
      if (msg.bridgeSession !== bridgeSession) {
        logger.warn(
          `[gambit] rejected orchestration-worker message with mismatched bridge session (type=${msg.type})`,
        );
        return;
      }

      if (msg.type === "trace.event") {
        ctx.trace?.(msg.event);
        return;
      }
      if (msg.type === "state.update") {
        ctx.onStateUpdate?.(msg.state);
        return;
      }
      if (msg.type === "stream.text") {
        ctx.onStreamText?.(msg.chunk);
        return;
      }

      if (msg.type === "model.chat.request") {
        (async () => {
          try {
            const result = await ctx.modelProvider.chat({
              ...msg.input,
              signal: ctx.signal,
              onStreamText: (chunk) => {
                worker.postMessage(
                  {
                    type: "model.chat.stream",
                    requestId: msg.requestId,
                    chunk,
                  } satisfies OrchestrationParentMessage,
                );
              },
            });
            worker.postMessage(
              {
                type: "model.chat.result",
                requestId: msg.requestId,
                result,
              } satisfies OrchestrationParentMessage,
            );
          } catch (err) {
            worker.postMessage(
              {
                type: "model.chat.error",
                requestId: msg.requestId,
                error: {
                  source: "model",
                  name: err instanceof Error ? err.name : undefined,
                  message: err instanceof Error ? err.message : String(err),
                  code: (err as { code?: unknown })?.code,
                },
              } satisfies OrchestrationParentMessage,
            );
          }
        })();
        return;
      }

      if (msg.type === "model.responses.request") {
        (async () => {
          try {
            if (!ctx.modelProvider.responses) {
              throw new Error(
                "Responses API unavailable for current model provider",
              );
            }
            const result = await ctx.modelProvider.responses({
              ...msg.input,
              signal: ctx.signal,
              onStreamEvent: (streamEvent) => {
                worker.postMessage(
                  {
                    type: "model.responses.event",
                    requestId: msg.requestId,
                    event: streamEvent,
                  } satisfies OrchestrationParentMessage,
                );
              },
            });
            worker.postMessage(
              {
                type: "model.responses.result",
                requestId: msg.requestId,
                result,
              } satisfies OrchestrationParentMessage,
            );
          } catch (err) {
            worker.postMessage(
              {
                type: "model.responses.error",
                requestId: msg.requestId,
                error: {
                  source: "model",
                  name: err instanceof Error ? err.name : undefined,
                  message: err instanceof Error ? err.message : String(err),
                  code: (err as { code?: unknown })?.code,
                },
              } satisfies OrchestrationParentMessage,
            );
          }
        })();
        return;
      }

      if (msg.type === "model.resolveModel.request") {
        (async () => {
          try {
            const result = ctx.modelProvider.resolveModel
              ? await ctx.modelProvider.resolveModel(msg.input)
              : {
                model: Array.isArray(msg.input.model)
                  ? msg.input.model[0]
                  : msg.input.model,
                params: msg.input.params,
              };
            worker.postMessage(
              {
                type: "model.resolveModel.result",
                requestId: msg.requestId,
                result,
              } satisfies OrchestrationParentMessage,
            );
          } catch (err) {
            worker.postMessage(
              {
                type: "model.resolveModel.error",
                requestId: msg.requestId,
                error: {
                  source: "model",
                  name: err instanceof Error ? err.name : undefined,
                  message: err instanceof Error ? err.message : String(err),
                  code: (err as { code?: unknown })?.code,
                },
              } satisfies OrchestrationParentMessage,
            );
          }
        })();
        return;
      }

      if (msg.type === "run.result") {
        if (msg.completionNonce !== completionNonce) {
          logger.warn(
            `[gambit] rejected orchestration-worker run.result with invalid completion nonce`,
          );
          return;
        }
        finishResolve(msg.result);
        return;
      }
      if (msg.type === "run.error") {
        if (msg.completionNonce !== completionNonce) {
          logger.warn(
            `[gambit] rejected orchestration-worker run.error with invalid completion nonce`,
          );
          return;
        }
        finishReject(normalizeWorkerError(msg.error));
      }
    });
  });

  try {
    worker.postMessage(
      {
        type: "run.start",
        bridgeSession,
        completionNonce,
        options: {
          path: ctx.deckPath,
          input: ctx.input,
          inputProvided: ctx.inputProvided,
          initialUserMessage: ctx.initialUserMessage,
          isRoot: ctx.isRoot,
          guardrails: ctx.guardrails,
          depth: ctx.depth,
          parentActionCallId: ctx.parentActionCallId,
          runId: ctx.runId,
          defaultModel: ctx.defaultModel,
          modelOverride: ctx.modelOverride,
          stream: ctx.stream,
          state: ctx.state,
          responsesMode: ctx.responsesMode,
          allowRootStringInput: ctx.allowRootStringInput,
          runDeadlineMs: ctx.runDeadlineMs,
        },
        permissionCeiling: toWirePermissionSet(ctx.permissions),
      } satisfies OrchestrationRunStartMessage,
    );
    ensureRunActive(ctx.runDeadlineMs, ctx.signal);
    return await outcome;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    clearAndTerminate();
  }
}

type WorkerSpawnRequest = {
  bridgeSession: string;
  requestId: string;
  payload: {
    path: string;
    input: unknown;
    initialUserMessage?: unknown;
    parentActionCallId?: string;
    parentPermissionsBaseDir: string;
    parentPermissions: WirePermissionSet;
    workspacePermissions?: PermissionDeclarationInput;
    workspacePermissionsBaseDir?: string;
    sessionPermissions?: PermissionDeclarationInput;
    sessionPermissionsBaseDir?: string;
    runDeadlineMs: number;
  };
};

async function runComputeDeckInWorker(ctx: WorkerRuntimeCtx): Promise<unknown> {
  throwIfCanceled(ctx.signal);
  const { runId } = ctx;
  const actionCallId = randomId("action");
  const bridgeSession = randomId("bridge");
  const completionNonce = randomId("done");
  const worker = createWorkerSandboxBridge(
    new URL("./runtime_worker.ts", import.meta.url).href,
    buildWorkerPermissions(ctx.permissions, ctx.deckPath),
  );

  let settled = false;
  const clearAndTerminate = () => {
    try {
      worker.terminate();
    } catch {
      // ignore
    }
  };
  let timeoutId: number | undefined;
  const activeSpawnRequests = new Set<string>();
  let currentState = ctx.state;

  const outcome = new Promise<unknown>((resolve, reject) => {
    const finishResolve = (value: unknown) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      resolve(value);
    };
    const finishReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      reject(err);
    };
    const remainingMs = Math.max(
      0,
      Math.floor(ctx.runDeadlineMs - performance.now()),
    );
    timeoutId = setTimeout(() => {
      finishReject(new Error(WORKER_TIMEOUT_MESSAGE));
      clearAndTerminate();
    }, remainingMs) as unknown as number;

    worker.addEventListener("error", (event: WorkerBridgeEvent) => {
      event.preventDefault?.();
      finishReject(
        event.error ??
          new Error(
            typeof event.message === "string"
              ? event.message
              : "Worker execution failed",
          ),
      );
    });

    worker.addEventListener("messageerror", () => {
      finishReject(new Error("Worker bridge message serialization failed"));
    });

    worker.addEventListener("message", (event: WorkerBridgeEvent) => {
      const msg = event.data as Record<string, unknown>;
      const receivedBridgeSession = typeof msg.bridgeSession === "string"
        ? msg.bridgeSession
        : "";
      if (receivedBridgeSession !== bridgeSession) {
        const type = typeof msg.type === "string" ? msg.type : "unknown";
        logger.warn(
          `[gambit] rejected compute-worker message with mismatched bridge session (type=${type})`,
        );
        return;
      }
      // Ignore any late worker messages once this run has already settled.
      if (settled) return;
      const type = typeof msg.type === "string" ? msg.type : "";
      if (type === "log.entry") {
        if (!ctx.trace) return;
        const entry = msg.entry;
        const raw = typeof entry === "string"
          ? { message: entry }
          : entry && typeof entry === "object"
          ? entry as Record<string, unknown>
          : { message: "" };
        const message = typeof raw.message === "string"
          ? raw.message
          : raw.message !== undefined
          ? String(raw.message)
          : "";
        const title = typeof raw.title === "string" ? raw.title : undefined;
        const body = raw.body ?? raw.message ?? message;
        ctx.trace({
          type: "log",
          runId,
          deckPath: ctx.deckPath,
          actionCallId,
          parentActionCallId: ctx.parentActionCallId,
          level: (raw.level as "debug" | "info" | "warn" | "error") ?? "info",
          title: title ?? (message || undefined),
          message,
          body,
          meta: raw.meta,
        });
        return;
      }

      if (type === "spawn.request") {
        const req = msg as unknown as WorkerSpawnRequest;
        const requestId = req.requestId;
        if (!requestId) return;
        if (activeSpawnRequests.has(requestId)) {
          logger.warn(
            `[gambit] rejected duplicate compute-worker spawn.request (${requestId})`,
          );
          return;
        }
        activeSpawnRequests.add(requestId);
        (async () => {
          try {
            const parentFromWorker = normalizePermissionBaseDir(
              fromWirePermissionSet(req.payload.parentPermissions),
              req.payload.parentPermissionsBaseDir,
            );
            // Enforce monotonicity against the parent effective ceiling.
            const bridgedParent = intersectPermissions(
              ctx.permissions,
              parentFromWorker,
              req.payload.parentPermissionsBaseDir,
            );
            const childResult = await runDeck({
              path: req.payload.path,
              input: req.payload.input,
              modelProvider: ctx.modelProvider,
              isRoot: false,
              guardrails: ctx.guardrails,
              depth: ctx.depth + 1,
              parentActionCallId: req.payload.parentActionCallId,
              runId,
              defaultModel: ctx.defaultModel,
              modelOverride: ctx.modelOverride,
              trace: ctx.trace,
              stream: ctx.stream,
              state: currentState,
              onStateUpdate: (state) => {
                currentState = state;
                ctx.onStateUpdate?.(state);
              },
              onStreamText: ctx.onStreamText,
              responsesMode: ctx.responsesMode,
              initialUserMessage: req.payload.initialUserMessage,
              inputProvided: true,
              parentPermissions: bridgedParent,
              workspacePermissions: req.payload.workspacePermissions,
              workspacePermissionsBaseDir:
                req.payload.workspacePermissionsBaseDir,
              sessionPermissions: req.payload.sessionPermissions,
              sessionPermissionsBaseDir: req.payload.sessionPermissionsBaseDir,
              runDeadlineMs: Math.min(
                ctx.runDeadlineMs,
                Number.isFinite(req.payload.runDeadlineMs)
                  ? req.payload.runDeadlineMs
                  : ctx.runDeadlineMs,
              ),
              workerSandbox: true,
              signal: ctx.signal,
              onTool: ctx.onTool,
            });
            worker.postMessage({
              type: "spawn.result",
              requestId,
              result: childResult,
            });
          } catch (err) {
            worker.postMessage({
              type: "spawn.error",
              requestId,
              error: {
                source: "child",
                name: err instanceof Error ? err.name : undefined,
                message: err instanceof Error ? err.message : String(err),
                code: (err as { code?: unknown })?.code,
              },
            });
          } finally {
            activeSpawnRequests.delete(requestId);
          }
        })();
        return;
      }

      if (type === "state.update") {
        const nextState = (msg as { state?: SavedState }).state;
        if (!nextState || typeof nextState !== "object") return;
        currentState = nextState;
        ctx.onStateUpdate?.(nextState);
        return;
      }

      if (type === "run.result") {
        if (
          (msg as { completionNonce?: unknown }).completionNonce !==
            completionNonce
        ) {
          logger.warn(
            `[gambit] rejected compute-worker run.result with invalid completion nonce`,
          );
          return;
        }
        finishResolve((msg as { result?: unknown }).result);
        return;
      }

      if (type === "run.error") {
        if (
          (msg as { completionNonce?: unknown }).completionNonce !==
            completionNonce
        ) {
          logger.warn(
            `[gambit] rejected compute-worker run.error with invalid completion nonce`,
          );
          return;
        }
        finishReject(normalizeWorkerError((msg as { error?: unknown }).error));
      }
    });
  });

  try {
    worker.postMessage({
      type: "run.start",
      bridgeSession,
      completionNonce,
      runId,
      actionCallId,
      deckPath: ctx.deckPath,
      input: ctx.input,
      state: ctx.state,
      initialUserMessage: ctx.initialUserMessage,
      depth: ctx.depth,
      parentActionCallId: ctx.parentActionCallId,
      permissions: toWirePermissionSet(ctx.permissions),
      workspacePermissions: ctx.workspacePermissions,
      workspacePermissionsBaseDir: ctx.workspacePermissionsBaseDir,
      sessionPermissions: ctx.sessionPermissions,
      sessionPermissionsBaseDir: ctx.sessionPermissionsBaseDir,
      runDeadlineMs: ctx.runDeadlineMs,
      isRoot: ctx.isRoot,
      allowRootStringInput: ctx.allowRootStringInput,
    });
    const raw = await outcome;
    ensureRunActive(ctx.runDeadlineMs, ctx.signal);
    return raw;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    clearAndTerminate();
  }
}

async function runComputeDeckInProcess(ctx: RuntimeCtxBase): Promise<unknown> {
  const { deck, runId } = ctx;
  const actionCallId = randomId("action");
  let computeState = ctx.state
    ? {
      ...ctx.state,
      messages: Array.isArray(ctx.state.messages)
        ? ctx.state.messages.map(sanitizeMessage)
        : [],
      meta: ctx.state.meta ? { ...ctx.state.meta } : undefined,
      messageRefs: Array.isArray(ctx.state.messageRefs)
        ? [...ctx.state.messageRefs]
        : undefined,
    }
    : undefined;

  const ensureComputeState = (): SavedState => {
    if (computeState) return computeState;
    computeState = {
      runId,
      messages: [],
      meta: {},
      messageRefs: [],
    };
    return computeState;
  };

  const publishComputeState = () => {
    if (!computeState) return;
    ctx.onStateUpdate?.({
      ...computeState,
      messages: computeState.messages.map(sanitizeMessage),
      meta: computeState.meta ? { ...computeState.meta } : undefined,
      messageRefs: Array.isArray(computeState.messageRefs)
        ? [...computeState.messageRefs]
        : undefined,
    });
  };

  const execContext: ExecutionContext = {
    runId,
    actionCallId,
    parentActionCallId: ctx.parentActionCallId,
    depth: ctx.depth,
    input: ctx.input,
    initialUserMessage: ctx.initialUserMessage,
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
      const content = String(message.content ?? "");
      if ((role !== "user" && role !== "assistant") || !content.trim()) {
        return;
      }
      const state = ensureComputeState();
      const sanitized = sanitizeMessage({ role, content: content.trim() });
      state.messages = [...(state.messages ?? []), sanitized];
      const refs = Array.isArray(state.messageRefs)
        ? [...state.messageRefs]
        : [];
      refs.push({ id: randomId("msg"), role: sanitized.role });
      state.messageRefs = refs;
      publishComputeState();
    },
    label: deck.label,
    log: (entry) => {
      if (!ctx.trace) return;
      const raw = typeof entry === "string" ? { message: entry } : entry;
      if (!raw) return;

      const message = typeof raw.message === "string"
        ? raw.message
        : raw.message !== undefined
        ? String(raw.message)
        : typeof entry === "string"
        ? entry
        : "";

      const title = typeof raw.title === "string" ? raw.title : undefined;
      const body = raw.body ?? raw.message ?? message;

      ctx.trace({
        type: "log",
        runId,
        deckPath: deck.path,
        actionCallId,
        parentActionCallId: ctx.parentActionCallId,
        level: raw.level ?? "info",
        title: title ?? (message || undefined),
        message,
        body,
        meta: raw.meta,
      });
    },
    spawnAndWait: async (opts) => {
      ensureRunActive(ctx.runDeadlineMs, ctx.signal);
      const childPath = path.isAbsolute(opts.path)
        ? opts.path
        : path.resolve(path.dirname(deck.path), opts.path);
      const childInitialUserMessage = Object.hasOwn(opts, "initialUserMessage")
        ? opts.initialUserMessage
        : ctx.initialUserMessage;
      return await runDeck({
        path: childPath,
        input: opts.input,
        modelProvider: ctx.modelProvider,
        isRoot: false,
        guardrails: ctx.guardrails,
        depth: ctx.depth + 1,
        parentActionCallId: actionCallId,
        runId,
        defaultModel: ctx.defaultModel,
        modelOverride: ctx.modelOverride,
        trace: ctx.trace,
        stream: ctx.stream,
        state: computeState,
        onStateUpdate: (state) => {
          computeState = {
            ...state,
            messages: Array.isArray(state.messages)
              ? state.messages.map(sanitizeMessage)
              : [],
            meta: state.meta ? { ...state.meta } : undefined,
            messageRefs: Array.isArray(state.messageRefs)
              ? [...state.messageRefs]
              : undefined,
          };
          ctx.onStateUpdate?.(state);
        },
        onStreamText: ctx.onStreamText,
        responsesMode: ctx.responsesMode,
        initialUserMessage: childInitialUserMessage,
        inputProvided: true,
        parentPermissions: ctx.permissions,
        workspacePermissions: ctx.workspacePermissions,
        workspacePermissionsBaseDir: ctx.workspacePermissionsBaseDir,
        sessionPermissions: ctx.sessionPermissions,
        sessionPermissionsBaseDir: ctx.sessionPermissionsBaseDir,
        runDeadlineMs: ctx.runDeadlineMs,
        workerSandbox: ctx.workerSandbox,
        signal: ctx.signal,
        onTool: ctx.onTool,
      });
    },
    fail: (opts) => {
      throw new Error(opts.message);
    },
    return: (payload) => Promise.resolve(payload),
  };

  ensureRunActive(ctx.runDeadlineMs, ctx.signal);
  const raw = await deck.executor!(execContext);
  ensureRunActive(ctx.runDeadlineMs, ctx.signal);
  return validateOutput(deck, raw, ctx.depth === 0);
}

async function runLlmDeck(
  ctx: RuntimeCtxBase & {
    initialUserMessage?: unknown;
  },
): Promise<unknown> {
  const {
    deck,
    guardrails,
    depth,
    modelProvider,
    input,
    runId,
    inputProvided,
    initialUserMessage,
  } = ctx;
  const actionCallId = randomId("action");
  const start = performance.now();
  const respondEnabled = Boolean(deck.respond);
  const useResponses = Boolean(ctx.responsesMode) ||
    ctx.state?.format === "responses";

  const systemPrompt = buildSystemPrompt(deck);

  const refToolCallId = randomId("call");
  const messages: Array<ModelMessage> = ctx.state?.messages?.length
    ? ctx.state.messages.map(sanitizeMessage)
    : ctx.state?.items?.length
    ? messagesFromResponseItems(ctx.state.items).map(sanitizeMessage)
    : [];
  const resumed = messages.length > 0;
  const sendContext = Boolean(inputProvided) && input !== undefined && !resumed;
  const idleController = createIdleController({
    cfg: deck.handlers?.onIdle,
    deck,
    guardrails,
    depth,
    runId,
    parentActionCallId: ctx.parentActionCallId,
    modelProvider,
    defaultModel: ctx.defaultModel,
    modelOverride: ctx.modelOverride,
    trace: ctx.trace,
    stream: ctx.stream,
    onStreamText: ctx.onStreamText,
    pushMessages: (msgs) => messages.push(...msgs.map(sanitizeMessage)),
    responsesMode: ctx.responsesMode,
    permissions: ctx.permissions,
    workspacePermissions: ctx.workspacePermissions,
    workspacePermissionsBaseDir: ctx.workspacePermissionsBaseDir,
    sessionPermissions: ctx.sessionPermissions,
    sessionPermissionsBaseDir: ctx.sessionPermissionsBaseDir,
    runDeadlineMs: ctx.runDeadlineMs,
    workerSandbox: ctx.workerSandbox,
    signal: ctx.signal,
    onTool: ctx.onTool,
  });
  let streamingBuffer = "";
  let streamingCommitted = false;
  const wrappedOnStreamText = (chunk: string) => {
    if (!chunk || ctx.signal?.aborted) return;
    idleController.touch();
    streamingBuffer += chunk;
    ctx.onStreamText?.(chunk);
  };
  if (!resumed) {
    messages.push(sanitizeMessage({ role: "system", content: systemPrompt }));
    if (sendContext) {
      ctx.trace?.({
        type: "tool.call",
        runId,
        actionCallId: refToolCallId,
        name: GAMBIT_TOOL_CONTEXT,
        args: {},
        toolKind: "internal",
        parentActionCallId: actionCallId,
      });
      messages.push(
        sanitizeMessage({
          role: "assistant",
          content: null,
          tool_calls: [{
            id: refToolCallId,
            type: "function",
            function: {
              name: GAMBIT_TOOL_CONTEXT,
              arguments: "{}",
            },
          }],
        }),
        sanitizeMessage({
          role: "tool",
          name: GAMBIT_TOOL_CONTEXT,
          tool_call_id: refToolCallId,
          content: JSON.stringify(input),
        }),
      );
      ctx.trace?.({
        type: "tool.result",
        runId,
        actionCallId: refToolCallId,
        name: GAMBIT_TOOL_CONTEXT,
        result: input as unknown as import("./types.ts").JSONValue,
        toolKind: "internal",
        parentActionCallId: actionCallId,
      });
    }
  }

  if (initialUserMessage !== undefined) {
    const userMessage = sanitizeMessage({
      role: "user",
      content: formatInputForUser(initialUserMessage),
    });
    messages.push(userMessage);
    ctx.trace?.({
      type: "message.user",
      runId,
      actionCallId,
      deckPath: deck.path,
      message: userMessage,
      parentActionCallId: ctx.parentActionCallId,
    });
  }
  idleController.touch();

  const tools = await buildToolDefs(deck, ctx.permissions);
  ctx.trace?.({
    type: "deck.start",
    runId,
    deckPath: deck.path,
    actionCallId,
    parentActionCallId: ctx.parentActionCallId,
    permissions: ctx.permissionsTrace,
  });
  let passes = 0;
  try {
    while (passes < guardrails.maxPasses) {
      passes++;
      ensureRunActive(ctx.runDeadlineMs, ctx.signal);
      streamingBuffer = "";
      streamingCommitted = false;
      const modelCandidate = ctx.modelOverride ??
        deck.modelParams?.model ??
        ctx.defaultModel ??
        (() => {
          throw new Error(
            `No model configured for deck ${deck.path} and no --model provided`,
          );
        })();
      const resolved = await resolveModelChoice({
        model: modelCandidate,
        params: toProviderParams(deck.modelParams),
        modelProvider,
        deckPath: deck.path,
      });
      const model = resolved.model;
      const providerParams = resolved.params;

      const stateMessages = ctx.state?.messages?.length;
      ctx.trace?.({
        type: "model.call",
        runId,
        actionCallId,
        deckPath: deck.path,
        model,
        stream: ctx.stream,
        messageCount: messages.length,
        toolCount: tools.length,
        messages: messages.map(sanitizeMessage),
        tools,
        stateMessages,
        mode: useResponses ? "responses" : "chat",
        responseItems: useResponses
          ? responseItemsFromMessages(messages)
          : undefined,
        parentActionCallId: ctx.parentActionCallId,
      });

      let responseOutputItems: Array<ResponseItem> | undefined;
      const responses = modelProvider.responses;
      const projectedToolCalls = new Set<string>();
      const projectedToolResults = new Set<string>();
      const projectedToolNames = new Map<string, string>();
      type ModelCallResult = Awaited<ReturnType<ModelProvider["chat"]>>;
      const result: ModelCallResult = (useResponses && responses)
        ? await (async () => {
          const responseItems = responseItemsFromMessages(messages);
          let sawDelta = false;
          const response = await responses({
            request: {
              model,
              input: responseItems,
              tools: tools as Array<ResponseToolDefinition>,
              stream: ctx.stream,
              params: providerParams,
            },
            state: ctx.state,
            deckPath: deck.path,
            signal: ctx.signal,
            onStreamEvent:
              (ctx.trace || ctx.onStreamText || deck.handlers?.onIdle)
                ? (event) => {
                  if (ctx.trace) {
                    const streamEvent = event as unknown as Record<
                      string,
                      import("./types.ts").JSONValue
                    >;
                    const handledAsResponse = traceOpenResponsesStreamEvent({
                      streamEvent,
                      runId,
                      actionCallId,
                      deckPath: deck.path,
                      model,
                      parentActionCallId: ctx.parentActionCallId,
                      trace: ctx.trace,
                    });
                    if (!handledAsResponse) {
                      ctx.trace({
                        type: "model.stream.event",
                        runId,
                        actionCallId,
                        deckPath: deck.path,
                        model,
                        event: streamEvent,
                        parentActionCallId: ctx.parentActionCallId,
                      });
                    }
                    projectStreamToolTraceEvents({
                      streamEvent,
                      runId,
                      parentActionCallId: actionCallId,
                      trace: ctx.trace,
                      emittedCalls: projectedToolCalls,
                      emittedResults: projectedToolResults,
                      toolNames: projectedToolNames,
                    });
                  }
                  if (event.type === "response.output_text.delta") {
                    sawDelta = true;
                    wrappedOnStreamText(event.delta);
                  } else if (
                    event.type === "response.output_text.done" && !sawDelta
                  ) {
                    wrappedOnStreamText(event.text);
                  }
                }
                : undefined,
          });
          responseOutputItems = response.output ?? [];
          const mapped = mapResponseOutput(responseOutputItems);
          return {
            message: mapped.message,
            finishReason: mapped.toolCalls?.length ? "tool_calls" : "stop",
            toolCalls: mapped.toolCalls,
            usage: response.usage,
            updatedState: response.updatedState,
          };
        })()
        : await modelProvider.chat({
          model,
          messages,
          tools,
          stream: ctx.stream,
          state: ctx.state,
          deckPath: deck.path,
          signal: ctx.signal,
          params: providerParams,
          onStreamText: (ctx.onStreamText || deck.handlers?.onIdle)
            ? wrappedOnStreamText
            : undefined,
          onStreamEvent: ctx.trace
            ? (event) => {
              const handledAsResponse = traceOpenResponsesStreamEvent({
                streamEvent: event,
                runId,
                actionCallId,
                deckPath: deck.path,
                model,
                parentActionCallId: ctx.parentActionCallId,
                trace: ctx.trace,
              });
              if (!handledAsResponse) {
                ctx.trace?.({
                  type: "model.stream.event",
                  runId,
                  actionCallId,
                  deckPath: deck.path,
                  model,
                  event,
                  parentActionCallId: ctx.parentActionCallId,
                });
              }
              projectStreamToolTraceEvents({
                streamEvent: event,
                runId,
                parentActionCallId: actionCallId,
                trace: ctx.trace,
                emittedCalls: projectedToolCalls,
                emittedResults: projectedToolResults,
                toolNames: projectedToolNames,
              });
            }
            : undefined,
        });
      idleController.touch();
      let message = result.message;
      ctx.trace?.({
        type: "model.result",
        runId,
        actionCallId,
        deckPath: deck.path,
        model,
        finishReason: result.finishReason,
        message: sanitizeMessage(message),
        toolCalls: result.toolCalls,
        stateMessages: result.updatedState?.messages?.length,
        usage: result.usage,
        mode: useResponses ? "responses" : "chat",
        responseItems: responseOutputItems,
        parentActionCallId: ctx.parentActionCallId,
      });
      const computeState = (updated?: SavedState): SavedState => {
        const base = updated ??
          { runId, messages: messages.map(sanitizeMessage) };
        const mergedMessages = base.messages && base.messages.length > 0
          ? base.messages.map(sanitizeMessage)
          : messages.map(sanitizeMessage);
        const responseItems = useResponses
          ? responseItemsFromMessages(mergedMessages)
          : updated?.items ?? ctx.state?.items;
        const priorRefs = updated?.messageRefs ?? ctx.state?.messageRefs ?? [];
        const messageRefs: Array<MessageRef> = mergedMessages.map((m, idx) =>
          priorRefs[idx] ?? { id: randomId("msg"), role: m.role }
        );
        const feedback = updated?.feedback ?? ctx.state?.feedback;
        const traces = updated?.traces ?? ctx.state?.traces;
        const meta = updated?.meta ?? ctx.state?.meta;
        const notes = updated?.notes ?? ctx.state?.notes;
        const conversationScore = updated?.conversationScore ??
          ctx.state?.conversationScore;
        return {
          ...base,
          runId,
          messages: mergedMessages,
          format: useResponses
            ? "responses"
            : updated?.format ?? ctx.state?.format,
          items: responseItems,
          messageRefs,
          feedback,
          traces,
          meta,
          notes,
          conversationScore,
        };
      };

      if (result.toolCalls && result.toolCalls.length > 0) {
        let responded = false;
        let respondValue: unknown;
        let endSignal: GambitEndSignal | undefined;
        const appendedMessages: Array<ModelMessage> = [];
        const toolCallText = streamingBuffer ||
          (typeof message.content === "string" ? message.content : "");
        if (!streamingCommitted && toolCallText) {
          messages.push(
            sanitizeMessage({ role: "assistant", content: toolCallText }),
          );
          streamingCommitted = true;
        }

        for (const call of result.toolCalls) {
          if (respondEnabled && call.name === GAMBIT_TOOL_RESPOND) {
            const status = typeof call.args?.status === "number"
              ? call.args.status
              : undefined;
            const message = typeof call.args?.message === "string"
              ? call.args.message
              : undefined;
            const code = typeof call.args?.code === "string"
              ? call.args.code
              : undefined;
            const meta = (call.args?.meta &&
                typeof call.args.meta === "object" &&
                call.args.meta !== null)
              ? call.args.meta as Record<string, unknown>
              : undefined;
            const rawPayload = call.args?.payload ?? call.args;
            const validatedPayload = validateOutput(
              deck,
              rawPayload,
              depth === 0,
            );
            const respondEnvelope: {
              payload: unknown;
              status?: number;
              message?: string;
              code?: string;
              meta?: Record<string, unknown>;
            } = {
              payload: validatedPayload,
            };
            if (status !== undefined) respondEnvelope.status = status;
            if (message !== undefined) respondEnvelope.message = message;
            if (code !== undefined) respondEnvelope.code = code;
            if (meta !== undefined) respondEnvelope.meta = meta;
            ctx.trace?.({
              type: "tool.call",
              runId,
              actionCallId: call.id,
              name: call.name,
              args: call.args,
              toolKind: "internal",
              parentActionCallId: actionCallId,
            });
            const toolContent = JSON.stringify(call.args ?? {});
            appendedMessages.push({
              role: "assistant",
              content: null,
              tool_calls: [{
                id: call.id,
                type: "function",
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args ?? {}),
                },
              }],
            });
            appendedMessages.push({
              role: "tool",
              tool_call_id: call.id,
              name: call.name,
              content: toolContent,
            });
            respondValue = respondEnvelope;
            responded = true;
            ctx.trace?.({
              type: "tool.result",
              runId,
              actionCallId: call.id,
              name: call.name,
              result:
                respondEnvelope as unknown as import("./types.ts").JSONValue,
              toolKind: "internal",
              parentActionCallId: actionCallId,
            });
            continue;
          }

          if (deck.allowEnd && call.name === GAMBIT_TOOL_END) {
            const status = typeof call.args?.status === "number"
              ? call.args.status
              : undefined;
            const messageText = typeof call.args?.message === "string"
              ? call.args.message
              : undefined;
            const code = typeof call.args?.code === "string"
              ? call.args.code
              : undefined;
            const meta = (call.args?.meta &&
                typeof call.args.meta === "object" &&
                call.args.meta !== null)
              ? call.args.meta as Record<string, unknown>
              : undefined;
            const payload = call.args?.payload;
            ctx.trace?.({
              type: "tool.call",
              runId,
              actionCallId: call.id,
              name: call.name,
              args: call.args,
              toolKind: "internal",
              parentActionCallId: actionCallId,
            });
            const toolContent = JSON.stringify(call.args ?? {});
            appendedMessages.push({
              role: "assistant",
              content: null,
              tool_calls: [{
                id: call.id,
                type: "function",
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args ?? {}),
                },
              }],
            });
            appendedMessages.push({
              role: "tool",
              tool_call_id: call.id,
              name: call.name,
              content: toolContent,
            });
            const signal: GambitEndSignal = { __gambitEnd: true };
            if (status !== undefined) signal.status = status;
            if (messageText !== undefined) signal.message = messageText;
            if (code !== undefined) signal.code = code;
            if (meta !== undefined) signal.meta = meta;
            if (payload !== undefined) signal.payload = payload;
            endSignal = signal;
            ctx.trace?.({
              type: "tool.result",
              runId,
              actionCallId: call.id,
              name: call.name,
              result: signal as unknown as import("./types.ts").JSONValue,
              toolKind: "internal",
              parentActionCallId: actionCallId,
            });
            continue;
          }

          const actionRef = deck.actionDecks.find((a) => a.name === call.name);
          const toolKind: ToolKind = actionRef ? "action" : "external";
          const actionPermissions = resolveEffectivePermissions({
            baseDir: path.dirname(deck.path),
            parent: ctx.permissions,
            reference: actionRef?.permissions
              ? {
                baseDir: path.dirname(deck.path),
                permissions: actionRef.permissions,
              }
              : undefined,
          });
          ctx.trace?.({
            type: "action.start",
            runId,
            actionCallId: call.id,
            name: call.name,
            path: call.name,
            parentActionCallId: actionCallId,
            permissions: actionPermissions.trace,
          });
          ctx.trace?.({
            type: "tool.call",
            runId,
            actionCallId: call.id,
            name: call.name,
            args: call.args,
            toolKind,
            parentActionCallId: actionCallId,
          });
          const toolResult = await handleToolCall(call, {
            parentDeck: deck,
            modelProvider,
            guardrails,
            depth,
            runId,
            parentActionCallId: actionCallId,
            defaultModel: ctx.defaultModel,
            modelOverride: ctx.modelOverride,
            trace: ctx.trace,
            onStreamText: (ctx.onStreamText || deck.handlers?.onIdle)
              ? wrappedOnStreamText
              : undefined,
            runStartedAt: start,
            inputProvided: true,
            idle: idleController,
            responsesMode: ctx.responsesMode,
            permissions: ctx.permissions,
            workspacePermissions: ctx.workspacePermissions,
            workspacePermissionsBaseDir: ctx.workspacePermissionsBaseDir,
            sessionPermissions: ctx.sessionPermissions,
            sessionPermissionsBaseDir: ctx.sessionPermissionsBaseDir,
            runDeadlineMs: ctx.runDeadlineMs,
            workerSandbox: ctx.workerSandbox,
            signal: ctx.signal,
            onTool: ctx.onTool,
          });
          ctx.trace?.({
            type: "tool.result",
            runId,
            actionCallId: call.id,
            name: call.name,
            result: toolResult.toolContent,
            toolKind,
            parentActionCallId: actionCallId,
          });
          appendedMessages.push({
            role: "assistant",
            content: null,
            tool_calls: [{
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args),
              },
            }],
          });
          appendedMessages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: toolResult.toolContent,
          });
          if (toolResult.extraMessages?.length) {
            appendedMessages.push(...toolResult.extraMessages);
          }
          ctx.trace?.({
            type: "action.end",
            runId,
            actionCallId: call.id,
            name: call.name,
            path: call.name,
            parentActionCallId: actionCallId,
          });
        }

        if (appendedMessages.length) {
          messages.push(...appendedMessages.map(sanitizeMessage));
          idleController.touch();
        }
        if (ctx.onStateUpdate) {
          ensureRunActive(ctx.runDeadlineMs, ctx.signal);
          const state = computeState(result.updatedState);
          ctx.onStateUpdate(state);
        }
        if (endSignal) {
          ctx.trace?.({
            type: "deck.end",
            runId,
            deckPath: deck.path,
            actionCallId,
            parentActionCallId: ctx.parentActionCallId,
          });
          return endSignal;
        }
        if (responded) {
          ctx.trace?.({
            type: "deck.end",
            runId,
            deckPath: deck.path,
            actionCallId,
            parentActionCallId: ctx.parentActionCallId,
          });
          return respondValue;
        }
        continue;
      }

      if (
        !respondEnabled &&
        result.finishReason === "stop" &&
        (message.content === null || message.content === undefined) &&
        (!result.toolCalls || result.toolCalls.length === 0)
      ) {
        message = { ...message, content: "" };
      }

      if (result.finishReason === "tool_calls") {
        throw new Error("Model requested tool_calls but provided none");
      }

      if (
        result.finishReason === "length" &&
        (message.content === null || message.content === undefined)
      ) {
        throw new Error("Model stopped early (length) with no content");
      }

      if (message.content !== null && message.content !== undefined) {
        messages.push(sanitizeMessage(message));
        ensureRunActive(ctx.runDeadlineMs, ctx.signal);
        if (ctx.onStateUpdate) {
          const state = computeState(result.updatedState);
          ctx.onStateUpdate(state);
        }
        if (
          ctx.parentActionCallId !== undefined &&
          (!result.toolCalls || result.toolCalls.length === 0)
        ) {
          ctx.trace?.({
            type: "monolog",
            runId,
            deckPath: deck.path,
            actionCallId,
            parentActionCallId: ctx.parentActionCallId,
            content: message
              .content as unknown as import("./types.ts").JSONValue,
          });
        }
        if (!respondEnabled) {
          const validated = validateOutput(deck, message.content, depth === 0);
          ctx.trace?.({
            type: "deck.end",
            runId,
            deckPath: deck.path,
            actionCallId,
            parentActionCallId: ctx.parentActionCallId,
          });
          return validated;
        }
      }

      if (respondEnabled && result.finishReason === "stop") {
        continue;
      }

      if (passes >= guardrails.maxPasses) {
        throw new Error("Max passes exceeded without completing");
      }
    }
  } finally {
    idleController.stop();
  }

  throw new Error("Model did not complete within guardrails");
}

async function handleToolCall(
  call: { id: string; name: string; args: Record<string, unknown> },
  ctx: {
    parentDeck: LoadedDeck;
    guardrails: Guardrails;
    depth: number;
    runId: string;
    parentActionCallId?: string;
    modelProvider: ModelProvider;
    defaultModel?: string;
    modelOverride?: string;
    trace?: (event: import("./types.ts").TraceEvent) => void;
    stream?: boolean;
    onStreamText?: (chunk: string) => void;
    runStartedAt: number;
    inputProvided?: boolean;
    idle?: IdleController;
    responsesMode?: boolean;
    permissions: NormalizedPermissionSet;
    workspacePermissions?: PermissionDeclarationInput;
    workspacePermissionsBaseDir?: string;
    sessionPermissions?: PermissionDeclarationInput;
    sessionPermissionsBaseDir?: string;
    runDeadlineMs: number;
    workerSandbox: boolean;
    signal?: AbortSignal;
    onTool?: RunOptions["onTool"];
  },
): Promise<ToolCallResult> {
  ensureRunActive(ctx.runDeadlineMs, ctx.signal);
  const source = {
    deckPath: ctx.parentDeck.path,
    actionName: call.name,
  };

  const baseComplete = (payload: {
    status?: number;
    payload?: unknown;
    message?: string;
    code?: string;
    meta?: Record<string, unknown>;
  }) =>
    JSON.stringify({
      runId: ctx.runId,
      actionCallId: call.id,
      parentActionCallId: ctx.parentActionCallId,
      source,
      status: payload.status,
      payload: payload.payload,
      message: payload.message,
      code: payload.code,
      meta: payload.meta,
    });
  const extraMessages: Array<ModelMessage> = [];
  const started = performance.now();

  const runBuiltinTool = async (): Promise<ToolCallResult | null> => {
    if (!isBuiltinTool(call.name)) return null;
    const deny = (message: string): ToolCallResult => ({
      toolContent: baseComplete({
        status: 403,
        code: "permission_denied",
        message,
      }),
    });

    if (call.name === BUILTIN_TOOL_READ_FILE) {
      let targetPath: string;
      try {
        targetPath = resolveToolPath(ctx.permissions.baseDir, call.args.path);
      } catch (err) {
        return {
          toolContent: baseComplete({
            status: 400,
            code: "invalid_input",
            message: err instanceof Error ? err.message : String(err),
          }),
        };
      }
      if (!canReadPath(ctx.permissions, targetPath)) {
        return deny(`read_file denied for ${targetPath}`);
      }
      const text = await Deno.readTextFile(targetPath);
      const lines = text.split(/\r?\n/);
      const { startLine, endLine } = parseLineRange(call.args);
      const sliced = lines.slice(startLine - 1, endLine).join("\n");
      return {
        toolContent: baseComplete({
          status: 200,
          payload: {
            path: targetPath,
            start_line: startLine,
            end_line: endLine,
            total_lines: lines.length,
            content: sliced,
          },
        }),
      };
    }

    if (call.name === BUILTIN_TOOL_LIST_DIR) {
      let targetPath: string;
      try {
        targetPath = resolveToolPath(ctx.permissions.baseDir, call.args.path);
      } catch (err) {
        return {
          toolContent: baseComplete({
            status: 400,
            code: "invalid_input",
            message: err instanceof Error ? err.message : String(err),
          }),
        };
      }
      if (!canReadPath(ctx.permissions, targetPath)) {
        return deny(`list_dir denied for ${targetPath}`);
      }
      const recursive = Boolean(call.args.recursive);
      const maxEntries = parseToolLimit(call.args.max_entries, 200, 2000);
      const out: Array<{ path: string; type: "file" | "dir" | "symlink" }> = [];
      const pending: Array<string> = [targetPath];
      while (pending.length > 0 && out.length < maxEntries) {
        const current = pending.pop()!;
        for await (const entry of Deno.readDir(current)) {
          if (out.length >= maxEntries) break;
          const entryPath = path.join(current, entry.name);
          if (!canReadPath(ctx.permissions, entryPath)) continue;
          const type = entry.isDirectory
            ? "dir"
            : entry.isSymlink
            ? "symlink"
            : "file";
          out.push({ path: entryPath, type });
          if (recursive && entry.isDirectory) {
            pending.push(entryPath);
          }
        }
      }
      return {
        toolContent: baseComplete({
          status: 200,
          payload: {
            path: targetPath,
            recursive,
            entries: out,
            truncated: out.length >= maxEntries,
          },
        }),
      };
    }

    if (call.name === BUILTIN_TOOL_GREP_FILES) {
      let targetPath: string;
      try {
        targetPath = resolveToolPath(ctx.permissions.baseDir, call.args.path);
      } catch (err) {
        return {
          toolContent: baseComplete({
            status: 400,
            code: "invalid_input",
            message: err instanceof Error ? err.message : String(err),
          }),
        };
      }
      if (!canReadPath(ctx.permissions, targetPath)) {
        return deny(`grep_files denied for ${targetPath}`);
      }
      const query = typeof call.args.query === "string" ? call.args.query : "";
      if (!query) {
        return {
          toolContent: baseComplete({
            status: 400,
            code: "invalid_input",
            message: "query is required",
          }),
        };
      }
      let re: RegExp;
      try {
        re = new RegExp(query, "g");
      } catch (err) {
        return {
          toolContent: baseComplete({
            status: 400,
            code: "invalid_regex",
            message: err instanceof Error ? err.message : String(err),
          }),
        };
      }
      const maxMatches = parseToolLimit(call.args.max_matches, 200, 2000);
      const matches: Array<{
        path: string;
        line: number;
        text: string;
      }> = [];
      const pending: Array<string> = [targetPath];
      while (pending.length > 0 && matches.length < maxMatches) {
        const current = pending.pop()!;
        const stat = await Deno.stat(current);
        if (stat.isDirectory) {
          for await (const entry of Deno.readDir(current)) {
            const entryPath = path.join(current, entry.name);
            if (!canReadPath(ctx.permissions, entryPath)) continue;
            if (entry.isDirectory) {
              pending.push(entryPath);
              continue;
            }
            if (!entry.isFile) continue;
            const text = await Deno.readTextFile(entryPath).catch(() => null);
            if (text === null) continue;
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              re.lastIndex = 0;
              if (!re.test(lines[i])) continue;
              matches.push({ path: entryPath, line: i + 1, text: lines[i] });
              if (matches.length >= maxMatches) break;
            }
            if (matches.length >= maxMatches) break;
          }
          continue;
        }
        if (!stat.isFile) continue;
        const text = await Deno.readTextFile(current).catch(() => null);
        if (text === null) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          re.lastIndex = 0;
          if (!re.test(lines[i])) continue;
          matches.push({ path: current, line: i + 1, text: lines[i] });
          if (matches.length >= maxMatches) break;
        }
      }
      return {
        toolContent: baseComplete({
          status: 200,
          payload: {
            path: targetPath,
            query,
            matches,
            truncated: matches.length >= maxMatches,
          },
        }),
      };
    }

    if (call.name === BUILTIN_TOOL_APPLY_PATCH) {
      let targetPath: string;
      try {
        targetPath = resolveToolPath(ctx.permissions.baseDir, call.args.path);
      } catch (err) {
        return {
          toolContent: baseComplete({
            status: 400,
            code: "invalid_input",
            message: err instanceof Error ? err.message : String(err),
          }),
        };
      }
      if (!canWritePath(ctx.permissions, targetPath)) {
        return deny(`apply_patch denied for ${targetPath}`);
      }

      const rawEdits = Array.isArray(call.args.edits) ? call.args.edits : [];
      const edits = rawEdits.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const rec = entry as Record<string, unknown>;
        if (
          typeof rec.old_text !== "string" || typeof rec.new_text !== "string"
        ) {
          return [];
        }
        return [{
          oldText: rec.old_text,
          newText: rec.new_text,
          replaceAll: Boolean(rec.replace_all),
        }];
      });
      if (edits.length === 0) {
        return {
          toolContent: baseComplete({
            status: 400,
            code: "invalid_input",
            message: "edits must include at least one old_text/new_text pair",
          }),
        };
      }

      const createIfMissing = Boolean(call.args.create_if_missing);
      let existing = "";
      let created = false;
      try {
        if (!canReadPath(ctx.permissions, targetPath)) {
          return deny(`apply_patch read denied for ${targetPath}`);
        }
        existing = await Deno.readTextFile(targetPath);
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          if (!createIfMissing) {
            return {
              toolContent: baseComplete({
                status: 404,
                code: "not_found",
                message: `file not found: ${targetPath}`,
              }),
            };
          }
          created = true;
          existing = "";
        } else {
          throw err;
        }
      }

      const patched = applySimplePatch(existing, edits);
      if (!created && patched.applied === 0) {
        return {
          toolContent: baseComplete({
            status: 409,
            code: "no_changes",
            message: `No edit targets were found in ${targetPath}`,
          }),
        };
      }
      if (created) {
        const parentDir = path.dirname(targetPath);
        if (parentDir && parentDir !== "." && parentDir !== targetPath) {
          await Deno.mkdir(parentDir, { recursive: true });
        }
      }
      try {
        await Deno.writeTextFile(targetPath, patched.next);
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          return {
            toolContent: baseComplete({
              status: 404,
              code: "not_found",
              message: `path not found: ${targetPath}`,
            }),
          };
        }
        return {
          toolContent: baseComplete({
            status: 500,
            code: "write_failed",
            message: err instanceof Error ? err.message : String(err),
          }),
        };
      }
      return {
        toolContent: baseComplete({
          status: 200,
          payload: {
            path: targetPath,
            applied: patched.applied,
            created,
          },
        }),
      };
    }

    if (call.name === BUILTIN_TOOL_EXEC) {
      const command = typeof call.args.command === "string"
        ? call.args.command
        : "";
      if (!command) {
        return {
          toolContent: baseComplete({
            status: 400,
            code: "invalid_input",
            message: "command is required",
          }),
        };
      }
      if (
        !canRunCommand(ctx.permissions, command) &&
        !canRunPath(ctx.permissions, command)
      ) {
        return deny(`exec denied for command ${command}`);
      }
      const args = toStringArray(call.args.args);
      const cwd = typeof call.args.cwd === "string"
        ? path.resolve(ctx.permissions.baseDir, call.args.cwd)
        : ctx.permissions.baseDir;
      const timeoutMs = parseToolLimit(call.args.timeout_ms, 5000, 30000);
      const remainingMs = Math.max(
        1,
        Math.min(timeoutMs, Math.floor(ctx.runDeadlineMs - performance.now())),
      );
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (ctx.signal?.aborted) {
        controller.abort();
      } else if (ctx.signal) {
        ctx.signal.addEventListener("abort", onAbort, { once: true });
      }
      const timeoutId = setTimeout(() => controller.abort(), remainingMs);
      try {
        const output = await executeBuiltinCommand({
          command,
          args,
          cwd,
          signal: controller.signal,
        });
        const stdout = new TextDecoder().decode(output.stdout).slice(0, 65536);
        const stderr = new TextDecoder().decode(output.stderr).slice(0, 65536);
        return {
          toolContent: baseComplete({
            status: 200,
            payload: {
              command,
              args,
              cwd,
              code: output.code,
              success: output.success,
              stdout,
              stderr,
            },
          }),
        };
      } catch (err) {
        if (err instanceof ExecToolUnsupportedHostError) {
          return {
            toolContent: baseComplete({
              status: 501,
              code: err.code,
              message: err.message,
            }),
          };
        }
        return {
          toolContent: baseComplete({
            status: 500,
            code: "exec_failed",
            message: err instanceof Error ? err.message : String(err),
          }),
        };
      } finally {
        clearTimeout(timeoutId);
        if (ctx.signal) {
          ctx.signal.removeEventListener("abort", onAbort);
        }
      }
    }

    return null;
  };

  const builtinResult = await runBuiltinTool();
  if (builtinResult) {
    return builtinResult;
  }
  const action = ctx.parentDeck.actionDecks.find((a) => a.name === call.name);
  if (!action) {
    const externalTool = ctx.parentDeck.tools.find((tool) =>
      tool.name === call.name
    );
    if (!externalTool) {
      return {
        toolContent: JSON.stringify({
          runId: ctx.runId,
          actionCallId: call.id,
          parentActionCallId: ctx.parentActionCallId,
          source,
          status: 404,
          message: "unknown action",
        }),
      };
    }
    let externalInput: Record<string, unknown> = call.args;
    if (externalTool.inputSchema) {
      try {
        externalInput = validateWithSchema(
          externalTool.inputSchema as never,
          call.args,
        ) as Record<string, unknown>;
      } catch (err) {
        return {
          toolContent: baseComplete({
            status: 400,
            code: "invalid_input",
            message: err instanceof Error ? err.message : String(err),
          }),
        };
      }
    }
    if (!ctx.onTool) {
      return {
        toolContent: baseComplete({
          status: 500,
          code: "missing_on_tool",
          message: `External tool ${call.name} requires runtime onTool handler`,
        }),
      };
    }
    try {
      const result = await ctx.onTool({
        name: call.name,
        args: externalInput,
        runId: ctx.runId,
        actionCallId: call.id,
        parentActionCallId: ctx.parentActionCallId,
        deckPath: ctx.parentDeck.path,
      });
      return { toolContent: baseComplete(normalizeChildResult(result)) };
    } catch (err) {
      return {
        toolContent: baseComplete({
          status: 500,
          code: "tool_handler_error",
          message: err instanceof Error ? err.message : String(err),
        }),
      };
    }
  }
  let actionInput: unknown = call.args;
  if (action.contextSchema) {
    try {
      actionInput = validateWithSchema(
        action.contextSchema as never,
        call.args,
      );
    } catch (err) {
      return {
        toolContent: baseComplete({
          status: 400,
          code: "invalid_input",
          message: err instanceof Error ? err.message : String(err),
        }),
      };
    }
  }

  const busyCfg = ctx.parentDeck.handlers?.onBusy ??
    ctx.parentDeck.handlers?.onInterval;
  const busyDelay = busyCfg?.delayMs ?? DEFAULT_STATUS_DELAY_MS;
  const busyRepeat = busyCfg?.repeatMs;

  let busyTimer: number | undefined;
  let busyFired = false;
  let busyStopped = false;
  let nextBusyAt = busyCfg?.path ? performance.now() + busyDelay : 0;

  ctx.idle?.pause();

  const childPromise = (async () => {
    try {
      const result = await runDeck({
        path: action.path,
        input: actionInput,
        modelProvider: ctx.modelProvider,
        isRoot: false,
        guardrails: ctx.guardrails,
        depth: ctx.depth + 1,
        parentActionCallId: call.id,
        runId: ctx.runId,
        defaultModel: ctx.defaultModel,
        modelOverride: ctx.modelOverride,
        trace: ctx.trace,
        stream: ctx.stream,
        onStreamText: ctx.onStreamText,
        responsesMode: ctx.responsesMode,
        initialUserMessage: undefined,
        parentPermissions: ctx.permissions,
        referencePermissions: action.permissions,
        referencePermissionsBaseDir: path.dirname(ctx.parentDeck.path),
        workspacePermissions: ctx.workspacePermissions,
        workspacePermissionsBaseDir: ctx.workspacePermissionsBaseDir,
        sessionPermissions: ctx.sessionPermissions,
        sessionPermissionsBaseDir: ctx.sessionPermissionsBaseDir,
        runDeadlineMs: ctx.runDeadlineMs,
        workerSandbox: ctx.workerSandbox,
        signal: ctx.signal,
        onTool: ctx.onTool,
      });
      return { ok: true, result };
    } catch (err) {
      return { ok: false as const, error: err };
    } finally {
      // Keep busy timers alive until the caller explicitly stops them
    }
  })();

  const triggerBusy = async (elapsed: number) => {
    if (busyStopped) return;
    busyFired = true;
    try {
      const envelope = await runBusyHandler({
        parentDeck: ctx.parentDeck,
        action,
        call,
        runId: ctx.runId,
        parentActionCallId: ctx.parentActionCallId,
        handlerPath: busyCfg!.path,
        modelProvider: ctx.modelProvider,
        guardrails: ctx.guardrails,
        depth: ctx.depth,
        defaultModel: ctx.defaultModel,
        modelOverride: ctx.modelOverride,
        elapsedMs: elapsed,
        trace: ctx.trace,
        stream: ctx.stream,
        onStreamText: ctx.onStreamText,
        responsesMode: ctx.responsesMode,
        initialUserMessage: undefined,
        permissions: ctx.permissions,
        workspacePermissions: ctx.workspacePermissions,
        workspacePermissionsBaseDir: ctx.workspacePermissionsBaseDir,
        sessionPermissions: ctx.sessionPermissions,
        sessionPermissionsBaseDir: ctx.sessionPermissionsBaseDir,
        runDeadlineMs: ctx.runDeadlineMs,
        workerSandbox: ctx.workerSandbox,
        signal: ctx.signal,
        onTool: ctx.onTool,
      });
      if (envelope.length) {
        extraMessages.push(...envelope.map(sanitizeMessage));
      }
      ctx.idle?.touch();
    } catch {
      // ignore handler errors
    }
  };

  const scheduleNextBusy = () => {
    if (!busyCfg?.path || busyStopped) return;
    const now = performance.now();
    const delay = Math.max(0, nextBusyAt - now);
    busyTimer = setTimeout(async () => {
      if (busyStopped) return;
      const elapsed = performance.now() - started;
      await triggerBusy(elapsed);
      if (busyRepeat && busyRepeat > 0) {
        nextBusyAt += busyRepeat;
        scheduleNextBusy();
      }
    }, delay) as unknown as number;
  };

  if (busyCfg?.path) {
    scheduleNextBusy();
  }

  const stopBusy = () => {
    busyStopped = true;
    if (busyTimer !== undefined) {
      clearTimeout(busyTimer);
    }
  };

  const childResult = await childPromise;
  ctx.idle?.resume();

  if (!childResult.ok) {
    const handled = await maybeHandleError({
      err: childResult.error,
      call,
      ctx,
      action,
    });
    if (handled) {
      if (handled.extraMessages) {
        extraMessages.push(...handled.extraMessages);
      }
      stopBusy();
      ctx.idle?.touch();
      const content = handled.toolContent;
      return { toolContent: content, extraMessages };
    }

    stopBusy();
    throw childResult.error;
  }

  const normalized = normalizeChildResult(childResult.result);
  if (action.responseSchema) {
    normalized.payload = validateWithSchema(
      action.responseSchema as never,
      normalized.payload,
    );
  }
  const toolContent = baseComplete(normalized);

  if (busyCfg?.path) {
    const elapsedFromAction = performance.now() - started;
    if (!busyFired && elapsedFromAction >= busyDelay) {
      try {
        const envelope = await runBusyHandler({
          parentDeck: ctx.parentDeck,
          action,
          call,
          runId: ctx.runId,
          parentActionCallId: ctx.parentActionCallId,
          handlerPath: busyCfg.path,
          modelProvider: ctx.modelProvider,
          guardrails: ctx.guardrails,
          depth: ctx.depth,
          defaultModel: ctx.defaultModel,
          modelOverride: ctx.modelOverride,
          elapsedMs: elapsedFromAction,
          trace: ctx.trace,
          stream: ctx.stream,
          onStreamText: ctx.onStreamText,
          responsesMode: ctx.responsesMode,
          initialUserMessage: undefined,
          permissions: ctx.permissions,
          workspacePermissions: ctx.workspacePermissions,
          workspacePermissionsBaseDir: ctx.workspacePermissionsBaseDir,
          sessionPermissions: ctx.sessionPermissions,
          sessionPermissionsBaseDir: ctx.sessionPermissionsBaseDir,
          runDeadlineMs: ctx.runDeadlineMs,
          workerSandbox: ctx.workerSandbox,
          signal: ctx.signal,
          onTool: ctx.onTool,
        });
        if (envelope.length) {
          extraMessages.push(...envelope.map(sanitizeMessage));
        }
        ctx.idle?.touch();
      } catch {
        // ignore handler errors
      }
    }
  }

  const completeEventId = randomId("event");
  extraMessages.push(
    {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: completeEventId,
        type: "function",
        function: {
          name: GAMBIT_TOOL_COMPLETE,
          arguments: toolContent,
        },
      }],
    },
    {
      role: "tool",
      tool_call_id: completeEventId,
      name: GAMBIT_TOOL_COMPLETE,
      content: toolContent,
    },
  );

  stopBusy();
  ctx.idle?.touch();

  return { toolContent, extraMessages };
}

function normalizeChildResult(
  result: unknown,
): {
  status?: number;
  payload?: unknown;
  message?: string;
  code?: string;
  meta?: Record<string, unknown>;
} {
  if (result && typeof result === "object") {
    const rec = result as Record<string, unknown>;
    const status = typeof rec.status === "number" ? rec.status : undefined;
    const message = typeof rec.message === "string" ? rec.message : undefined;
    const code = typeof rec.code === "string" ? rec.code : undefined;
    const meta = (rec.meta && typeof rec.meta === "object")
      ? rec.meta as Record<string, unknown>
      : undefined;
    const payload = rec.payload ?? result;
    return { status, payload, message, code, meta };
  }
  return { payload: result };
}

async function runBusyHandler(args: {
  parentDeck: LoadedDeck;
  action: { name: string; path: string; label?: string; description?: string };
  call: { id: string; name: string; args: Record<string, unknown> };
  runId: string;
  parentActionCallId?: string;
  handlerPath: string;
  modelProvider: ModelProvider;
  guardrails: Guardrails;
  depth: number;
  defaultModel?: string;
  modelOverride?: string;
  elapsedMs: number;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  stream?: boolean;
  onStreamText?: (chunk: string) => void;
  initialUserMessage?: unknown;
  responsesMode?: boolean;
  permissions: NormalizedPermissionSet;
  workspacePermissions?: PermissionDeclarationInput;
  workspacePermissionsBaseDir?: string;
  sessionPermissions?: PermissionDeclarationInput;
  sessionPermissionsBaseDir?: string;
  runDeadlineMs: number;
  workerSandbox: boolean;
  signal?: AbortSignal;
  onTool?: RunOptions["onTool"];
}): Promise<Array<ModelMessage>> {
  try {
    ensureRunActive(args.runDeadlineMs, args.signal);
    const input = {
      kind: "busy",
      label: args.action.label ?? args.parentDeck.label,
      source: { deckPath: args.parentDeck.path, actionName: args.action.name },
      trigger: {
        reason: "timeout" as const,
        elapsedMs: Math.floor(args.elapsedMs),
      },
      childInput: args.call.args,
    };
    const handlerOutput = await runDeck({
      path: args.handlerPath,
      input,
      modelProvider: args.modelProvider,
      isRoot: false,
      guardrails: args.guardrails,
      depth: args.depth + 1,
      parentActionCallId: args.call.id,
      runId: args.runId,
      defaultModel: args.defaultModel,
      modelOverride: args.modelOverride,
      trace: args.trace,
      stream: args.stream,
      onStreamText: args.onStreamText,
      responsesMode: args.responsesMode,
      initialUserMessage: args.initialUserMessage,
      inputProvided: true,
      parentPermissions: args.permissions,
      workspacePermissions: args.workspacePermissions,
      workspacePermissionsBaseDir: args.workspacePermissionsBaseDir,
      sessionPermissions: args.sessionPermissions,
      sessionPermissionsBaseDir: args.sessionPermissionsBaseDir,
      runDeadlineMs: args.runDeadlineMs,
      workerSandbox: args.workerSandbox,
      signal: args.signal,
      onTool: args.onTool,
    });
    const elapsedMs = Math.floor(args.elapsedMs);
    let message: string | undefined;
    if (typeof handlerOutput === "string") {
      message = handlerOutput;
    } else if (handlerOutput && typeof handlerOutput === "object") {
      if (
        typeof (handlerOutput as { message?: unknown }).message === "string"
      ) {
        message = (handlerOutput as { message?: string }).message;
      } else {
        message = JSON.stringify(handlerOutput);
      }
    }
    if (!message) return [];
    if (args.onStreamText && !args.signal?.aborted) {
      args.onStreamText(`${message}\n`);
    } else {
      logger.log(message);
    }
    return [{
      role: "assistant",
      content: `${message} (elapsed ${elapsedMs}ms)`,
    }];
  } catch {
    return [];
  }
}

function createIdleController(args: {
  cfg?: import("./types.ts").IdleHandlerConfig;
  deck: LoadedDeck;
  guardrails: Guardrails;
  depth: number;
  runId: string;
  parentActionCallId?: string;
  modelProvider: ModelProvider;
  defaultModel?: string;
  modelOverride?: string;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  stream?: boolean;
  onStreamText?: (chunk: string) => void;
  pushMessages: (msgs: Array<ModelMessage>) => void;
  responsesMode?: boolean;
  permissions: NormalizedPermissionSet;
  workspacePermissions?: PermissionDeclarationInput;
  workspacePermissionsBaseDir?: string;
  sessionPermissions?: PermissionDeclarationInput;
  sessionPermissionsBaseDir?: string;
  runDeadlineMs: number;
  workerSandbox: boolean;
  signal?: AbortSignal;
  onTool?: RunOptions["onTool"];
}): IdleController {
  if (!args.cfg?.path) {
    return {
      touch: () => {},
      pause: () => {},
      resume: () => {},
      stop: () => {},
    };
  }

  const delayMs = args.cfg.delayMs ?? DEFAULT_STATUS_DELAY_MS;
  const repeatMs = args.cfg.repeatMs;
  let timer: number | undefined;
  let paused = false;
  let stopped = false;
  let lastTouched = performance.now();

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const schedule = () => {
    if (stopped || paused) return;
    clear();
    const now = performance.now();
    const remaining = Math.max(0, delayMs - (now - lastTouched));
    timer = setTimeout(async () => {
      if (stopped || paused) return;
      const elapsed = performance.now() - lastTouched;
      try {
        const envelope = await runIdleHandler({
          deck: args.deck,
          handlerPath: args.cfg!.path,
          runId: args.runId,
          parentActionCallId: args.parentActionCallId,
          modelProvider: args.modelProvider,
          guardrails: args.guardrails,
          depth: args.depth,
          defaultModel: args.defaultModel,
          modelOverride: args.modelOverride,
          elapsedMs: elapsed,
          trace: args.trace,
          stream: args.stream,
          onStreamText: args.onStreamText,
          responsesMode: args.responsesMode,
          permissions: args.permissions,
          workspacePermissions: args.workspacePermissions,
          workspacePermissionsBaseDir: args.workspacePermissionsBaseDir,
          sessionPermissions: args.sessionPermissions,
          sessionPermissionsBaseDir: args.sessionPermissionsBaseDir,
          runDeadlineMs: args.runDeadlineMs,
          workerSandbox: args.workerSandbox,
          signal: args.signal,
          onTool: args.onTool,
        });
        if (envelope.length) args.pushMessages(envelope.map(sanitizeMessage));
      } catch {
        // ignore idle handler errors
      }
      if (repeatMs && repeatMs > 0) {
        lastTouched = performance.now();
        schedule();
      }
    }, remaining) as unknown as number;
  };

  const touch = () => {
    if (stopped) return;
    lastTouched = performance.now();
    schedule();
  };
  const pause = () => {
    paused = true;
    clear();
  };
  const resume = () => {
    if (stopped) return;
    if (!paused) return;
    paused = false;
    schedule();
  };
  const stop = () => {
    stopped = true;
    clear();
  };

  return { touch, pause, resume, stop };
}

async function runIdleHandler(args: {
  deck: LoadedDeck;
  handlerPath: string;
  runId: string;
  parentActionCallId?: string;
  modelProvider: ModelProvider;
  guardrails: Guardrails;
  depth: number;
  defaultModel?: string;
  modelOverride?: string;
  elapsedMs: number;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  stream?: boolean;
  onStreamText?: (chunk: string) => void;
  responsesMode?: boolean;
  permissions: NormalizedPermissionSet;
  workspacePermissions?: PermissionDeclarationInput;
  workspacePermissionsBaseDir?: string;
  sessionPermissions?: PermissionDeclarationInput;
  sessionPermissionsBaseDir?: string;
  runDeadlineMs: number;
  workerSandbox: boolean;
  signal?: AbortSignal;
  onTool?: RunOptions["onTool"];
}): Promise<Array<ModelMessage>> {
  try {
    ensureRunActive(args.runDeadlineMs, args.signal);
    const input = {
      kind: "idle",
      label: args.deck.label,
      source: { deckPath: args.deck.path },
      trigger: {
        reason: "idle_timeout" as const,
        elapsedMs: Math.floor(args.elapsedMs),
      },
    };
    const handlerOutput = await runDeck({
      path: args.handlerPath,
      input,
      modelProvider: args.modelProvider,
      isRoot: false,
      guardrails: args.guardrails,
      depth: args.depth + 1,
      parentActionCallId: args.parentActionCallId,
      runId: args.runId,
      defaultModel: args.defaultModel,
      modelOverride: args.modelOverride,
      trace: args.trace,
      stream: args.stream,
      onStreamText: args.onStreamText,
      responsesMode: args.responsesMode,
      initialUserMessage: undefined,
      inputProvided: true,
      parentPermissions: args.permissions,
      workspacePermissions: args.workspacePermissions,
      workspacePermissionsBaseDir: args.workspacePermissionsBaseDir,
      sessionPermissions: args.sessionPermissions,
      sessionPermissionsBaseDir: args.sessionPermissionsBaseDir,
      runDeadlineMs: args.runDeadlineMs,
      workerSandbox: args.workerSandbox,
      signal: args.signal,
      onTool: args.onTool,
    });
    const elapsedMs = Math.floor(args.elapsedMs);
    let message: string | undefined;
    if (typeof handlerOutput === "string") {
      message = handlerOutput;
    } else if (handlerOutput && typeof handlerOutput === "object") {
      if (
        typeof (handlerOutput as { message?: unknown }).message === "string"
      ) {
        message = (handlerOutput as { message?: string }).message;
      } else {
        message = JSON.stringify(handlerOutput);
      }
    }
    if (!message) return [];
    if (args.onStreamText && !args.signal?.aborted) {
      args.onStreamText(`${message}\n`);
    } else {
      logger.log(message);
    }
    return [{
      role: "assistant",
      content: `${message} (idle for ${elapsedMs}ms)`,
    }];
  } catch {
    return [];
  }
}

async function maybeHandleError(args: {
  err: unknown;
  call: { id: string; name: string; args: Record<string, unknown> };
  ctx: {
    parentDeck: LoadedDeck;
    guardrails: Guardrails;
    depth: number;
    runId: string;
    parentActionCallId?: string;
    modelProvider: ModelProvider;
    defaultModel?: string;
    modelOverride?: string;
    trace?: (event: import("./types.ts").TraceEvent) => void;
    stream?: boolean;
    onStreamText?: (chunk: string) => void;
    responsesMode?: boolean;
    permissions: NormalizedPermissionSet;
    workspacePermissions?: PermissionDeclarationInput;
    workspacePermissionsBaseDir?: string;
    sessionPermissions?: PermissionDeclarationInput;
    sessionPermissionsBaseDir?: string;
    runDeadlineMs: number;
    workerSandbox: boolean;
    signal?: AbortSignal;
    onTool?: RunOptions["onTool"];
  };
  action: { name: string; path: string; label?: string; description?: string };
}): Promise<ToolCallResult | undefined> {
  const handlerPath = args.ctx.parentDeck.handlers?.onError?.path;
  if (!handlerPath) return undefined;
  ensureRunActive(args.ctx.runDeadlineMs, args.ctx.signal);

  const message = args.err instanceof Error
    ? args.err.message
    : String(args.err);
  const envelopeInput = {
    kind: "error",
    label: args.action.label ?? args.ctx.parentDeck.label,
    source: {
      deckPath: args.ctx.parentDeck.path,
      actionName: args.action.name,
    },
    error: { message },
    childInput: args.call.args,
  };

  try {
    const handlerOutput = await runDeck({
      path: handlerPath,
      input: envelopeInput,
      modelProvider: args.ctx.modelProvider,
      isRoot: false,
      guardrails: args.ctx.guardrails,
      depth: args.ctx.depth + 1,
      parentActionCallId: args.call.id,
      runId: args.ctx.runId,
      defaultModel: args.ctx.defaultModel,
      modelOverride: args.ctx.modelOverride,
      trace: args.ctx.trace,
      stream: args.ctx.stream,
      onStreamText: args.ctx.onStreamText,
      responsesMode: args.ctx.responsesMode,
      initialUserMessage: undefined,
      inputProvided: true,
      parentPermissions: args.ctx.permissions,
      workspacePermissions: args.ctx.workspacePermissions,
      workspacePermissionsBaseDir: args.ctx.workspacePermissionsBaseDir,
      sessionPermissions: args.ctx.sessionPermissions,
      sessionPermissionsBaseDir: args.ctx.sessionPermissionsBaseDir,
      runDeadlineMs: args.ctx.runDeadlineMs,
      workerSandbox: args.ctx.workerSandbox,
      signal: args.ctx.signal,
      onTool: args.ctx.onTool,
    });

    const parsed = typeof handlerOutput === "object" && handlerOutput !== null
      ? handlerOutput as Record<string, unknown>
      : undefined;
    const status = typeof parsed?.status === "number" ? parsed.status : 500;
    const code = typeof parsed?.code === "string" ? parsed.code : undefined;
    const messageOverride = typeof parsed?.message === "string"
      ? parsed.message
      : undefined;
    const meta = (parsed?.meta && typeof parsed.meta === "object")
      ? parsed.meta as Record<string, unknown>
      : undefined;
    const payload = parsed?.payload ?? handlerOutput;

    const content = JSON.stringify({
      runId: args.ctx.runId,
      actionCallId: args.call.id,
      parentActionCallId: args.ctx.parentActionCallId,
      source: {
        deckPath: args.ctx.parentDeck.path,
        actionName: args.action.name,
      },
      status,
      payload,
      message: messageOverride ?? message,
      code,
      meta,
    });

    const callId = randomId("event");
    const extraMessages: Array<ModelMessage> = [
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: callId,
          type: "function",
          function: {
            name: GAMBIT_TOOL_COMPLETE,
            arguments: content,
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: callId,
        name: GAMBIT_TOOL_COMPLETE,
        content,
      },
    ];

    return { toolContent: content, extraMessages };
  } catch {
    // Fallback when the handler itself fails: still return a structured error envelope
    // so the assistant can continue gracefully.
    const status = 500;
    const messageOverride = `Handled error: ${message}`;
    const code = "HANDLER_FALLBACK";
    const content = JSON.stringify({
      runId: args.ctx.runId,
      actionCallId: args.call.id,
      parentActionCallId: args.ctx.parentActionCallId,
      source: {
        deckPath: args.ctx.parentDeck.path,
        actionName: args.action.name,
      },
      status,
      payload: envelopeInput,
      message: messageOverride,
      code,
      meta: { handlerFailed: true },
    });

    const callId = randomId("event");
    const extraMessages: Array<ModelMessage> = [
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: callId,
          type: "function",
          function: {
            name: GAMBIT_TOOL_COMPLETE,
            arguments: content,
          },
        }],
      },
      {
        role: "tool",
        tool_call_id: callId,
        name: GAMBIT_TOOL_COMPLETE,
        content,
      },
    ];

    return { toolContent: content, extraMessages };
  }
}

function buildSystemPrompt(deck: LoadedDeck): string {
  const parts: Array<string> = [];
  const prompt = deck.body ?? deck.prompt;
  if (prompt) parts.push(prompt.trim());
  if (!deck.inlineEmbeds) {
    for (const card of deck.cards) {
      if (card.body) parts.push(card.body.trim());
    }
  }
  return parts.join("\n\n").trim();
}

function formatInputForUser(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function sanitizeMessage(msg: ModelMessage): ModelMessage {
  const toolCalls = msg.tool_calls && msg.tool_calls.length > 0
    ? msg.tool_calls
    : undefined;
  return { ...msg, tool_calls: toolCalls };
}

function resolveToolPath(baseDir: string, rawPath: unknown): string {
  if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
    throw new Error("path is required");
  }
  return path.resolve(baseDir, rawPath);
}

function parseLineRange(args: Record<string, unknown>): {
  startLine: number;
  endLine: number;
} {
  const startLine = Number.isInteger(args.start_line)
    ? Math.max(1, Number(args.start_line))
    : 1;
  const endLine = Number.isInteger(args.end_line)
    ? Math.max(startLine, Number(args.end_line))
    : startLine + 399;
  return { startLine, endLine };
}

function parseToolLimit(value: unknown, fallback: number, max: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(1, Number(value)));
}

function toStringArray(value: unknown): Array<string> {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function hasAnyScope(scope: { all: boolean; values: Set<string> }): boolean {
  return scope.all || scope.values.size > 0;
}

function hasAnyRunScope(scope: {
  all: boolean;
  paths: Set<string>;
  commands: Set<string>;
}): boolean {
  return scope.all || scope.paths.size > 0 || scope.commands.size > 0;
}

function isBuiltinTool(name: string): boolean {
  return BUILTIN_TOOL_NAMES.has(name);
}

function applySimplePatch(
  content: string,
  edits: Array<{ oldText: string; newText: string; replaceAll?: boolean }>,
): { next: string; applied: number } {
  let next = content;
  let applied = 0;
  for (const edit of edits) {
    const oldText = edit.oldText ?? "";
    const newText = edit.newText ?? "";
    if (!oldText) continue;
    if (edit.replaceAll) {
      if (!next.includes(oldText)) continue;
      next = next.split(oldText).join(newText);
      applied++;
      continue;
    }
    const idx = next.indexOf(oldText);
    if (idx === -1) continue;
    next = `${next.slice(0, idx)}${newText}${next.slice(idx + oldText.length)}`;
    applied++;
  }
  return { next, applied };
}

async function buildToolDefs(
  deck: LoadedDeck,
  permissions: NormalizedPermissionSet,
): Promise<Array<ToolDefinition>> {
  const defs: Array<ToolDefinition> = [];
  const addBuiltinTools = () => {
    if (hasAnyScope(permissions.read)) {
      defs.push(
        {
          type: "function",
          function: {
            name: BUILTIN_TOOL_READ_FILE,
            description: "Read a UTF-8 text file.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" },
                start_line: { type: "number" },
                end_line: { type: "number" },
              },
              required: ["path"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: BUILTIN_TOOL_LIST_DIR,
            description: "List directory entries.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" },
                recursive: { type: "boolean" },
                max_entries: { type: "number" },
              },
              required: ["path"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: BUILTIN_TOOL_GREP_FILES,
            description: "Search text files using a regular expression.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" },
                query: { type: "string" },
                max_matches: { type: "number" },
              },
              required: ["path", "query"],
              additionalProperties: false,
            },
          },
        },
      );
    }

    if (hasAnyScope(permissions.write)) {
      defs.push({
        type: "function",
        function: {
          name: BUILTIN_TOOL_APPLY_PATCH,
          description:
            "Apply text replacements to a file using old/new edit pairs.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              create_if_missing: { type: "boolean" },
              edits: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    old_text: { type: "string" },
                    new_text: { type: "string" },
                    replace_all: { type: "boolean" },
                  },
                  required: ["old_text", "new_text"],
                  additionalProperties: false,
                },
              },
            },
            required: ["path", "edits"],
            additionalProperties: false,
          },
        },
      });
    }

    if (hasAnyRunScope(permissions.run)) {
      defs.push({
        type: "function",
        function: {
          name: BUILTIN_TOOL_EXEC,
          description: "Run an allowed command with optional args.",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string" },
              args: {
                type: "array",
                items: { type: "string" },
              },
              cwd: { type: "string" },
              timeout_ms: { type: "number" },
            },
            required: ["command"],
            additionalProperties: false,
          },
        },
      });
    }
  };

  addBuiltinTools();
  if (deck.allowEnd) {
    defs.push({
      type: "function",
      function: {
        name: GAMBIT_TOOL_END,
        description: "End the current run once all goals are complete.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "number" },
            payload: {},
            message: { type: "string" },
            code: { type: "string" },
            meta: { type: "object" },
          },
          additionalProperties: true,
        },
      },
    });
  }
  if (deck.respond) {
    defs.push({
      type: "function",
      function: {
        name: GAMBIT_TOOL_RESPOND,
        description: "Finish the current deck with a structured response.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "number" },
            payload: {},
            message: { type: "string" },
            code: { type: "string" },
            meta: { type: "object" },
          },
          additionalProperties: true,
        },
      },
    });
  }
  for (const action of deck.actionDecks) {
    if (isBuiltinTool(action.name)) {
      throw new Error(
        `Action name ${action.name} conflicts with a built-in tool name`,
      );
    }
    let schema = action.contextSchema;
    if (!schema) {
      const child = await loadDeck(action.path, deck.path);
      ensureSchemaPresence(child, false);
      schema = resolveContextSchema(child)!;
    }
    const params = toJsonSchema(schema as never);
    defs.push({
      type: "function",
      function: {
        name: action.name,
        description: action.description,
        parameters: params,
      },
    });
  }
  const actionNames = new Set(deck.actionDecks.map((action) => action.name));
  for (const external of deck.tools) {
    if (actionNames.has(external.name)) continue;
    if (isBuiltinTool(external.name)) {
      throw new Error(
        `External tool name ${external.name} conflicts with a built-in tool name`,
      );
    }
    defs.push({
      type: "function",
      function: {
        name: external.name,
        description: external.description,
        parameters: external.inputSchema
          ? toJsonSchema(external.inputSchema as never)
          : { type: "object", additionalProperties: true },
      },
    });
  }
  return defs;
}
