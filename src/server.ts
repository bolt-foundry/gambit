import * as path from "@std/path";
import { isGambitEndSignal, runDeck } from "@bolt-foundry/gambit-core";
import { sanitizeNumber } from "./test_bot.ts";
import { makeConsoleTracer } from "./trace.ts";
import { defaultSessionRoot } from "./cli_utils.ts";
import { loadDeck } from "@bolt-foundry/gambit-core";
import {
  appendDurableStreamEvent,
  handleDurableStreamRequest,
} from "./durable_streams.ts";
import type { FeedbackEntry, SavedState } from "@bolt-foundry/gambit-core";
import type {
  LoadedDeck,
  ModelMessage,
  ModelProvider,
  TraceEvent,
} from "@bolt-foundry/gambit-core";
import type { ZodTypeAny } from "zod";

const logger = console;
const moduleLocation = (() => {
  const directoryFromUrl = (url?: string): string | undefined => {
    if (!url || !url.startsWith("file:")) return undefined;
    return path.dirname(path.fromFileUrl(url));
  };
  try {
    const resolved = import.meta.resolve("./server.ts");
    const fromResolved = directoryFromUrl(resolved);
    if (fromResolved) return { dir: fromResolved, isLocal: true };
  } catch {
    // ignore resolution failures and try other strategies
  }
  const fromMeta = directoryFromUrl(import.meta.url);
  if (fromMeta) return { dir: fromMeta, isLocal: true };
  return { dir: Deno.cwd(), isLocal: false };
})();
const moduleDir = moduleLocation.dir;
const simulatorBundleUrl = (() => {
  try {
    return import.meta.resolve("../simulator-ui/dist/bundle.js");
  } catch {
    return undefined;
  }
})();
const simulatorBundleSourceMapUrl = (() => {
  try {
    return import.meta.resolve("../simulator-ui/dist/bundle.js.map");
  } catch {
    return undefined;
  }
})();
let cachedRemoteBundle: Uint8Array | null = null;
let cachedRemoteBundleSourceMap: Uint8Array | null = null;
const simulatorBundlePath = path.resolve(
  moduleDir,
  "..",
  "simulator-ui",
  "dist",
  "bundle.js",
);
const simulatorUiEntryPath = path.resolve(
  moduleDir,
  "..",
  "simulator-ui",
  "src",
  "main.tsx",
);
const simulatorBundleSourceMapPath = path.resolve(
  moduleDir,
  "..",
  "simulator-ui",
  "dist",
  "bundle.js.map",
);
const SIMULATOR_STREAM_ID = "gambit-simulator";
const TEST_BOT_STREAM_ID = "gambit-test-bot";
const CALIBRATE_STREAM_ID = "gambit-calibrate";
type AvailableTestDeck = {
  id: string;
  label: string;
  description?: string;
  path: string;
};
type AvailableGraderDeck = {
  id: string;
  label: string;
  description?: string;
  path: string;
};

let availableTestDecks: Array<AvailableTestDeck> = [];
const testDeckByPath = new Map<string, AvailableTestDeck>();
const testDeckById = new Map<string, AvailableTestDeck>();
let availableGraderDecks: Array<AvailableGraderDeck> = [];
const graderDeckByPath = new Map<string, AvailableGraderDeck>();
const graderDeckById = new Map<string, AvailableGraderDeck>();

type NormalizedSchema = {
  kind:
    | "string"
    | "number"
    | "boolean"
    | "enum"
    | "object"
    | "array"
    | "unknown";
  optional: boolean;
  description?: string;
  example?: unknown;
  defaultValue?: unknown;
  enumValues?: Array<unknown>;
  fields?: Record<string, NormalizedSchema>;
  items?: NormalizedSchema;
};

type SchemaDescription = {
  schema?: NormalizedSchema;
  defaults?: unknown;
  error?: string;
};

type SessionMeta = {
  id: string;
  deck?: string;
  deckSlug?: string;
  testBotName?: string;
  createdAt?: string;
  gradingRuns?: Array<GradingRunRecord>;
  sessionDir?: string;
  statePath?: string;
};

type GradingRunRecord = {
  id: string;
  graderId: string;
  graderPath: string;
  graderLabel?: string;
  status: "running" | "completed" | "error";
  runAt?: string;
  referenceSample?: {
    score: number;
    reason: string;
    evidence?: Array<string>;
  };
  input?: unknown;
  result?: unknown;
  error?: string;
};
type GradingFlag = {
  id: string;
  refId: string;
  runId?: string;
  turnIndex?: number;
  reason?: string;
  createdAt: string;
};

type OutgoingMessage =
  | {
    type: "ready";
    deck: string;
    port: number;
    schema?: NormalizedSchema;
    defaults?: unknown;
    schemaError?: string;
  }
  | { type: "pong" }
  | { type: "stream"; chunk: string; runId?: string }
  | { type: "result"; result: unknown; runId?: string; streamed: boolean }
  | { type: "trace"; event: TraceEvent }
  | {
    type: "state";
    state: SavedState;
    newMessages?: Array<{
      index: number;
      role: string;
      messageRefId?: string;
      content?: unknown;
    }>;
  }
  | { type: "error"; message: string; runId?: string };

function randomId(prefix: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `${prefix}-${suffix}`;
}

function resolveDefaultValue(raw: unknown): unknown {
  if (typeof raw === "function") {
    try {
      return raw();
    } catch {
      return undefined;
    }
  }
  return raw;
}

