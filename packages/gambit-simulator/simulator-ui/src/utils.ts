import {
  buildWorkspacePath,
  parseWorkspaceRoute,
  WORKSPACE_ROUTE_BASE,
} from "../../src/workspace_routes.ts";
import { joinTextParts } from "@bolt-foundry/gambit-core";

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

export type MessageRef = {
  id: string;
  role: string;
  source?: "scenario" | "manual" | "artifact";
};

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
  messages: Array<ModelMessage>;
  messageRefs?: Array<MessageRef>;
  feedback?: Array<FeedbackEntry>;
  traces?: Array<TraceEvent>;
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
  sqlitePath?: string;
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
    evidence?: Array<string>;
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
  workspaceId: string;
  messages: Array<ModelMessage>;
  messageRefs?: Array<MessageRef>;
  feedback?: Array<FeedbackEntry>;
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
  workspaceId: string;
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
  workspaceId?: string;
  // Temporary alias while server payloads migrate fully to workspaceId.
  sessionId?: string;
  error?: string;
  initFill?: {
    requested: Array<string>;
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
    feedbackEligible?: boolean;
    messageSource?: "scenario" | "manual" | "artifact";
    feedback?: FeedbackEntry;
    respondStatus?: number;
    respondCode?: string;
    respondMessage?: string;
    respondPayload?: unknown;
    respondMeta?: Record<string, unknown>;
  }>;
  traces?: Array<TraceEvent>;
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
  maxTurns?: number;
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
  key: string;
  id: string;
  actionCallId?: string;
  runId?: string;
  name?: string;
  status: "pending" | "running" | "completed" | "error";
  args?: unknown;
  result?: unknown;
  error?: unknown;
  handledError?: string;
  parentActionCallId?: string;
  depth?: number;
};

export type BuildDisplayMessage = {
  kind: "message" | "tool" | "reasoning";
  id?: string;
  role?: "user" | "assistant";
  content?: string;
  messageRefId?: string | null;
  feedbackEligible?: boolean;
  feedback?: FeedbackEntry;
  toolCallId?: string;
  toolSummary?: ToolCallSummary;
  reasoningId?: string;
  reasoningType?: string;
  reasoningRaw?: Record<string, unknown>;
};

export const SCORE_VALUES = [-3, -2, -1, 0, 1, 2, 3];

export const WORKSPACES_BASE_PATH = WORKSPACE_ROUTE_BASE;
export const DOCS_PATH = "/docs";
export const DEFAULT_WORKSPACE_BUILD_PATH = buildWorkspacePath("build");
// Legacy alias retained while docs/debug copy still references "debug".
export const DEFAULT_WORKSPACE_DEBUG_PATH = DEFAULT_WORKSPACE_BUILD_PATH;
export const DEFAULT_TEST_PATH = buildWorkspacePath("test");
export const DEFAULT_BUILD_PATH = buildWorkspacePath("build");
export const DEFAULT_GRADE_PATH = buildWorkspacePath("grade");
export const DEFAULT_VERIFY_PATH = buildWorkspacePath("verify");
export const GRADE_PATH_SUFFIX = "/grade";
export const buildGradePath = (workspaceId: string, gradeRunId?: string) =>
  buildWorkspacePath("grade", workspaceId, { runId: gradeRunId });
export const buildTestPath = (workspaceId?: string | null, runId?: string) =>
  buildWorkspacePath("test", workspaceId, { runId });
export const buildVerifyPath = (workspaceId?: string | null) =>
  buildWorkspacePath("verify", workspaceId);
export const DURABLE_STREAM_PREFIX = "/graphql/streams/";
export const WORKSPACE_STREAM_ID = "gambit-workspace";
export const GRADE_STREAM_ID = "gambit-grade";
export const TEST_STREAM_ID = "gambit-test";
export const BUILD_STREAM_ID = "gambit-build";
// Legacy alias used by pre-Isograph simulator UI stream wiring.
export const SIMULATOR_STREAM_ID = WORKSPACE_STREAM_ID;

