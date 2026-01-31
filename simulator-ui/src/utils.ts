export type NormalizedSchema = {
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

export type SchemaResponse = {
  deck?: string;
  startMode?: "assistant" | "user";
  modelParams?: Record<string, unknown>;
  schema?: NormalizedSchema;
  defaults?: unknown;
  error?: string;
  tools?: Array<{
    name: string;
    label?: string;
    description?: string;
    path?: string;
  }>;
};

export type ModelMessage = {
  role: string;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type MessageRef = { id: string; role: string };

export type FeedbackEntry = {
  id: string;
  runId: string;
  messageRefId: string;
  score: number;
  reason?: string;
  createdAt?: string;
};

export type SavedState = {
  runId: string;
  messages: ModelMessage[];
  messageRefs?: MessageRef[];
  feedback?: FeedbackEntry[];
  traces?: TraceEvent[];
  notes?: SessionNotes;
  conversationScore?: SessionRating;
  meta?: Record<string, unknown>;
};

export type SessionNotes = {
  text?: string;
  updatedAt?: string;
};

export type SessionRating = {
  score: number;
  updatedAt?: string;
};

export type TraceEvent = {
  type?: string;
  runId?: string;
  deckPath?: string;
  message?: ModelMessage;
  [key: string]: unknown;
};

export type SessionMeta = {
  id: string;
  deck?: string;
  deckSlug?: string;
  testBotName?: string;
  createdAt?: string;
  sessionDir?: string;
  statePath?: string;
};

export type GraderDeckMeta = {
  id: string;
  label: string;
  description?: string;
  path: string;
};

export type CalibrationRun = {
  id: string;
  graderId: string;
  graderPath: string;
  graderLabel?: string;
  status: "running" | "completed" | "error";
  runAt?: string;
  referenceSample?: {
    score: number;
    reason: string;
    evidence?: string[];
  };
  input?: unknown;
  result?: unknown;
  error?: string;
};

export type GradingFlag = {
  id: string;
  refId: string;
  runId?: string;
  turnIndex?: number;
  reason?: string;
  createdAt?: string;
};

export type SessionDetailResponse = {
  sessionId: string;
  messages: ModelMessage[];
  messageRefs?: MessageRef[];
  feedback?: FeedbackEntry[];
  meta?: Record<string, unknown>;
};

export type CalibrateSession = SessionMeta & {
  gradingRuns?: Array<CalibrationRun>;
};

export type CalibrateResponse = {
  graderDecks?: Array<GraderDeckMeta>;
  sessions?: Array<CalibrateSession>;
};

export type CalibrateStreamMessage = {
  type: "calibrateSession";
  sessionId: string;
  run: CalibrationRun;
  session: CalibrateSession;
};

export type CalibrateRef = {
  runId?: string;
  turnIndex?: number;
};

export type TestBotRun = {
  id?: string;
  status: "idle" | "running" | "completed" | "error" | "canceled";
  sessionId?: string;
  error?: string;
  initFill?: {
    requested: string[];
    applied?: unknown;
    provided?: unknown;
    error?: string;
  };
  startedAt?: string;
  finishedAt?: string;
  maxTurns?: number;
  messages: Array<{
    role: string;
    content: string;
    messageRefId?: string;
    feedback?: FeedbackEntry;
    respondStatus?: number;
    respondCode?: string;
    respondMessage?: string;
    respondPayload?: unknown;
    respondMeta?: Record<string, unknown>;
  }>;
  traces?: TraceEvent[];
  toolInserts?: Array<{
    actionCallId?: string;
    parentActionCallId?: string;
    name?: string;
    index: number;
  }>;
};

export type TestBotStreamEvent = {
  type: "testBotStream";
  runId?: string;
  role: "user" | "assistant";
  chunk: string;
  turn?: number;
  ts?: number;
};

export type TestBotStreamEndEvent = {
  type: "testBotStreamEnd";
  runId?: string;
  role: "user" | "assistant";
  turn?: number;
  ts?: number;
};

export type TestBotStatusEvent = {
  type: "testBotStatus";
  run?: TestBotRun;
};

export type TestBotSocketMessage =
  | TestBotStreamEvent
  | TestBotStreamEndEvent
  | TestBotStatusEvent;

export type TestDeckMeta = {
  id: string;
  label: string;
  description?: string;
  path: string;
};

export type TestBotConfigResponse = {
  botPath?: string | null;
  botLabel?: string | null;
  botDescription?: string | null;
  selectedDeckId?: string | null;
  testDecks?: Array<TestDeckMeta>;
  inputSchema?: NormalizedSchema | null;
  inputSchemaError?: string | null;
  defaults?: { input?: unknown } | null;
};

export type SimulatorMessage =
  | {
    type: "ready";
    deck?: string;
    port?: number;
    schema?: NormalizedSchema;
    defaults?: unknown;
    schemaError?: string;
  }
  | { type: "state"; state: SavedState }
  | { type: "trace"; event: TraceEvent }
  | { type: "stream"; chunk: string; runId?: string }
  | { type: "result"; result: unknown; runId?: string; streamed?: boolean }
  | { type: "pong" }
  | { type: "error"; message: string; runId?: string };

export type ToolCallSummary = {
  id: string;
  name?: string;
  status: "pending" | "running" | "completed" | "error";
  args?: unknown;
  result?: unknown;
  error?: unknown;
  handledError?: string;
  parentActionCallId?: string;
  depth?: number;
};

export const SCORE_VALUES = [-3, -2, -1, 0, 1, 2, 3];

export const SESSIONS_BASE_PATH = "/sessions";
export const DOCS_PATH = "/docs";
export const DEFAULT_SESSION_PATH = `${SESSIONS_BASE_PATH}/new/debug`;
export const DEFAULT_TEST_PATH = `${SESSIONS_BASE_PATH}/new/test`;
export const GRADE_PATH_SUFFIX = "/grade";
export const buildGradePath = (sessionId: string) =>
  `${SESSIONS_BASE_PATH}/${encodeURIComponent(sessionId)}${GRADE_PATH_SUFFIX}`;
export const DURABLE_STREAM_PREFIX = "/api/durable-streams/stream/";
export const SIMULATOR_STREAM_ID = "gambit-simulator";
export const GRADE_STREAM_ID = "gambit-grade";
export const TEST_STREAM_ID = "gambit-test";
export const BUILD_STREAM_ID = "gambit-build";

export const buildTabEnabled = Boolean(
  (window as unknown as { __GAMBIT_BUILD_TAB_ENABLED__?: boolean })
    .__GAMBIT_BUILD_TAB_ENABLED__,
);

export type BuildBotStreamEvent = {
  type: "buildBotStream";
  runId?: string;
  role: "user" | "assistant";
  chunk: string;
  turn?: number;
  ts?: number;
};

export type BuildBotStreamEndEvent = {
  type: "buildBotStreamEnd";
  runId?: string;
  role: "user" | "assistant";
  turn?: number;
  ts?: number;
};

export type BuildBotStatusEvent = {
  type: "buildBotStatus";
  run?: TestBotRun;
};

export type BuildBotSocketMessage =
  | BuildBotStreamEvent
  | BuildBotStreamEndEvent
  | BuildBotStatusEvent;

export const deckPath = (window as unknown as { __GAMBIT_DECK_PATH__?: string })
  .__GAMBIT_DECK_PATH__ ?? "Unknown deck";
const deckLabelFromWindow = (
  window as unknown as { __GAMBIT_DECK_LABEL__?: string | null }
).__GAMBIT_DECK_LABEL__ ?? null;
export const gambitVersion = (
  window as unknown as { __GAMBIT_VERSION__?: string | null }
).__GAMBIT_VERSION__ ?? null;
const fallbackDeckLabel = (() => {
  const base = deckPath.split(/[\\/]/).pop() ?? deckPath;
  const cleaned = base.replace(/\.deck\.(md|ts)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return cleaned || base;
})();
export const deckLabel = deckLabelFromWindow ?? fallbackDeckLabel;
export const normalizedDeckPath = normalizeFsPath(deckPath);
export const repoRootPath = guessRepoRoot(normalizedDeckPath);
export const deckDisplayPath =
  toRelativePath(normalizedDeckPath, repoRootPath) ??
    normalizedDeckPath;

export const fileNameFromPath = (
  pathValue?: string | null,
): string | null => {
  if (!pathValue) return null;
  const base = pathValue.split(/[\\/]/).pop() ?? pathValue;
  return base || pathValue;
};

export const botFilename = (pathValue?: string | null): string | null =>
  fileNameFromPath(pathValue);

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function formatJson(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    const looksLikeStructuredJson = trimmed.startsWith("{") ||
      trimmed.startsWith("[");
    if (!looksLikeStructuredJson) return value;
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatTimestamp(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function formatTimestampShort(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const includeYear = date.getFullYear() !== now.getFullYear();
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: includeYear ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function countUserMessages(
  messages: Array<{ role: string; content: string }>,
) {
  return messages.filter((m) => m.role === "user").length;
}

export function countAssistantMessages(
  messages: Array<{ role?: string; content?: unknown }>,
) {
  return messages.filter((m) => m.role === "assistant").length;
}

export function extractScoreAndReason(result: unknown): {
  score?: number;
  reason?: string;
} {
  if (!result || typeof result !== "object") return {};
  const record = result as Record<string, unknown>;
  const payload = record.payload &&
      typeof record.payload === "object" &&
      record.payload !== null
    ? record.payload as Record<string, unknown>
    : record;
  const score = typeof payload.score === "number" ? payload.score : undefined;
  const reason = typeof payload.reason === "string"
    ? payload.reason
    : undefined;
  return { score, reason };
}

export function extractGradingFlags(
  meta?: Record<string, unknown>,
): GradingFlag[] {
  if (!meta) return [];
  const flags = (meta as { gradingFlags?: unknown }).gradingFlags;
  if (!Array.isArray(flags)) return [];
  return flags.filter((flag): flag is GradingFlag =>
    Boolean(flag && typeof flag === "object" && "refId" in flag)
  );
}

export function formatSnippet(value: unknown, maxLength = 140): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : (() => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  })();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export function getScoreClass(displayScore?: number): string {
  if (displayScore === undefined) return "calibrate-score--empty";
  if (displayScore > 0) return "calibrate-score--positive";
  if (displayScore < 0) return "calibrate-score--negative";
  return "calibrate-score--neutral";
}

export function extractTurnContext(input?: unknown): {
  priorUser?: string;
  gradedAssistant?: string;
} {
  if (!input || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;
  const session = record.session;
  const messageToGrade = record.messageToGrade;
  const gradedAssistant = messageToGrade &&
      typeof messageToGrade === "object" &&
      typeof (messageToGrade as { content?: unknown }).content === "string"
    ? String((messageToGrade as { content?: string }).content)
    : undefined;
  const messages = session &&
      typeof session === "object" &&
      Array.isArray((session as { messages?: unknown }).messages)
    ? (session as { messages: Array<{ role?: string; content?: unknown }> })
      .messages
    : [];
  let priorUser: string | undefined = undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") continue;
    if (typeof msg.content === "string") {
      priorUser = msg.content;
      break;
    }
  }
  return { priorUser, gradedAssistant };
}

export function extractTotalTurns(input?: unknown): number | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const session = record.session;
  const messages = session &&
      typeof session === "object" &&
      Array.isArray((session as { messages?: unknown }).messages)
    ? (session as { messages: Array<{ role?: string; content?: unknown }> })
      .messages
    : Array.isArray((record as { messages?: unknown }).messages)
    ? (record as { messages: Array<{ role?: string; content?: unknown }> })
      .messages
    : [];
  const total = countAssistantMessages(messages);
  return total > 0 ? total : undefined;
}

export function extractTotalTurnsFromResult(result?: unknown):
  | number
  | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  if (record.mode !== "turns") return undefined;
  const totalTurns = typeof record.totalTurns === "number"
    ? record.totalTurns
    : undefined;
  const turns = Array.isArray(record.turns) ? record.turns : undefined;
  if (typeof totalTurns === "number") return totalTurns;
  return turns ? turns.length : undefined;
}

export function isTurnsResult(result?: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  return (result as { mode?: unknown }).mode === "turns";
}

export function extractConversationContext(input?: unknown): {
  latestUser?: string;
  latestAssistant?: string;
} {
  if (!input || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;
  const session = record.session;
  const messages = session &&
      typeof session === "object" &&
      Array.isArray((session as { messages?: unknown }).messages)
    ? (session as { messages: Array<{ role?: string; content?: unknown }> })
      .messages
    : [];
  let latestUser: string | undefined = undefined;
  let latestAssistant: string | undefined = undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;
    if (!latestAssistant && msg.role === "assistant") {
      if (typeof msg.content === "string") {
        latestAssistant = msg.content;
      }
    }
    if (!latestUser && msg.role === "user") {
      if (typeof msg.content === "string") {
        latestUser = msg.content;
      }
    }
    if (latestUser && latestAssistant) break;
  }
  return { latestUser, latestAssistant };
}

export function getDurableStreamOffset(streamId: string): number {
  try {
    const raw = window.localStorage.getItem(
      `gambit.durable-streams.offset.${streamId}`,
    );
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  } catch {
    return 0;
  }
}

export function setDurableStreamOffset(streamId: string, offset: number) {
  try {
    window.localStorage.setItem(
      `gambit.durable-streams.offset.${streamId}`,
      String(offset),
    );
  } catch {
    // ignore storage failures
  }
}

export function buildDurableStreamUrl(streamId: string, offset: number) {
  const params = new URLSearchParams({ live: "sse", offset: String(offset) });
  return `${DURABLE_STREAM_PREFIX}${
    encodeURIComponent(streamId)
  }?${params.toString()}`;
}

export function toDeckSlug(input: string): string {
  const base = input?.split(/[/\\]/).pop() || "deck";
  const withoutExt = base.replace(/\.[^.]+$/, "");
  const slug = withoutExt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );
  return slug || "session";
}

export function normalizeBasePath(basePath: string): string {
  if (basePath === "/") return "";
  return basePath.replace(/\/+$/, "");
}

export function getSessionIdFromPath(
  pathname?: string,
  basePath = SESSIONS_BASE_PATH,
): string | null {
  const target = typeof pathname === "string"
    ? pathname
    : window.location.pathname;
  const normalizedTarget = target.replace(/\/+$/, "");
  const canonical = normalizedTarget.match(
    /^\/sessions\/([^/]+)(?:\/(debug|grade|test))?$/,
  );
  if (canonical) {
    const id = canonical[1];
    if (id && id !== "new") return decodeURIComponent(id);
    return null;
  }
  const bases = [basePath, "/debug", "/simulate", ""];
  for (const base of bases) {
    if (typeof base !== "string") continue;
    const normalized = normalizeBasePath(base);
    const prefix = `${normalized}/sessions/`.replace(/^\/\//, "/");
    if (normalized === "" && !normalizedTarget.startsWith("/sessions/")) {
      continue;
    }
    if (normalized !== "" && !normalizedTarget.startsWith(prefix)) {
      continue;
    }
    const remainder = normalized === ""
      ? normalizedTarget.slice("/sessions/".length)
      : normalizedTarget.slice(prefix.length);
    if (remainder.length > 0 && remainder !== "new") {
      return decodeURIComponent(remainder);
    }
  }
  return null;
}

export function cloneValue<T>(value: T): T {
  try {
    // @ts-ignore structuredClone is available in modern browsers
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

export function normalizeFsPath(input?: string | null): string {
  if (!input) return "";
  return input.replace(/\\/g, "/");
}

export function guessRepoRoot(path: string): string | null {
  const normalized = normalizeFsPath(path);
  const marker = "/bfmono";
  const idx = normalized.indexOf(marker);
  if (idx === -1) return null;
  return normalized.slice(0, idx + marker.length);
}

export function toRelativePath(
  path?: string | null,
  repoRoot?: string | null,
): string | null {
  if (!path) return null;
  const target = normalizeFsPath(path);
  if (repoRoot) {
    const normalizedRoot = normalizeFsPath(repoRoot);
    if (target === normalizedRoot) return "";
    if (target.startsWith(`${normalizedRoot}/`)) {
      return target.slice(normalizedRoot.length + 1);
    }
  }
  return target;
}

export function getGradeSessionIdFromLocation(): string | null {
  const pathMatch = window.location.pathname.match(
    /^\/sessions\/([^/]+)\/grade/,
  );
  if (pathMatch) return decodeURIComponent(pathMatch[1]);
  const params = new URLSearchParams(window.location.search);
  const param = params.get("sessionId");
  return param ? decodeURIComponent(param) : null;
}

export function getGradeRefFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");
  return ref && ref.trim().length ? ref.trim() : null;
}

export function parseGradingRef(ref: string): {
  runId?: string;
  turnIndex?: number;
} {
  const match = ref.match(
    /^gradingRun:([^#]+)(?:#turn:(\d+))?$/i,
  );
  if (!match) return {};
  const runId = match[1];
  const turnIndex = match[2] ? Number(match[2]) : undefined;
  return {
    runId: runId || undefined,
    turnIndex: Number.isFinite(turnIndex) ? turnIndex : undefined,
  };
}

export function getPathValue(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (
      !current || typeof current !== "object" ||
      !(segment in (current as Record<string, unknown>))
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function setPathValue(
  value: unknown,
  path: string[],
  nextValue: unknown,
): unknown {
  if (path.length === 0) return nextValue;
  const root = value && typeof value === "object"
    ? cloneValue(value as unknown)
    : {};
  let cursor = root as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const existing = cursor[segment];
    const next = existing && typeof existing === "object"
      ? cloneValue(existing as unknown)
      : {};
    cursor[segment] = next;
    cursor = next as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (nextValue === undefined) {
    delete cursor[last];
  } else {
    cursor[last] = nextValue;
  }
  return root;
}

export function deriveInitialFromSchema(schema?: NormalizedSchema): unknown {
  if (!schema) return undefined;
  if (schema.defaultValue !== undefined) return cloneValue(schema.defaultValue);
  if (schema.example !== undefined) return cloneValue(schema.example);
  switch (schema.kind) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.fields ?? {})) {
        const v = deriveInitialFromSchema(child);
        if (v !== undefined) out[key] = v;
      }
      return Object.keys(out).length ? out : {};
    }
    case "array": {
      const item = schema.items
        ? deriveInitialFromSchema(schema.items)
        : undefined;
      return item !== undefined ? [item] : [];
    }
    case "boolean":
      return false;
    case "number":
      return undefined;
    case "string":
    case "unknown":
    case "enum":
    default:
      return undefined;
  }
}

export function flattenSchemaLeaves(
  schema?: NormalizedSchema,
  prefix: string[] = [],
): Array<{ path: string[]; schema: NormalizedSchema }> {
  if (!schema) return [];
  if (schema.kind === "object" && schema.fields) {
    const out: Array<{ path: string[]; schema: NormalizedSchema }> = [];
    for (const [key, child] of Object.entries(schema.fields)) {
      out.push(...flattenSchemaLeaves(child, [...prefix, key]));
    }
    return out;
  }
  return [{ path: prefix, schema }];
}

export function findMissingRequiredFields(
  schema: NormalizedSchema | undefined,
  value: unknown,
  prefix: string[] = [],
): string[] {
  if (!schema) return [];
  if (schema.optional) return [];

  if (schema.kind === "object" && schema.fields) {
    const missing: string[] = [];
    const asObj = value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
    for (const [key, child] of Object.entries(schema.fields)) {
      missing.push(
        ...findMissingRequiredFields(
          child,
          asObj ? asObj[key] : undefined,
          [...prefix, key],
        ),
      );
    }
    return missing;
  }

  const key = prefix.join(".") || "(root)";
  if (value === undefined || value === null) return [key];

  switch (schema.kind) {
    case "string": {
      if (typeof value !== "string") return [key];
      if (value.trim() === "") return [key];
      return [];
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? [] : [key];
    case "boolean":
      return typeof value === "boolean" ? [] : [key];
    case "enum":
      return value === "" ? [key] : [];
    case "array":
      return Array.isArray(value) && value.length > 0 ? [] : [key];
    case "unknown":
      return [];
    default:
      return [];
  }
}

export function extractInitFromTraces(
  traces?: TraceEvent[],
): unknown | undefined {
  if (!Array.isArray(traces)) return undefined;
  for (const event of traces) {
    if (event?.type === "run.start" && "input" in event) {
      const input = (event as { input?: unknown }).input;
      if (input !== undefined) return input;
    }
  }
  return undefined;
}

export function renderMarkdown(text: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(
    /\n/g,
    "<br />",
  );
}

export function findHandledErrors(traces: TraceEvent[]): Map<string, string> {
  const handled = new Map<string, string>();
  for (const trace of traces) {
    if (!trace || typeof trace !== "object") continue;
    if (trace.type !== "tool.result") continue;
    const name = typeof (trace as { name?: unknown }).name === "string"
      ? (trace as { name?: string }).name
      : undefined;
    if (name !== "gambit_init") continue;
    const result = (trace as { result?: unknown }).result as
      | Record<string, unknown>
      | undefined;
    if (!result || result.kind !== "error") continue;
    const source = result.source as Record<string, unknown> | undefined;
    const actionName = typeof source?.actionName === "string"
      ? source.actionName
      : undefined;
    const errorObj = result.error as { message?: unknown } | undefined;
    const errorMessage = typeof errorObj?.message === "string"
      ? errorObj.message
      : undefined;
    if (actionName && errorMessage) {
      handled.set(actionName, errorMessage);
    }
  }
  return handled;
}

export function summarizeToolCalls(traces: TraceEvent[]): ToolCallSummary[] {
  const order: ToolCallSummary[] = [];
  const byId = new Map<string, ToolCallSummary>();
  const depthMap = new Map<string, number>();
  for (const trace of traces) {
    if (!trace || typeof trace !== "object") continue;
    const type = typeof trace.type === "string" ? trace.type : "";
    const actionCallId = typeof (trace as { actionCallId?: unknown })
        .actionCallId === "string"
      ? (trace as { actionCallId?: string }).actionCallId
      : undefined;
    const parentActionCallId = typeof (trace as {
        parentActionCallId?: unknown;
      }).parentActionCallId === "string"
      ? (trace as { parentActionCallId?: string }).parentActionCallId
      : undefined;
    if (
      (type === "deck.start" || type === "action.start") && actionCallId
    ) {
      const parentDepth = parentActionCallId && depthMap.has(parentActionCallId)
        ? depthMap.get(parentActionCallId)!
        : -1;
      depthMap.set(actionCallId, parentDepth + 1);
      continue;
    }
    if (!type.startsWith("tool.") || !actionCallId) continue;
    let summary = byId.get(actionCallId);
    if (!summary) {
      summary = {
        id: actionCallId,
        name: typeof trace.name === "string" ? trace.name : undefined,
        status: "pending",
      };
      byId.set(actionCallId, summary);
      order.push(summary);
    }
    if (typeof trace.name === "string") summary.name = trace.name;
    if (type === "tool.call") {
      if ("args" in trace) {
        summary.args = (trace as { args?: unknown }).args;
      }
      summary.status = "running";
      summary.parentActionCallId = parentActionCallId;
      const parentDepth = parentActionCallId && depthMap.has(parentActionCallId)
        ? depthMap.get(parentActionCallId)!
        : -1;
      const nextDepth = parentDepth + 1;
      summary.depth = summary.depth ?? nextDepth;
      depthMap.set(actionCallId, nextDepth);
    } else if (type === "tool.result") {
      if ("result" in trace) {
        summary.result = (trace as { result?: unknown }).result;
      }
      summary.status = "completed";
    } else if (type === "tool.error") {
      if ("error" in trace) {
        summary.error = (trace as { error?: unknown }).error;
      }
      summary.status = "error";
    }
  }
  const handled = findHandledErrors(traces);
  order.forEach((summary) => {
    if (!summary.name) return;
    const errorMessage = handled.get(summary.name);
    if (errorMessage) {
      summary.handledError = errorMessage;
    }
  });
  return order;
}

export type RespondInfo = {
  status?: number;
  code?: string;
  message?: string;
  meta?: Record<string, unknown>;
  payload?: unknown;
};

const RESPOND_TOOL_NAME = "gambit_respond";

const stringifyMessageContent = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const safeParseJson = (text: string | null | undefined): unknown => {
  if (typeof text !== "string" || text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const summarizeRespondMessage = (
  message: ModelMessage | null | undefined,
): RespondInfo & { displayText: string } | null => {
  if (!message || message.role !== "tool") return null;
  const name = typeof message.name === "string" ? message.name : undefined;
  if (name !== RESPOND_TOOL_NAME) return null;
  const parsed = safeParseJson(
    typeof message.content === "string" ? message.content : "",
  ) as Record<string, unknown> | undefined;
  const payload = parsed && typeof parsed === "object"
    ? ("payload" in parsed ? (parsed as { payload?: unknown }).payload : parsed)
    : undefined;
  const status = typeof parsed?.status === "number"
    ? parsed.status as number
    : undefined;
  const code = typeof parsed?.code === "string"
    ? parsed.code as string
    : undefined;
  const respondMessage = typeof parsed?.message === "string"
    ? parsed.message as string
    : undefined;
  const meta = parsed && typeof parsed.meta === "object"
    ? parsed.meta as Record<string, unknown>
    : undefined;
  const summary: Record<string, unknown> = {};
  if (status !== undefined) summary.status = status;
  if (code !== undefined) summary.code = code;
  if (respondMessage !== undefined) summary.message = respondMessage;
  if (meta !== undefined) summary.meta = meta;
  summary.payload = payload ?? null;
  return {
    status,
    code,
    message: respondMessage,
    meta,
    payload,
    displayText: JSON.stringify(summary, null, 2),
  };
};

export type ConversationEntry = {
  id?: string;
  message: ModelMessage;
  feedback?: FeedbackEntry;
  respond?: RespondInfo;
};

export function buildConversationEntries(
  state?: SavedState | null,
): ConversationEntry[] {
  if (!state) return [];
  const entries: ConversationEntry[] = [];
  const rawMessages = state.messages ?? [];
  const refs = state.messageRefs ?? [];
  const feedbackByRef = new Map(
    state.feedback?.map((entry) => [entry.messageRefId, entry]) ?? [],
  );
  for (let idx = 0; idx < rawMessages.length; idx++) {
    const msg = rawMessages[idx];
    const ref = refs[idx];
    if (!msg) continue;
    const respondSummary = summarizeRespondMessage(msg);
    if (respondSummary) {
      entries.push({
        id: ref?.id,
        message: {
          role: "assistant",
          content: respondSummary.displayText,
          name: RESPOND_TOOL_NAME,
        },
        feedback: ref ? feedbackByRef.get(ref.id) : undefined,
        respond: {
          status: respondSummary.status,
          code: respondSummary.code,
          message: respondSummary.message,
          meta: respondSummary.meta,
          payload: respondSummary.payload,
        },
      });
      continue;
    }
    if (msg.role !== "assistant" && msg.role !== "user") continue;
    const content = stringifyMessageContent(msg.content).trim();
    if (!content) continue;
    entries.push({
      id: ref?.id,
      message: {
        ...msg,
        content,
      },
      feedback: ref ? feedbackByRef.get(ref.id) : undefined,
    });
  }
  return entries;
}

export function normalizeAppPath(input: string): string {
  const trimmed = input.replace(/\/+$/, "") || "/";
  if (trimmed === "/" || trimmed === "") {
    if (window.location.pathname !== DOCS_PATH) {
      window.history.replaceState({}, "", DOCS_PATH);
    }
    return DOCS_PATH;
  }
  if (trimmed === DOCS_PATH) {
    if (window.location.pathname !== DOCS_PATH) {
      window.history.replaceState({}, "", DOCS_PATH);
    }
    return DOCS_PATH;
  }
  if (trimmed === "/test") {
    if (window.location.pathname !== DEFAULT_TEST_PATH) {
      window.history.replaceState({}, "", DEFAULT_TEST_PATH);
    }
    return DEFAULT_TEST_PATH;
  }
  if (
    trimmed === "/debug" || trimmed === "/simulate" ||
    trimmed === SESSIONS_BASE_PATH
  ) {
    if (window.location.pathname !== DEFAULT_SESSION_PATH) {
      window.history.replaceState({}, "", DEFAULT_SESSION_PATH);
    }
    return DEFAULT_SESSION_PATH;
  }
  if (/^\/sessions\/[^/]+\/(debug|test|grade)$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\/sessions\/[^/]+\/grade/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("/debug/sessions/")) {
    const raw = trimmed.slice("/debug/sessions/".length);
    const decoded = decodeURIComponent(raw);
    const next = `${SESSIONS_BASE_PATH}/${encodeURIComponent(decoded)}/debug`;
    window.history.replaceState({}, "", next);
    return next;
  }
  if (
    trimmed.startsWith("/sessions/") && !trimmed.includes("/debug") &&
    trimmed !== DEFAULT_SESSION_PATH
  ) {
    const remainder = trimmed.slice("/sessions/".length);
    if (remainder && remainder !== "new") {
      const decoded = decodeURIComponent(remainder);
      const next = `${SESSIONS_BASE_PATH}/${encodeURIComponent(decoded)}/debug`;
      window.history.replaceState({}, "", next);
      return next;
    }
  }
  return trimmed || DEFAULT_SESSION_PATH;
}
