import * as path from "@std/path";
import { isGambitEndSignal, runDeck } from "./runtime.ts";
import { sanitizeNumber } from "./test_bot.ts";
import { makeConsoleTracer } from "./trace.ts";
import { loadDeck } from "./loader.ts";
import {
  appendDurableStreamEvent,
  handleDurableStreamRequest,
} from "./durable_streams.ts";
import type { FeedbackEntry, SavedState } from "./state.ts";
import type {
  LoadedDeck,
  ModelMessage,
  ModelProvider,
  TraceEvent,
} from "./types.ts";
import type { ZodTypeAny } from "zod";

const logger = console;
const moduleDir = path.dirname(path.fromFileUrl(import.meta.url));
const simulatorBundlePath = path.resolve(
  moduleDir,
  "..",
  "simulator-ui",
  "dist",
  "bundle.js",
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
      : path.resolve(Deno.cwd(), ".gambit", "sessions");
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
              const enriched = persistSessionState({
                ...state,
                meta: {
                  ...(state.meta ?? {}),
                  testBot: true,
                  testBotRunId: runId,
                  testBotConfigPath: botConfigPath,
                },
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
              const enriched = persistSessionState({
                ...state,
                meta: {
                  ...(state.meta ?? {}),
                  testBot: true,
                  testBotRunId: runId,
                  testBotConfigPath: botConfigPath,
                },
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
  if (opts.autoBundle) {
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
                result: { mode: "turns", turns: [] },
              };
              currentState = upsertCalibrationRun(currentState, entry);
              if (assistantTurns.length === 0) {
                return { mode: "turns", turns: [] };
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
                  result: { mode: "turns", turns: [...turns] },
                };
                currentState = upsertCalibrationRun(currentState, entry);
              }
              return { mode: "turns", turns };
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
              const enrichedState = persistSessionState({
                ...state,
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
        url.pathname.startsWith("/test-bot") ||
        url.pathname.startsWith("/calibrate")
      ) {
        const body = hasReactBundle()
          ? simulatorReactHtml(resolvedDeckPath)
          : simulatorHtml(resolvedDeckPath);
        return new Response(body, {
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
        if (!hasReactBundle()) {
          return new Response(
            "Bundle missing. Run `deno task bundle:sim` (or start with `--bundle`).",
            { status: 404 },
          );
        }
        try {
          const data = await Deno.readFile(simulatorBundlePath);
          const headers = new Headers({
            "content-type": "application/javascript; charset=utf-8",
          });
          // Hint the browser about the external source map since Deno's bundle
          // output does not embed a sourceMappingURL comment.
          if (hasReactBundleSourceMap()) {
            headers.set("SourceMap", "/ui/bundle.js.map");
          }
          return new Response(data, { headers });
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
        if (!hasReactBundleSourceMap()) {
          return new Response(
            "Source map missing. Run `deno task bundle:sim:sourcemap` (or start with `--bundle --sourcemap`).",
            { status: 404 },
          );
        }
        try {
          const data = await Deno.readFile(simulatorBundleSourceMapPath);
          return new Response(data, {
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
  <span style="display:none">Gambit Simulator Debug</span>
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

function simulatorHtml(deckPath: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Gambit Simulator Debug</title>
  <style>
    body { font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: linear-gradient(135deg, #eaf2ff, #f7f9ff); color: #0f172a; }
    .shell { max-width: 1080px; margin: 24px auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .card { background: white; border-radius: 16px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); padding: 16px; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    header h1 { margin: 0; font-size: 20px; }
    header .meta { font-size: 12px; color: #475569; }
    .header-actions { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .layout { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; }
    .panel-title { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 14px; color: #1f2937; margin-bottom: 6px; }
    .transcript { background: #f5f7fb; border-radius: 14px; padding: 12px; height: 400px; overflow-y: auto; border: 1px solid #e2e8f0; }
    .events { background: #f8fafc; border-radius: 14px; padding: 0; height: 400px; overflow-y: auto; border: 1px solid #e2e8f0; }
    .event-row { display: grid; grid-template-columns: 96px 1fr auto; align-items: start; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
    .event-row:last-child { border-bottom: none; }
    .event-type { font-weight: 700; text-transform: uppercase; font-size: 11px; color: #0f172a; }
    .event-type.assistant { color: #2563eb; }
    .event-type.user { color: #0ea5e9; }
    .event-type.trace { color: #475569; }
    .event-type.monolog { color: #475569; }
    .event-type.error { color: #b91c1c; }
    .event-type.system { color: #8a6d3b; }
    .event-type.status { color: #8a6d3b; }
    .event-type.handler { color: #0f766e; }
    .event-summary { white-space: pre-wrap; color: #0f172a; }
    .event-actions { display: flex; gap: 8px; align-items: center; }
    .event-details { grid-column: 1 / -1; background: #eef2ff; border-radius: 10px; padding: 8px 10px; font-family: monospace; white-space: pre-wrap; margin: 0; border: 1px solid #cbd5e1; }
    .event-toggle { border: none; background: #e2e8f0; color: #334155; padding: 4px 8px; border-radius: 8px; cursor: pointer; font-size: 12px; }
    .event-toggle:hover { background: #cbd5e1; }
    .row { display: flex; margin: 6px 0; }
    .row.user { justify-content: flex-end; }
    .row.assistant, .row.trace, .row.system, .row.error, .row.handler, .row.status { justify-content: flex-start; }
    .row.meta { justify-content: center; }
    .bubble { max-width: 70%; padding: 10px 12px; border-radius: 16px; line-height: 1.4; white-space: pre-wrap; position: relative; }
    .bubble.user { background: #0b93f6; color: white; border-bottom-right-radius: 4px; }
    .bubble.assistant { background: #e5e5ea; color: #111; border-bottom-left-radius: 4px; }
    .bubble.system { background: #fff3cd; color: #8a6d3b; border-bottom-left-radius: 4px; }
    .bubble.status { background: #fff3cd; color: #8a6d3b; border-bottom-left-radius: 4px; }
    .bubble.handler { background: #d1fae5; color: #065f46; border-bottom-left-radius: 4px; }
    .bubble.trace, .bubble.meta, .bubble.monolog { background: #e2e8f0; color: #475569; border-bottom-left-radius: 4px; border-bottom-right-radius: 4px; }
    .bubble.error { background: #fee2e2; color: #b91c1c; border-bottom-left-radius: 4px; }
    .bubble.collapsible { cursor: pointer; }
    .bubble .details { display: none; margin-top: 6px; padding-top: 6px; border-top: 1px solid #cbd5e1; font-size: 12px; white-space: pre-wrap; }
    .bubble .feedback { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; opacity: 0.3; transition: opacity 120ms ease-in-out; }
    .bubble:hover .feedback, .bubble .feedback.force-visible { opacity: 1; }
    .feedback-scores { display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .feedback-scores button { padding: 6px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: white; color: #0f172a; font-size: 12px; cursor: pointer; }
    .feedback-scores button:hover { background: #e2e8f0; }
    .feedback-scores button.active { background: #0b93f6; border-color: #0b93f6; color: white; }
    .feedback-reason { width: 100%; min-height: 54px; font-size: 12px; border-radius: 10px; border: 1px solid #cbd5e1; padding: 8px; resize: vertical; display: none; box-sizing: border-box; }
    .feedback-reason.visible { display: block; }
    .feedback-status { font-size: 11px; color: #94a3b8; }
    .feedback.saving .feedback-status { color: #0b93f6; }
    .bubble.open .details { display: block; }
    .bubble .chevron { position: absolute; right: 10px; top: 10px; font-size: 12px; color: #94a3b8; }
    form.composer { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; }
    .controls { display: flex; align-items: center; gap: 8px; justify-content: space-between; flex-wrap: wrap; }
    button { padding: 10px 14px; border: none; border-radius: 10px; background: #0b93f6; color: white; cursor: pointer; font-weight: 600; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .ghost-btn { background: white; color: #0f172a; border: 1px solid #cbd5e1; }
    .ghost-btn:hover:not(:disabled) { background: #f8fafc; }
    label { font-size: 13px; color: #475569; display: inline-flex; align-items: center; gap: 4px; }
    .mode-switch { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .tabs { display: inline-flex; gap: 6px; align-items: center; }
    .tab { padding: 8px 10px; border-radius: 10px; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; cursor: pointer; }
    .tab.active { background: #0b93f6; color: white; border-color: #0b93f6; }
    .panel { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; background: #f8fafc; }
    .field-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .field { display: flex; flex-direction: column; gap: 6px; background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; }
    .field label { font-weight: 600; color: #111827; }
    .field .label-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .field small { color: #475569; font-weight: 500; }
    .badge { padding: 2px 8px; border-radius: 999px; background: #e2e8f0; color: #475569; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .input-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; width: 100%; }
    textarea.input-box { min-height: 72px; resize: vertical; font-family: monospace; }
    textarea.json-input, textarea.message-input { width: 100%; min-height: 120px; border-radius: 10px; border: 1px solid #cbd5e1; padding: 10px; font-family: monospace; resize: vertical; background: white; }
    .hint { color: #475569; font-size: 12px; }
    .inline-actions { display: inline-flex; align-items: center; gap: 10px; }
    .input-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .reset-note { color: #b45309; font-size: 12px; }
    .sessions-modal { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .sessions-modal[hidden] { display: none; }
    .sessions-modal-backdrop { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.5); }
    .sessions-modal-content { position: relative; background: white; border-radius: 16px; padding: 20px; width: min(520px, 90%); max-height: 80vh; overflow: auto; box-shadow: 0 15px 40px rgba(15, 23, 42, 0.2); display: flex; flex-direction: column; gap: 12px; }
    .sessions-modal-header { display: flex; justify-content: space-between; align-items: center; }
    .sessions-list { display: flex; flex-direction: column; gap: 8px; }
    .sessions-item { text-align: left; border: 1px solid #cbd5e1; border-radius: 10px; background: #f8fafc; color: #0f172a; padding: 10px; cursor: pointer; }
    .sessions-item:hover { background: #e2e8f0; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <header>
        <div>
          <h1>Gambit Simulator Debug</h1>
          <div class="meta">Deck: <code>${deckPath}</code> · Stream: <code>/api/durable-streams/stream/gambit-simulator</code></div>
        </div>
        <div class="header-actions">
          <button type="button" id="sessionsBtn" class="ghost-btn">Sessions</button>
          <button type="button" id="reconnect" class="ghost-btn">Reconnect</button>
          <div id="status">connecting...</div>
        </div>
      </header>
      <div class="layout">
        <div>
          <div class="panel-title">
            <span>Conversation</span>
          </div>
          <div id="transcript" class="transcript"></div>
        </div>
        <div>
          <div class="panel-title">
            <span>Traces & Tools</span>
          </div>
          <div id="events" class="events"></div>
        </div>
      </div>
      <form id="composer" class="composer">
        <div class="panel">
          <div class="panel-title">User message</div>
          <textarea id="messageInput" class="message-input" placeholder="Send a user message to the assistant"></textarea>
          <div class="hint" id="modeHint">Send runs init (if provided) first, then this message in the same run.</div>
        </div>
        <div id="initPanel" class="panel" hidden>
          <div class="panel-title">Init input (from schema)</div>
          <div class="tabs">
            <button type="button" data-tab="form" class="tab active">Form</button>
            <button type="button" data-tab="json" class="tab">Raw JSON</button>
          </div>
          <div id="formTab">
            <div id="formContainer" class="field-grid"></div>
            <div class="hint" id="formHint">Fields are generated from the deck input schema.</div>
          </div>
          <div id="jsonTab" hidden>
            <textarea id="jsonInput" class="json-input" placeholder='Enter JSON payload for init input'></textarea>
            <div class="hint">Switch back to the form to edit by field. JSON edits will be preserved.</div>
          </div>
        </div>
        <div class="controls">
          <div class="inline-actions">
            <label><input type="checkbox" id="traceToggle" checked /> Trace</label>
            <label><input type="checkbox" id="streamToggle" checked /> Stream</label>
            <label id="resetStateRow" hidden><input type="checkbox" id="resetState" /> Start new run (clear saved state)</label>
          </div>
          <div class="input-row">
            <button type="submit" id="send">Send</button>
          </div>
        </div>
      </form>
    </div>
    <div class="sessions-modal" id="sessionsModal" hidden>
      <div class="sessions-modal-backdrop" id="sessionsBackdrop"></div>
      <div class="sessions-modal-content">
        <div class="sessions-modal-header">
          <h2>Saved sessions</h2>
          <button type="button" id="sessionsClose" class="ghost-btn">Close</button>
        </div>
        <div id="sessionsStatus" class="hint"></div>
        <div id="sessionsList" class="sessions-list"></div>
      </div>
    </div>
  </div>
  <script>
    (function() {
      const transcript = document.getElementById("transcript");
      const events = document.getElementById("events");
      const status = document.getElementById("status");
      const sessionsBtn = document.getElementById("sessionsBtn");
      const sessionsModal = document.getElementById("sessionsModal");
      const sessionsList = document.getElementById("sessionsList");
      const sessionsStatus = document.getElementById("sessionsStatus");
      const sessionsClose = document.getElementById("sessionsClose");
      const sessionsBackdrop = document.getElementById("sessionsBackdrop");
      const reconnectBtn = document.getElementById("reconnect");
      const composer = document.getElementById("composer");
      const btn = document.getElementById("send");
      const modeHint = document.getElementById("modeHint");
      const formContainer = document.getElementById("formContainer");
      const jsonInput = document.getElementById("jsonInput");
      const messageInput = document.getElementById("messageInput");
      const formTab = document.getElementById("formTab");
      const jsonTab = document.getElementById("jsonTab");
      const initPanel = document.getElementById("initPanel");
      const tabButtons = Array.from(document.querySelectorAll("[data-tab]"));
      const traceToggle = document.getElementById("traceToggle");
      const streamToggle = document.getElementById("streamToggle");
      const resetState = document.getElementById("resetState");
      const resetStateRow = document.getElementById("resetStateRow");
      let currentAssistant = null;
      let statusBubble = null;
      let streamMode = "assistant"; // assistant | status | handler
      let logAssistant = null;
      let logStatus = null;
      let waitingForAssistant = false;
      let waitStartedAt = 0;
      let waitTicker = null;
      let waitingForNextAssistant = false;
      let nextAssistantWaitStartedAt = 0;
      let nextAssistantTicker = null;
      let latestState = null;
      const pendingByRole = new Map();
      const pendingFeedbackSaves = new Map();
      const feedbackByRef = new Map();
      let schemaShape = null;
      let formState = undefined;
      let formTouched = false;
      let jsonDirty = false;
      let activeTab = "form";
      let connectionAttempt = 0;
      const traceParents = new Map();

      const streamId = "gambit-simulator";
      const streamStorageKey = "gambit.durable-streams.offset.gambit-simulator";
      const streamBase = "/api/durable-streams/stream/" + encodeURIComponent(streamId);
      let eventSource = null;

      function getStreamOffset() {
        try {
          const raw = localStorage.getItem(streamStorageKey);
          const parsed = raw ? Number(raw) : 0;
          return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
        } catch {
          return 0;
        }
      }

      function setStreamOffset(offset) {
        try {
          localStorage.setItem(streamStorageKey, String(offset));
        } catch {
          // ignore
        }
      }

      function buildStreamUrl() {
        const offset = getStreamOffset();
        return streamBase + "?live=sse&offset=" + offset;
      }

      function scrollBottom(el) {
        el.scrollTop = el.scrollHeight;
      }

      function escapeSelector(value) {
        if (window.CSS && typeof window.CSS.escape === "function") {
          return window.CSS.escape(value);
        }
        return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      }

      function trackBubble(role, bubble, target) {
        if (target !== transcript) return;
        const queue = pendingByRole.get(role) ?? [];
        queue.push(bubble);
        pendingByRole.set(role, queue);
      }

      function setLatestState(state) {
        latestState = state && typeof state === "object"
          ? JSON.parse(JSON.stringify(state))
          : null;
        resetStateRow.hidden = !latestState;
        if (!latestState) {
          resetState.checked = false;
        }
        updateModeHint();
      }

      function closeSessionsModal() {
        if (!sessionsModal) return;
        sessionsModal.hidden = true;
      }

      function formatSessionLabel(session) {
        const deck = session.deckSlug || session.deck || "session";
        if (session.createdAt) {
          const date = new Date(session.createdAt);
          if (!Number.isNaN(date.getTime())) {
            return date.toLocaleString() + " · " + deck;
          }
        }
        return session.id + " · " + deck;
      }

      async function loadSessionsList() {
        if (!sessionsList || !sessionsStatus) return;
        sessionsStatus.textContent = "Loading sessions...";
        sessionsList.innerHTML = "";
        try {
          const res = await fetch("/sessions");
          if (!res.ok) throw new Error(res.status + " " + res.statusText);
          const body = await res.json();
          const sessions = Array.isArray(body.sessions) ? body.sessions : [];
          if (!sessions.length) {
            sessionsStatus.textContent = "No saved sessions yet.";
            return;
          }
          sessionsStatus.textContent = "";
          sessions.forEach((session) => {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "sessions-item";
            item.textContent = formatSessionLabel(session);
            item.addEventListener("click", async () => {
              try {
                const res = await fetch("/api/simulator/load-session", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ sessionId: session.id }),
                });
                if (!res.ok) {
                  throw new Error(res.status + " " + res.statusText);
                }
                const payload = await res.json();
                if (payload && payload.state) {
                  setLatestState(payload.state);
                  refreshFeedbackMap(payload.state);
                }
                closeSessionsModal();
              } catch (err) {
                addEvent("error", "Failed to load session: " + String(err));
              }
            });
            sessionsList.appendChild(item);
          });
        } catch (err) {
          sessionsStatus.textContent = "Failed to load sessions.";
          console.error(err);
        }
      }

      function openSessionsModal() {
        if (!sessionsModal) return;
        sessionsModal.hidden = false;
        loadSessionsList();
      }

      sessionsBtn?.addEventListener("click", () => {
        openSessionsModal();
      });
      sessionsClose?.addEventListener("click", () => closeSessionsModal());
      sessionsBackdrop?.addEventListener("click", () => closeSessionsModal());

      function addBubble(target, role, text, opts = {}) {
        const row = document.createElement("div");
        row.className = "row " + (opts.middle ? "meta" : role);
        const bubble = document.createElement("div");
        bubble.className = "bubble " + role;
        bubble.textContent = text;
        if (opts.collapsible) {
          bubble.classList.add("collapsible", "meta");
          const chev = document.createElement("span");
          chev.textContent = "▾";
          chev.className = "chevron";
          bubble.appendChild(chev);
          const details = document.createElement("div");
          details.className = "details";
          details.textContent = opts.details ?? "";
          bubble.appendChild(details);
          bubble.addEventListener("click", () => {
            const open = bubble.classList.toggle("open");
            chev.textContent = open ? "▴" : "▾";
          });
        }
        row.appendChild(bubble);
        target.appendChild(row);
        scrollBottom(target);
        trackBubble(role, bubble, target);
        return bubble;
      }

      function addEvent(role, text, opts = {}) {
        const row = document.createElement("div");
        row.className = "event-row";
        const depth = typeof opts.depth === "number" ? opts.depth : 0;
        if (depth > 0) {
          row.style.marginLeft = (depth * 16) + "px";
        }

        const type = document.createElement("div");
        type.className = "event-type " + role;
        type.textContent = role;

        const summary = document.createElement("div");
        summary.className = "event-summary";
        summary.textContent = text;

        row.appendChild(type);
        row.appendChild(summary);

        if (opts.details) {
          const actions = document.createElement("div");
          actions.className = "event-actions";
          const toggle = document.createElement("button");
          toggle.type = "button";
          toggle.className = "event-toggle";
          toggle.textContent = "Details";
          const details = document.createElement("pre");
          details.className = "event-details";
          details.textContent = opts.details;
          details.hidden = true;
          toggle.addEventListener("click", () => {
            details.hidden = !details.hidden;
            toggle.textContent = details.hidden ? "Details" : "Hide";
          });
          actions.appendChild(toggle);
          row.appendChild(actions);
          row.appendChild(details);
        } else {
          const spacer = document.createElement("div");
          spacer.className = "event-actions";
          row.appendChild(spacer);
        }

        events.appendChild(row);
        scrollBottom(events);
        return summary;
      }

      function refreshFeedbackMap(state) {
        feedbackByRef.clear();
        if (state?.feedback && Array.isArray(state.feedback)) {
          state.feedback.forEach((f) => {
            if (f && typeof f === "object" && typeof f.messageRefId === "string") {
              feedbackByRef.set(f.messageRefId, f);
            }
          });
        }
        syncAllFeedbackPanels();
      }

      function syncAllFeedbackPanels() {
        document.querySelectorAll(".feedback").forEach((panel) => {
          const refId = panel?.dataset?.messageRefId;
          if (!refId) return;
          syncFeedbackPanel(panel, refId);
        });
      }

      function sendFeedback(messageRefId, score, reason) {
        const sessionId = latestState?.meta?.sessionId;
        if (!sessionId) return;
        clearPendingFeedbackSave(messageRefId);
        markFeedbackSaving(messageRefId);
        fetch("/api/simulator/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, messageRefId, score, reason }),
        }).catch((err) => {
          addEvent("error", "Failed to save feedback: " + String(err));
        });
      }

      function nextPendingBubble(role) {
        const queue = pendingByRole.get(role) ?? [];
        while (queue.length) {
          const candidate = queue.shift();
          if (candidate && !candidate.dataset.messageRefId) {
            pendingByRole.set(role, queue);
            return candidate;
          }
        }
        pendingByRole.set(role, queue);
        return null;
      }

      function syncFeedbackPanel(panel, messageRefId) {
        panel.dataset.messageRefId = messageRefId;
        const current = feedbackByRef.get(messageRefId);
        const currentScore = typeof current?.score === "number" ? current.score : null;
        const reasonEl = panel.querySelector(".feedback-reason");
        const buttons = Array.from(
          panel.querySelectorAll(".feedback-scores button"),
        );
        buttons.forEach((btn) => {
          const val = Number(btn.dataset.value);
          const active = currentScore !== null && val === currentScore;
          btn.classList.toggle("active", active);
          if (active) panel.dataset.score = String(val);
        });
        if (reasonEl) {
          reasonEl.value = current?.reason ?? reasonEl.value ?? "";
        }
        const shouldShowReason = currentScore !== null ||
          (reasonEl && reasonEl.value && reasonEl.value.trim().length > 0);
        if (reasonEl) {
          reasonEl.classList.toggle("visible", shouldShowReason);
          if (shouldShowReason) panel.classList.add("force-visible");
        }
        const statusEl = panel.querySelector(".feedback-status");
        if (statusEl) {
          if (currentScore !== null || (current && current.reason)) {
            statusEl.textContent = "Saved";
          } else {
            statusEl.textContent = "Not scored yet";
          }
        }
        panel.classList.remove("saving");
      }

      function attachFeedbackControls(bubble, messageRefId, role) {
        if (!messageRefId || role === "user") return;
        let panel = bubble.querySelector(".feedback");
        if (!panel) {
          panel = document.createElement("div");
          panel.className = "feedback";
          const scores = document.createElement("div");
          scores.className = "feedback-scores";
          for (let i = -3; i <= 3; i++) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = String(i);
            btn.dataset.value = String(i);
            btn.addEventListener("click", () => {
              const reasonEl = panel.querySelector(".feedback-reason");
              const reason = reasonEl ? reasonEl.value : "";
              panel.dataset.score = String(i);
              scores.querySelectorAll("button").forEach((b) =>
                b.classList.toggle("active", b === btn)
              );
              if (reasonEl) {
                reasonEl.classList.add("visible");
                panel.classList.add("force-visible");
              }
              sendFeedback(messageRefId, i, reason);
            });
            scores.appendChild(btn);
          }
          const reason = document.createElement("textarea");
          reason.className = "feedback-reason";
          reason.placeholder = "Why did you pick this score?";
          reason.addEventListener("input", () => {
            panel.classList.remove("saving");
            const statusEl = panel.querySelector(".feedback-status");
            if (statusEl) statusEl.textContent = "Unsaved changes...";
            const refId = panel.dataset.messageRefId;
            if (refId) {
              scheduleFeedbackSave(refId, panel);
            }
          });
          reason.addEventListener("change", () => {
            const fallbackScore = feedbackByRef.get(messageRefId)?.score;
            const score = Number(
              panel.dataset.score ??
                (typeof fallbackScore === "number" ? fallbackScore : NaN),
            );
            if (Number.isNaN(score)) return;
            sendFeedback(messageRefId, score, reason.value);
          });
          panel.appendChild(scores);
          panel.appendChild(reason);
          const status = document.createElement("div");
          status.className = "feedback-status";
          status.textContent = "Not scored yet";
          panel.appendChild(status);
          bubble.appendChild(panel);
        }
        syncFeedbackPanel(panel, messageRefId);
      }

      function markFeedbackSaving(messageRefId) {
        const panel = document.querySelector(
          '.feedback[data-message-ref-id="' +
            escapeSelector(messageRefId) + '"]',
        );
        if (panel) {
          panel.classList.add("saving");
          const status = panel.querySelector(".feedback-status");
          if (status) status.textContent = "Saving...";
        }
      }

      function clearPendingFeedbackSave(messageRefId) {
        const timer = pendingFeedbackSaves.get(messageRefId);
        if (timer) {
          clearTimeout(timer);
          pendingFeedbackSaves.delete(messageRefId);
        }
      }

      function scheduleFeedbackSave(messageRefId, panel) {
        clearPendingFeedbackSave(messageRefId);
        const timer = setTimeout(() => {
          pendingFeedbackSaves.delete(messageRefId);
          const reasonEl = panel.querySelector(".feedback-reason");
          if (!reasonEl) return;
          const fallbackScore = feedbackByRef.get(messageRefId)?.score;
          const score = Number(
            panel.dataset.score ??
              (typeof fallbackScore === "number" ? fallbackScore : NaN),
          );
          if (Number.isNaN(score)) return;
          sendFeedback(messageRefId, score, reasonEl.value);
        }, 600);
        pendingFeedbackSaves.set(messageRefId, timer);
      }

      function bindMessages(newMessages) {
        if (!Array.isArray(newMessages)) return;
        newMessages.forEach((m) => {
          const role = m?.role || "assistant";
          const bubble = nextPendingBubble(role);
          if (!bubble) return;
          bubble.dataset.messageRefId = m.messageRefId || "";
          attachFeedbackControls(bubble, m.messageRefId, role);
        });
      }

      function formatPayload(p) {
        if (typeof p === "string") return p;
        try { return JSON.stringify(p, null, 2); } catch { return String(p); }
      }

      function formatDuration(ms) {
        return ms < 1000 ? String(Math.round(ms)) + "ms" : (ms / 1000).toFixed(2) + "s";
      }

      function updateWaitStatus() {
        if (!waitingForAssistant) return;
        const elapsed = performance.now() - waitStartedAt;
        status.textContent = "waiting " + formatDuration(elapsed);
      }

      function startWaitTimer() {
        waitStartedAt = performance.now();
        waitingForAssistant = true;
        if (waitTicker) clearInterval(waitTicker);
        updateWaitStatus();
        waitTicker = setInterval(updateWaitStatus, 250);
      }

      function stopWaitTimer(reason) {
        if (!waitingForAssistant) return;
        const elapsed = performance.now() - waitStartedAt;
        waitingForAssistant = false;
        if (waitTicker) {
          clearInterval(waitTicker);
          waitTicker = null;
        }
        status.textContent = "connected";
        const label = reason ?? "assistant reply";
        addEvent("system", label + " after " + formatDuration(elapsed));
      }

      function clearWaitTimer() {
        waitingForAssistant = false;
        if (waitTicker) {
          clearInterval(waitTicker);
          waitTicker = null;
        }
      }

      function updateNextAssistantStatus() {
        if (!waitingForNextAssistant) return;
        const elapsed = performance.now() - nextAssistantWaitStartedAt;
        status.textContent = "waiting next reply " + formatDuration(elapsed);
      }

      function startNextAssistantWait() {
        nextAssistantWaitStartedAt = performance.now();
        waitingForNextAssistant = true;
        if (nextAssistantTicker) clearInterval(nextAssistantTicker);
        updateNextAssistantStatus();
        nextAssistantTicker = setInterval(updateNextAssistantStatus, 250);
      }

      function stopNextAssistantWait(reason) {
        if (!waitingForNextAssistant) return;
        const elapsed = performance.now() - nextAssistantWaitStartedAt;
        waitingForNextAssistant = false;
        if (nextAssistantTicker) {
          clearInterval(nextAssistantTicker);
          nextAssistantTicker = null;
        }
        if (!waitingForAssistant) status.textContent = "connected";
        const label = reason ?? "next reply";
        addEvent("system", label + " after " + formatDuration(elapsed));
      }

      function clearNextAssistantWait() {
        waitingForNextAssistant = false;
        if (nextAssistantTicker) {
          clearInterval(nextAssistantTicker);
          nextAssistantTicker = null;
        }
      }

      function summarizeTrace(ev) {
        if (!ev || typeof ev !== "object") return "trace";
        const name = typeof ev.name === "string" ? ev.name : undefined;
        switch (ev.type) {
          case "log": {
            const summary = ev.title ?? ev.message ?? "";
            return "log - " + summary;
          }
          case "model.call": {
            const msgs = ev.messageCount ?? (ev.messages?.length ?? "?");
            const tools = ev.toolCount ?? (ev.tools?.length ?? 0);
            const stream = ev.stream ? "stream" : "no-stream";
            return "model.call " + (ev.model ?? "(default)") +
              " · msgs=" + msgs + " tools=" + tools + " · " + stream;
          }
          case "model.result": {
            const toolCalls = ev.toolCalls?.length ?? 0;
            const finish = ev.finishReason ?? "?";
            return "model.result " + (ev.model ?? "(default)") +
              " · finish=" + finish + " · toolCalls=" + toolCalls;
          }
          case "message.user": {
            const content = ev?.message?.content;
            const text = content === null || content === undefined
              ? ""
              : String(content);
            const snippet = text.length > 120 ? text.slice(0, 117) + "..." : text;
            return "user message" + (snippet ? " · " + snippet : "");
          }
          case "monolog": {
            const text = (() => {
              if (typeof ev.content === "string") return ev.content;
              try { return JSON.stringify(ev.content); } catch { return String(ev.content); }
            })();
            const snippet = text.length > 120 ? text.slice(0, 117) + "..." : text;
            return "monolog · " + snippet;
          }
          default: {
            const label = String(ev.type || "trace");
            const pretty = label.replace("action.", "action ").replace("deck.", "deck ");
            return "• " + (name ? (pretty + " (" + name + ")") : pretty);
          }
        }
      }

      function traceRole(ev) {
        if (!ev || typeof ev !== "object") return "trace";
        if (ev.type === "message.user") return "user";
        if (ev.type === "monolog") return "monolog";
        const name = typeof ev.name === "string" ? ev.name : undefined;
        const deckPath = typeof ev.deckPath === "string" ? ev.deckPath : undefined;
        const isHandlerDeck = deckPath && deckPath.includes("/handlers/");
        if (
          isHandlerDeck ||
          name === "gambit_respond" ||
          name === "gambit_complete"
        ) {
          return "handler";
        }
        return "trace";
      }

      function recordTraceParent(ev) {
        const id = ev?.actionCallId;
        if (!id) return;
        if (!traceParents.has(id)) {
          traceParents.set(id, ev.parentActionCallId ?? null);
        }
      }

      function traceDepth(ev) {
        const id = ev?.actionCallId;
        if (!id) return 0;
        let depth = 0;
        let current = id;
        const seen = new Set();
        while (traceParents.has(current)) {
          const parent = traceParents.get(current);
          if (!parent) break;
          depth++;
          if (seen.has(parent)) break;
          seen.add(parent);
          current = parent;
        }
        return depth;
      }

      function formatTraceEvent(ev) {
        const hook = typeof window.gambitFormatTrace === "function"
          ? window.gambitFormatTrace(ev)
          : undefined;
        if (hook) {
          if (typeof hook === "string") {
            return { role: "trace", summary: hook, details: formatPayload(ev) };
          }
          return {
            role: hook.role || hook.type || "trace",
            summary: hook.summary || hook.text || "trace",
            details: hook.details || (hook.includeRaw ? formatPayload(ev) : undefined) || formatPayload(ev),
            depth: typeof hook.depth === "number" ? hook.depth : traceDepth(ev),
          };
        }
        return {
          role: traceRole(ev),
          summary: summarizeTrace(ev),
          details: formatPayload(ev),
          depth: traceDepth(ev),
        };
      }

      function cloneValue(value) {
        try { return structuredClone(value); } catch { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
      }

      function deriveInitialFromSchema(schema, defaults) {
        if (defaults !== undefined) return cloneValue(defaults);
        if (!schema) return undefined;
        if (schema.defaultValue !== undefined) return cloneValue(schema.defaultValue);
        if (schema.example !== undefined) return cloneValue(schema.example);
        if (schema.kind === "object") {
          const obj = {};
          for (const [key, child] of Object.entries(schema.fields || {})) {
            const val = deriveInitialFromSchema(child);
            if (val !== undefined) obj[key] = val;
          }
          return Object.keys(obj).length ? obj : {};
        }
        if (schema.kind === "array" && schema.items) {
          const item = deriveInitialFromSchema(schema.items);
          return item !== undefined ? [item] : [];
        }
        return undefined;
      }

      function getPathValue(path) {
        let node = formState;
        for (const key of path) {
          if (node === undefined || node === null) return undefined;
          if (typeof node !== "object") return undefined;
          node = node[key];
        }
        return node;
      }

      function setPathValue(path, value, optional) {
        if (path.length === 0) {
          formState = value;
          return;
        }
        if (!formState || typeof formState !== "object") {
          formState = {};
        }
        let target = formState;
        for (let i = 0; i < path.length - 1; i++) {
          const key = path[i];
          if (typeof target[key] !== "object" || target[key] === null) {
            target[key] = {};
          }
          target = target[key];
        }
        const last = path[path.length - 1];
        if (optional && (value === undefined || value === "")) {
          delete target[last];
        } else {
          target[last] = value;
        }
      }

      function renderSchemaForm() {
        formContainer.innerHTML = "";
        if (!schemaShape) {
          const placeholder = document.createElement("div");
          placeholder.className = "hint";
          placeholder.textContent = "Waiting for schema... you can still paste JSON.";
          formContainer.appendChild(placeholder);
          return;
        }
        const root = renderField("Input", schemaShape, [], formState);
        formContainer.appendChild(root);
      }

      function renderField(labelText, schema, path, value) {
        if (schema.kind === "object" && schema.fields) {
          const wrapper = document.createElement("div");
          wrapper.className = "field";
          const labelRow = document.createElement("div");
          labelRow.className = "label-row";
          const lbl = document.createElement("label");
          lbl.textContent = labelText;
          labelRow.appendChild(lbl);
          const badge = document.createElement("span");
          badge.className = "badge";
          badge.textContent = schema.optional ? "optional" : "required";
          labelRow.appendChild(badge);
          wrapper.appendChild(labelRow);
          if (schema.description) {
            const desc = document.createElement("small");
            desc.textContent = schema.description;
            wrapper.appendChild(desc);
          }
          const grid = document.createElement("div");
          grid.className = "field-grid";
          for (const [key, child] of Object.entries(schema.fields)) {
            const childValue = value && typeof value === "object" ? value[key] : undefined;
            const childNode = renderField(key, child, [...path, key], childValue);
            grid.appendChild(childNode);
          }
          wrapper.appendChild(grid);
          return wrapper;
        }

        const field = document.createElement("div");
        field.className = "field";
        const labelRow = document.createElement("div");
        labelRow.className = "label-row";
        const lbl = document.createElement("label");
        lbl.textContent = labelText;
        labelRow.appendChild(lbl);
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = schema.optional ? "optional" : "required";
        labelRow.appendChild(badge);
        field.appendChild(labelRow);
        if (schema.description) {
          const desc = document.createElement("small");
          desc.textContent = schema.description;
          field.appendChild(desc);
        }
        const initial = value !== undefined ? value : deriveInitialFromSchema(schema);
        const setDirty = () => { formTouched = true; if (!jsonDirty) jsonInput.value = safeStringify(formState); };

        if (schema.kind === "string" || schema.kind === "unknown") {
          const input = document.createElement("input");
          input.className = "input-box";
          input.type = "text";
          if (initial !== undefined) input.value = String(initial);
          if (!schema.optional && !initial) input.placeholder = "required";
          input.addEventListener("input", () => {
            const val = input.value;
            setPathValue(path, val === "" && schema.optional ? undefined : val, schema.optional);
            setDirty();
          });
          field.appendChild(input);
        } else if (schema.kind === "number") {
          const input = document.createElement("input");
          input.className = "input-box";
          input.type = "number";
          if (typeof initial === "number") input.value = String(initial);
          input.addEventListener("input", () => {
            const raw = input.value;
            if (raw === "" && schema.optional) {
              setPathValue(path, undefined, true);
            } else {
              const parsed = Number(raw);
              if (!Number.isNaN(parsed)) {
                setPathValue(path, parsed, schema.optional);
              }
            }
            setDirty();
          });
          field.appendChild(input);
        } else if (schema.kind === "boolean") {
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = Boolean(initial);
          checkbox.addEventListener("change", () => {
            setPathValue(path, checkbox.checked, schema.optional);
            setDirty();
          });
          const row = document.createElement("div");
          row.className = "input-row";
          row.appendChild(checkbox);
          const txt = document.createElement("span");
          txt.textContent = "True / False";
          row.appendChild(txt);
          field.appendChild(row);
        } else if (schema.kind === "enum" && Array.isArray(schema.enumValues)) {
          const select = document.createElement("select");
          select.className = "input-box";
          const placeholder = document.createElement("option");
          placeholder.value = "";
          placeholder.textContent = schema.optional ? "— optional —" : "Select a value";
          select.appendChild(placeholder);
          for (const val of schema.enumValues) {
            const opt = document.createElement("option");
            opt.value = String(val);
            opt.textContent = String(val);
            select.appendChild(opt);
          }
          if (initial !== undefined) select.value = String(initial);
          select.addEventListener("change", () => {
            const raw = select.value;
            const chosen = raw === "" && schema.optional ? undefined : raw;
            setPathValue(path, chosen, schema.optional);
            setDirty();
          });
          field.appendChild(select);
        } else {
          const area = document.createElement("textarea");
          area.className = "input-box";
          area.placeholder = "Enter JSON";
          area.value = initial !== undefined ? safeStringify(initial) : "";
          area.addEventListener("input", () => {
            try {
              const parsed = JSON.parse(area.value);
              setPathValue(path, parsed, schema.optional);
            } catch {
              // keep last good value
            }
            setDirty();
          });
          field.appendChild(area);
        }
        return field;
      }

      function safeStringify(value) {
        try { return JSON.stringify(value, null, 2); } catch { return String(value); }
      }

      function applySchemaPayload(payload) {
        if (payload.schemaError) {
          addEvent("error", "Schema error: " + payload.schemaError);
        }
        if (payload.schema) {
          schemaShape = payload.schema;
        }
        initPanel.hidden = !schemaShape;
        if (!schemaShape) return;
        if (!formTouched || formState === undefined) {
          formState = deriveInitialFromSchema(schemaShape, payload.defaults);
          jsonDirty = false;
        }
        renderSchemaForm();
        if (!jsonDirty) {
          jsonInput.value = safeStringify(formState ?? {});
        }
        // First time we load schema, keep form pristine.
        formTouched = false;
        updateModeHint();
      }

      async function fetchSchema() {
        try {
          const res = await fetch("/schema");
          if (!res.ok) throw new Error(res.status + " " + res.statusText);
          const body = await res.json();
          applySchemaPayload(body);
        } catch (err) {
          addEvent("error", "Failed to fetch schema: " + err);
        }
      }

      function updateModeHint() {
        if (initPanel.hidden) {
          modeHint.textContent =
            "Deck has no input schema; send a message or leave blank to let the assistant start.";
          return;
        }
        if (latestState) {
          modeHint.textContent = "State loaded; init payloads are treated as user messages unless you start a new run.";
        } else {
          modeHint.textContent = "Send runs init first (from schema), then your message in the same run.";
        }
      }

      function handleMessage(msg) {
        if (!msg || typeof msg !== "object") return;
        switch (msg.type) {
          case "ready": {
            status.textContent = "ready";
            addEvent("system", "Server ready.");
            setLatestState(null);
            applySchemaPayload(msg);
            break;
          }
          case "pong":
            status.textContent = "pong";
            break;
          case "stream": {
            const chunk = msg.chunk ?? "";
            const target = streamMode === "status" || streamMode === "handler"
              ? "status"
              : "assistant";
            if (waitingForAssistant) stopWaitTimer("first token");
            if (waitingForNextAssistant) stopNextAssistantWait("next reply");
            if (target === "status") {
              if (!statusBubble) statusBubble = addBubble(transcript, "status", "");
              statusBubble.textContent += chunk;
              if (!logStatus) logStatus = addEvent("status", "");
              logStatus.textContent += chunk;
            } else {
              if (!currentAssistant) currentAssistant = addBubble(transcript, "assistant", "");
              currentAssistant.textContent += chunk;
              if (!logAssistant) logAssistant = addEvent("assistant", "");
              logAssistant.textContent += chunk;
            }
            scrollBottom(transcript);
            scrollBottom(events);
            break;
          }
          case "result": {
            if (waitingForAssistant) stopWaitTimer("result");
            if (waitingForNextAssistant) stopNextAssistantWait("next reply");
            const content = formatPayload(msg.result);
            if (!currentAssistant) {
              addBubble(transcript, "assistant", content);
            } else if (!currentAssistant.textContent.trim()) {
              currentAssistant.textContent = content;
            }
            if (!logAssistant) {
              addEvent("assistant", content);
            } else if (!logAssistant.textContent.trim()) {
              logAssistant.textContent = content;
            }
            currentAssistant = null;
            statusBubble = null;
            streamMode = "assistant";
            logAssistant = null;
            logStatus = null;
            status.textContent = "connected";
            break;
          }
          case "error":
            if (waitingForAssistant) stopWaitTimer("error");
            if (waitingForNextAssistant) stopNextAssistantWait("error");
            addBubble(events, "error", "Error: " + (msg.message ?? "unknown"));
            currentAssistant = null;
            statusBubble = null;
            logStatus = null;
            streamMode = "assistant";
            status.textContent = "error";
            break;
          case "state": {
            setLatestState(msg.state);
            refreshFeedbackMap(msg.state);
            bindMessages(msg.newMessages || []);
            break;
          }
          case "trace": {
            const ev = msg.event || {};
            if (ev.type === "model.call") {
              currentAssistant = null;
              logAssistant = null;
              statusBubble = null;
              logStatus = null;
              streamMode = "assistant";
            }
            recordTraceParent(ev);
            const formatted = formatTraceEvent(ev);
            if (formatted.role === "handler" && ev.type === "deck.start") {
              streamMode = "status";
              statusBubble = null;
              logStatus = null;
            } else if (formatted.role === "handler" && ev.type === "deck.end") {
              streamMode = "assistant";
              statusBubble = null;
            } else if (ev.type === "deck.start" || ev.type === "deck.end") {
              streamMode = "assistant";
            }
            addEvent(formatted.role, formatted.summary, {
              collapsible: true,
              details: formatted.details,
              depth: formatted.depth,
            });
            if (ev.type === "model.result" && ev.finishReason === "tool_calls") {
              startNextAssistantWait();
            }
            break;
          }
          default:
            addEvent("system", JSON.stringify(msg));
        }
      }

      function connect(reason = "connect") {
        connectionAttempt += 1;
        if (eventSource) {
          eventSource.close();
        }
        status.textContent = "connecting...";
        traceParents.clear();
        eventSource = new EventSource(buildStreamUrl());
        eventSource.onopen = () => {
          status.textContent = "connected";
          addEvent("system", reason === "reconnect" ? "Reconnected." : "Connected.");
        };
        eventSource.onerror = () => {
          status.textContent = "error";
          clearWaitTimer();
          clearNextAssistantWait();
          setLatestState(null);
        };
        eventSource.onmessage = (ev) => {
          try {
            const envelope = JSON.parse(ev.data);
            if (
              envelope &&
              typeof envelope.offset === "number" &&
              Number.isFinite(envelope.offset)
            ) {
              setStreamOffset(envelope.offset + 1);
            }
            handleMessage(envelope?.data);
          } catch {
            addEvent("system", String(ev.data));
          }
        };
      }

      updateModeHint();
      connect();
      fetchSchema();

      function switchTab(tab) {
        activeTab = tab;
        tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
        formTab.hidden = tab !== "form";
        jsonTab.hidden = tab !== "json";
        if (tab === "form" && jsonDirty) {
          try {
            const parsed = JSON.parse(jsonInput.value);
            formState = parsed;
            formTouched = false;
            jsonDirty = false;
            renderSchemaForm();
          } catch (err) {
            addEvent("error", "Invalid JSON: " + err);
          }
        }
      }

      tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          switchTab(btn.dataset.tab || "form");
        });
      });

      jsonInput.addEventListener("input", () => {
        jsonDirty = true;
      });

      reconnectBtn.addEventListener("click", () => {
        connect("reconnect");
      });

      composer.addEventListener("submit", (e) => {
        e.preventDefault();
        const shouldResetState = resetState.checked;
        const payload = {
          stream: streamToggle.checked,
          trace: traceToggle.checked,
          resetState: shouldResetState,
        };

        const text = messageInput.value.trim();
        const hasMessage = text.length > 0;
        if (hasMessage) {
          payload.message = text;
        }

        const hasState = Boolean(latestState) && !shouldResetState;
        const includeInit = !hasState || formTouched || jsonDirty;
        let inputValue = undefined;
        if (!initPanel.hidden && includeInit) {
          try {
            inputValue = activeTab === "json"
              ? JSON.parse(jsonInput.value || "null")
              : formState;
          } catch (err) {
            addEvent("error", "JSON parse error: " + err);
            return;
          }
          payload.input = inputValue === undefined ? {} : inputValue;
        }

        if (hasMessage) {
          addBubble(transcript, "user", text);
          addEvent("user", text);
        } else if (payload.input === undefined && hasState) {
          addEvent("error", "Nothing to send. Provide init input or a message.");
          return;
        }

        if (payload.input !== undefined) {
          const display = formatPayload(payload.input);
          const role = hasState ? "user" : "system";
          const label = hasState ? display : "gambit_init " + display;
          addBubble(transcript, role, label);
          addEvent(role, label);
        }

        currentAssistant = null;
        statusBubble = null;
        logAssistant = null;
        logStatus = null;
        streamMode = "assistant";
        clearNextAssistantWait();
        if (!shouldResetState && latestState?.meta?.sessionId) {
          payload.sessionId = latestState.meta.sessionId;
        }
        fetch("/api/simulator/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }).then(async (res) => {
          if (res.ok) return;
          const info = await res.json().catch(() => ({}));
          addEvent(
            "error",
            "Run failed: " +
              (info?.error || res.status + " " + res.statusText),
          );
        }).catch((err) => {
          addEvent("error", "Run failed: " + String(err));
        });
        if (shouldResetState) {
          setLatestState(null);
        }
        messageInput.value = "";
        startWaitTimer();
      });

      messageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          btn.click();
        }
      });
    })();
  </script>
</body>
</html>`;
}