const gambitGlobals = globalThis as typeof globalThis & {
  __GAMBIT_BUILD_TAB_ENABLED__?: boolean;
  __GAMBIT_BUILD_CHAT_PROVIDER__?: string | null;
  __GAMBIT_VERIFY_TAB_ENABLED__?: boolean;
  __GAMBIT_WORKSPACE_ONBOARDING__?: boolean;
  __GAMBIT_WORKSPACE_ID__?: string | null;
  __GAMBIT_CHAT_ACCORDION_ENABLED__?: boolean;
  __GAMBIT_WORKBENCH_CHAT_TOP_ACTIONS__?: boolean;
  __GAMBIT_DECK_PATH__?: string;
  __GAMBIT_DECK_LABEL__?: string | null;
  __GAMBIT_VERSION__?: string | null;
};

export const buildTabEnabled = Boolean(
  gambitGlobals.__GAMBIT_BUILD_TAB_ENABLED__,
);
export const verifyTabEnabled = Boolean(
  gambitGlobals.__GAMBIT_VERIFY_TAB_ENABLED__,
);
export const workspaceOnboardingEnabled = Boolean(
  gambitGlobals.__GAMBIT_WORKSPACE_ONBOARDING__,
);
export const workspaceIdFromWindow = gambitGlobals.__GAMBIT_WORKSPACE_ID__ ??
  null;
export const chatAccordionEnabled = Boolean(
  gambitGlobals.__GAMBIT_CHAT_ACCORDION_ENABLED__,
);
export const workbenchChatTopActionsEnabled = gambitGlobals
  .__GAMBIT_WORKBENCH_CHAT_TOP_ACTIONS__ === true;
export type BuildChatProvider = "codex-cli" | "claude-code-cli";
export const buildChatProvider = ((() => {
  const raw = gambitGlobals.__GAMBIT_BUILD_CHAT_PROVIDER__;
  return raw === "claude-code-cli" ? "claude-code-cli" : "codex-cli";
})()) satisfies BuildChatProvider;

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

export type BuildBotTraceEvent = {
  type: "buildBotTrace";
  runId?: string;
  event: TraceEvent;
};

export type BuildBotStatusEvent = {
  type: "buildBotStatus";
  run?: TestBotRun;
};

export type BuildBotSocketMessage =
  | BuildBotStreamEvent
  | BuildBotStreamEndEvent
  | BuildBotTraceEvent
  | BuildBotStatusEvent;

export type WorkspaceSocketMessage =
  | BuildBotSocketMessage
  | TestBotSocketMessage
  | CalibrateStreamMessage;

export const deckPath = gambitGlobals.__GAMBIT_DECK_PATH__ ?? "Unknown deck";
const deckLabelFromWindow = gambitGlobals.__GAMBIT_DECK_LABEL__ ?? null;
export const gambitVersion = gambitGlobals.__GAMBIT_VERSION__ ?? null;
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

export const scenarioNameFromValue = (
  value?: string | null,
): string | null => {
  const base = fileNameFromPath(value);
  if (!base) return null;
  const cleaned = base.replace(/\.deck\.(md|ts)$/i, "")
    .replace(/\.(md|ts)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
};

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
): Array<GradingFlag> {
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
    const raw = globalThis.localStorage.getItem(
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
    globalThis.localStorage.setItem(
      `gambit.durable-streams.offset.${streamId}`,
      String(offset),
    );
  } catch {
    // ignore storage failures
  }
}