async function describeDeckInputSchemaFromPath(
  deckPath: string,
): Promise<SchemaDescription> {
  try {
    const deck = await loadDeck(deckPath);
    return describeZodSchema(deck.inputSchema);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[sim] failed to load deck schema: ${message}`);
    return { error: message };
  }
}

function describeZodSchema(schema?: ZodTypeAny): SchemaDescription {
  try {
    const normalized = normalizeSchema(schema);
    const defaults = normalized ? materializeDefaults(normalized) : undefined;
    return { schema: normalized, defaults };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

function schemaHasField(
  schema: NormalizedSchema | undefined,
  field: string,
): boolean {
  return schema?.kind === "object" &&
    Boolean(schema.fields && schema.fields[field]);
}

function normalizeSchema(schema?: ZodTypeAny): NormalizedSchema | undefined {
  if (!schema) return undefined;
  const unwrapped = unwrapSchema(schema);
  const core = unwrapped.schema;
  if (!core || typeof core !== "object") return undefined;
  const meta = {
    optional: unwrapped.optional,
    description: readDescription(schema) ?? readDescription(core),
    example: readExample(schema) ?? readExample(core),
    defaultValue: unwrapped.defaultValue,
  };
  const typeName = (core as { _def?: { typeName?: string } })._def?.typeName;
  switch (typeName) {
    case "ZodString":
      return { kind: "string", ...meta };
    case "ZodNumber":
      return { kind: "number", ...meta };
    case "ZodBoolean":
      return { kind: "boolean", ...meta };
    case "ZodEnum": {
      const values = (core as { _def: { values: Array<unknown> } })._def.values;
      return { kind: "enum", enumValues: [...values], ...meta };
    }
    case "ZodNativeEnum": {
      const values =
        (core as { _def: { values: Record<string, unknown> } })._def
          .values;
      return { kind: "enum", enumValues: Object.values(values), ...meta };
    }
    case "ZodLiteral": {
      const value = (core as { _def: { value: unknown } })._def.value;
      const defaultValue = meta.defaultValue !== undefined
        ? meta.defaultValue
        : value;
      const { defaultValue: _m, ...restMeta } = meta;
      return {
        kind: "enum",
        enumValues: [value],
        ...restMeta,
        defaultValue,
      };
    }
    case "ZodArray": {
      const items = (core as { _def: { type: ZodTypeAny } })._def.type;
      return {
        kind: "array",
        items: normalizeSchema(items),
        ...meta,
      };
    }
    case "ZodObject": {
      const fields: Record<string, NormalizedSchema> = {};
      const shape =
        (core as { _def: { shape: () => Record<string, ZodTypeAny> } })
          ._def.shape();
      for (const [key, child] of Object.entries(shape)) {
        const normalized = normalizeSchema(child as ZodTypeAny);
        if (normalized) fields[key] = normalized;
      }
      return { kind: "object", fields, ...meta };
    }
    default:
      return { kind: "unknown", ...meta };
  }
}

function unwrapSchema(schema: ZodTypeAny): {
  schema: ZodTypeAny;
  optional: boolean;
  defaultValue?: unknown;
} {
  let current: ZodTypeAny = schema;
  let optional = false;
  let defaultValue: unknown;

  while (current && typeof current === "object") {
    const def =
      (current as { _def?: { typeName?: string; [k: string]: unknown } })
        ._def;
    const typeName = def?.typeName;
    if (typeName === "ZodOptional" || typeName === "ZodNullable") {
      optional = true;
      current = (def as { innerType: ZodTypeAny }).innerType;
      continue;
    }
    if (typeName === "ZodDefault") {
      if (defaultValue === undefined) {
        defaultValue = resolveDefaultValue(
          (def as { defaultValue: unknown }).defaultValue,
        );
      }
      current = (def as { innerType: ZodTypeAny }).innerType;
      continue;
    }
    if (typeName === "ZodEffects") {
      current = (def as { schema: ZodTypeAny }).schema;
      continue;
    }
    if (typeName === "ZodCatch") {
      current = (def as { innerType: ZodTypeAny }).innerType;
      continue;
    }
    if (typeName === "ZodBranded") {
      current = (def as { type: ZodTypeAny }).type;
      continue;
    }
    break;
  }

  return { schema: current, optional, defaultValue };
}

function readDescription(schema?: ZodTypeAny): string | undefined {
  const def = schema && typeof schema === "object"
    ? (schema as { _def?: { description?: unknown } })._def
    : undefined;
  return typeof def?.description === "string" ? def.description : undefined;
}

function readExample(schema?: ZodTypeAny): unknown {
  const def = schema && typeof schema === "object"
    ? (schema as { _def?: Record<string, unknown> })._def
    : undefined;
  if (!def) return undefined;
  const direct = def.example ?? def.examples;
  if (direct !== undefined) return direct;
  const openapi = (def as { openapi?: { example?: unknown } }).openapi;
  if (openapi?.example !== undefined) return openapi.example;
  return undefined;
}

function cloneValue<T>(value: T): T {
  try {
    // @ts-ignore structuredClone is available in Deno
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

function resolveDeckPath(p: string): string {
  const absolutePath = path.isAbsolute(p) ? p : path.resolve(p);
  try {
    const url = import.meta.resolve(path.toFileUrl(absolutePath).href);
    if (url.startsWith("file:")) return path.fromFileUrl(url);
    return url;
  } catch {
    return absolutePath;
  }
}

function materializeDefaults(schema?: NormalizedSchema): unknown {
  if (!schema) return undefined;
  if (schema.defaultValue !== undefined) return cloneValue(schema.defaultValue);
  if (schema.example !== undefined) return cloneValue(schema.example);

  switch (schema.kind) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.fields ?? {})) {
        const value = materializeDefaults(child);
        if (value !== undefined) out[key] = value;
      }
      return Object.keys(out).length ? out : undefined;
    }
    case "array": {
      if (schema.items) {
        const item = materializeDefaults(schema.items);
        if (item !== undefined) return [item];
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function deriveInitialFromSchema(schema?: NormalizedSchema): unknown {
  if (!schema) return undefined;
  if (schema.defaultValue !== undefined) return cloneValue(schema.defaultValue);
  if (schema.example !== undefined) return cloneValue(schema.example);

  switch (schema.kind) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.fields ?? {})) {
        const value = deriveInitialFromSchema(child);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }
    case "array": {
      if (schema.items) {
        const item = deriveInitialFromSchema(schema.items);
        if (item !== undefined) return [item];
      }
      return [];
    }
    case "boolean":
      return false;
    default:
      return undefined;
  }
}

/**
 * Start the WebSocket simulator server used by the Gambit debug UI.
 */
export function startWebSocketSimulator(opts: {
  deckPath: string;
  modelProvider: ModelProvider;
  model?: string;
  modelForce?: string;
  port?: number;
  verbose?: boolean;
  signal?: AbortSignal;
  sessionDir?: string;
  autoBundle?: boolean;
  sourceMap?: boolean;
  bundlePlatform?: "deno" | "browser";
}): ReturnType<typeof Deno.serve> {
  const port = opts.port ?? 8000;
  const consoleTracer = opts.verbose ? makeConsoleTracer() : undefined;
  let resolvedDeckPath = resolveDeckPath(opts.deckPath);
  const sessionsRoot = (() => {
    const base = opts.sessionDir
      ? path.resolve(opts.sessionDir)
      : defaultSessionRoot(resolvedDeckPath);
    try {
      Deno.mkdirSync(base, { recursive: true });
    } catch (err) {
      logger.warn(
        `[sim] unable to ensure sessions directory ${base}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    return base;
  })();
  const ensureDir = (dir: string) => {
    try {
      Deno.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore
    }
  };
  const deckSlugFromPath = (p: string) => {
    const baseName = path.basename(p || "deck");
    const withoutExt = baseName.replace(/\.[^.]+$/, "");
    const slug = withoutExt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
      /^-+|-+$/g,
      "",
    );
    return slug || "session";
  };
  type TestBotRunStatus = {
    id: string;
    status: "idle" | "running" | "completed" | "error" | "canceled";
    sessionId?: string;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    maxTurns?: number;
    messages: Array<{
      role: string;
      content: string;
      messageRefId?: string;
      feedback?: FeedbackEntry;
    }>;
    traces?: Array<TraceEvent>;
    toolInserts?: Array<{
      actionCallId?: string;
      parentActionCallId?: string;
      name?: string;
      index: number;
    }>;
  };
  type TestBotRunEntry = {
    run: TestBotRunStatus;
    promise: Promise<void> | null;
    abort: AbortController | null;
  };
  const testBotRuns = new Map<string, TestBotRunEntry>();
  const broadcastTestBot = (payload: unknown) => {
    appendDurableStreamEvent(TEST_BOT_STREAM_ID, payload);
  };
  let deckSlug = deckSlugFromPath(resolvedDeckPath);
  const enrichStateWithSession = (state: SavedState): {
    state: SavedState;
    dir?: string;
  } => {
    const meta = { ...(state.meta ?? {}) };
    const now = new Date();
    if (typeof meta.sessionId !== "string") {
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      meta.sessionId = `${deckSlug}-${stamp}`;
      meta.sessionCreatedAt = now.toISOString();
    }
    if (typeof meta.deck !== "string") {
      meta.deck = resolvedDeckPath;
    }
    if (typeof meta.deckSlug !== "string") {
      meta.deckSlug = deckSlug;
    }
    if (typeof meta.sessionDir !== "string") {
      meta.sessionDir = path.join(sessionsRoot, String(meta.sessionId));
    }
    if (
      typeof meta.sessionStatePath !== "string" &&
      typeof meta.sessionDir === "string"
    ) {
      meta.sessionStatePath = path.join(meta.sessionDir, "state.json");
    }
    const dir = typeof meta.sessionDir === "string"
      ? meta.sessionDir
      : undefined;
    return { state: { ...state, meta }, dir };
  };
  const persistSessionState = (state: SavedState): SavedState => {
    const { state: enriched, dir } = enrichStateWithSession(state);
    if (dir) {
      try {
        ensureDir(dir);
        const filePath = path.join(dir, "state.json");
        Deno.writeTextFileSync(filePath, JSON.stringify(enriched, null, 2));
      } catch (err) {
        logger.warn(
          `[sim] failed to persist session state: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    return enriched;
  };
  const readSessionState = (sessionId: string): SavedState | undefined => {
    const dir = path.join(sessionsRoot, sessionId);
    const filePath = path.join(dir, "state.json");
    try {
      const text = Deno.readTextFileSync(filePath);
      const parsed = JSON.parse(text) as SavedState;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // ignore
    }
    return undefined;
  };
  const deleteSessionState = (sessionId: string): boolean => {
    if (
      !sessionId ||
      sessionId === "." ||
      sessionId === ".." ||
      sessionId !== path.basename(sessionId) ||
      sessionId.includes("/") ||
      sessionId.includes("\\")
    ) {
      return false;
    }
    const dir = path.resolve(sessionsRoot, sessionId);
    if (dir === sessionsRoot) return false;
    const relative = path.relative(sessionsRoot, dir);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return false;
    }
    try {
      Deno.removeSync(dir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  };

  const cloneTraces = (traces: Array<TraceEvent>): Array<TraceEvent> => {
    try {
      return structuredClone(traces);
    } catch {
      try {
        return JSON.parse(JSON.stringify(traces));
      } catch {
        return [...traces];
      }
    }
  };

  let simulatorRunning = false;
  let simulatorCurrentRunId: string | undefined;
  let simulatorSavedState: SavedState | undefined;
  let simulatorCapturedTraces: Array<TraceEvent> = [];
  const emitSimulator = (payload: OutgoingMessage) => {
    appendDurableStreamEvent(SIMULATOR_STREAM_ID, payload);
  };

  const listSessions = (): Array<SessionMeta> => {
    try {
      const entries: Array<SessionMeta> = [];
      for (const entry of Deno.readDirSync(sessionsRoot)) {
        if (!entry.isDirectory) continue;
        const state = readSessionState(entry.name);
        if (!state) continue;
        entries.push(buildSessionMeta(entry.name, state));
      }
      entries.sort((a, b) => {
        const aKey = a.createdAt ?? a.id;
        const bKey = b.createdAt ?? b.id;
        return bKey.localeCompare(aKey);
      });
      return entries;
    } catch {
      return [];
    }
  };

  const buildSessionMeta = (
    sessionId: string,
    state?: SavedState,
  ): SessionMeta => {
    const meta = state?.meta ?? {};
    const createdAt = typeof meta.sessionCreatedAt === "string"
      ? meta.sessionCreatedAt
      : undefined;
    const deck = typeof meta.deck === "string" ? meta.deck : undefined;
    const deckSlug = typeof meta.deckSlug === "string"
      ? meta.deckSlug
      : undefined;
    const testBotName =
      typeof (meta as { testBotName?: unknown }).testBotName ===
          "string"
        ? (meta as { testBotName: string }).testBotName
        : undefined;
    const gradingRuns = Array.isArray(
        (meta as { gradingRuns?: unknown }).gradingRuns,
      )
      ? (meta as { gradingRuns: Array<GradingRunRecord> }).gradingRuns.map(
        (run) => ({
          id: typeof run.id === "string" ? run.id : randomId("cal"),
          graderId: run.graderId,
          graderPath: run.graderPath,
          graderLabel: run.graderLabel,
          status: run.status,
          runAt: run.runAt,
          referenceSample: run.referenceSample,
          input: run.input,
          result: run.result,
          error: run.error,
        }),
      )
      : Array.isArray(meta.calibrationRuns)
      ? (meta.calibrationRuns as Array<GradingRunRecord>).map((run) => ({
        id: typeof run.id === "string" ? run.id : randomId("cal"),
        graderId: run.graderId,
        graderPath: run.graderPath,
        graderLabel: run.graderLabel,
        status: run.status,
        runAt: run.runAt,
        referenceSample: run.referenceSample,
        input: run.input,
        result: run.result,
        error: run.error,
      }))
      : undefined;
    const sessionDir = typeof meta.sessionDir === "string"
      ? meta.sessionDir
      : path.join(sessionsRoot, sessionId);
    const statePath = typeof (meta as { sessionStatePath?: string })
        .sessionStatePath === "string"
      ? (meta as { sessionStatePath?: string }).sessionStatePath
      : path.join(sessionDir, "state.json");
    return {
      id: sessionId,
      deck,
      deckSlug,
      createdAt,
      testBotName,
      gradingRuns,
      sessionDir,
      statePath,
    };
  };

  const stringifyContent = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const updateTestDeckRegistry = (list: Array<AvailableTestDeck>) => {
    testDeckByPath.clear();
    testDeckById.clear();
    for (const entry of list) {
      testDeckByPath.set(entry.path, entry);
      testDeckById.set(entry.id, entry);
    }
  };
  const updateGraderDeckRegistry = (list: Array<AvailableGraderDeck>) => {
    graderDeckByPath.clear();
    graderDeckById.clear();
    for (const entry of list) {
      graderDeckByPath.set(entry.path, entry);
      graderDeckById.set(entry.id, entry);
    }
  };

  const resolveTestDeck = (
    identifier: string,
  ): AvailableTestDeck | undefined => {
    if (!identifier) return undefined;
    const byId = testDeckById.get(identifier);
    if (byId) return byId;
    const byPath = testDeckByPath.get(path.resolve(identifier));
    return byPath;
  };
  const resolveGraderDeck = (
    identifier: string,
  ): AvailableGraderDeck | undefined => {
    if (!identifier) return undefined;
    const byId = graderDeckById.get(identifier);
    if (byId) return byId;
    const byPath = graderDeckByPath.get(path.resolve(identifier));
    return byPath;
  };

  const slugify = (label: string): string => {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
      /(^-|-$)+/g,
      "",
    );
  };

  const toDeckLabel = (filePath: string): string => {
    const base = path.basename(filePath);
    return base
      .replace(/\.deck\.(md|ts)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || base;
  };

  const buildTestBotSnapshot = (
    state: SavedState,
  ): {
    messages: TestBotRunStatus["messages"];
    toolInserts: NonNullable<TestBotRunStatus["toolInserts"]>;
  } => {
    const rawMessages = state.messages ?? [];
    const refs = state.messageRefs ?? [];
    const feedbackByRef = new Map(
      state.feedback?.map((entry) => [entry.messageRefId, entry]) ?? [],
    );
    const messages: TestBotRunStatus["messages"] = [];
    const fallbackToolInserts: NonNullable<TestBotRunStatus["toolInserts"]> =
      [];
    for (let i = 0; i < rawMessages.length; i++) {
      const msg = rawMessages[i];
      if (msg?.role === "assistant" || msg?.role === "user") {
        const content = stringifyContent(msg.content).trim();
        if (!content) continue;
        const refId = refs[i]?.id;
        messages.push({
          role: msg.role,
          content,
          messageRefId: refId,
          feedback: refId ? feedbackByRef.get(refId) : undefined,
        });
        continue;
      }
      if (msg?.role === "tool") {
        const actionCallId =
          typeof (msg as { tool_call_id?: unknown }).tool_call_id === "string"
            ? (msg as { tool_call_id?: string }).tool_call_id
            : undefined;
        const name = typeof msg.name === "string" ? msg.name : undefined;
        fallbackToolInserts.push({
          actionCallId,
          name,
          index: messages.length,
        });
      }
    }
    const traceToolInserts = deriveToolInsertsFromTraces(
      state,
      messages.length,
    );
    return {
      messages,
      toolInserts: traceToolInserts.length > 0
        ? traceToolInserts
        : fallbackToolInserts,
    };
  };

  const deriveToolInsertsFromTraces = (
    state: SavedState,
    messageCount: number,
  ): NonNullable<TestBotRunStatus["toolInserts"]> => {
    const traces = Array.isArray(state.traces) ? state.traces : [];
    if (!traces.length) return [];
    const inserts: NonNullable<TestBotRunStatus["toolInserts"]> = [];
    let messageIndex = 0;
    for (const trace of traces as Array<TraceEvent>) {
      if (!trace || typeof trace !== "object") continue;
      const traceRecord = trace as Record<string, unknown>;
      const type = typeof traceRecord.type === "string" ? traceRecord.type : "";
      if (type === "message.user" || type === "model.result") {
        messageIndex++;
        continue;
      }
      if (type === "tool.call") {
        const actionCallId = typeof traceRecord.actionCallId === "string"
          ? traceRecord.actionCallId
          : undefined;
        const parentActionCallId =
          typeof traceRecord.parentActionCallId === "string"
            ? traceRecord.parentActionCallId
            : undefined;
        const name = typeof traceRecord.name === "string"
          ? traceRecord.name
          : undefined;
        inserts.push({
          actionCallId,
          parentActionCallId,
          name,
          index: Math.min(messageIndex, messageCount),
        });
      }
    }
    return inserts;
  };

  const syncTestBotRunFromState = (
    run: TestBotRunStatus,
    state: SavedState,
  ) => {
    const snapshot = buildTestBotSnapshot(state);
    run.messages = snapshot.messages;
    run.toolInserts = snapshot.toolInserts;
    const sessionId = typeof state.meta?.sessionId === "string"
      ? state.meta.sessionId
      : undefined;
    if (sessionId) run.sessionId = sessionId;
    run.traces = Array.isArray(state.traces) ? [...state.traces] : undefined;
  };

  const startTestBotRun = (runOpts: {
    maxTurnsOverride?: number;
    deckInput?: unknown;
    botInput?: unknown;
    initialUserMessage?: string;
    botDeckPath?: string;
  } = {}): TestBotRunStatus => {
    const botDeckPath = typeof runOpts.botDeckPath === "string"
      ? runOpts.botDeckPath
      : undefined;
    if (!botDeckPath) {
      throw new Error("Missing test bot deck path");
    }
    const defaultMaxTurns = 12;
    const maxTurns = Math.round(
      sanitizeNumber(
        runOpts.maxTurnsOverride ?? defaultMaxTurns,
        defaultMaxTurns,
        { min: 1, max: 200 },
      ),
    );
    const deckInput = runOpts.deckInput;
    const hasDeckInput = deckInput !== undefined;
    const botInput: unknown = runOpts.botInput;
    const initialUserMessage = typeof runOpts.initialUserMessage === "string"
      ? runOpts.initialUserMessage.trim()
      : "";
    const botConfigPath = botDeckPath;
    const testBotName = path.basename(botConfigPath).replace(
      /\.deck\.(md|ts)$/i,
      "",
    );
    const runId = randomId("testbot");
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    const entry: TestBotRunEntry = {
      run: {
        id: runId,
        status: "running",
        startedAt,
        maxTurns,
        messages: [],
        traces: [],
        toolInserts: [],
      },
      promise: null,
      abort: controller,
    };
    testBotRuns.set(runId, entry);
    const run = entry.run;
    let savedState: SavedState | undefined = undefined;
    let lastCount = 0;
    const capturedTraces: Array<TraceEvent> = [];

    const setSessionId = (state: SavedState | undefined) => {
      const sessionId = typeof state?.meta?.sessionId === "string"
        ? state.meta.sessionId
        : undefined;
      if (sessionId) run.sessionId = sessionId;
    };

    const appendFromState = (state: SavedState) => {
      const snapshot = buildTestBotSnapshot(state);
      const rawLength = state.messages?.length ?? 0;
      const toolCount = snapshot.toolInserts.length;
      const shouldBroadcast = rawLength !== lastCount ||
        (run.toolInserts?.length ?? 0) !== toolCount;
      run.messages = snapshot.messages;
      run.toolInserts = snapshot.toolInserts;
      lastCount = rawLength;
      setSessionId(state);
      run.traces = Array.isArray(state.traces) ? [...state.traces] : undefined;
      if (shouldBroadcast) {
        broadcastTestBot({ type: "testBotStatus", run });
      }
    };

    const tracer = (event: TraceEvent) => {
      const stamped = event.ts ? event : { ...event, ts: Date.now() };
      capturedTraces.push(stamped);
      consoleTracer?.(stamped);
    };

    let deckBotState: SavedState | undefined = undefined;
    let sessionEnded = false;

    const getLastAssistantMessage = (
      history: Array<ModelMessage | null | undefined>,
    ): string | undefined => {
      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg?.role === "assistant") {
          return stringifyContent(msg.content);
        }
      }
      return undefined;
    };

    const generateDeckBotUserMessage = async (
      history: Array<ModelMessage | null | undefined>,
      streamOpts?: { onStreamText?: (chunk: string) => void },
    ): Promise<string> => {
      const assistantMessage = getLastAssistantMessage(history);
      if (!assistantMessage) return "";
      const result = await runDeckWithFallback({
        path: botDeckPath,
        input: botInput,
        inputProvided: botInput !== undefined,
        modelProvider: opts.modelProvider,
        state: deckBotState,
        allowRootStringInput: true,
        initialUserMessage: assistantMessage,
        onStateUpdate: (state) => {
          deckBotState = state;
        },
        stream: Boolean(streamOpts?.onStreamText),
        onStreamText: streamOpts?.onStreamText,
      });
      if (isGambitEndSignal(result)) {
        sessionEnded = true;
        return "";
      }
      const text = stringifyOutput(result);
      return text.trim();
    };

    const loop = async () => {
      try {
        if (!controller.signal.aborted) {
          const initialResult = await runDeck({
            path: resolvedDeckPath,
            input: deckInput,
            inputProvided: hasDeckInput,
            modelProvider: opts.modelProvider,
            defaultModel: opts.model,
            modelOverride: opts.modelForce,
            trace: tracer,
            stream: false,
            state: savedState,
            allowRootStringInput: true,
            initialUserMessage: initialUserMessage || undefined,
            onStateUpdate: (state) => {
              const nextMeta = {
                ...(savedState?.meta ?? {}),
                ...(state.meta ?? {}),
                testBot: true,
                testBotRunId: runId,
                testBotConfigPath: botConfigPath,
                testBotName,
              };
              const enriched = persistSessionState({
                ...state,
                meta: nextMeta,
                traces: capturedTraces,
              });
              savedState = enriched;
              appendFromState(enriched);
            },
          });
          if (isGambitEndSignal(initialResult)) {
            sessionEnded = true;
          }
        }
        for (let turn = 0; turn < maxTurns; turn++) {
          if (sessionEnded) break;
          if (controller.signal.aborted) break;
          const history = savedState?.messages ?? [];
          const userMessage = await generateDeckBotUserMessage(history, {
            onStreamText: (chunk) =>
              broadcastTestBot({
                type: "testBotStream",
                runId,
                role: "user",
                chunk,
                turn,
                ts: Date.now(),
              }),
          });
          broadcastTestBot({
            type: "testBotStreamEnd",
            runId,
            role: "user",
            turn,
            ts: Date.now(),
          });
          if (!userMessage) break;
          const rootResult = await runDeck({
            path: resolvedDeckPath,
            input: deckInput,
            inputProvided: hasDeckInput,
            modelProvider: opts.modelProvider,
            defaultModel: opts.model,
            modelOverride: opts.modelForce,
            trace: tracer,
            stream: true,
            state: savedState,
            allowRootStringInput: true,
            initialUserMessage: userMessage,
            onStateUpdate: (state) => {
              const nextMeta = {
                ...(savedState?.meta ?? {}),
                ...(state.meta ?? {}),
                testBot: true,
                testBotRunId: runId,
                testBotConfigPath: botConfigPath,
                testBotName,
              };
              const enriched = persistSessionState({
                ...state,
                meta: nextMeta,
                traces: capturedTraces,
              });
              savedState = enriched;
              appendFromState(enriched);
            },
            onStreamText: (chunk) =>
              broadcastTestBot({
                type: "testBotStream",
                runId,
                role: "assistant",
                chunk,
                turn,
                ts: Date.now(),
              }),
          });
          if (isGambitEndSignal(rootResult)) {
            sessionEnded = true;
            break;
          }
          broadcastTestBot({
            type: "testBotStreamEnd",
            runId,
            role: "assistant",
            turn,
            ts: Date.now(),
          });
        }
        run.status = controller.signal.aborted ? "canceled" : "completed";
        broadcastTestBot({ type: "testBotStatus", run });
      } catch (err) {
        run.status = "error";
        run.error = err instanceof Error ? err.message : String(err);
        broadcastTestBot({ type: "testBotStatus", run });
      } finally {
        if (savedState?.messages) {
          const snapshot = buildTestBotSnapshot(savedState);
          run.messages = snapshot.messages;
          run.toolInserts = snapshot.toolInserts;
        }
        setSessionId(savedState);
        run.traces = Array.isArray(savedState?.traces)
          ? [...(savedState?.traces ?? [])]
          : undefined;
        run.finishedAt = new Date().toISOString();
        entry.abort = null;
        entry.promise = null;
        broadcastTestBot({ type: "testBotStatus", run });
      }
    };

    entry.promise = loop();
    broadcastTestBot({ type: "testBotStatus", run });
    return run;
  };

  const deckLoadPromise: Promise<LoadedDeck | null> = loadDeck(
    resolvedDeckPath,
  )
    .then((deck) => {
      resolvedDeckPath = deck.path;
      deckSlug = deckSlugFromPath(resolvedDeckPath);
      availableTestDecks = (deck.testDecks ?? []).map((testDeck, index) => {
        const label = testDeck.label && typeof testDeck.label === "string"
          ? testDeck.label
          : toDeckLabel(testDeck.path);
        const id = testDeck.id && typeof testDeck.id === "string"
          ? testDeck.id
          : slugify(`${label || "test-deck"}-${index}`);
        return {
          id,
          label: label || id,
          description: typeof testDeck.description === "string"
            ? testDeck.description
            : undefined,
          path: testDeck.path,
        };
      });
      updateTestDeckRegistry(availableTestDecks);
      availableGraderDecks = (deck.graderDecks ?? []).map(
        (graderDeck, index) => {
          const label = graderDeck.label && typeof graderDeck.label === "string"
            ? graderDeck.label
            : toDeckLabel(graderDeck.path);
          const id = graderDeck.id && typeof graderDeck.id === "string"
            ? graderDeck.id
            : slugify(`${label || "grader-deck"}-${index}`);
          return {
            id,
            label: label || id,
            description: typeof graderDeck.description === "string"
              ? graderDeck.description
              : undefined,
            path: graderDeck.path,
          };
        },
      );
      updateGraderDeckRegistry(availableGraderDecks);
      return deck;
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[sim] failed to load deck: ${message}`);
      availableTestDecks = [];
      updateTestDeckRegistry(availableTestDecks);
      availableGraderDecks = [];
      updateGraderDeckRegistry(availableGraderDecks);
      return null;
    });

  const schemaPromise: Promise<SchemaDescription> = deckLoadPromise
    .then((deck) =>
      deck ? describeZodSchema(deck.inputSchema) : {
        error: "Deck failed to load",
      }
    )
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[sim] failed to load deck schema: ${message}`);
      return { error: message };
    });

  const wantsSourceMap = Boolean(opts.sourceMap);
  const bundlePlatform = opts.bundlePlatform ?? "deno";
  const autoBundle = opts.autoBundle ?? true;
  const needsBundle = !hasReactBundle() ||
    (wantsSourceMap && !hasReactBundleSourceMap()) ||
    isReactBundleStale();
  const shouldAutoBundle = autoBundle && moduleLocation.isLocal && needsBundle;
  if (autoBundle && !moduleLocation.isLocal && opts.verbose) {
    logger.log(
      "[sim] auto-bundle disabled for remote package; using packaged bundle.",
    );
  }
  if (shouldAutoBundle) {
    try {
      const p = new Deno.Command("deno", {
        args: [
          "bundle",
          "--platform",
          bundlePlatform,
          ...(wantsSourceMap ? ["--sourcemap=external"] : []),
          "--output",
          "simulator-ui/dist/bundle.js",
          "simulator-ui/src/main.tsx",
        ],
        cwd: path.resolve(moduleDir, ".."),
        stdout: "null",
        stderr: "null",
      });
      p.outputSync();
    } catch (err) {
      logger.warn(
        `[sim] auto-bundle failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  const server = Deno.serve(
    { port, signal: opts.signal, onListen: () => {} },
    async (req) => {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/durable-streams/stream/")) {
        return handleDurableStreamRequest(req);
      }
      if (url.pathname === "/api/calibrate") {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        await deckLoadPromise.catch(() => null);
        const sessions = listSessions();
        return new Response(
          JSON.stringify({
            graderDecks: availableGraderDecks,
            sessions,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }

      if (url.pathname === "/api/calibrate/run") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as {
            sessionId?: string;
            graderId?: string;
          };
          if (!body.sessionId) {
            throw new Error("Missing sessionId");
          }
          const sessionId = body.sessionId;
          await deckLoadPromise.catch(() => null);
          const grader = body.graderId
            ? resolveGraderDeck(body.graderId)
            : availableGraderDecks[0];
          if (!grader) {
            throw new Error("Unknown grader deck selection");
          }
          const sessionState = readSessionState(sessionId);
          if (!sessionState) {
            throw new Error("Session not found");
          }
          const graderSchema = await describeDeckInputSchemaFromPath(
            grader.path,
          );
          const runMode = schemaHasField(graderSchema.schema, "messageToGrade")
            ? "turns"
            : "conversation";
          const metaForGrading = (() => {
            const rawMeta = sessionState.meta;
            if (!rawMeta || typeof rawMeta !== "object") return undefined;
            const next = { ...(rawMeta as Record<string, unknown>) };
            delete next.calibrationRuns;
            delete next.gradingRuns;
            return next;
          })();
          const sessionPayload = {
            messages: Array.isArray(sessionState.messages)
              ? sessionState.messages.map((msg) => ({
                role: msg.role,
                content: msg.content,
                name: msg.name,
              }))
              : undefined,
            meta: metaForGrading,
            notes: sessionState.notes
              ? { text: sessionState.notes.text }
              : undefined,
          };
          const startedAt = new Date().toISOString();
          const runId = randomId("cal");
          let entry: GradingRunRecord;
          const upsertCalibrationRun = (
            state: SavedState,
            nextEntry: GradingRunRecord,
          ): SavedState => {
            const previousRuns = Array.isArray(
                (state.meta as { gradingRuns?: unknown })?.gradingRuns,
              )
              ? ((state.meta as { gradingRuns: Array<GradingRunRecord> })
                .gradingRuns)
              : Array.isArray(state.meta?.calibrationRuns)
              ? (state.meta?.calibrationRuns as Array<GradingRunRecord>)
              : [];
            const index = previousRuns.findIndex((run) =>
              run.id === nextEntry.id
            );
            const nextRuns = index >= 0
              ? previousRuns.map((run, i) => (i === index ? nextEntry : run))
              : [...previousRuns, nextEntry];
            const nextState = persistSessionState({
              ...state,
              meta: {
                ...(state.meta ?? {}),
                gradingRuns: nextRuns,
              },
            });
            const sessionMeta = buildSessionMeta(sessionId, nextState);
            appendDurableStreamEvent(CALIBRATE_STREAM_ID, {
              type: "calibrateSession",
              sessionId,
              run: nextEntry,
              session: sessionMeta,
            });
            return nextState;
          };
          let currentState = sessionState;
          try {
            const result = await (async () => {
              if (runMode !== "turns") {
                entry = {
                  id: runId,
                  graderId: grader.id,
                  graderPath: grader.path,
                  graderLabel: grader.label,
                  status: "running",
                  runAt: startedAt,
                  input: { session: sessionPayload },
                };
                currentState = upsertCalibrationRun(currentState, entry);
                return await runDeckWithFallback({
                  path: grader.path,
                  input: { session: sessionPayload },
                  inputProvided: true,
                  modelProvider: opts.modelProvider,
                  allowRootStringInput: false,
                  initialUserMessage: undefined,
                  stream: false,
                });
              }
              const messages = sessionPayload.messages ?? [];
              const assistantTurns = messages
                .map((msg, idx) => ({ msg, idx }))
                .filter(({ msg }) =>
                  msg.role === "assistant" &&
                  typeof msg.content === "string" &&
                  msg.content.trim().length > 0
                );
              const totalTurns = assistantTurns.length;
              const turns: Array<{
                index: number;
                message: unknown;
                input: unknown;
                result: unknown;
              }> = [];
              entry = {
                id: runId,
                graderId: grader.id,
                graderPath: grader.path,
                graderLabel: grader.label,
                status: "running",
                runAt: startedAt,
                result: { mode: "turns", totalTurns, turns: [] },
              };
              currentState = upsertCalibrationRun(currentState, entry);
              if (totalTurns === 0) {
                return { mode: "turns", totalTurns, turns: [] };
              }
              for (const { msg, idx } of assistantTurns) {
                const input = {
                  session: {
                    ...sessionPayload,
                    messages: messages.slice(0, idx + 1),
                  },
                  messageToGrade: msg,
                };
                const turnResult = await runDeckWithFallback({
                  path: grader.path,
                  input,
                  inputProvided: true,
                  modelProvider: opts.modelProvider,
                  allowRootStringInput: false,
                  initialUserMessage: undefined,
                  stream: false,
                });
                turns.push({
                  index: idx,
                  message: msg,
                  input,
                  result: turnResult,
                });
                entry = {
                  ...entry,
                  result: { mode: "turns", totalTurns, turns: [...turns] },
                };
                currentState = upsertCalibrationRun(currentState, entry);
              }
              return { mode: "turns", totalTurns, turns };
            })();
            entry = {
              id: runId,
              graderId: grader.id,
              graderPath: grader.path,
              graderLabel: grader.label,
              status: "completed",
              runAt: startedAt,
              input: { session: sessionPayload },
              result,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            entry = {
              id: runId,
              graderId: grader.id,
              graderPath: grader.path,
              graderLabel: grader.label,
              status: "error",
              runAt: startedAt,
              input: { session: sessionPayload },
              error: message,
            };
          }
          const nextState = upsertCalibrationRun(currentState, entry);
          const sessionMeta = buildSessionMeta(body.sessionId, nextState);
          return new Response(
            JSON.stringify({
              sessionId: body.sessionId,
              run: entry,
              session: sessionMeta,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (url.pathname === "/api/calibrate/flag") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as {
            sessionId?: string;
            refId?: string;
            runId?: string;
            turnIndex?: number;
            reason?: string;
          };
          if (!body.sessionId || !body.refId) {
            throw new Error("Missing sessionId or refId");
          }
          const state = readSessionState(body.sessionId);
          if (!state) {
            throw new Error("Session not found");
          }
          const meta = (state.meta && typeof state.meta === "object")
            ? { ...(state.meta as Record<string, unknown>) }
            : {};
          const existingFlags = Array.isArray(
              (meta as { gradingFlags?: unknown }).gradingFlags,
            )
            ? ((meta as { gradingFlags: Array<GradingFlag> }).gradingFlags)
            : [];
          const flagIndex = existingFlags.findIndex((flag) =>
            flag?.refId === body.refId
          );
          let nextFlags: Array<GradingFlag>;
          let flagged = false;
          if (flagIndex >= 0) {
            nextFlags = existingFlags.filter((_, idx) => idx !== flagIndex);
            flagged = false;
          } else {
            const now = new Date().toISOString();
            nextFlags = [
              ...existingFlags,
              {
                id: randomId("flag"),
                refId: body.refId,
                runId: body.runId,
                turnIndex: body.turnIndex,
                reason: body.reason?.trim() || undefined,
                createdAt: now,
              },
            ];
            flagged = true;
          }
          const updated = persistSessionState({
            ...state,
            meta: {
              ...meta,
              gradingFlags: nextFlags,
            },
          });
          const sessionMeta = buildSessionMeta(body.sessionId, updated);
          appendDurableStreamEvent(CALIBRATE_STREAM_ID, {
            type: "calibrateSession",
            sessionId: body.sessionId,
            session: sessionMeta,
          });
          return new Response(
            JSON.stringify({
              sessionId: body.sessionId,
              flagged,
              flags: nextFlags,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (url.pathname === "/api/calibrate/flag/reason") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as {
            sessionId?: string;
            refId?: string;
            reason?: string;
          };
          if (!body.sessionId || !body.refId) {
            throw new Error("Missing sessionId or refId");
          }
          const state = readSessionState(body.sessionId);
          if (!state) {
            throw new Error("Session not found");
          }
          const meta = (state.meta && typeof state.meta === "object")
            ? { ...(state.meta as Record<string, unknown>) }
            : {};
          const existingFlags = Array.isArray(
              (meta as { gradingFlags?: unknown }).gradingFlags,
            )
            ? ((meta as { gradingFlags: Array<GradingFlag> }).gradingFlags)
            : [];
          const flagIndex = existingFlags.findIndex((flag) =>
            flag?.refId === body.refId
          );
          if (flagIndex < 0) {
            throw new Error("Flag not found");
          }
          const updatedFlag: GradingFlag = {
            ...existingFlags[flagIndex],
            reason: body.reason?.trim() || undefined,
          };
          const nextFlags = existingFlags.map((flag, idx) =>
            idx === flagIndex ? updatedFlag : flag
          );
          const updated = persistSessionState({
            ...state,
            meta: {
              ...meta,
              gradingFlags: nextFlags,
            },
          });
          const sessionMeta = buildSessionMeta(body.sessionId, updated);
          appendDurableStreamEvent(CALIBRATE_STREAM_ID, {
            type: "calibrateSession",
            sessionId: body.sessionId,
            session: sessionMeta,
          });
          return new Response(
            JSON.stringify({
              sessionId: body.sessionId,
              flags: nextFlags,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (url.pathname === "/api/grading/reference") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as {
            sessionId?: string;
            runId?: string;
            turnIndex?: number;
            referenceSample?: {
              score?: number;
              reason?: string;
              evidence?: Array<string>;
            };
          };
          if (!body.sessionId) throw new Error("Missing sessionId");
          if (!body.runId) throw new Error("Missing runId");
          if (!body.referenceSample) {
            throw new Error("Missing referenceSample");
          }
          const score = body.referenceSample.score;
          if (typeof score !== "number" || Number.isNaN(score)) {
            throw new Error("Invalid reference score");
          }
          const reason = body.referenceSample.reason;
          if (typeof reason !== "string" || reason.trim().length === 0) {
            throw new Error("Missing reference reason");
          }
          const evidence = Array.isArray(body.referenceSample.evidence)
            ? body.referenceSample.evidence.filter((e) =>
              typeof e === "string" && e.trim().length > 0
            )
            : undefined;
          const state = readSessionState(body.sessionId);
          if (!state) throw new Error("Session not found");
          const previousRuns = Array.isArray(
              (state.meta as { gradingRuns?: unknown })?.gradingRuns,
            )
            ? ((state.meta as { gradingRuns: Array<GradingRunRecord> })
              .gradingRuns)
            : Array.isArray(state.meta?.calibrationRuns)
            ? (state.meta?.calibrationRuns as Array<GradingRunRecord>)
            : [];
          const index = previousRuns.findIndex((run) => run.id === body.runId);
          if (index < 0) throw new Error("Run not found");
          const run = previousRuns[index];
          const nextRun: GradingRunRecord = {
            ...run,
          };
          if (typeof body.turnIndex === "number") {
            const result = run.result;
            const turnIndex = body.turnIndex;
            if (
              !result || typeof result !== "object" ||
              (result as { mode?: unknown }).mode !== "turns" ||
              !Array.isArray((result as { turns?: unknown }).turns)
            ) {
              throw new Error("Run does not support turn references");
            }
            const turns = (result as {
              turns: Array<Record<string, unknown>>;
            }).turns.map((turn) => ({ ...turn }));
            const targetIndex = turns.findIndex((turn) =>
              turn.index === turnIndex
            );
            if (targetIndex < 0) {
              throw new Error("Turn not found");
            }
            turns[targetIndex] = {
              ...turns[targetIndex],
              referenceSample: { score, reason, evidence },
            };
            nextRun.result = { ...(result as object), turns };
          } else {
            nextRun.referenceSample = { score, reason, evidence };
          }
          const nextRuns = previousRuns.map((entry, i) =>
            i === index ? nextRun : entry
          );
          const nextState = persistSessionState({
            ...state,
            meta: {
              ...(state.meta ?? {}),
              gradingRuns: nextRuns,
            },
          });
          const sessionMeta = buildSessionMeta(body.sessionId, nextState);
          appendDurableStreamEvent(CALIBRATE_STREAM_ID, {
            type: "calibrateSession",
            sessionId: body.sessionId,
            run: nextRun,
            session: sessionMeta,
          });
          return new Response(
            JSON.stringify({
              sessionId: body.sessionId,
              run: nextRun,
              session: sessionMeta,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (url.pathname === "/api/test-bot") {
        if (req.method === "GET") {
          await deckLoadPromise.catch(() => null);
          const requestedDeck = url.searchParams.get("deckPath");
          const selection = requestedDeck
            ? resolveTestDeck(requestedDeck)
            : availableTestDecks[0];
          if (requestedDeck && !selection) {
            return new Response(
              JSON.stringify({
                error: "Unknown test deck selection",
              }),
              {
                status: 400,
                headers: { "content-type": "application/json" },
              },
            );
          }
          if (selection) {
            const schemaDesc = await describeDeckInputSchemaFromPath(
              selection.path,
            );
            return new Response(
              JSON.stringify({
                botPath: selection.path,
                botLabel: selection.label,
                botDescription: selection.description,
                selectedDeckId: selection.id,
                inputSchema: schemaDesc.schema,
                inputSchemaError: schemaDesc.error,
                defaults: { input: schemaDesc.defaults },
                testDecks: availableTestDecks,
              }),
              { headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              botPath: null,
              botLabel: null,
              botDescription: null,
              selectedDeckId: null,
              inputSchema: null,
              inputSchemaError: null,
              defaults: {},
              testDecks: availableTestDecks,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response("Method not allowed", { status: 405 });
      }

      if (url.pathname === "/api/test-bot/run") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        let maxTurnsOverride: number | undefined = undefined;
        let deckInput: unknown = undefined;
        let botInput: unknown = undefined;
        let initialUserMessage: string | undefined = undefined;
        let botDeckSelection: AvailableTestDeck | undefined;
        try {
          const body = await req.json() as {
            maxTurns?: number;
            init?: unknown;
            botInput?: unknown;
            initialUserMessage?: unknown;
            botDeckPath?: string;
          };
          if (
            typeof body.maxTurns === "number" && Number.isFinite(body.maxTurns)
          ) {
            maxTurnsOverride = body.maxTurns;
          }
          deckInput = body.init;
          botInput = body.botInput;
          await deckLoadPromise.catch(() => null);
          if (typeof body.botDeckPath === "string") {
            const resolved = resolveTestDeck(body.botDeckPath);
            if (!resolved) {
              return new Response(
                JSON.stringify({ error: "Unknown test deck selection" }),
                {
                  status: 400,
                  headers: { "content-type": "application/json" },
                },
              );
            }
            botDeckSelection = resolved;
          } else if (!body.botDeckPath && availableTestDecks.length > 0) {
            botDeckSelection = availableTestDecks[0];
          }
          if (
            typeof body.initialUserMessage === "string" &&
            body.initialUserMessage.trim().length > 0
          ) {
            initialUserMessage = body.initialUserMessage;
          }
        } catch {
          // ignore parse errors; use defaults
        }
        if (deckInput === undefined) {
          try {
            const desc = await schemaPromise;
            deckInput = desc.defaults !== undefined
              ? desc.defaults
              : deriveInitialFromSchema(desc.schema);
          } catch {
            // ignore; keep undefined
          }
        }
        if (!botDeckSelection) {
          return new Response(
            JSON.stringify({ error: "No test decks configured" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const run = startTestBotRun({
          maxTurnsOverride,
          deckInput,
          botInput,
          initialUserMessage,
          botDeckPath: botDeckSelection.path,
        });
        return new Response(
          JSON.stringify({ run }),
          { headers: { "content-type": "application/json" } },
        );
      }

      if (url.pathname === "/api/test-bot/status") {
        const runId = url.searchParams.get("runId") ?? undefined;
        const sessionId = url.searchParams.get("sessionId") ?? undefined;
        let entry = runId ? testBotRuns.get(runId) : undefined;
        if (!entry && sessionId) {
          for (const candidate of testBotRuns.values()) {
            if (candidate.run.sessionId === sessionId) {
              entry = candidate;
              break;
            }
          }
        }
        const run = entry?.run ?? {
          id: runId ?? "",
          status: "idle",
          messages: [],
          traces: [],
          toolInserts: [],
          sessionId,
        };
        if (!entry && sessionId) {
          const state = readSessionState(sessionId);
          if (state) {
            run.id = typeof state.runId === "string" ? state.runId : run.id;
            run.status = "completed";
            syncTestBotRunFromState(run, state);
          }
        }
        if (run.sessionId) {
          const state = readSessionState(run.sessionId);
          if (state) {
            syncTestBotRunFromState(run, state);
          }
        }
        await deckLoadPromise.catch(() => null);
        const requestedDeck = url.searchParams.get("deckPath");
        const selection = requestedDeck
          ? resolveTestDeck(requestedDeck)
          : availableTestDecks[0];
        if (requestedDeck && !selection) {
          return new Response(
            JSON.stringify({
              error: "Unknown test deck selection",
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            },
          );
        }
        if (selection) {
          const schemaDesc = await describeDeckInputSchemaFromPath(
            selection.path,
          );
          return new Response(
            JSON.stringify({
              run,
              botPath: selection.path,
              botLabel: selection.label,
              botDescription: selection.description,
              selectedDeckId: selection.id,
              inputSchema: schemaDesc.schema,
              inputSchemaError: schemaDesc.error,
              defaults: { input: schemaDesc.defaults },
              testDecks: availableTestDecks,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            run,
            botPath: null,
            botLabel: null,
            botDescription: null,
            selectedDeckId: null,
            inputSchema: null,
            inputSchemaError: null,
            defaults: {},
            testDecks: availableTestDecks,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }

      if (url.pathname === "/api/test-bot/stop") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        let runId: string | undefined = undefined;
        try {
          const body = await req.json() as { runId?: string };
          if (typeof body.runId === "string") runId = body.runId;
        } catch {
          // ignore
        }
        const entry = runId ? testBotRuns.get(runId) : undefined;
        const wasRunning = Boolean(entry?.promise);
        if (entry?.abort) {
          entry.abort.abort();
        }
        return new Response(
          JSON.stringify({
            stopped: wasRunning,
            run: entry?.run ?? {
              id: runId ?? "",
              status: "idle",
              messages: [],
              traces: [],
              toolInserts: [],
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }

      if (url.pathname === "/api/simulator/run") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        if (simulatorRunning) {
          emitSimulator({ type: "error", message: "Run already in progress" });
          return new Response(
            JSON.stringify({ error: "Run already in progress" }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }
        let payload: {
          input?: unknown;
          message?: unknown;
          trace?: boolean;
          resetState?: boolean;
          stream?: boolean;
          model?: string;
          modelForce?: string;
          sessionId?: string;
        } = {};
        try {
          payload = await req.json();
        } catch {
          // ignore parse errors
        }
        if (payload.resetState) {
          simulatorSavedState = undefined;
          simulatorCapturedTraces = [];
          simulatorCurrentRunId = undefined;
        }
        if (payload.sessionId) {
          const loaded = readSessionState(payload.sessionId);
          if (loaded) {
            simulatorSavedState = loaded;
            simulatorCapturedTraces = Array.isArray(loaded.traces)
              ? cloneTraces(loaded.traces)
              : [];
          }
        }
        simulatorCurrentRunId = undefined;
        const stream = payload.stream ?? true;
        const forwardTrace = payload.trace ?? true;
        const tracer = (event: TraceEvent) => {
          const stamped = event.ts ? event : { ...event, ts: Date.now() };
          if (stamped.type === "run.start") {
            simulatorCurrentRunId = stamped.runId;
          }
          simulatorCapturedTraces.push(stamped);
          consoleTracer?.(stamped);
          if (forwardTrace) emitSimulator({ type: "trace", event: stamped });
        };
        let initialUserMessage: unknown = typeof payload.message === "string"
          ? payload.message
          : undefined;
        let input = payload.input;
        let inputProvided = payload.input !== undefined;
        const hasSavedMessages =
          (simulatorSavedState?.messages?.length ?? 0) > 0;
        if (
          initialUserMessage === undefined &&
          input !== undefined &&
          hasSavedMessages
        ) {
          initialUserMessage = input;
          input = undefined;
          inputProvided = false;
        }
        if (opts.verbose) {
          logger.log(
            `[sim] starting run runId=${
              simulatorSavedState?.runId ?? "(new)"
            } messages=${
              simulatorSavedState?.messages?.length ?? 0
            } stream=${stream}`,
          );
        }
        simulatorRunning = true;
        try {
          const result = await runDeck({
            path: resolvedDeckPath,
            input,
            inputProvided,
            modelProvider: opts.modelProvider,
            isRoot: true,
            allowRootStringInput: true,
            defaultModel: payload.model ?? opts.model,
            modelOverride: payload.modelForce ?? opts.modelForce,
            trace: tracer,
            stream,
            state: simulatorSavedState,
            onStateUpdate: (state) => {
              const nextMeta = {
                ...(simulatorSavedState?.meta ?? {}),
                ...(state.meta ?? {}),
              };
              const enrichedState = persistSessionState({
                ...state,
                meta: nextMeta,
                notes: state.notes ?? simulatorSavedState?.notes,
                conversationScore: state.conversationScore ??
                  simulatorSavedState?.conversationScore,
                traces: simulatorCapturedTraces,
              });
              simulatorSavedState = enrichedState;
              emitSimulator({ type: "state", state: enrichedState });
            },
            initialUserMessage,
            onStreamText: (chunk) =>
              emitSimulator({
                type: "stream",
                chunk,
                runId: simulatorCurrentRunId,
              }),
          });
          emitSimulator({
            type: "result",
            result,
            runId: simulatorCurrentRunId,
            streamed: stream,
          });
          return new Response(
            JSON.stringify({
              runId: simulatorCurrentRunId,
              sessionId: simulatorSavedState?.meta?.sessionId,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emitSimulator({
            type: "error",
            message,
            runId: simulatorCurrentRunId,
          });
          return new Response(
            JSON.stringify({ error: message }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        } finally {
          simulatorRunning = false;
        }
      }

      if (url.pathname === "/api/simulator/feedback") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as {
            sessionId?: string;
            messageRefId?: string;
            score?: number;
            reason?: string;
          };
          if (!body.sessionId) {
            throw new Error("Missing sessionId");
          }
          if (!body.messageRefId) {
            throw new Error("Missing messageRefId");
          }
          if (typeof body.score !== "number" || Number.isNaN(body.score)) {
            throw new Error("Invalid score");
          }
          const state = readSessionState(body.sessionId);
          if (!state) throw new Error("Session not found");
          simulatorSavedState = state;
          simulatorCapturedTraces = Array.isArray(state.traces)
            ? cloneTraces(state.traces)
            : [];
          const clamped = Math.max(-3, Math.min(3, Math.round(body.score)));
          const reason = typeof body.reason === "string"
            ? body.reason
            : undefined;
          const runId = typeof state.runId === "string" ? state.runId : "run";
          const existing = state.feedback ?? [];
          const idx = existing.findIndex((f) =>
            f.messageRefId === body.messageRefId
          );
          const now = new Date().toISOString();
          const entry = idx >= 0
            ? {
              ...existing[idx],
              score: clamped,
              reason,
              runId: existing[idx].runId ?? runId,
            }
            : {
              id: randomId("fb"),
              runId,
              messageRefId: body.messageRefId,
              score: clamped,
              reason,
              createdAt: now,
            };
          const feedback = idx >= 0
            ? existing.map((f, i) => i === idx ? entry : f)
            : [...existing, entry];
          const enriched = persistSessionState({
            ...state,
            feedback,
            traces: simulatorCapturedTraces,
          });
          simulatorSavedState = enriched;
          emitSimulator({ type: "state", state: enriched });
          return new Response(
            JSON.stringify({ feedback: entry }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (url.pathname === "/api/simulator/notes") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as {
            sessionId?: string;
            text?: string;
          };
          if (!body.sessionId) {
            throw new Error("Missing sessionId");
          }
          const state = readSessionState(body.sessionId);
          if (!state) throw new Error("Session not found");
          simulatorSavedState = state;
          simulatorCapturedTraces = Array.isArray(state.traces)
            ? cloneTraces(state.traces)
            : [];
          const now = new Date().toISOString();
          const enriched = persistSessionState({
            ...state,
            notes: { text: body.text ?? "", updatedAt: now },
            traces: simulatorCapturedTraces,
          });
          simulatorSavedState = enriched;
          emitSimulator({ type: "state", state: enriched });
          return new Response(
            JSON.stringify({ notes: enriched.notes, saved: true }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (url.pathname === "/api/simulator/conversation-score") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as {
            sessionId?: string;
            score?: number;
          };
          if (!body.sessionId) {
            throw new Error("Missing sessionId");
          }
          if (typeof body.score !== "number" || Number.isNaN(body.score)) {
            throw new Error("Invalid score");
          }
          const state = readSessionState(body.sessionId);
          if (!state) throw new Error("Session not found");
          simulatorSavedState = state;
          simulatorCapturedTraces = Array.isArray(state.traces)
            ? cloneTraces(state.traces)
            : [];
          const clamped = Math.max(-3, Math.min(3, Math.round(body.score)));
          const now = new Date().toISOString();
          const enriched = persistSessionState({
            ...state,
            conversationScore: { score: clamped, updatedAt: now },
            traces: simulatorCapturedTraces,
          });
          simulatorSavedState = enriched;
          emitSimulator({ type: "state", state: enriched });
          return new Response(
            JSON.stringify({
              conversationScore: enriched.conversationScore,
              saved: true,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (url.pathname === "/api/simulator/load-session") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as { sessionId?: string };
          if (!body.sessionId) {
            throw new Error("Missing sessionId");
          }
          const state = readSessionState(body.sessionId);
          if (!state) {
            throw new Error("Session not found");
          }
          simulatorSavedState = state;
          simulatorCapturedTraces = Array.isArray(state.traces)
            ? cloneTraces(state.traces)
            : [];
          emitSimulator({ type: "state", state });
          return new Response(
            JSON.stringify({ state }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (url.pathname === "/api/session") {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) {
          return new Response(
            JSON.stringify({ error: "Missing sessionId" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const state = readSessionState(sessionId);
        if (!state) {
          return new Response(
            JSON.stringify({ error: "Session not found" }),
            { status: 404, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            sessionId,
            messages: state.messages,
            messageRefs: state.messageRefs,
            feedback: state.feedback,
            traces: state.traces,
            notes: state.notes,
            meta: state.meta,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }

      if (url.pathname === "/api/session/notes") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as {
            sessionId?: string;
            text?: string;
          };
          if (!body.sessionId) {
            throw new Error("Missing sessionId");
          }
          const state = readSessionState(body.sessionId);
          if (!state) {
            throw new Error("Session not found");
          }
          const now = new Date().toISOString();
          const nextState = persistSessionState({
            ...state,
            notes: { text: body.text ?? "", updatedAt: now },
          });
          return new Response(
            JSON.stringify({
              sessionId: body.sessionId,
              notes: nextState.notes,
              saved: true,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (url.pathname === "/api/session/feedback") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as {
            sessionId?: string;
            messageRefId?: string;
            score?: number;
            reason?: string;
          };
          if (!body.sessionId) {
            throw new Error("Missing sessionId");
          }
          if (!body.messageRefId) {
            throw new Error("Missing messageRefId");
          }
          if (typeof body.score !== "number" || Number.isNaN(body.score)) {
            throw new Error("Invalid score");
          }
          const state = readSessionState(body.sessionId);
          if (!state) {
            throw new Error("Session not found");
          }
          const clamped = Math.max(-3, Math.min(3, Math.round(body.score)));
          const reason = typeof body.reason === "string"
            ? body.reason
            : undefined;
          const runId = typeof state.runId === "string"
            ? state.runId
            : "session";
          const existing = state.feedback ?? [];
          const idx = existing.findIndex((entry) =>
            entry.messageRefId === body.messageRefId
          );
          const now = new Date().toISOString();
          const entry = idx >= 0
            ? {
              ...existing[idx],
              score: clamped,
              reason,
              runId: existing[idx].runId ?? runId,
            }
            : {
              id: randomId("fb"),
              runId,
              messageRefId: body.messageRefId,
              score: clamped,
              reason,
              createdAt: now,
            };
          const feedback = idx >= 0
            ? existing.map((item, i) => i === idx ? entry : item)
            : [...existing, entry];
          const nextState = persistSessionState({
            ...state,
            feedback,
          });
          const testBotRunId = typeof nextState.meta?.testBotRunId === "string"
            ? nextState.meta.testBotRunId
            : undefined;
          if (testBotRunId) {
            const testEntry = testBotRuns.get(testBotRunId);
            if (testEntry) {
              syncTestBotRunFromState(testEntry.run, nextState);
              broadcastTestBot({ type: "testBotStatus", run: testEntry.run });
            }
          }
          return new Response(
            JSON.stringify({
              sessionId: body.sessionId,
              feedback: entry,
              saved: true,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (url.pathname === "/api/session/delete") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as { sessionId?: string };
          if (!body.sessionId) {
            throw new Error("Missing sessionId");
          }
          const removed = deleteSessionState(body.sessionId);
          if (!removed) {
            return new Response(
              JSON.stringify({ error: "Session not found" }),
              { status: 404, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({ sessionId: body.sessionId, deleted: true }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (url.pathname === "/api/feedback") {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        const deckPathParam = url.searchParams.get("deckPath");
        if (!deckPathParam) {
          return new Response(
            JSON.stringify({ error: "Missing deckPath" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const items: Array<Record<string, unknown>> = [];
        try {
          for await (const entry of Deno.readDir(sessionsRoot)) {
            if (!entry.isDirectory) continue;
            const sessionId = entry.name;
            const state = readSessionState(sessionId);
            if (!state) continue;
            if (state.meta?.deck !== deckPathParam) continue;
            const feedbackList = Array.isArray(state.feedback)
              ? state.feedback
              : [];
            feedbackList.forEach((fb) => {
              if (!fb || typeof fb !== "object") return;
              const messageRefId = (fb as { messageRefId?: string })
                .messageRefId;
              if (typeof messageRefId !== "string") return;
              let messageContent: unknown = undefined;
              if (
                Array.isArray(state.messageRefs) &&
                Array.isArray(state.messages)
              ) {
                const idx = state.messageRefs.findIndex((ref) =>
                  ref?.id === messageRefId
                );
                if (idx >= 0) {
                  messageContent = state.messages[idx]?.content;
                }
              }
              items.push({
                sessionId,
                deck: state.meta?.deck,
                sessionCreatedAt: state.meta?.sessionCreatedAt,
                messageRefId,
                score: (fb as { score?: number }).score,
                reason: (fb as { reason?: string }).reason,
                createdAt: (fb as { createdAt?: string }).createdAt,
                archivedAt: (fb as { archivedAt?: string }).archivedAt,
                messageContent,
              });
            });
          }
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        items.sort((a, b) => {
          const aTime = String(a.createdAt ?? "") || "";
          const bTime = String(b.createdAt ?? "") || "";
          return bTime.localeCompare(aTime);
        });
        return new Response(
          JSON.stringify({ deckPath: deckPathParam, items }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.pathname === "/api/feedback/archive" && req.method === "POST") {
        try {
          const body = await req.json() as {
            sessionId?: string;
            messageRefId?: string;
            archived?: boolean;
          };
          if (!body.sessionId || !body.messageRefId) {
            throw new Error("Missing sessionId or messageRefId");
          }
          const state = readSessionState(body.sessionId);
          if (!state || !Array.isArray(state.feedback)) {
            throw new Error("Session not found");
          }
          const idx = state.feedback.findIndex((fb) =>
            (fb as { messageRefId?: string }).messageRefId === body.messageRefId
          );
          if (idx === -1) throw new Error("Feedback not found");
          const next = { ...state.feedback[idx] };
          if (body.archived === false) {
            delete (next as Record<string, unknown>).archivedAt;
          } else {
            (next as Record<string, unknown>).archivedAt = new Date()
              .toISOString();
          }
          const nextFeedback = state.feedback.map((fb, i) =>
            i === idx ? next : fb
          );
          const updated = persistSessionState({
            ...state,
            feedback: nextFeedback,
          });
          return new Response(
            JSON.stringify({
              sessionId: body.sessionId,
              messageRefId: body.messageRefId,
              archivedAt: (next as { archivedAt?: string }).archivedAt,
              saved: true,
              feedbackCount: updated.feedback?.length ?? 0,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (
        url.pathname === "/" || url.pathname.startsWith("/sessions/") ||
        url.pathname.startsWith("/simulate") ||
        url.pathname.startsWith("/debug") ||
        url.pathname.startsWith("/editor") ||
        url.pathname.startsWith("/docs") ||
        url.pathname.startsWith("/test-bot") ||
        url.pathname.startsWith("/calibrate")
      ) {
        const hasBundle = await canServeReactBundle();
        if (!hasBundle) {
          return new Response(
            "Simulator UI bundle missing. Run `deno task bundle:sim` (or start with `--bundle`).",
            { status: 500 },
          );
        }
        return new Response(simulatorReactHtml(resolvedDeckPath), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/schema") {
        const desc = await schemaPromise;
        return new Response(
          JSON.stringify({
            deck: resolvedDeckPath,
            ...desc,
          }),
          {
            headers: { "content-type": "application/json; charset=utf-8" },
          },
        );
      }

      if (url.pathname === "/api/deck-source") {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const content = await Deno.readTextFile(resolvedDeckPath);
          return new Response(
            JSON.stringify({
              path: resolvedDeckPath,
              content,
            }),
            { headers: { "content-type": "application/json; charset=utf-8" } },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(
            JSON.stringify({
              path: resolvedDeckPath,
              error: message,
            }),
            {
              status: 500,
              headers: { "content-type": "application/json; charset=utf-8" },
            },
          );
        }
      }

      if (url.pathname === "/ui/bundle.js") {
        const data = await readReactBundle();
        if (!data) {
          return new Response(
            "Bundle missing. Run `deno task bundle:sim` (or start with `--bundle`).",
            { status: 404 },
          );
        }
        try {
          const headers = new Headers({
            "content-type": "application/javascript; charset=utf-8",
          });
          // Hint the browser about the external source map since Deno's bundle
          // output does not embed a sourceMappingURL comment.
          if (shouldAdvertiseSourceMap()) {
            headers.set("SourceMap", "/ui/bundle.js.map");
          }
          return new Response(data as unknown as BodyInit, { headers });
        } catch (err) {
          return new Response(
            `Failed to read bundle: ${
              err instanceof Error ? err.message : String(err)
            }`,
            { status: 500 },
          );
        }
      }

      if (url.pathname === "/ui/bundle.js.map") {
        const data = await readReactBundleSourceMap();
        if (!data) {
          return new Response(
            "Source map missing. Run `deno task bundle:sim:sourcemap` (or start with `--bundle --sourcemap`).",
            { status: 404 },
          );
        }
        try {
          return new Response(data as unknown as BodyInit, {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
          });
        } catch (err) {
          return new Response(
            `Failed to read source map: ${
              err instanceof Error ? err.message : String(err)
            }`,
            { status: 500 },
          );
        }
      }

      if (url.pathname === "/sessions") {
        const sessions = listSessions();
        return new Response(JSON.stringify({ sessions }), {
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  );

  const listenPort = (server.addr as Deno.NetAddr).port;
  logger.log(
    `Simulator listening on http://localhost:${listenPort} (deck=${resolvedDeckPath})`,
  );
  return server;
}

function hasReactBundle(): boolean {
  try {
    const stat = Deno.statSync(simulatorBundlePath);
    return stat.isFile;
  } catch {
    return false;
  }
}

function hasReactBundleSourceMap(): boolean {
  try {
    const stat = Deno.statSync(simulatorBundleSourceMapPath);
    return stat.isFile;
  } catch {
    return false;
  }
}

function isReactBundleStale(): boolean {
  try {
    const bundleStat = Deno.statSync(simulatorBundlePath);
    const entryStat = Deno.statSync(simulatorUiEntryPath);
    if (!bundleStat.isFile || !entryStat.isFile) return false;
    const bundleTime = bundleStat.mtime?.getTime();
    const entryTime = entryStat.mtime?.getTime();
    if (typeof bundleTime !== "number" || typeof entryTime !== "number") {
      return false;
    }
    return entryTime > bundleTime;
  } catch {
    return false;
  }
}

function shouldAdvertiseSourceMap(): boolean {
  if (hasReactBundleSourceMap()) return true;
  if (!simulatorBundleSourceMapUrl) return false;
  return !simulatorBundleSourceMapUrl.startsWith("file:");
}

async function readReactBundle(): Promise<Uint8Array | null> {
  try {
    return await Deno.readFile(simulatorBundlePath);
  } catch {
    return await readRemoteBundle(simulatorBundleUrl, "bundle");
  }
}

async function readReactBundleSourceMap(): Promise<Uint8Array | null> {
  try {
    return await Deno.readFile(simulatorBundleSourceMapPath);
  } catch {
    return await readRemoteBundle(simulatorBundleSourceMapUrl, "map");
  }
}

async function canServeReactBundle(): Promise<boolean> {
  if (hasReactBundle()) return true;
  return (await readRemoteBundle(simulatorBundleUrl, "bundle")) !== null;
}

async function readRemoteBundle(
  url: string | undefined,
  kind: "bundle" | "map",
): Promise<Uint8Array | null> {
  if (!url || url.startsWith("file:")) return null;
  const cached = kind === "bundle"
    ? cachedRemoteBundle
    : cachedRemoteBundleSourceMap;
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    if (kind === "bundle") {
      cachedRemoteBundle = data;
    } else {
      cachedRemoteBundleSourceMap = data;
    }
    return data;
  } catch {
    return null;
  }
}

function simulatorReactHtml(deckPath: string): string {
  const deckLabel = deckPath.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const bundleStamp = (() => {
    try {
      const stat = Deno.statSync(simulatorBundlePath);
      const mtime = stat.mtime?.getTime();
      return typeof mtime === "number" ? String(mtime) : "";
    } catch {
      return "";
    }
  })();
  const bundleUrl = bundleStamp
    ? `/ui/bundle.js?v=${bundleStamp}`
    : "/ui/bundle.js";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Gambit Debug</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; background: #f3f5f9; }
    #root { min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    window.__GAMBIT_DECK_PATH__ = ${JSON.stringify(deckLabel)};
  </script>
  <script type="module" src="${bundleUrl}"></script>
</body>
</html>`;
}

function stringifyOutput(output: unknown): string {
  if (output === null || output === undefined) return "";
  if (
    output &&
    typeof output === "object" &&
    "payload" in (output as Record<string, unknown>)
  ) {
    return stringifyOutput((output as { payload?: unknown }).payload);
  }
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function shouldRetryWithStringInput(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    return error.message.includes("Schema validation failed");
  }
  return false;
}

async function runDeckWithFallback(args: {
  path: string;
  input?: unknown;
  inputProvided?: boolean;
  modelProvider: ModelProvider;
  state?: SavedState;
  allowRootStringInput?: boolean;
  initialUserMessage?: string;
  onStateUpdate?: (state: SavedState) => void;
  stream?: boolean;
  onStreamText?: (chunk: string) => void;
}): Promise<unknown> {
  try {
    return await runDeck({
      path: args.path,
      input: args.input,
      inputProvided: args.inputProvided,
      modelProvider: args.modelProvider,
      state: args.state,
      allowRootStringInput: args.allowRootStringInput,
      initialUserMessage: args.initialUserMessage,
      onStateUpdate: args.onStateUpdate,
      stream: args.stream,
      onStreamText: args.onStreamText,
    });
  } catch (error) {
    if (args.input === undefined && shouldRetryWithStringInput(error)) {
      return await runDeck({
        path: args.path,
        input: "",
        inputProvided: true,
        modelProvider: args.modelProvider,
        state: args.state,
        allowRootStringInput: args.allowRootStringInput,
        initialUserMessage: args.initialUserMessage,
        onStateUpdate: args.onStateUpdate,
        stream: args.stream,
        onStreamText: args.onStreamText,
      });
    }
    throw error;
  }
}