export function buildDurableStreamUrl(streamId: string, offset: number) {
  const params = new URLSearchParams({ live: "sse", offset: String(offset) });
  const relative = `${DURABLE_STREAM_PREFIX}${
    encodeURIComponent(streamId)
  }?${params.toString()}`;
  try {
    const origin = globalThis.location?.origin ??
      (
        globalThis as {
          window?: { location?: { origin?: string } };
        }
      ).window?.location?.origin ??
      "http://localhost";
    return new URL(relative, origin).toString();
  } catch {
    return relative;
  }
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

export function getWorkspaceIdFromPath(
  pathname?: string,
  basePath = WORKSPACES_BASE_PATH,
): string | null {
  const target = typeof pathname === "string"
    ? pathname
    : globalThis.location.pathname;
  const normalizedTarget = target.replace(/\/+$/, "") || "/";
  const canonical = parseWorkspaceRoute(normalizedTarget);
  if (canonical) return canonical.workspaceId;
  const bases = [basePath, "/debug", "/simulate", ""];
  for (const base of bases) {
    if (typeof base !== "string") continue;
    const normalized = normalizeBasePath(base);
    const prefix = `${normalized}/workspaces/`.replace(/^\/\//, "/");
    if (normalized === "" && !normalizedTarget.startsWith("/workspaces/")) {
      continue;
    }
    if (normalized !== "" && !normalizedTarget.startsWith(prefix)) {
      continue;
    }
    const remainder = normalized === ""
      ? normalizedTarget.slice("/workspaces/".length)
      : normalizedTarget.slice(prefix.length);
    if (remainder.length > 0 && remainder !== "new") {
      return decodeURIComponent(remainder);
    }
  }
  return null;
}

export function getWorkspaceRouteFromPath(pathname?: string) {
  const target = typeof pathname === "string"
    ? pathname
    : globalThis.location.pathname;
  const normalizedTarget = target.replace(/\/+$/, "") || "/";
  return parseWorkspaceRoute(normalizedTarget);
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

export function getGradeWorkspaceIdFromLocation(): string | null {
  const route = getWorkspaceRouteFromPath(globalThis.location.pathname);
  if (!route || route.tab !== "grade") return null;
  return route.workspaceId ?? null;
}

export function getGradeRunIdFromLocation(): string | null {
  const route = getWorkspaceRouteFromPath(globalThis.location.pathname);
  if (!route || route.tab !== "grade") return null;
  return route.gradeRunId ?? null;
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

export function getPathValue(value: unknown, path: Array<string>): unknown {
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
  path: Array<string>,
  nextValue: unknown,
): unknown {
  if (path.length === 0) return nextValue;
  const root = value && typeof value === "object" ? cloneValue(value) : {};
  let cursor = root as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const existing = cursor[segment];
    const next = existing && typeof existing === "object"
      ? cloneValue(existing)
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
  prefix: Array<string> = [],
): Array<{ path: Array<string>; schema: NormalizedSchema }> {
  if (!schema) return [];
  if (schema.kind === "object" && schema.fields) {
    const out: Array<{ path: Array<string>; schema: NormalizedSchema }> = [];
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
  prefix: Array<string> = [],
): Array<string> {
  if (!schema) return [];
  if (schema.optional) return [];

  if (schema.kind === "object" && schema.fields) {
    const missing: Array<string> = [];
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
  traces?: Array<TraceEvent>,
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
  return escaped
    .replace(/`([^`]+?)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br />");
}

export function findHandledErrors(
  traces: Array<TraceEvent>,
): Map<string, string> {
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

export function summarizeToolCalls(
  traces: Array<TraceEvent>,
): Array<ToolCallSummary> {
  const order: Array<ToolCallSummary> = [];
  const byKey = new Map<string, ToolCallSummary>();
  const depthMap = new Map<string, number>();
  const traceCallKey = (trace: TraceEvent, actionCallId: string) =>
    `${typeof trace.runId === "string" ? trace.runId : ""}:${actionCallId}`;
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
    const key = traceCallKey(trace, actionCallId);
    let summary = byKey.get(key);
    if (!summary) {
      summary = {
        key,
        id: actionCallId,
        actionCallId,
        runId: typeof trace.runId === "string" ? trace.runId : undefined,
        name: typeof trace.name === "string" ? trace.name : undefined,
        status: "pending",
      };
      byKey.set(key, summary);
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

export function deriveBuildDisplayMessages(
  messages: Array<{ role: string; content: string }> = [],
  traces?: Array<TraceEvent> | null,
): Array<BuildDisplayMessage> {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const safeTraces = Array.isArray(traces) ? traces : [];
  if (safeTraces.length === 0) {
    return safeMessages.map((msg, idx) => ({
      kind: "message",
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
      reasoningId: `fallback-${idx}`,
    }));
  }

  const entries: Array<BuildDisplayMessage> = [];
  const toolSummaries = new Map<string, ToolCallSummary>();
  const toolEntryIds = new Set<string>();
  const toolDepthMap = new Map<string, number>();
  const reasoningIndexById = new Map<string, number>();
  const assistantIndexById = new Map<string, number>();

  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  };
  const asString = (value: unknown): string =>
    typeof value === "string" ? value : "";
  const scopedId = (scope: string, id: string): string =>
    scope ? `${scope}:${id}` : id;
  const stringifyContent = (value: unknown): string => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  const pushAssistantMessage = (content: string) => {
    const normalized = content.trim();
    if (!normalized) return;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry?.kind !== "message") continue;
      if (entry.role !== "assistant") continue;
      if ((entry.content ?? "").trim() === normalized) return;
      break;
    }
    entries.push({
      kind: "message",
      role: "assistant",
      content: normalized,
    });
  };
  const extractReasoningText = (payload: Record<string, unknown>): string => {
    const payloadType = asString(payload.type);
    if (payloadType === "response.reasoning.delta") {
      return asString(payload.delta);
    }
    if (payloadType === "response.reasoning.done") {
      return asString(payload.text);
    }
    if (payloadType === "response.reasoning_summary_text.delta") {
      return asString(payload.delta);
    }
    if (payloadType === "response.reasoning_summary_text.done") {
      return asString(payload.text);
    }
    if (
      payloadType === "response.reasoning_summary_part.added" ||
      payloadType === "response.reasoning_summary_part.done"
    ) {
      const part = asRecord(payload.part);
      return part ? asString(part.text) : "";
    }
    return "";
  };
  const ensureToolSummary = (input: {
    actionCallId: string;
    name?: string;
    parentActionCallId?: string;
  }): ToolCallSummary => {
    const { actionCallId, name, parentActionCallId } = input;
    let summary = toolSummaries.get(actionCallId);
    if (!summary) {
      summary = {
        key: actionCallId,
        id: actionCallId,
        name,
        status: "pending",
        parentActionCallId,
      };
      toolSummaries.set(actionCallId, summary);
    }
    if (name && !summary.name) summary.name = name;
    if (parentActionCallId) summary.parentActionCallId = parentActionCallId;
    return summary;
  };
  const pushToolEntry = (summary: ToolCallSummary) => {
    if (toolEntryIds.has(summary.id)) return;
    toolEntryIds.add(summary.id);
    entries.push({
      kind: "tool",
      toolCallId: summary.id,
      toolSummary: summary,
    });
  };
  const applyToolEvent = (input: {
    event: Record<string, unknown>;
    type: string;
  }) => {
    const actionCallId = asString(input.event.actionCallId);
    if (!actionCallId) return;
    const name = asString(input.event.name) || undefined;
    const parentActionCallId = asString(input.event.parentActionCallId) ||
      undefined;
    const summary = ensureToolSummary({
      actionCallId,
      name,
      parentActionCallId,
    });
    if (input.type === "tool.call") {
      summary.args = "args" in input.event ? input.event.args : undefined;
      summary.status = "running";
      if (parentActionCallId) {
        const parentDepth = toolDepthMap.has(parentActionCallId)
          ? toolDepthMap.get(parentActionCallId)!
          : -1;
        summary.depth = summary.depth ?? parentDepth + 1;
        toolDepthMap.set(actionCallId, summary.depth);
      }
      pushToolEntry(summary);
      return;
    }
    if (input.type === "tool.result") {
      summary.result = "result" in input.event ? input.event.result : null;
      summary.status = "completed";
      pushToolEntry(summary);
      return;
    }
    if (input.type === "tool.error") {
      summary.error = "error" in input.event ? input.event.error : null;
      summary.status = "error";
      pushToolEntry(summary);
    }
  };
  const upsertReasoning = (input: {
    reasoningId: string;
    text: string;
    raw: Record<string, unknown>;
    mode: "append" | "replace";
  }) => {
    const normalizedText = input.text.trim();
    if (!normalizedText) return;
    const reasoningId = input.reasoningId || "reasoning";
    const existingIndex = reasoningIndexById.get(reasoningId);
    if (existingIndex === undefined) {
      entries.push({
        kind: "reasoning",
        reasoningId,
        reasoningType: asString(input.raw.type) || undefined,
        content: normalizedText,
        reasoningRaw: input.raw,
      });
      reasoningIndexById.set(reasoningId, entries.length - 1);
      return;
    }
    const existing = entries[existingIndex];
    if (!existing || existing.kind !== "reasoning") return;
    const previousText = typeof existing.content === "string"
      ? existing.content
      : "";
    let nextText = previousText;
    if (input.mode === "append") {
      if (!previousText) {
        nextText = normalizedText;
      } else if (!previousText.endsWith(normalizedText)) {
        nextText = `${previousText}${normalizedText}`;
      }
    } else {
      if (previousText === normalizedText) {
        nextText = previousText;
      } else if (!previousText) {
        nextText = normalizedText;
      } else if (normalizedText.startsWith(previousText)) {
        nextText = normalizedText;
      } else if (previousText.startsWith(normalizedText)) {
        nextText = previousText;
      } else if (!previousText.includes(normalizedText)) {
        nextText = `${previousText}\n${normalizedText}`;
      }
    }
    if (nextText === previousText) return;
    entries[existingIndex] = {
      ...existing,
      reasoningType: asString(input.raw.type) || existing.reasoningType,
      content: nextText,
      reasoningRaw: input.raw,
    };
  };
  const upsertAssistantMessage = (
    input: { messageId: string; text: string },
  ) => {
    const text = input.text.trim();
    if (!text) return;
    const messageId = input.messageId || `assistant-${entries.length}`;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (entry?.kind !== "message") continue;
      if (entry.role !== "assistant") continue;
      if ((entry.content ?? "").trim() === text) {
        assistantIndexById.set(messageId, i);
        return;
      }
      break;
    }
    const existingIndex = assistantIndexById.get(messageId);
    if (existingIndex !== undefined) {
      const existing = entries[existingIndex];
      if (existing?.kind === "message" && existing.role === "assistant") {
        entries[existingIndex] = {
          ...existing,
          content: text,
        };
      }
      return;
    }
    entries.push({
      kind: "message",
      role: "assistant",
      content: text,
    });
    assistantIndexById.set(messageId, entries.length - 1);
  };
  const extractAssistantTextFromItem = (
    item: Record<string, unknown>,
  ): string => {
    const itemType = asString(item.type);
    if (itemType === "agent_message") return asString(item.text);
    if (itemType !== "message") return "";
    if (asString(item.role) !== "assistant") return "";
    const content = item.content;
    if (!Array.isArray(content)) return "";
    const textParts = content.map((part) => {
      const partRecord = asRecord(part);
      if (!partRecord) return "";
      return typeof partRecord.text === "string" ? partRecord.text : "";
    }).filter((part) => part.length > 0);
    return joinTextParts(textParts);
  };

  for (const trace of safeTraces) {
    if (!trace || typeof trace !== "object") continue;
    const record = trace as Record<string, unknown>;
    const type = asString(record.type);
    if (type === "message.user") {
      const message = (record as { message?: unknown }).message;
      const msgRecord = asRecord(message);
      entries.push({
        kind: "message",
        role: "user",
        content: stringifyContent(msgRecord?.content),
      });
      continue;
    }
    if (type === "model.result") {
      const message = (record as { message?: unknown }).message;
      const msgRecord = asRecord(message);
      pushAssistantMessage(stringifyContent(msgRecord?.content));
      continue;
    }
    if (
      type === "tool.call" || type === "tool.result" || type === "tool.error"
    ) {
      applyToolEvent({ event: record, type });
      continue;
    }
    if (type !== "model.stream.event") continue;
    const event = (record as { event?: unknown }).event;
    const payloadRecord = asRecord(event);
    const payload = payloadRecord?.type === "codex.event"
      ? asRecord(payloadRecord.payload)
      : payloadRecord;
    if (!payload) continue;
    const payloadType = asString(payload.type);
    if (
      payloadType === "tool.call" || payloadType === "tool.result" ||
      payloadType === "tool.error"
    ) {
      applyToolEvent({ event: payload, type: payloadType });
      continue;
    }
    if (payloadType.startsWith("response.reasoning")) {
      const actionScope = asString(record.actionCallId) ||
        asString(record.runId);
      const baseReasoningId = asString(payload.item_id) || payloadType;
      upsertReasoning({
        reasoningId: scopedId(actionScope, baseReasoningId),
        text: extractReasoningText(payload),
        raw: payload,
        mode: payloadType.endsWith(".delta") ? "append" : "replace",
      });
      continue;
    }
    const item = asRecord(payload.item);
    if (!item) continue;
    const itemType = asString(item.type);
    if (
      itemType === "agent_message" ||
      (itemType === "message" && payloadType === "response.output_item.done")
    ) {
      const text = extractAssistantTextFromItem(item);
      if (!text) continue;
      const outputIndex = typeof payload.output_index === "number"
        ? String(payload.output_index)
        : "";
      const actionScope = asString(record.actionCallId) ||
        asString(record.runId);
      const baseMessageId = asString(item.id) || asString(payload.item_id) ||
        (outputIndex ? `output-${outputIndex}` : "");
      upsertAssistantMessage({
        messageId: scopedId(actionScope, baseMessageId),
        text,
      });
      continue;
    }
    if (itemType.includes(":")) {
      const extensionData = Object.hasOwn(item, "data")
        ? (item as { data?: unknown }).data
        : item;
      const extensionText = (() => {
        try {
          return JSON.stringify(extensionData);
        } catch {
          return String(extensionData);
        }
      })();
      if (!extensionText || extensionText === "{}") continue;
      const outputIndex = typeof payload.output_index === "number"
        ? String(payload.output_index)
        : "";
      const actionScope = asString(record.actionCallId) ||
        asString(record.runId);
      const baseExtensionId = asString(item.id) || asString(payload.item_id) ||
        (outputIndex ? `extension-${outputIndex}` : itemType);
      upsertReasoning({
        reasoningId: scopedId(actionScope, `extension:${baseExtensionId}`),
        text: `${itemType}: ${extensionText}`,
        raw: item,
        mode: "replace",
      });
      continue;
    }
    if (itemType !== "reasoning") continue;
    let text = "";
    const summary = item.summary;
    if (Array.isArray(summary)) {
      text = joinTextParts(summary.map((part) => {
        const partRecord = asRecord(part);
        return partRecord && typeof partRecord.text === "string"
          ? partRecord.text
          : "";
      }));
    } else if (typeof item.text === "string") {
      text = item.text;
    }
    const actionScope = asString(record.actionCallId) || asString(record.runId);
    const baseReasoningId = asString(item.id) || "reasoning";
    upsertReasoning({
      reasoningId: scopedId(actionScope, baseReasoningId),
      text,
      raw: item,
      mode: "replace",
    });
  }

  return entries;
}

export function deriveReasoningByAssistant(
  traces?: Array<TraceEvent> | null,
): Map<number, Array<ReasoningDetail>> {
  const buckets = new Map<number, Array<ReasoningDetail>>();
  if (!Array.isArray(traces) || traces.length === 0) return buckets;
  const pending: Array<ReasoningDetail> = [];
  const pendingById = new Map<string, ReasoningDetail>();
  let assistantIndex = -1;

  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  };
  const asString = (value: unknown): string =>
    typeof value === "string" ? value : "";
  const extractPayload = (value: unknown): Record<string, unknown> | null => {
    const record = asRecord(value);
    if (!record) return null;
    if (record.type === "codex.event") {
      return asRecord(record.payload);
    }
    return record;
  };
  const appendDetail = (input: {
    id?: string;
    text: string;
    event: Record<string, unknown>;
    trace: TraceEvent;
  }) => {
    const chunk = input.text.trim();
    if (!chunk) return;
    const actionCallId = asString(
      (input.trace as { actionCallId?: unknown }).actionCallId,
    ) || undefined;
    const model = asString((input.trace as { model?: unknown }).model) ||
      undefined;
    const key = input.id && input.id.trim().length > 0
      ? input.id
      : `${input.trace.runId ?? ""}:${actionCallId ?? ""}:${pending.length}`;
    let detail = pendingById.get(key);
    if (!detail) {
      detail = {
        text: chunk,
        event: input.event,
        model,
        actionCallId,
      };
      pendingById.set(key, detail);
      pending.push(detail);
      return;
    }
    if (!detail.text.endsWith(chunk)) {
      detail.text += chunk;
    }
    detail.event = input.event;
    if (!detail.model && model) detail.model = model;
    if (!detail.actionCallId && actionCallId) {
      detail.actionCallId = actionCallId;
    }
  };

  for (const trace of traces) {
    if (!trace || typeof trace !== "object") continue;
    if (trace.type === "model.result") {
      const message = (trace as { message?: unknown }).message as
        | ModelMessage
        | undefined;
      if (message?.role === "assistant") {
        assistantIndex += 1;
        if (pending.length > 0) {
          buckets.set(assistantIndex, [...pending]);
          pending.length = 0;
          pendingById.clear();
        }
      }
      continue;
    }
    if (trace.type !== "model.stream.event") continue;
    const payload = extractPayload((trace as { event?: unknown }).event);
    if (!payload) continue;
    const payloadType = asString(payload.type);
    if (payloadType.startsWith("response.reasoning")) {
      let text = "";
      if (payloadType === "response.reasoning.delta") {
        text = asString(payload.delta);
      } else if (payloadType === "response.reasoning.done") {
        text = asString(payload.text);
      } else if (payloadType === "response.reasoning_summary_text.delta") {
        text = asString(payload.delta);
      } else if (payloadType === "response.reasoning_summary_text.done") {
        text = asString(payload.text);
      } else if (
        payloadType === "response.reasoning_summary_part.added" ||
        payloadType === "response.reasoning_summary_part.done"
      ) {
        const part = asRecord(payload.part);
        text = part ? asString(part.text) : "";
      }
      appendDetail({
        id: asString(payload.item_id) || undefined,
        text,
        event: payload,
        trace,
      });
      continue;
    }
    const item = asRecord(payload.item);
    if (!item) continue;
    if (asString(item.type) !== "reasoning") continue;
    const summary = item.summary;
    let text = "";
    if (Array.isArray(summary)) {
      text = joinTextParts(summary.map((part) => {
        const partRecord = asRecord(part);
        return partRecord ? asString(partRecord.text) : "";
      }));
    } else if (typeof summary === "string") {
      text = summary;
    } else if (typeof item.text === "string") {
      text = item.text;
    }
    appendDetail({
      id: asString(item.id) || undefined,
      text,
      event: item,
      trace,
    });
  }

  return buckets;
}

export type RespondInfo = {
  status?: number;
  code?: string;
  message?: string;
  meta?: Record<string, unknown>;
  payload?: unknown;
};

export type ReasoningDetail = {
  text: string;
  event: unknown;
  model?: string;
  actionCallId?: string;
};

// Legacy traces may still include synthetic respond envelopes.
const LEGACY_RESPOND_TOOL_NAME = "gambit_respond";

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
  if (name !== LEGACY_RESPOND_TOOL_NAME) return null;
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
): Array<ConversationEntry> {
  if (!state) return [];
  const entries: Array<ConversationEntry> = [];
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
          name: LEGACY_RESPOND_TOOL_NAME,
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
    if (
      msg.role !== "assistant" && msg.role !== "user" &&
      msg.role !== "system"
    ) continue;
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
    if (globalThis.location.pathname !== DOCS_PATH) {
      globalThis.history.replaceState({}, "", DOCS_PATH);
    }
    return DOCS_PATH;
  }
  if (trimmed === DOCS_PATH) {
    if (globalThis.location.pathname !== DOCS_PATH) {
      globalThis.history.replaceState({}, "", DOCS_PATH);
    }
    return DOCS_PATH;
  }
  if (trimmed === "/test") {
    if (globalThis.location.pathname !== DEFAULT_TEST_PATH) {
      globalThis.history.replaceState({}, "", DEFAULT_TEST_PATH);
    }
    return DEFAULT_TEST_PATH;
  }
  if (trimmed === "/grade") {
    if (globalThis.location.pathname !== DEFAULT_GRADE_PATH) {
      globalThis.history.replaceState({}, "", DEFAULT_GRADE_PATH);
    }
    return DEFAULT_GRADE_PATH;
  }
  if (trimmed === "/verify") {
    if (globalThis.location.pathname !== DEFAULT_VERIFY_PATH) {
      globalThis.history.replaceState({}, "", DEFAULT_VERIFY_PATH);
    }
    return DEFAULT_VERIFY_PATH;
  }
  if (trimmed === "/build") {
    if (globalThis.location.pathname !== DEFAULT_BUILD_PATH) {
      globalThis.history.replaceState({}, "", DEFAULT_BUILD_PATH);
    }
    return DEFAULT_BUILD_PATH;
  }
  if (
    trimmed === "/debug" || trimmed === "/simulate" ||
    trimmed === WORKSPACES_BASE_PATH
  ) {
    if (globalThis.location.pathname !== DEFAULT_WORKSPACE_BUILD_PATH) {
      globalThis.history.replaceState({}, "", DEFAULT_WORKSPACE_BUILD_PATH);
    }
    return DEFAULT_WORKSPACE_BUILD_PATH;
  }
  if (
    /^\/workspaces\/[^/]+\/(build|verify)$/.test(trimmed) ||
    /^\/workspaces\/[^/]+\/(test|grade)(?:\/[^/]+)?$/.test(trimmed)
  ) {
    return trimmed;
  }
  if (trimmed.startsWith("/debug/workspaces/")) {
    const raw = trimmed.slice("/debug/workspaces/".length);
    const decoded = decodeURIComponent(raw);
    const next = `${WORKSPACES_BASE_PATH}/${encodeURIComponent(decoded)}/build`;
    globalThis.history.replaceState({}, "", next);
    return next;
  }
  if (
    trimmed.startsWith("/workspaces/") && !trimmed.includes("/debug") &&
    !trimmed.includes("/test") && !trimmed.includes("/grade") &&
    !trimmed.includes("/build") && !trimmed.includes("/verify") &&
    trimmed !== DEFAULT_WORKSPACE_BUILD_PATH
  ) {
    const remainder = trimmed.slice("/workspaces/".length);
    if (remainder && remainder !== "new") {
      const decoded = decodeURIComponent(remainder);
      const next = `${WORKSPACES_BASE_PATH}/${
        encodeURIComponent(decoded)
      }/build`;
      globalThis.history.replaceState({}, "", next);
      return next;
    }
  }
  return trimmed || DEFAULT_WORKSPACE_BUILD_PATH;
}
