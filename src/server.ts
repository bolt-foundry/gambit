import * as path from "@std/path";
import { copy, ensureDir, existsSync } from "@std/fs";
import { parse } from "@std/jsonc";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import {
  isGambitEndSignal,
  isRunCanceledError,
  runDeck,
} from "@bolt-foundry/gambit-core";
import { sanitizeNumber } from "./test_bot.ts";
import { makeConsoleTracer } from "./trace.ts";
import { defaultSessionRoot } from "./cli_utils.ts";
import { loadDeck } from "@bolt-foundry/gambit-core";
import { createWorkspaceScaffold } from "./workspace.ts";
import {
  assertSafeBuildBotRoot,
  randomId,
  resolveDefaultValue,
} from "./server_helpers.ts";
import type {
  AvailableGraderDeck,
  AvailableTestDeck,
  DeckToolDescription,
  GradingFlag,
  GradingRunRecord,
  NormalizedSchema,
  SchemaDescription,
  SessionMeta,
} from "./server_types.ts";
import { createSessionStore } from "./server_session_store.ts";
import { handleUiRoutes } from "./server_ui_routes.ts";
import {
  resolveWorkspaceIdFromRecord,
  resolveWorkspaceIdFromSearchParams,
  WORKSPACE_ROUTE_BASE,
  WORKSPACE_STATE_SCHEMA_VERSION,
  workspaceSchemaError,
} from "./workspace_routes.ts";
import {
  appendDurableStreamEvent,
  GRAPHQL_STREAMS_PREFIX,
  handleDurableStreamRequest,
} from "./durable_streams.ts";
import { type CheckReport, handleCheckCommand } from "./commands/check.ts";
import { readCodexLoginStatus } from "./codex_preflight.ts";
import { handleGraphqlStreamMultiplexRequest } from "./graphql_stream_multiplex.ts";
import { handleGraphqlSubscriptionStreamRequest } from "./graphql_subscription_stream.ts";
import type { GambitID } from "./gambit_id.ts";
import { asGambitID } from "./gambit_id.ts";
import {
  asGambitWorkspaceRelativePath,
  type GambitWorkspaceRelativePath,
} from "./gambit_path.ts";
import { asGambitISODateTime } from "./gambit_time.ts";
import { gambitYoga } from "./simulator_graphql.ts";
import {
  getSimulatorIsographEnvironment,
  type SimulatorGraphqlOperations,
} from "./server_isograph_environment.ts";
import {
  createServerRedirectResponse,
  getRedirectFromEntrypoint,
} from "./simulator_redirect_handler.ts";
import { AppRoot } from "../simulator-ui/src/AppRoot.tsx";
import { globalStyles } from "../simulator-ui/src/styles.ts";
import {
  isographAppRoutes as simulatorIsographAppRoutes,
  matchRouteWithParams as matchSimulatorRouteWithParams,
} from "../simulator-ui/src/routing.ts";
import type { FeedbackEntry, SavedState } from "@bolt-foundry/gambit-core";
import type {
  CreateResponseRequest,
  CreateResponseResponse,
  JSONValue,
  LoadedDeck,
  ModelMessage,
  ModelProvider,
  ResponseEvent,
  ResponseItem,
  ResponseTextContent,
  ResponseToolChoice,
  ResponseToolDefinition,
  TraceEvent,
} from "@bolt-foundry/gambit-core";
import type { ZodTypeAny } from "zod";

type WorkspaceFileReadRecord = {
  id: GambitID;
  path: GambitWorkspaceRelativePath;
  size: number | null;
  modifiedAt: ReturnType<typeof asGambitISODateTime> | null;
  content: string | null;
};

type ReadWorkspaceFilesArgs = {
  workspaceId: GambitID;
  id?: GambitID | null;
  pathPrefix?: GambitWorkspaceRelativePath | null;
};

type ReadWorkspaceFiles = (
  args: ReadWorkspaceFilesArgs,
) => Promise<Array<WorkspaceFileReadRecord>>;

const GAMBIT_TOOL_RESPOND = "gambit_respond";

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
const simulatorBundleSourceMapPath = path.resolve(
  moduleDir,
  "..",
  "simulator-ui",
  "dist",
  "bundle.js.map",
);
const simulatorFaviconDistPath = path.resolve(
  moduleDir,
  "..",
  "simulator-ui",
  "dist",
  "favicon.ico",
);
const simulatorFaviconSrcPath = path.resolve(
  moduleDir,
  "..",
  "simulator-ui",
  "src",
  "favicon.ico",
);
const gambitVersion = (() => {
  const envVersion = Deno.env.get("GAMBIT_VERSION")?.trim();
  if (envVersion) return envVersion;
  const readVersion = (configPath: string): string | null => {
    try {
      const text = Deno.readTextFileSync(configPath);
      const data = parse(text) as { version?: string };
      const version = typeof data.version === "string"
        ? data.version.trim()
        : "";
      return version || null;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  };
  const candidates = [
    path.resolve(moduleDir, "..", "deno.jsonc"),
    path.resolve(moduleDir, "..", "deno.json"),
  ];
  for (const candidate of candidates) {
    const version = readVersion(candidate);
    if (version) return version;
  }
  return "unknown";
})();
const WORKSPACE_STREAM_ID = "gambit-workspace";
const _GRADE_STREAM_ID = "gambit-grade";
const TEST_STREAM_ID = "gambit-test";
const WORKSPACE_API_BASE = "/api/workspace";
const WORKSPACES_API_BASE = "/api/workspaces";
const VERIFY_BATCH_SIZE_MAX = 24;
const VERIFY_BATCH_CONCURRENCY_MAX = 6;
const WORKSPACE_REFRESH_DEBUG = (() => {
  const value = (Deno.env.get("GAMBIT_WORKSPACE_REFRESH_DEBUG") ?? "")
    .toLowerCase()
    .trim();
  return value === "1" || value === "true" || value === "yes";
})();
const logWorkspaceRefreshDebug = (
  event: string,
  payload: Record<string, unknown>,
): void => {
  if (!WORKSPACE_REFRESH_DEBUG) return;
  logger.info(
    `[gambit-workspace-refresh-debug] ${event} ${JSON.stringify(payload)}`,
  );
};
const extractMissingReadfilePath = (message: string): string | null => {
  const match = message.match(/readfile ['"]([^'"]+)['"]/);
  return match?.[1] ?? null;
};
const DEFAULT_TEST_BOT_SEED_PROMPT =
  "Start the conversation as the user. Do not wait for the assistant to speak first.";
const isWorkspaceEventDomain = (value: unknown): boolean =>
  value === "build" || value === "test" || value === "grade" ||
  value === "session";
const extractPersistedWorkspacePayload = (
  record: Record<string, unknown>,
): Record<string, unknown> => {
  if (!isWorkspaceEventDomain(record.type)) return record;
  const nested = record.data;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    return record;
  }
  return nested as Record<string, unknown>;
};
const _safeJsonStringify = (value: unknown): string => {
  const stack: Array<unknown> = [];
  return JSON.stringify(value, function (_key, candidate) {
    if (!candidate || typeof candidate !== "object") return candidate;
    while (stack.length > 0 && stack[stack.length - 1] !== this) {
      stack.pop();
    }
    if (stack.includes(candidate)) return "[Circular]";
    stack.push(candidate);
    return candidate;
  });
};
const GAMBIT_BOT_SOURCE_DECK_URL = new URL(
  "./decks/gambit-bot/PROMPT.md",
  import.meta.url,
);
const GAMBIT_BOT_SOURCE_DECK_PATH =
  GAMBIT_BOT_SOURCE_DECK_URL.protocol === "file:"
    ? path.fromFileUrl(GAMBIT_BOT_SOURCE_DECK_URL)
    : "";
const GAMBIT_BOT_SOURCE_DIR = GAMBIT_BOT_SOURCE_DECK_URL.protocol === "file:"
  ? path.dirname(path.fromFileUrl(GAMBIT_BOT_SOURCE_DECK_URL))
  : "";
const GAMBIT_BOT_POLICY_DIR = GAMBIT_BOT_SOURCE_DIR
  ? path.join(GAMBIT_BOT_SOURCE_DIR, "policy")
  : "";

async function ensureGambitPolicyInBotRoot(root: string) {
  if (!GAMBIT_BOT_POLICY_DIR) return;
  try {
    const info = await Deno.stat(GAMBIT_BOT_POLICY_DIR);
    if (!info.isDirectory) return;
  } catch {
    return;
  }
  const dest = path.join(root, ".gambit", "policy");
  if (existsSync(dest)) return;
  await ensureDir(path.dirname(dest));
  try {
    await copy(GAMBIT_BOT_POLICY_DIR, dest, { overwrite: false });
  } catch (err) {
    // Concurrent workspace bootstraps can race this copy; if destination exists,
    // treat it as successfully initialized.
    if (!(err instanceof Deno.errors.AlreadyExists)) {
      throw err;
    }
  }
}
async function describeDeckInputSchemaFromPath(
  deckPath: string,
): Promise<SchemaDescription> {
  try {
    const deck = await loadDeck(deckPath);
    const tools = mapDeckTools(deck.actionDecks);
    const desc = describeZodSchema(deck.inputSchema);
    return tools ? { ...desc, tools } : desc;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[sim] failed to load deck schema: ${message}`);
    return { error: message };
  }
}

async function describeDeckGraphqlConfigFromPath(
  deckPath: string,
): Promise<{
  deck?: string;
  startMode?: "assistant" | "user";
  modelParams?: Record<string, unknown>;
  inputSchema?: unknown;
  defaults?: unknown;
  tools?: Array<DeckToolDescription>;
  inputSchemaError?: string;
}> {
  const desc = await describeDeckInputSchemaFromPath(deckPath);
  try {
    const deck = await loadDeck(deckPath);
    const startMode =
      deck.startMode === "assistant" || deck.startMode === "user"
        ? deck.startMode
        : "assistant";
    return {
      deck: deck.path,
      startMode,
      modelParams: deck.modelParams ?? undefined,
      inputSchema: desc.schema,
      defaults: desc.defaults,
      tools: desc.tools,
      inputSchemaError: desc.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      deck: deckPath,
      startMode: "assistant",
      inputSchema: desc.schema,
      defaults: desc.defaults,
      tools: desc.tools,
      inputSchemaError: desc.error ?? message,
    };
  }
}

function mapDeckTools(
  actionDecks?: Array<{
    name?: string;
    label?: string;
    description?: string;
    path?: string;
  }>,
): Array<DeckToolDescription> | undefined {
  if (!Array.isArray(actionDecks) || actionDecks.length === 0) {
    return undefined;
  }
  const described = actionDecks
    .filter((action): action is {
      name: string;
      label?: string;
      description?: string;
      path?: string;
    } => Boolean(action?.name && typeof action.name === "string"))
    .map((action) => ({
      name: action.name,
      label: typeof action.label === "string" ? action.label : undefined,
      description: typeof action.description === "string"
        ? action.description
        : undefined,
      path: action.path,
    }));
  return described.length > 0 ? described : undefined;
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

function _schemaHasField(
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

function _deriveInitialFromSchema(schema?: NormalizedSchema): unknown {
  if (!schema) return undefined;
  if (schema.defaultValue !== undefined) return cloneValue(schema.defaultValue);
  if (schema.example !== undefined) return cloneValue(schema.example);

  switch (schema.kind) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.fields ?? {})) {
        const value = _deriveInitialFromSchema(child);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }
    case "array": {
      if (schema.items) {
        const item = _deriveInitialFromSchema(schema.items);
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

function _getPathValue(value: unknown, path: Array<string>): unknown {
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

function _setPathValue(
  value: unknown,
  path: Array<string>,
  nextValue: unknown,
): unknown {
  if (path.length === 0) return nextValue;
  const root = value && typeof value === "object"
    // this predates the lint rule
    ? cloneValue(value as unknown)
    : {};
  let cursor = root as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const existing = cursor[segment];
    const next = existing && typeof existing === "object"
      // this predates the lint rule
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

function findMissingRequiredFields(
  schema: NormalizedSchema | undefined,
  value: unknown,
  prefix: Array<string> = [],
): Array<string> {
  if (!schema) return [];
  if (schema.optional) return [];

  if (schema.kind === "object" && schema.fields) {
    if (
      value !== undefined && value !== null &&
      (typeof value !== "object" || Array.isArray(value))
    ) {
      return [];
    }
    const asObj = value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
    const missing: Array<string> = [];
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
  if (value === undefined || value === null) {
    return schema.defaultValue !== undefined ? [] : [key];
  }

  if (schema.kind === "string" || schema.kind === "enum") {
    return typeof value === "string" && value.trim() === "" ? [key] : [];
  }
  if (schema.kind === "array") {
    return Array.isArray(value) && value.length === 0 ? [key] : [];
  }
  if (schema.kind === "number") {
    return typeof value === "number" && Number.isFinite(value) ? [] : [key];
  }
  if (schema.kind === "boolean") {
    return typeof value === "boolean" ? [] : [key];
  }
  return [];
}

function getSchemaAtPath(
  schema: NormalizedSchema | undefined,
  path: Array<string>,
): NormalizedSchema | undefined {
  let current = schema;
  for (const segment of path) {
    if (!current || current.kind !== "object" || !current.fields) return;
    current = current.fields[segment];
  }
  return current;
}

function _buildInitFillPrompt(args: {
  missing: Array<string>;
  current: unknown;
  schema: NormalizedSchema | undefined;
}): string {
  const schemaHints = args.missing.map((path) => {
    const segments = path === "(root)" ? [] : path.split(".");
    const leaf = getSchemaAtPath(args.schema, segments);
    return {
      path,
      kind: leaf?.kind,
      description: leaf?.description,
      enumValues: leaf?.enumValues,
    };
  });
  const payload = {
    type: "gambit_test_bot_init_fill",
    missing: args.missing,
    current: args.current ?? null,
    schemaHints,
  };
  return [
    "You are filling missing required init fields for a Gambit Scenario run.",
    "Return ONLY valid JSON that includes values for the missing fields.",
    "Do not include any fields that are not listed as missing.",
    "If the only missing path is '(root)', return the full init JSON value.",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

function unwrapRespondPayload(output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  const record = output as Record<string, unknown>;
  if ("payload" in record) {
    return record.payload;
  }
  return output;
}

function _parseInitFillOutput(
  output: unknown,
): { data?: unknown; error?: string } {
  if (output === null || output === undefined) {
    return { error: "Persona returned empty init fill output." };
  }
  if (typeof output === "object") {
    return { data: unwrapRespondPayload(output) };
  }
  if (typeof output === "string") {
    const text = output.trim();
    if (!text) return { error: "Persona returned empty init fill output." };
    try {
      const parsed = JSON.parse(text);
      return { data: unwrapRespondPayload(parsed) };
    } catch (err) {
      return {
        error: `Persona returned invalid JSON for init fill: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }
  return { error: "Persona returned unsupported init fill output." };
}

function _validateInitInput(schema: ZodTypeAny | undefined, value: unknown) {
  if (!schema) return value;
  if (typeof schema.safeParse !== "function") {
    throw new Error("Init schema missing safeParse");
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues?.[0];
    const message = issue
      ? `${issue.path.join(".") || "(root)"}: ${issue.message}`
      : result.error.message;
    throw new Error(`Schema validation failed: ${message}`);
  }
  return result.data;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parseBodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function toTextPart(
  role: "system" | "user" | "assistant",
  value: unknown,
): { type: "input_text" | "output_text"; text: string } | null {
  if (typeof value === "string") {
    return {
      type: role === "assistant" ? "output_text" : "input_text",
      text: value,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : "";
  if (!text) return null;
  const type = typeof record.type === "string" ? record.type : "";
  if (type === "output_text") return { type: "output_text", text };
  if (type === "input_text") return { type: "input_text", text };
  return {
    type: role === "assistant" ? "output_text" : "input_text",
    text,
  };
}

function normalizeMessageItem(
  item: Record<string, unknown>,
): ResponseItem | null {
  const role = item.role;
  if (role !== "system" && role !== "user" && role !== "assistant") {
    throw new Error("message.role must be system, user, or assistant");
  }
  const rawContent = item.content;
  const content = Array.isArray(rawContent)
    ? rawContent.map((part) => toTextPart(role, part)).filter((
      part,
    ): part is { type: "input_text" | "output_text"; text: string } =>
      Boolean(part)
    )
    : [toTextPart(role, rawContent)].filter((
      part,
    ): part is { type: "input_text" | "output_text"; text: string } =>
      Boolean(part)
    );
  if (content.length === 0) {
    throw new Error("message.content must include text");
  }
  return {
    type: "message",
    role,
    content,
    id: typeof item.id === "string" ? item.id : undefined,
  };
}

function normalizeInputItems(input: unknown): Array<ResponseItem> {
  if (typeof input === "string") {
    return [{
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: input }],
    }];
  }
  const arr = Array.isArray(input) ? input : [input];
  const items: Array<ResponseItem> = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("input items must be objects");
    }
    const item = raw as Record<string, unknown>;
    const type = typeof item.type === "string" ? item.type : "";
    if (type === "message") {
      const normalized = normalizeMessageItem(item);
      if (normalized) items.push(normalized);
      continue;
    }
    if (type === "function_call") {
      const callId = item.call_id;
      const name = item.name;
      const args = item.arguments;
      if (
        typeof callId !== "string" || typeof name !== "string" ||
        typeof args !== "string"
      ) {
        throw new Error(
          "function_call requires call_id, name, and arguments strings",
        );
      }
      items.push({
        type: "function_call",
        call_id: callId,
        name,
        arguments: args,
        id: typeof item.id === "string" ? item.id : undefined,
      });
      continue;
    }
    if (type === "function_call_output") {
      const callId = item.call_id;
      const output = item.output;
      if (typeof callId !== "string" || typeof output !== "string") {
        throw new Error(
          "function_call_output requires call_id and output strings",
        );
      }
      items.push({
        type: "function_call_output",
        call_id: callId,
        output,
        id: typeof item.id === "string" ? item.id : undefined,
      });
      continue;
    }
    if (type.includes(":")) {
      const data = Object.hasOwn(item, "data")
        ? asJsonValue(item.data)
        : Object.entries(item)
          .filter(([key]) => key !== "type" && key !== "id")
          .reduce((acc, [key, value]) => {
            acc[key] = asJsonValue(value);
            return acc;
          }, {} as Record<string, JSONValue>);
      items.push({
        type: type as `${string}:${string}`,
        id: typeof item.id === "string" ? item.id : undefined,
        data,
        // this predates the lint rule
      } as unknown as ResponseItem);
      continue;
    }
    throw new Error(`Unsupported input item type: ${type || "(missing type)"}`);
  }
  return items;
}

function normalizeTools(
  tools: unknown,
): Array<ResponseToolDefinition> | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const out: Array<ResponseToolDefinition> = [];
  for (const raw of tools) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("tools entries must be objects");
    }
    const item = raw as Record<string, unknown>;
    const type = typeof item.type === "string" ? item.type : "";
    if (type !== "function") continue;
    const nested = item.function;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const fn = nested as Record<string, unknown>;
      const name = fn.name;
      if (typeof name !== "string" || !name) {
        throw new Error("tool.function.name is required");
      }
      out.push({
        type: "function",
        function: {
          name,
          description: typeof fn.description === "string"
            ? fn.description
            : undefined,
          parameters: (fn.parameters &&
              typeof fn.parameters === "object" &&
              !Array.isArray(fn.parameters))
            ? fn.parameters as Record<string, JSONValue>
            : {},
        },
      });
      continue;
    }
    const name = item.name;
    if (typeof name !== "string" || !name) {
      throw new Error("tool.name is required");
    }
    out.push({
      type: "function",
      function: {
        name,
        description: typeof item.description === "string"
          ? item.description
          : undefined,
        parameters: (item.parameters &&
            typeof item.parameters === "object" &&
            !Array.isArray(item.parameters))
          ? item.parameters as Record<string, JSONValue>
          : {},
      },
    });
  }
  return out.length ? out : undefined;
}

function normalizeToolChoice(choice: unknown): ResponseToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "none" || choice === "auto" || choice === "required") {
    return choice;
  }
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
    return undefined;
  }
  const record = choice as Record<string, unknown>;
  if (record.type === "allowed_tools" && Array.isArray(record.tools)) {
    const tools = record.tools
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return null;
        }
        const tool = entry as Record<string, unknown>;
        if (tool.type !== "function" || typeof tool.name !== "string") {
          return null;
        }
        return { type: "function", name: tool.name } as const;
      })
      .filter((entry): entry is { type: "function"; name: string } =>
        Boolean(entry)
      );
    if (tools.length === 0) return undefined;
    const mode = record.mode === "none" || record.mode === "auto" ||
        record.mode === "required"
      ? record.mode
      : undefined;
    return { type: "allowed_tools", tools, mode };
  }
  if (record.type !== "function") return undefined;
  if (record.function && typeof record.function === "object") {
    const fn = record.function as Record<string, unknown>;
    if (typeof fn.name === "string" && fn.name.length > 0) {
      return { type: "function", function: { name: fn.name } };
    }
  }
  if (typeof record.name === "string" && record.name.length > 0) {
    return { type: "function", function: { name: record.name } };
  }
  return undefined;
}

function sseFrame(event: unknown): Uint8Array {
  const encoder = new TextEncoder();
  const type = event && typeof event === "object" && !Array.isArray(event) &&
      typeof (event as { type?: unknown }).type === "string"
    ? (event as { type: string }).type
    : null;
  if (type) {
    return encoder.encode(
      `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`,
    );
  }
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function asJsonValue(value: unknown): JSONValue {
  if (
    value === null || typeof value === "string" || typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => asJsonValue(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, JSONValue> = {};
    for (
      const [key, entry] of Object.entries(value as Record<string, unknown>)
    ) {
      out[key] = asJsonValue(entry);
    }
    return out;
  }
  return String(value);
}

function toStrictContentPart(
  part: ResponseTextContent,
): Record<string, unknown> {
  if (part.type === "output_text") {
    return {
      type: "output_text",
      text: part.text,
      annotations: [],
      logprobs: [],
    };
  }
  return {
    type: part.type,
    text: part.text,
  };
}

function toStrictResponseItem(
  item: ResponseItem,
  index: number,
): Record<string, unknown> {
  if (item.type === "message") {
    return {
      type: "message",
      id: item.id ?? `msg_${index + 1}`,
      status: "completed",
      role: item.role,
      content: item.content.map((part) => toStrictContentPart(part)),
    };
  }
  if (item.type === "function_call") {
    return {
      type: "function_call",
      id: item.id ?? item.call_id,
      call_id: item.call_id,
      name: item.name,
      arguments: item.arguments,
      status: "completed",
    };
  }
  if (item.type === "function_call_output") {
    return {
      type: "function_call_output",
      id: item.id ?? `${item.call_id}_out`,
      call_id: item.call_id,
      output: item.output,
      status: "completed",
    };
  }
  if (item.type === "reasoning") {
    return {
      type: "reasoning",
      id: item.id ?? `rs_${index + 1}`,
      content: (item.content ?? []).map((part) => toStrictContentPart(part)),
      summary: item.summary.map((part) => toStrictContentPart(part)),
      encrypted_content: item.encrypted_content ?? null,
    };
  }
  return {
    type: item.type,
    id: item.id ?? `ext_${index + 1}`,
    data: item.data,
    status: "completed",
  };
}

function toStrictTools(
  tools: Array<ResponseToolDefinition> | undefined,
): Array<Record<string, unknown>> {
  if (!tools || tools.length === 0) return [];
  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description ?? null,
    parameters: tool.function.parameters ?? null,
    strict: false,
  }));
}

function toStrictToolChoice(
  choice: CreateResponseRequest["tool_choice"],
): Record<string, unknown> | string {
  if (!choice) return "auto";
  if (choice === "none" || choice === "auto" || choice === "required") {
    return choice;
  }
  if (choice.type === "allowed_tools") {
    return {
      type: "allowed_tools",
      tools: choice.tools,
      mode: choice.mode ?? "auto",
    };
  }
  return { type: "function", name: choice.function.name };
}

function toStrictResponseResource(args: {
  request: CreateResponseRequest;
  response: CreateResponseResponse;
  statusOverride?: "in_progress" | "completed" | "failed";
}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const createdAt = args.response.created_at ?? args.response.created ?? now;
  const status = args.statusOverride ?? args.response.status ?? "completed";
  const usage = args.response.usage
    ? {
      input_tokens: args.response.usage.promptTokens ?? 0,
      output_tokens: args.response.usage.completionTokens ?? 0,
      total_tokens: args.response.usage.totalTokens ?? 0,
      input_tokens_details: {
        cached_tokens: 0,
      },
      output_tokens_details: {
        reasoning_tokens: args.response.usage.reasoningTokens ?? 0,
      },
    }
    : null;

  return {
    id: args.response.id,
    object: "response",
    created_at: createdAt,
    completed_at: status === "completed" ? now : null,
    status,
    incomplete_details: null,
    model: args.response.model ?? args.request.model,
    previous_response_id: args.request.previous_response_id ?? null,
    instructions: args.request.instructions ?? null,
    output: (args.response.output ?? []).map((item, idx) =>
      toStrictResponseItem(item, idx)
    ),
    error: args.response.error ?? null,
    tools: toStrictTools(args.request.tools),
    tool_choice: toStrictToolChoice(args.request.tool_choice),
    truncation: args.response.truncation ?? args.request.truncation ??
      "disabled",
    parallel_tool_calls: args.response.parallel_tool_calls ??
      args.request.parallel_tool_calls ?? false,
    text: args.response.text
      ? asJsonValue(args.response.text)
      : args.request.text
      ? asJsonValue(args.request.text)
      : { format: { type: "text" } },
    top_p: args.response.top_p ?? args.request.top_p ?? 1,
    presence_penalty: args.response.presence_penalty ??
      args.request.presence_penalty ?? 0,
    frequency_penalty: args.response.frequency_penalty ??
      args.request.frequency_penalty ?? 0,
    top_logprobs: args.response.top_logprobs ?? args.request.top_logprobs ?? 0,
    temperature: args.response.temperature ?? args.request.temperature ?? 1,
    reasoning: args.request.reasoning
      ? {
        effort: args.request.reasoning.effort ?? null,
        summary: args.request.reasoning.summary ?? null,
      }
      : null,
    usage,
    max_output_tokens: args.request.max_output_tokens ?? null,
    max_tool_calls: args.request.max_tool_calls ?? null,
    store: args.response.store ?? args.request.store ?? false,
    background: args.response.background ?? args.request.background ?? false,
    service_tier: args.response.service_tier ?? args.request.service_tier ??
      "default",
    metadata: args.request.metadata ? asJsonValue(args.request.metadata) : {},
    safety_identifier: args.response.safety_identifier ??
      args.request.safety_identifier ?? null,
    prompt_cache_key: args.response.prompt_cache_key ??
      args.request.prompt_cache_key ?? null,
  };
}

/**
 * Start the WebSocket simulator server used by the Gambit debug UI.
 */
export function startWebSocketSimulator(opts: {
  deckPath: string;
  modelProvider: ModelProvider;
  model?: string;
  modelForce?: string;
  initialContext?: unknown;
  contextProvided?: boolean;
  port?: number;
  verbose?: boolean;
  signal?: AbortSignal;
  sessionDir?: string;
  workspace?: {
    id: string;
    rootDeckPath: string;
    rootDir: string;
    onboarding?: boolean;
    scaffoldEnabled?: boolean;
    scaffoldRoot?: string;
  };
  autoBundle?: boolean;
  forceBundle?: boolean;
  sourceMap?: boolean;
  bundlePlatform?: "deno" | "browser";
  responsesMode?: boolean;
  workerSandbox?: boolean;
}): ReturnType<typeof Deno.serve> {
  const port = opts.port ?? 8000;
  const initialContext = opts.initialContext;
  const hasInitialContext = opts.contextProvided ??
    (initialContext !== undefined);
  const buildAssistantDeckPath = GAMBIT_BOT_SOURCE_DECK_PATH
    ? resolveDeckPath(GAMBIT_BOT_SOURCE_DECK_PATH)
    : resolveDeckPath(opts.deckPath);
  const consoleTracer = opts.verbose ? makeConsoleTracer() : undefined;
  let resolvedDeckPath = resolveDeckPath(opts.deckPath);
  const buildBotRootCache = new Map<string, string>();
  const deckGraphqlConfigCache = new Map<
    string,
    Awaited<ReturnType<typeof describeDeckGraphqlConfigFromPath>>
  >();
  let availableTestDecks: Array<AvailableTestDeck> = [];
  const testDeckByPath = new Map<string, AvailableTestDeck>();
  const testDeckById = new Map<string, AvailableTestDeck>();
  let availableGraderDecks: Array<AvailableGraderDeck> = [];
  const graderDeckByPath = new Map<string, AvailableGraderDeck>();
  const graderDeckById = new Map<string, AvailableGraderDeck>();
  const summarizeScenarioDeckRegistry = () => ({
    scenarioDeckCount: availableTestDecks.length,
    scenarioDeckPaths: availableTestDecks.slice(0, 12).map((deck) => deck.path),
  });
  const activeWorkspaceId = opts.workspace?.id ?? null;
  const activeWorkspaceOnboarding = Boolean(opts.workspace?.onboarding);
  const workspaceScaffoldEnabled = Boolean(opts.workspace?.scaffoldEnabled);
  const workspaceScaffoldRoot = opts.workspace?.scaffoldRoot
    ? path.resolve(opts.workspace.scaffoldRoot)
    : null;
  const sessionsRoot = (() => {
    const base = opts.sessionDir
      ? path.resolve(opts.sessionDir)
      : defaultSessionRoot(resolvedDeckPath);
    try {
      Deno.mkdirSync(base, { recursive: true });
    } catch (err) {
      logger.warn(
        `[sim] unable to ensure workspace state directory ${base}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
    return base;
  })();
  const workspaceRoot = (() => {
    const dir = workspaceScaffoldRoot ?? sessionsRoot;
    if (workspaceScaffoldEnabled) {
      try {
        Deno.mkdirSync(dir, { recursive: true });
      } catch (err) {
        logger.warn(
          `[sim] unable to ensure workspace directory ${dir}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    return dir;
  })();
  const workspaceById = new Map<
    string,
    { id: string; rootDir: string; rootDeckPath: string; createdAt: string }
  >();
  type WorkspaceFsWatcher = {
    abortController: AbortController;
    pendingPaths: Set<string>;
    pendingKinds: Set<string>;
    debounceTimer: ReturnType<typeof setTimeout> | null;
    task: Promise<void>;
  };
  const workspaceFsWatchers = new Map<string, WorkspaceFsWatcher>();
  const normalizeWorkspaceFsPath = (value: string): string =>
    value.split(/\\|\//g).filter(Boolean).join("/");
  const isInternalWorkspacePath = (value: string): boolean => {
    const normalized = normalizeWorkspaceFsPath(value);
    return normalized === ".gambit" || normalized.startsWith(".gambit/");
  };
  const isWorkspaceGraphRelevantPath = (value: string): boolean => {
    const normalized = normalizeWorkspaceFsPath(value);
    if (normalized.length === 0) return false;
    if (isInternalWorkspacePath(normalized)) return false;
    return true;
  };
  const toWorkspaceRelativePath = (
    rootDir: string,
    absoluteOrRelativePath: string,
  ): string | null => {
    const resolvedRoot = path.resolve(rootDir);
    const resolvedCandidate = path.resolve(absoluteOrRelativePath);
    const relative = normalizeWorkspaceFsPath(
      path.relative(resolvedRoot, resolvedCandidate),
    );
    if (!relative || relative.startsWith("..")) return null;
    return relative;
  };
  const flushWorkspaceFsWatcher = (workspaceId: string) => {
    const watcher = workspaceFsWatchers.get(workspaceId);
    if (!watcher || watcher.pendingPaths.size === 0) return;
    const changedPaths = [...watcher.pendingPaths].sort();
    const kinds = [...watcher.pendingKinds].sort();
    logWorkspaceRefreshDebug("fs.flush", {
      workspaceId,
      kinds,
      paths: changedPaths,
      pathCount: changedPaths.length,
    });
    watcher.pendingPaths.clear();
    watcher.pendingKinds.clear();
    watcher.debounceTimer = null;
    if (opts.verbose) {
      logger.info(
        `[sim] workspace fs change detected workspaceId=${workspaceId} kinds=${
          kinds.join(",")
        } paths=${changedPaths.join(",")}`,
      );
    }
    const reloadAttemptId = randomId("wsrefresh");
    logWorkspaceRefreshDebug("fs.reload.start", {
      workspaceId,
      reloadAttemptId,
      changedPaths,
      kinds,
      resolvedDeckPath,
      ...summarizeScenarioDeckRegistry(),
    });
    // Keep deck-derived registries (scenario/grader decks) in sync with edits.
    // Only emit refresh events after reload succeeds so subscriptions always
    // imply a readable, coherent workspace graph.
    void activateWorkspaceDeck(workspaceId, {
      forceReload: true,
      source: "fs-watcher",
      reloadAttemptId,
    })
      .then(() => {
        logWorkspaceRefreshDebug("fs.reload.success", {
          workspaceId,
          reloadAttemptId,
          changedPaths,
          kinds,
          resolvedDeckPath,
          ...summarizeScenarioDeckRegistry(),
        });
        appendDurableStreamEvent(WORKSPACE_STREAM_ID, {
          type: "workspaceGraphRefresh",
          workspaceId,
          reason: "fs-change",
          paths: changedPaths,
          kinds,
        });
        logWorkspaceRefreshDebug("fs.graphRefresh.emit", {
          workspaceId,
          reloadAttemptId,
          reason: "fs-change",
          pathCount: changedPaths.length,
          kindCount: kinds.length,
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logWorkspaceRefreshDebug("fs.reload.fail", {
          workspaceId,
          reloadAttemptId,
          resolvedDeckPath,
          error: message,
          missingPath: extractMissingReadfilePath(message),
          ...summarizeScenarioDeckRegistry(),
        });
        logger.warn(
          `[sim] workspace deck reload failed after fs change workspaceId=${workspaceId} error=${message}`,
        );
      });
  };
  const stopWorkspaceFsWatcher = (workspaceId: string) => {
    const watcher = workspaceFsWatchers.get(workspaceId);
    if (!watcher) return;
    logWorkspaceRefreshDebug("fs.stop", { workspaceId });
    if (watcher.debounceTimer !== null) {
      clearTimeout(watcher.debounceTimer);
      watcher.debounceTimer = null;
    }
    watcher.abortController.abort();
    workspaceFsWatchers.delete(workspaceId);
  };
  const startWorkspaceFsWatcher = (record: {
    id: string;
    rootDir: string;
  }) => {
    if (workspaceFsWatchers.has(record.id)) return;
    logWorkspaceRefreshDebug("fs.start", {
      workspaceId: record.id,
      rootDir: record.rootDir,
    });
    const abortController = new AbortController();
    const pendingPaths = new Set<string>();
    const pendingKinds = new Set<string>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const watcher = Deno.watchFs(record.rootDir, { recursive: true });
    abortController.signal.addEventListener("abort", () => {
      try {
        watcher.close();
      } catch {
        // ignore close errors while shutting down
      }
    });
    const task = (async () => {
      try {
        for await (const event of watcher) {
          if (abortController.signal.aborted) break;
          const kind = typeof event.kind === "string" ? event.kind : "unknown";
          let sawRelevantPath = false;
          for (const candidatePath of event.paths) {
            const relativePath = toWorkspaceRelativePath(
              record.rootDir,
              candidatePath,
            );
            if (!relativePath || !isWorkspaceGraphRelevantPath(relativePath)) {
              continue;
            }
            pendingPaths.add(relativePath);
            sawRelevantPath = true;
          }
          if (!sawRelevantPath) continue;
          pendingKinds.add(kind);
          if (debounceTimer !== null) continue;
          debounceTimer = setTimeout(() => {
            const existing = workspaceFsWatchers.get(record.id);
            if (!existing) return;
            existing.debounceTimer = null;
            flushWorkspaceFsWatcher(record.id);
          }, 120);
          const existing = workspaceFsWatchers.get(record.id);
          if (existing) {
            existing.debounceTimer = debounceTimer;
          }
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          logger.warn(
            `[sim] workspace fs watcher stopped for ${record.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      } finally {
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
      }
    })();
    workspaceFsWatchers.set(record.id, {
      abortController,
      pendingPaths,
      pendingKinds,
      debounceTimer,
      task,
    });
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
    initFill?: TestBotInitFill;
    id: string;
    status: "idle" | "running" | "completed" | "error" | "canceled";
    workspaceId?: string;
    // Temporary alias while simulator UI migrates off sessionId naming.
    sessionId?: string;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    maxTurns?: number;
    messages: Array<{
      role: string;
      content: string;
      messageRefId?: string;
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
  type TestBotInitFill = {
    requested: Array<string>;
    applied?: unknown;
    provided?: unknown;
    error?: string;
  };
  type TestBotRunEntry = {
    run: TestBotRunStatus;
    state: SavedState | null;
    promise: Promise<void> | null;
    abort: AbortController | null;
  };
  const testBotRuns = new Map<string, TestBotRunEntry>();
  const shouldPersistTestWorkspaceEvent = (
    payload: unknown,
  ): payload is Record<string, unknown> => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return false;
    }
    const type = (payload as { type?: unknown }).type;
    return type === "testBotStatus" || type === "gambit.test.status";
  };
  const broadcastTestBot = (payload: unknown, workspaceId?: string) => {
    if (workspaceId && shouldPersistTestWorkspaceEvent(payload)) {
      const state = readSessionState(workspaceId);
      if (state) {
        appendWorkspaceEnvelope(
          state,
          "test",
          payload,
        );
      }
    }
    appendDurableStreamEvent(WORKSPACE_STREAM_ID, payload);
    appendDurableStreamEvent(TEST_STREAM_ID, payload);
  };
  type BuildBotRunStatus = {
    id: string;
    status: "idle" | "running" | "completed" | "error" | "canceled";
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    messages: TestBotRunStatus["messages"];
    traces?: Array<TraceEvent>;
    toolInserts?: TestBotRunStatus["toolInserts"];
  };
  type BuildBotRunEntry = {
    run: BuildBotRunStatus;
    state: SavedState | null;
    promise: Promise<void> | null;
    abort: AbortController | null;
  };
  const buildBotRuns = new Map<string, BuildBotRunEntry>();

  const registerWorkspace = (record: {
    id: string;
    rootDir: string;
    rootDeckPath: string;
    createdAt: string;
  }) => {
    workspaceById.set(record.id, record);
    startWorkspaceFsWatcher(record);
    return record;
  };

  const resolveWorkspaceRecord = (
    workspaceId?: string | null,
  ):
    | { id: string; rootDir: string; rootDeckPath: string; createdAt: string }
    | null => {
    if (!workspaceId) return null;
    const cached = workspaceById.get(workspaceId);
    if (cached) return cached;
    const state = readSessionState(workspaceId);
    const meta = state?.meta ?? {};
    const deckPath = typeof (meta as { workspaceRootDeckPath?: unknown })
        .workspaceRootDeckPath === "string"
      ? (meta as { workspaceRootDeckPath: string }).workspaceRootDeckPath
      : typeof meta.deck === "string"
      ? meta.deck
      : undefined;
    const rootDir =
      typeof (meta as { workspaceRootDir?: unknown }).workspaceRootDir ===
          "string"
        ? (meta as { workspaceRootDir: string }).workspaceRootDir
        : deckPath
        ? path.dirname(deckPath)
        : undefined;
    if (!deckPath || !rootDir) return null;
    const createdAt =
      typeof (meta as { workspaceCreatedAt?: unknown }).workspaceCreatedAt ===
          "string"
        ? (meta as { workspaceCreatedAt: string }).workspaceCreatedAt
        : typeof meta.sessionCreatedAt === "string"
        ? meta.sessionCreatedAt
        : new Date().toISOString();
    return registerWorkspace({
      id: workspaceId,
      rootDir,
      rootDeckPath: deckPath,
      createdAt,
    });
  };

  const resolveBuildBotRoot = async (
    workspaceId?: string | null,
  ): Promise<string> => {
    const override = Deno.env.get("GAMBIT_SIMULATOR_BUILD_BOT_ROOT")?.trim();
    if (override) {
      const root = await Deno.realPath(override);
      const info = await Deno.stat(root);
      if (!info.isDirectory) {
        throw new Error(`Build bot root is not a directory: ${root}`);
      }
      assertSafeBuildBotRoot(root, GAMBIT_BOT_SOURCE_DIR);
      await ensureGambitPolicyInBotRoot(root);
      return root;
    }
    const cacheKey = workspaceId ?? "default";
    const cached = buildBotRootCache.get(cacheKey);
    if (cached) return cached;
    const record = resolveWorkspaceRecord(workspaceId);
    const candidate = record?.rootDir ?? path.dirname(resolvedDeckPath);
    const root = await Deno.realPath(candidate);
    const info = await Deno.stat(root);
    if (!info.isDirectory) {
      throw new Error(`Build bot root is not a directory: ${root}`);
    }
    assertSafeBuildBotRoot(root, GAMBIT_BOT_SOURCE_DIR);
    await ensureGambitPolicyInBotRoot(root);
    buildBotRootCache.set(cacheKey, root);
    return root;
  };

  const readCodexWorkspaceStatus = async (
    workspaceId?: string | null,
    online?: boolean,
  ): Promise<{
    trustedPath: string;
    writeEnabled: boolean;
    codexLoggedIn: boolean;
    codexLoginStatus: string;
    check?: CheckReport;
  }> => {
    const trustedPath = await resolveBuildBotRoot(workspaceId);
    const record = resolveWorkspaceRecord(workspaceId);
    const deckPath = record?.rootDeckPath ?? resolvedDeckPath;
    const login = await readCodexLoginStatus();
    let check: CheckReport | undefined;
    try {
      check = await handleCheckCommand({
        deckPath,
        checkOnline: Boolean(online),
        openRouterApiKey: Deno.env.get("OPENROUTER_API_KEY")?.trim() ||
          undefined,
        googleApiKey: (Deno.env.get("GOOGLE_API_KEY") ??
          Deno.env.get("GEMINI_API_KEY"))?.trim() || undefined,
        ollamaBaseURL: Deno.env.get("OLLAMA_BASE_URL") ?? undefined,
        json: true,
      });
    } catch {
      // Keep status endpoint resilient even if check cannot run.
      check = undefined;
    }
    return { trustedPath, writeEnabled: true, ...login, check };
  };

  const logWorkspaceBotRoot = async (
    endpoint: string,
    workspaceId?: string | null,
  ): Promise<void> => {
    try {
      const root = await resolveBuildBotRoot(workspaceId);
      logger.info(
        `[sim] ${endpoint}: workspaceId=${
          workspaceId ?? "(none)"
        } botRoot=${root}`,
      );
    } catch (err) {
      logger.warn(
        `[sim] ${endpoint}: workspaceId=${
          workspaceId ?? "(none)"
        } botRoot=<unresolved> ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  if (
    opts.workspace?.id && opts.workspace.rootDir && opts.workspace.rootDeckPath
  ) {
    registerWorkspace({
      id: opts.workspace.id,
      rootDir: opts.workspace.rootDir,
      rootDeckPath: opts.workspace.rootDeckPath,
      createdAt: new Date().toISOString(),
    });
  }

  const resolveBuildBotPath = async (root: string, inputPath: string) => {
    if (!inputPath || typeof inputPath !== "string") {
      throw new Error("path is required");
    }
    const normalizedInput = path.normalize(inputPath);
    const segments = normalizedInput.split(/\\|\//g);
    if (segments.includes("..")) {
      throw new Error("path traversal is not allowed");
    }
    const candidate = path.isAbsolute(normalizedInput)
      ? normalizedInput
      : path.resolve(root, normalizedInput);
    const relativePath = path.relative(root, candidate);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error("path escapes bot root");
    }
    const stat = await Deno.lstat(candidate);
    if (stat.isSymlink) {
      throw new Error("symlinks are not allowed");
    }
    const realCandidate = await Deno.realPath(candidate);
    const realRelative = path.relative(root, realCandidate);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("path escapes bot root");
    }
    return { fullPath: candidate, relativePath, stat };
  };

  const MAX_FILE_PREVIEW_BYTES = 250_000;
  const readPreviewText = (bytes: Uint8Array): string | null => {
    const limit = Math.min(bytes.length, 8192);
    for (let i = 0; i < limit; i += 1) {
      if (bytes[i] === 0) return null;
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      return decoder.decode(bytes);
    } catch {
      return null;
    }
  };

  let deckSlug = deckSlugFromPath(resolvedDeckPath);
  let deckLabel: string | undefined = undefined;
  let rootStartMode: "assistant" | "user" | undefined = undefined;
  const enrichStateWithSession = (state: SavedState): {
    state: SavedState;
    dir?: string;
  } => {
    const meta = { ...(state.meta ?? {}) };
    const now = new Date();
    meta.sessionUpdatedAt = now.toISOString();
    if (typeof meta.sessionId !== "string") {
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      meta.sessionId = `${deckSlug}-${stamp}`;
      meta.sessionCreatedAt = now.toISOString();
    }
    if (typeof meta.workspaceId !== "string") {
      meta.workspaceId = String(meta.sessionId);
    }
    if (typeof meta.workspaceSchemaVersion !== "string") {
      meta.workspaceSchemaVersion = WORKSPACE_STATE_SCHEMA_VERSION;
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
    if (
      typeof meta.sessionEventsPath !== "string" &&
      typeof meta.sessionDir === "string"
    ) {
      meta.sessionEventsPath = path.join(meta.sessionDir, "events.jsonl");
    }
    if (
      typeof meta.sessionBuildStatePath !== "string" &&
      typeof meta.sessionDir === "string"
    ) {
      meta.sessionBuildStatePath = path.join(
        meta.sessionDir,
        "build_state.json",
      );
    }
    const dir = typeof meta.sessionDir === "string"
      ? meta.sessionDir
      : undefined;
    return { state: { ...state, meta }, dir };
  };
  const {
    selectCanonicalScenarioRunSummary,
    appendWorkspaceEnvelope,
    appendSessionEvent,
    appendGradingLog,
    persistSessionState,
    readSessionStateStrict,
    readSessionState,
    readBuildState,
  } = createSessionStore({
    sessionsRoot,
    randomId,
    logger,
    enrichStateWithSession,
    workspaceStateSchemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
    workspaceSchemaError,
  });

  const traceCategory = (type: string): string => {
    switch (type) {
      case "message.user":
      case "model.result":
        return "turn";
      case "tool.call":
      case "tool.result":
        return "tool";
      case "log":
      case "monolog":
        return "status";
      case "run.start":
      case "run.end":
      case "deck.start":
      case "deck.end":
      case "action.start":
      case "action.end":
      case "model.call":
        return "lifecycle";
      default:
        return "trace";
    }
  };
  const buildWorkspaceMeta = (
    record: { id: string; rootDir: string; rootDeckPath: string },
    base?: Record<string, unknown>,
  ): Record<string, unknown> => {
    const createdAt =
      typeof (base as { sessionCreatedAt?: unknown })?.sessionCreatedAt ===
          "string"
        ? (base as { sessionCreatedAt: string }).sessionCreatedAt
        : typeof (base as { workspaceCreatedAt?: unknown })
            ?.workspaceCreatedAt === "string"
        ? (base as { workspaceCreatedAt: string }).workspaceCreatedAt
        : new Date().toISOString();
    return {
      ...(base ?? {}),
      workspaceSchemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
      workspaceId: record.id,
      workspaceRootDeckPath: record.rootDeckPath,
      workspaceRootDir: record.rootDir,
      workspaceCreatedAt: (base as { workspaceCreatedAt?: string } | undefined)
        ?.workspaceCreatedAt ?? createdAt,
      sessionCreatedAt: (base as { sessionCreatedAt?: string } | undefined)
        ?.sessionCreatedAt ?? createdAt,
      deck: record.rootDeckPath,
      deckSlug: deckSlugFromPath(record.rootDeckPath),
      sessionId: record.id,
    };
  };

  const _createWorkspaceSession = async (
    opts?: { onboarding?: boolean },
  ): Promise<{
    id: string;
    rootDir: string;
    rootDeckPath: string;
    createdAt: string;
  }> => {
    const createdAt = new Date().toISOString();
    if (workspaceScaffoldEnabled) {
      const scaffold = await createWorkspaceScaffold({
        baseDir: workspaceRoot,
      });
      const record = registerWorkspace(scaffold);
      persistSessionState({
        runId: record.id,
        messages: [],
        meta: buildWorkspaceMeta(record, {
          sessionCreatedAt: record.createdAt,
          workspaceCreatedAt: record.createdAt,
          workspaceOnboarding: opts?.onboarding ?? false,
        }),
      });
      return record;
    }
    const workspaceId = randomId("workspace");
    const rootDeckPath = resolvedDeckPath;
    const rootDir = path.dirname(rootDeckPath);
    const record = registerWorkspace({
      id: workspaceId,
      rootDir,
      rootDeckPath,
      createdAt,
    });
    persistSessionState({
      runId: record.id,
      messages: [],
      meta: buildWorkspaceMeta(record, {
        sessionCreatedAt: createdAt,
        workspaceCreatedAt: createdAt,
        workspaceOnboarding: opts?.onboarding ?? false,
      }),
    });
    return record;
  };
  const _ensureWorkspaceSession = (
    workspaceId: string,
  ): {
    id: string;
    rootDir: string;
    rootDeckPath: string;
    createdAt: string;
  } => {
    const existingRecord = resolveWorkspaceRecord(workspaceId);
    const createdAt = existingRecord?.createdAt ?? new Date().toISOString();
    const record = existingRecord ??
      registerWorkspace({
        id: workspaceId,
        rootDir: path.dirname(resolvedDeckPath),
        rootDeckPath: resolvedDeckPath,
        createdAt,
      });
    const existingState = readSessionState(workspaceId);
    if (!existingState) {
      persistSessionState({
        runId: workspaceId,
        messages: [],
        meta: buildWorkspaceMeta(record, {
          sessionCreatedAt: createdAt,
          workspaceCreatedAt: createdAt,
          workspaceOnboarding: activeWorkspaceOnboarding,
        }),
      });
    }
    return record;
  };

  if (
    opts.workspace?.id && opts.workspace.rootDir && opts.workspace.rootDeckPath
  ) {
    const existing = readSessionState(opts.workspace.id);
    if (!existing) {
      persistSessionState({
        runId: opts.workspace.id,
        messages: [],
        meta: buildWorkspaceMeta(
          {
            id: opts.workspace.id,
            rootDir: opts.workspace.rootDir,
            rootDeckPath: opts.workspace.rootDeckPath,
          },
          {
            sessionCreatedAt: new Date().toISOString(),
            workspaceCreatedAt: new Date().toISOString(),
            workspaceOnboarding: activeWorkspaceOnboarding,
          },
        ),
      });
    }
  }

  async function activateWorkspaceDeck(
    workspaceId?: string | null,
    options?: {
      forceReload?: boolean;
      source?: string;
      reloadAttemptId?: string;
    },
  ) {
    if (!workspaceId) return;
    const record = resolveWorkspaceRecord(workspaceId);
    if (!record) return;
    const source = options?.source ?? "unspecified";
    const reloadAttemptId = options?.reloadAttemptId ?? null;
    const nextPath = resolveDeckPath(record.rootDeckPath);
    const shouldSwitch = nextPath !== resolvedDeckPath;
    logWorkspaceRefreshDebug("deck.activate.begin", {
      workspaceId,
      source,
      reloadAttemptId,
      forceReload: Boolean(options?.forceReload),
      nextPath,
      resolvedDeckPath,
      ...summarizeScenarioDeckRegistry(),
    });
    if (shouldSwitch) {
      resolvedDeckPath = nextPath;
      buildBotRootCache.delete("default");
    } else if (!options?.forceReload) {
      logWorkspaceRefreshDebug("deck.activate.skip", {
        workspaceId,
        source,
        reloadAttemptId,
        reason: "already-active-and-not-forced",
        resolvedDeckPath,
        ...summarizeScenarioDeckRegistry(),
      });
      return;
    }
    reloadPrimaryDeck();
    const loadedDeck = await deckLoadPromise.catch(() => null);
    logWorkspaceRefreshDebug("deck.activate.done", {
      workspaceId,
      source,
      reloadAttemptId,
      loaded: Boolean(loadedDeck),
      loadedDeckPath: loadedDeck?.path ?? null,
      resolvedDeckPath,
      ...summarizeScenarioDeckRegistry(),
    });
  }
  const _deleteSessionState = (sessionId: string): boolean => {
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

  const _cloneTraces = (traces: Array<TraceEvent>): Array<TraceEvent> => {
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

  const getWorkspaceIdFromQuery = (url: URL): string | undefined =>
    resolveWorkspaceIdFromSearchParams(url.searchParams);

  const _getWorkspaceIdFromBody = (
    body: Record<string, unknown> | null | undefined,
  ): string | undefined => {
    if (!body || typeof body !== "object") return undefined;
    return resolveWorkspaceIdFromRecord(body);
  };

  const findTestRunByWorkspaceId = (
    workspaceId: string,
  ): TestBotRunEntry | undefined => {
    for (const candidate of testBotRuns.values()) {
      if (
        candidate.run.workspaceId === workspaceId ||
        candidate.run.sessionId === workspaceId
      ) {
        return candidate;
      }
    }
    return undefined;
  };

  const _buildWorkspaceReadModel = async (
    workspaceId: string,
    opts?: {
      requestedTestDeckPath?: string | null;
      requestedTestRunId?: string | null;
      requestedGradeRunId?: string | null;
    },
  ) => {
    let state: SavedState | undefined;
    try {
      state = readSessionStateStrict(workspaceId, { withTraces: true });
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
        status: 400,
      } as const;
    }
    if (!state) {
      return {
        error: "Workspace not found",
        status: 404,
      } as const;
    }

    const buildEntry = buildBotRuns.get(workspaceId);
    const buildRun = buildEntry?.run ?? buildRunFromProjection(workspaceId);

    const requestedTestRunId = typeof opts?.requestedTestRunId === "string" &&
        opts.requestedTestRunId.trim().length > 0
      ? opts.requestedTestRunId
      : null;

    const requestedTestEntry = requestedTestRunId
      ? testBotRuns.get(requestedTestRunId)
      : undefined;
    const requestedLiveRun = requestedTestEntry?.run &&
        (requestedTestEntry.run.workspaceId === workspaceId ||
          requestedTestEntry.run.sessionId === workspaceId)
      ? requestedTestEntry.run
      : undefined;
    const persistedRequestedRun = requestedTestRunId
      ? readPersistedTestRunStatusById(state, workspaceId, requestedTestRunId)
      : null;

    const testEntry = requestedLiveRun
      ? undefined
      : findTestRunByWorkspaceId(workspaceId);
    const testRun = requestedLiveRun ?? persistedRequestedRun ??
      testEntry?.run ?? {
      id: "",
      status: "idle" as const,
      messages: [],
      traces: [],
      toolInserts: [],
      workspaceId,
      sessionId: workspaceId,
    };
    if (!requestedLiveRun && !persistedRequestedRun && !testEntry) {
      syncTestBotRunFromState(testRun, state);
      const meta = state.meta && typeof state.meta === "object"
        ? state.meta as Record<string, unknown>
        : null;
      if (meta) {
        const selectedScenarioSummary = selectCanonicalScenarioRunSummary(meta);
        if (selectedScenarioSummary) {
          testRun.id = selectedScenarioSummary.scenarioRunId;
          if (testRun.status === "idle") {
            testRun.status = "completed";
          }
        }
      }
    }
    const feedbackByRef = new Map(
      (state.feedback ?? []).map((entry) => [entry.messageRefId, entry]),
    );
    if (Array.isArray(testRun.messages) && testRun.messages.length > 0) {
      testRun.messages = testRun.messages.map((message) => {
        const refId = typeof message.messageRefId === "string"
          ? message.messageRefId
          : undefined;
        if (!refId) return message;
        const feedback = feedbackByRef.get(refId);
        if (!feedback && !message.feedback) return message;
        if (!feedback) {
          return { ...message, feedback: undefined };
        }
        return { ...message, feedback };
      });
    }

    await deckLoadPromise.catch(() => null);
    const requestedDeck = opts?.requestedTestDeckPath ?? null;
    const testSelection = requestedDeck
      ? resolveTestDeck(requestedDeck)
      : availableTestDecks[0];
    const testSchemaDesc = testSelection
      ? await describeDeckInputSchemaFromPath(testSelection.path)
      : undefined;

    const session = {
      workspaceId,
      messages: state.messages,
      messageRefs: state.messageRefs,
      feedback: state.feedback,
      traces: state.traces,
      notes: state.notes,
      meta: state.meta,
    };

    return {
      workspaceId,
      build: { run: buildRun },
      test: {
        run: testRun,
        botPath: testSelection?.path ?? null,
        botLabel: testSelection?.label ?? null,
        botDescription: testSelection?.description ?? null,
        selectedDeckId: testSelection?.id ?? null,
        inputSchema: testSchemaDesc?.schema ?? null,
        inputSchemaError: testSchemaDesc?.error ?? null,
        defaults: { input: testSchemaDesc?.defaults },
        testDecks: availableTestDecks,
      },
      grade: {
        graderDecks: availableGraderDecks,
        sessions: listSessions(),
      },
      session,
    } as const;
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

  const safeParseJson = (text: string | null | undefined): unknown => {
    if (typeof text !== "string" || text.trim().length === 0) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };

  type RespondSummary = {
    status?: number;
    code?: string;
    message?: string;
    meta?: Record<string, unknown>;
    payload?: unknown;
    displayText: string;
  };

  const summarizeRespondCall = (
    message: ModelMessage | null | undefined,
  ): RespondSummary | null => {
    if (!message || message.role !== "tool") return null;
    const name = typeof message.name === "string" ? message.name : undefined;
    if (name !== GAMBIT_TOOL_RESPOND) return null;
    const parsed = safeParseJson(
      typeof message.content === "string" ? message.content : "",
    ) as Record<string, unknown> | undefined;
    const payload = parsed && typeof parsed === "object"
      ? ("payload" in parsed
        ? (parsed as { payload?: unknown }).payload
        : parsed)
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
  const _resolveGraderDeck = (
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
  const parseDeckMaxTurns = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const rounded = Math.round(value);
    if (rounded < 1) return 1;
    if (rounded > 200) return 200;
    return rounded;
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
      const refId = refs[i]?.id;
      if (msg?.role === "assistant" || msg?.role === "user") {
        const content = stringifyContent(msg.content).trim();
        if (!content) continue;
        messages.push({
          role: msg.role,
          content,
          messageRefId: refId,
          messageSource: refs[i]?.source === "scenario" ||
              refs[i]?.source === "manual" ||
              refs[i]?.source === "artifact"
            ? refs[i].source
            : undefined,
          feedback: refId ? feedbackByRef.get(refId) : undefined,
        });
        continue;
      }
      const respondSummary = summarizeRespondCall(msg);
      if (respondSummary) {
        messages.push({
          role: "assistant",
          content: respondSummary.displayText,
          messageRefId: refId,
          messageSource: refs[i]?.source === "scenario" ||
              refs[i]?.source === "manual" ||
              refs[i]?.source === "artifact"
            ? refs[i].source
            : undefined,
          feedback: refId ? feedbackByRef.get(refId) : undefined,
          respondStatus: respondSummary.status,
          respondCode: respondSummary.code,
          respondMessage: respondSummary.message,
          respondPayload: respondSummary.payload,
          respondMeta: respondSummary.meta,
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

  const _buildScenarioConversationArtifacts = (
    state: SavedState,
  ): {
    messages: Array<ModelMessage>;
    assistantTurns: Array<{
      conversationIndex: number;
      message: ModelMessage;
      messageRefId?: string;
    }>;
  } => {
    const rawMessages = state.messages ?? [];
    const refs = state.messageRefs ?? [];
    const conversation: Array<ModelMessage> = [];
    const assistantTurns: Array<{
      conversationIndex: number;
      message: ModelMessage;
      messageRefId?: string;
    }> = [];
    for (let i = 0; i < rawMessages.length; i++) {
      const msg = rawMessages[i];
      const messageRefId = typeof refs[i]?.id === "string"
        ? refs[i].id
        : undefined;
      if (msg?.role === "assistant" || msg?.role === "user") {
        const content = stringifyContent(msg.content).trim();
        if (!content) continue;
        const nextMessage: ModelMessage = {
          role: msg.role,
          content,
          name: msg.name,
          tool_calls: msg.tool_calls,
        };
        const conversationIndex = conversation.length;
        conversation.push(nextMessage);
        if (nextMessage.role === "assistant") {
          assistantTurns.push({
            conversationIndex,
            message: nextMessage,
            messageRefId,
          });
        }
        continue;
      }
      const respondSummary = summarizeRespondCall(msg);
      if (respondSummary) {
        const nextMessage: ModelMessage = {
          role: "assistant",
          content: respondSummary.displayText,
          name: GAMBIT_TOOL_RESPOND,
        };
        const conversationIndex = conversation.length;
        conversation.push(nextMessage);
        assistantTurns.push({
          conversationIndex,
          message: nextMessage,
          messageRefId,
        });
      }
    }
    return { messages: conversation, assistantTurns };
  };

  const _buildScenarioConversationArtifactsFromRun = (
    run: {
      messages: Array<{
        role: string;
        content: string;
        messageRefId?: string;
      }>;
    },
  ): {
    messages: Array<ModelMessage>;
    assistantTurns: Array<{
      conversationIndex: number;
      message: ModelMessage;
      messageRefId?: string;
    }>;
  } => {
    const conversation: Array<ModelMessage> = [];
    const assistantTurns: Array<{
      conversationIndex: number;
      message: ModelMessage;
      messageRefId?: string;
    }> = [];
    const runMessages = Array.isArray(run.messages) ? run.messages : [];
    for (const msg of runMessages) {
      if (msg?.role !== "assistant" && msg?.role !== "user") continue;
      const content = typeof msg.content === "string" ? msg.content.trim() : "";
      if (!content) continue;
      const nextMessage: ModelMessage = {
        role: msg.role,
        content,
      };
      const conversationIndex = conversation.length;
      conversation.push(nextMessage);
      if (nextMessage.role === "assistant") {
        assistantTurns.push({
          conversationIndex,
          message: nextMessage,
          messageRefId: msg.messageRefId,
        });
      }
    }
    return { messages: conversation, assistantTurns };
  };

  const gradeSchemaHasField = (
    schema: ZodTypeAny | undefined,
    field: string,
  ): boolean => {
    if (!schema) return false;
    let current: ZodTypeAny = schema;
    while (current && typeof current === "object") {
      const def =
        (current as { _def?: { typeName?: string; [k: string]: unknown } })
          ._def;
      const typeName = def?.typeName;
      if (
        typeName === "ZodOptional" || typeName === "ZodNullable" ||
        typeName === "ZodDefault"
      ) {
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
    const def = (current as { _def?: { typeName?: string; shape?: unknown } })
      ._def;
    if (def?.typeName !== "ZodObject") return false;
    const shape = typeof def.shape === "function" ? def.shape() : def.shape;
    return Boolean(shape && typeof shape === "object" && field in shape);
  };

  type WorkspaceVerifyBatchRequestRecordForGraphql = {
    id: string;
    status: "queued" | "running" | "completed" | "error";
    runId?: string;
    error?: string;
  };

  type WorkspaceVerifyBatchRecordForGraphql = {
    id: string;
    workspaceId: string;
    graderId: string;
    scenarioRunId?: string;
    status: "idle" | "running" | "completed" | "error";
    startedAt?: string;
    finishedAt?: string;
    requested: number;
    active: number;
    completed: number;
    failed: number;
    requests: Array<WorkspaceVerifyBatchRequestRecordForGraphql>;
  };

  const normalizeVerifyBatchStatus = (
    value: unknown,
  ): WorkspaceVerifyBatchRecordForGraphql["status"] => {
    if (value === "running") return "running";
    if (value === "completed") return "completed";
    if (value === "error") return "error";
    return "idle";
  };

  const normalizeVerifyBatchRequestStatus = (
    value: unknown,
  ): WorkspaceVerifyBatchRequestRecordForGraphql["status"] => {
    if (value === "running") return "running";
    if (value === "completed") return "completed";
    if (value === "error") return "error";
    return "queued";
  };

  const readWorkspaceVerifyBatchesFromState = (
    state: SavedState,
  ): Array<WorkspaceVerifyBatchRecordForGraphql> => {
    const meta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    if (!Array.isArray(meta.verifyBatches)) return [];
    return meta.verifyBatches.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const batch = entry as Record<string, unknown>;
      if (typeof batch.graderId !== "string" || batch.graderId.trim() === "") {
        return [];
      }
      const requests = Array.isArray(batch.requests)
        ? batch.requests.flatMap((request, requestIndex) => {
          if (!request || typeof request !== "object") return [];
          const requestRecord = request as Record<string, unknown>;
          const requestId = typeof requestRecord.id === "string" &&
              requestRecord.id.trim().length > 0
            ? requestRecord.id
            : `${String(batch.id ?? randomId("vbatch"))}:${requestIndex + 1}`;
          const runId = typeof requestRecord.runId === "string" &&
              requestRecord.runId.trim().length > 0
            ? requestRecord.runId
            : undefined;
          const error = typeof requestRecord.error === "string" &&
              requestRecord.error.trim().length > 0
            ? requestRecord.error
            : undefined;
          return [{
            id: requestId,
            status: normalizeVerifyBatchRequestStatus(requestRecord.status),
            runId,
            error,
          }];
        })
        : [];
      const active = requests.filter((request) => request.status === "running")
        .length;
      const completed = requests.filter((request) =>
        request.status === "completed"
      ).length;
      const failed = requests.filter((request) => request.status === "error")
        .length;
      const requested = Math.max(
        requests.length,
        typeof batch.requested === "number" && Number.isFinite(batch.requested)
          ? Math.max(0, Math.round(batch.requested))
          : 0,
      );
      return [{
        id: typeof batch.id === "string" && batch.id.trim().length > 0
          ? batch.id
          : randomId("vbatch"),
        workspaceId:
          typeof batch.workspaceId === "string" && batch.workspaceId.trim()
            ? batch.workspaceId
            : "",
        graderId: batch.graderId,
        scenarioRunId: typeof batch.scenarioRunId === "string" &&
            batch.scenarioRunId.trim().length > 0
          ? batch.scenarioRunId
          : undefined,
        status: normalizeVerifyBatchStatus(batch.status),
        startedAt:
          typeof batch.startedAt === "string" && batch.startedAt.trim().length >
              0
            ? batch.startedAt
            : undefined,
        finishedAt: typeof batch.finishedAt === "string" &&
            batch.finishedAt.trim().length > 0
          ? batch.finishedAt
          : undefined,
        requested,
        active,
        completed,
        failed,
        requests,
      }];
    });
  };

  const writeWorkspaceVerifyBatchesToState = (
    state: SavedState,
    batches: Array<WorkspaceVerifyBatchRecordForGraphql>,
  ): SavedState => {
    const currentMeta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    return {
      ...state,
      meta: {
        ...currentMeta,
        verifyBatches: batches,
      },
    };
  };

  const upsertWorkspaceVerifyBatchInState = (
    state: SavedState,
    nextBatch: WorkspaceVerifyBatchRecordForGraphql,
  ): SavedState => {
    const existing = readWorkspaceVerifyBatchesFromState(state);
    const nextBatches = [...existing];
    const existingIndex = nextBatches.findIndex((entry) =>
      entry.id === nextBatch.id
    );
    if (existingIndex >= 0) {
      nextBatches[existingIndex] = nextBatch;
    } else {
      nextBatches.unshift(nextBatch);
    }
    return writeWorkspaceVerifyBatchesToState(
      state,
      nextBatches.slice(0, 50),
    );
  };

  const readGradingRunsFromState = (
    state: SavedState,
  ): Array<GradingRunRecord> => {
    const meta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    const fromGradingRuns = Array.isArray(meta.gradingRuns)
      ? meta.gradingRuns
      : null;
    const fromCalibrationRuns = Array.isArray(meta.calibrationRuns)
      ? meta.calibrationRuns
      : null;
    const raw = fromGradingRuns ?? fromCalibrationRuns ?? [];
    return raw.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const run = entry as GradingRunRecord;
      const id = typeof run.id === "string" && run.id.trim().length > 0
        ? run.id
        : randomId("grade");
      if (
        typeof run.graderId !== "string" || typeof run.graderPath !== "string"
      ) {
        return [];
      }
      return [{
        ...run,
        id,
      }];
    });
  };

  const upsertGradingRunInState = (
    state: SavedState,
    nextRun: GradingRunRecord,
  ): SavedState => {
    const runs = readGradingRunsFromState(state);
    const index = runs.findIndex((entry) => entry.id === nextRun.id);
    const nextRuns = [...runs];
    if (index >= 0) {
      nextRuns[index] = nextRun;
    } else {
      nextRuns.unshift(nextRun);
    }
    const currentMeta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    const nextMeta: Record<string, unknown> = {
      ...currentMeta,
      gradingRuns: nextRuns,
    };
    delete nextMeta.calibrationRuns;
    return { ...state, meta: nextMeta };
  };

  const readGradingFlagsFromState = (
    state: SavedState,
  ): Array<GradingFlag> => {
    const meta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    if (!Array.isArray(meta.gradingFlags)) return [];
    return meta.gradingFlags.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const flag = entry as GradingFlag;
      if (typeof flag.refId !== "string" || flag.refId.trim().length === 0) {
        return [];
      }
      return [{
        id: typeof flag.id === "string" && flag.id.trim().length > 0
          ? flag.id
          : randomId("gflag"),
        refId: flag.refId.trim(),
        runId: typeof flag.runId === "string" ? flag.runId : undefined,
        turnIndex: typeof flag.turnIndex === "number"
          ? flag.turnIndex
          : undefined,
        reason: typeof flag.reason === "string" ? flag.reason : undefined,
        createdAt: typeof flag.createdAt === "string" && flag.createdAt
          ? flag.createdAt
          : new Date().toISOString(),
      }];
    });
  };

  const writeGradingFlagsToState = (
    state: SavedState,
    flags: Array<GradingFlag>,
  ): SavedState => {
    const currentMeta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    return {
      ...state,
      meta: {
        ...currentMeta,
        gradingFlags: flags,
      },
    };
  };

  const extractGradeScoreAndReason = (value: unknown): {
    score?: number;
    reason?: string;
  } => {
    if (!value || typeof value !== "object") return {};
    const record = value as Record<string, unknown>;
    const payload = record.payload && typeof record.payload === "object"
      ? record.payload as Record<string, unknown>
      : record;
    const score = typeof payload.score === "number" ? payload.score : undefined;
    const reason = typeof payload.reason === "string"
      ? payload.reason
      : undefined;
    return { score, reason };
  };

  const extractGradeTurnContext = (value: unknown): {
    priorUser?: string;
    gradedAssistant?: string;
  } => {
    if (!value || typeof value !== "object") return {};
    const input = value as Record<string, unknown>;
    const messageToGrade = input.messageToGrade;
    const gradedAssistant = messageToGrade && typeof messageToGrade === "object"
      ? typeof (messageToGrade as { content?: unknown }).content === "string"
        ? (messageToGrade as { content: string }).content
        : undefined
      : undefined;
    const session = input.session;
    const messages = session && typeof session === "object" &&
        Array.isArray((session as { messages?: unknown }).messages)
      ? (session as { messages: Array<{ role?: string; content?: unknown }> })
        .messages
      : [];
    let priorUser: string | undefined;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role !== "user") continue;
      if (typeof message.content === "string" && message.content.trim()) {
        priorUser = message.content;
        break;
      }
    }
    return { priorUser, gradedAssistant };
  };

  const deriveScenarioRunIdFromGradingRun = (
    run: GradingRunRecord,
  ): string | undefined => {
    if (typeof run.scenarioRunId === "string" && run.scenarioRunId.trim()) {
      return run.scenarioRunId.trim();
    }
    if (!run.input || typeof run.input !== "object") return undefined;
    const input = run.input as Record<string, unknown>;
    const session = input.session;
    if (!session || typeof session !== "object") return undefined;
    const meta = (session as { meta?: unknown }).meta;
    if (!meta || typeof meta !== "object") return undefined;
    const scenarioRunId = (meta as { scenarioRunId?: unknown }).scenarioRunId;
    return typeof scenarioRunId === "string" && scenarioRunId.trim().length > 0
      ? scenarioRunId
      : undefined;
  };

  const normalizePersistedTestRunStatus = (
    value: unknown,
    workspaceId: string,
  ): TestBotRunStatus | null => {
    if (!value || typeof value !== "object") return null;
    const raw = value as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!id) return null;
    const rawStatus = raw.status;
    const status = rawStatus === "running" || rawStatus === "completed" ||
        rawStatus === "error" || rawStatus === "canceled"
      ? rawStatus
      : "idle";
    return {
      id,
      status,
      workspaceId: typeof raw.workspaceId === "string"
        ? raw.workspaceId
        : workspaceId,
      sessionId: typeof raw.sessionId === "string"
        ? raw.sessionId
        : workspaceId,
      error: typeof raw.error === "string" ? raw.error : undefined,
      startedAt: typeof raw.startedAt === "string" ? raw.startedAt : undefined,
      finishedAt: typeof raw.finishedAt === "string"
        ? raw.finishedAt
        : undefined,
      maxTurns:
        typeof raw.maxTurns === "number" && Number.isFinite(raw.maxTurns)
          ? raw.maxTurns
          : undefined,
      messages: Array.isArray(raw.messages)
        ? raw.messages as TestBotRunStatus["messages"]
        : [],
      traces: Array.isArray(raw.traces) ? raw.traces as Array<TraceEvent> : [],
      toolInserts: Array.isArray(raw.toolInserts)
        ? raw.toolInserts as TestBotRunStatus["toolInserts"]
        : [],
    };
  };

  const readPersistedTestRunStatusById = (
    sessionState: SavedState,
    workspaceId: string,
    requestedRunId: string,
  ): TestBotRunStatus | null => {
    const eventsPath = typeof sessionState.meta?.sessionEventsPath === "string"
      ? sessionState.meta.sessionEventsPath
      : undefined;
    if (!eventsPath) return null;
    try {
      const text = Deno.readTextFileSync(eventsPath);
      let latest: TestBotRunStatus | null = null;
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== "object") continue;
        const payload = extractPersistedWorkspacePayload(parsed);
        if (
          payload.type !== "testBotStatus" &&
          payload.type !== "gambit.test.status"
        ) continue;
        const normalized = normalizePersistedTestRunStatus(
          payload.run,
          workspaceId,
        );
        if (!normalized || normalized.id !== requestedRunId) continue;
        latest = normalized;
      }
      return latest;
    } catch {
      return null;
    }
  };

  const listPersistedTestRunStatuses = (
    sessionState: SavedState,
    workspaceId: string,
  ): Array<TestBotRunStatus> => {
    const eventsPath = typeof sessionState.meta?.sessionEventsPath === "string"
      ? sessionState.meta.sessionEventsPath
      : undefined;
    if (!eventsPath) return [];
    try {
      const text = Deno.readTextFileSync(eventsPath);
      const latestByRunId = new Map<string, TestBotRunStatus>();
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== "object") continue;
        const payload = extractPersistedWorkspacePayload(parsed);
        if (
          payload.type !== "testBotStatus" &&
          payload.type !== "gambit.test.status"
        ) continue;
        const normalized = normalizePersistedTestRunStatus(
          payload.run,
          workspaceId,
        );
        if (!normalized || !normalized.id) continue;
        latestByRunId.set(normalized.id, normalized);
      }
      return [...latestByRunId.values()];
    } catch {
      return [];
    }
  };

  const listScenarioRunStatusesFromStateMeta = (
    sessionState: SavedState,
    workspaceId: string,
  ): Array<TestBotRunStatus> => {
    const meta = sessionState.meta && typeof sessionState.meta === "object"
      ? sessionState.meta as Record<string, unknown>
      : null;
    if (!meta) return [];

    const runsById = new Map<string, TestBotRunStatus>();
    const upsertPlaceholder = (runId: string, updatedAt?: string) => {
      if (!runId || runsById.has(runId)) return;
      runsById.set(runId, {
        id: runId,
        status: "completed",
        workspaceId,
        sessionId: workspaceId,
        startedAt: updatedAt,
        finishedAt: updatedAt,
        messages: [],
        traces: [],
        toolInserts: [],
      });
    };

    const primaryRunId = typeof meta.scenarioRunId === "string" &&
        meta.scenarioRunId.trim().length > 0
      ? meta.scenarioRunId.trim()
      : typeof meta.testBotRunId === "string" &&
          meta.testBotRunId.trim().length > 0
      ? meta.testBotRunId.trim()
      : null;
    if (primaryRunId) {
      const primary: TestBotRunStatus = {
        id: primaryRunId,
        status: "idle",
        workspaceId,
        sessionId: workspaceId,
        startedAt: typeof meta.startedAt === "string"
          ? meta.startedAt
          : undefined,
        finishedAt: typeof meta.finishedAt === "string"
          ? meta.finishedAt
          : undefined,
        messages: [],
        traces: [],
        toolInserts: [],
      };
      syncTestBotRunFromState(primary, sessionState);
      if (primary.messages.length > 0 && primary.status === "idle") {
        primary.status = "completed";
      }
      runsById.set(primary.id, primary);
    }

    const summaryValues = [
      meta.scenarioRunSummary,
      ...(Array.isArray(meta.scenarioRunSummaries)
        ? meta.scenarioRunSummaries
        : []),
    ];
    for (const value of summaryValues) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const summary = value as Record<string, unknown>;
      const summaryRunId = typeof summary.scenarioRunId === "string" &&
          summary.scenarioRunId.trim().length > 0
        ? summary.scenarioRunId.trim()
        : null;
      if (!summaryRunId) continue;
      const updatedAt = typeof summary.updatedAt === "string"
        ? summary.updatedAt
        : undefined;
      upsertPlaceholder(summaryRunId, updatedAt);
    }

    return [...runsById.values()];
  };

  const resolveMessageByRef = (
    state: SavedState,
    messageRefId: string,
  ): { message?: ModelMessage; ref?: { source?: unknown } } => {
    const refs = Array.isArray(state.messageRefs) ? state.messageRefs : [];
    const messages = Array.isArray(state.messages) ? state.messages : [];
    const idx = refs.findIndex((ref) => ref?.id === messageRefId);
    if (idx < 0) return {};
    return {
      message: messages[idx],
      ref: refs[idx],
    };
  };

  const _isFeedbackEligibleMessageRef = (
    state: SavedState,
    messageRefId: string,
  ): boolean => {
    const { message, ref } = resolveMessageByRef(state, messageRefId);
    if (!message) return false;
    if (message.role === "assistant") return true;
    if (message.role === "user" && ref?.source === "scenario") return true;
    return summarizeRespondCall(message) !== null;
  };

  const _isFeedbackEligiblePersistedTestRunMessageRef = (
    state: SavedState,
    runId: string,
    messageRefId: string,
  ): boolean => {
    const eventsPath = typeof state.meta?.sessionEventsPath === "string"
      ? state.meta.sessionEventsPath
      : undefined;
    if (!eventsPath) return false;
    try {
      const text = Deno.readTextFileSync(eventsPath);
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== "object") continue;
        const payload = extractPersistedWorkspacePayload(parsed);
        if (
          payload.type !== "testBotStatus" &&
          payload.type !== "gambit.test.status"
        ) {
          continue;
        }
        const run = payload.run;
        if (!run || typeof run !== "object") continue;
        const runRecord = run as { id?: unknown; messages?: unknown };
        if (typeof runRecord.id !== "string" || runRecord.id !== runId) {
          continue;
        }
        if (!Array.isArray(runRecord.messages)) continue;
        const found = runRecord.messages.some((entry) => {
          if (!entry || typeof entry !== "object") return false;
          const message = entry as {
            role?: unknown;
            messageRefId?: unknown;
            messageSource?: unknown;
          };
          if (message.messageRefId !== messageRefId) return false;
          if (message.role === "assistant") return true;
          return message.role === "user" &&
            message.messageSource === "scenario";
        });
        if (found) return true;
      }
    } catch {
      return false;
    }
    return false;
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

  const applyUserMessageRefSource = (
    previousState: SavedState | undefined,
    nextState: SavedState,
    source: "scenario" | "manual",
  ): SavedState => {
    if (
      !Array.isArray(nextState.messages) ||
      !Array.isArray(nextState.messageRefs)
    ) {
      return nextState;
    }
    const startIndex = Math.max(0, previousState?.messages?.length ?? 0);
    const nextRefs = [...nextState.messageRefs];
    let changed = false;
    for (let idx = startIndex; idx < nextState.messages.length; idx++) {
      const msg = nextState.messages[idx];
      if (!msg || msg.role !== "user") continue;
      const ref = nextRefs[idx];
      if (!ref || typeof ref.id !== "string") continue;
      if (ref.source === source) continue;
      nextRefs[idx] = { ...ref, source };
      changed = true;
    }
    if (!changed) return nextState;
    return { ...nextState, messageRefs: nextRefs };
  };

  const syncTestBotRunFromState = (
    run: TestBotRunStatus,
    state: SavedState,
  ) => {
    const snapshot = buildTestBotSnapshot(state);
    run.messages = snapshot.messages;
    run.toolInserts = snapshot.toolInserts;
    const workspaceId = typeof state.meta?.workspaceId === "string"
      ? state.meta.workspaceId
      : typeof state.meta?.sessionId === "string"
      ? state.meta.sessionId
      : undefined;
    if (workspaceId) {
      run.workspaceId = workspaceId;
      run.sessionId = workspaceId;
    }
    const initFill =
      (state.meta as { testBotInitFill?: TestBotInitFill } | undefined)
        ?.testBotInitFill;
    if (initFill) run.initFill = initFill;
    run.traces = Array.isArray(state.traces) ? [...state.traces] : undefined;
  };

  const buildRunFromProjection = (workspaceId: string): BuildBotRunStatus => {
    const projection = readBuildState(workspaceId);
    const run = projection?.run;
    if (!run) {
      return {
        id: workspaceId,
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
      };
    }
    return {
      id: run.id || workspaceId,
      status: run.status,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      messages: Array.isArray(run.messages) ? run.messages : [],
      traces: Array.isArray(run.traces) ? run.traces : [],
      toolInserts: Array.isArray(run.toolInserts) ? run.toolInserts : [],
    };
  };

  const readWorkspaceBuildRunForGraphql = (
    workspaceId: string,
  ): BuildBotRunStatus => {
    const active = buildBotRuns.get(workspaceId)?.run;
    if (active) {
      return {
        ...active,
        messages: Array.isArray(active.messages) ? [...active.messages] : [],
        traces: Array.isArray(active.traces) ? [...active.traces] : [],
        toolInserts: Array.isArray(active.toolInserts)
          ? [...active.toolInserts]
          : [],
      };
    }
    return buildRunFromProjection(workspaceId);
  };

  const _startTestBotRun = (runOpts: {
    runId?: string;
    maxTurnsOverride?: number;
    deckInput?: unknown;
    botInput?: unknown;
    initialUserMessage?: string;
    botDeckPath?: string;
    botDeckId?: string;
    botDeckLabel?: string;
    initFill?: TestBotInitFill;
    initFillTrace?: {
      args: Record<string, unknown>;
      result: Record<string, unknown>;
    };
    workspaceId?: string;
    workspaceRecord?: { id: string; rootDir: string; rootDeckPath: string };
    baseMeta?: Record<string, unknown>;
  } = {}): TestBotRunStatus => {
    const botDeckPath = typeof runOpts.botDeckPath === "string"
      ? runOpts.botDeckPath
      : undefined;
    if (!botDeckPath) {
      throw new Error("Missing scenario deck path");
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
    const selectedScenarioDeckId = runOpts.botDeckId ?? testBotName;
    const selectedScenarioDeckLabel = runOpts.botDeckLabel ?? testBotName;
    const runId = typeof runOpts.runId === "string" &&
        runOpts.runId.trim().length > 0
      ? runOpts.runId.trim()
      : randomId("testbot");
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
      state: null,
      promise: null,
      abort: controller,
    };
    testBotRuns.set(runId, entry);
    const run = entry.run;
    if (runOpts.workspaceId) {
      run.workspaceId = runOpts.workspaceId;
      run.sessionId = runOpts.workspaceId;
    }
    const emitTestBot = (payload: unknown) =>
      broadcastTestBot(payload, run.workspaceId ?? runOpts.workspaceId);
    if (runOpts.initFill) run.initFill = runOpts.initFill;
    let savedState: SavedState | undefined = undefined;
    const baseMeta = runOpts.baseMeta ?? {};
    const workspaceMeta = runOpts.workspaceRecord
      ? buildWorkspaceMeta(runOpts.workspaceRecord, baseMeta)
      : baseMeta;
    let lastCount = 0;
    const capturedTraces: Array<TraceEvent> = [];
    if (runOpts.initFillTrace) {
      const actionCallId = randomId("initfill");
      capturedTraces.push(
        {
          type: "tool.call",
          runId,
          actionCallId,
          name: "gambit_test_bot_init_fill",
          args: runOpts.initFillTrace.args as never,
          toolKind: "internal",
        },
        {
          type: "tool.result",
          runId,
          actionCallId,
          name: "gambit_test_bot_init_fill",
          result: runOpts.initFillTrace.result as never,
          toolKind: "internal",
        },
      );
    }

    const setWorkspaceId = (state: SavedState | undefined) => {
      const workspaceId = typeof state?.meta?.workspaceId === "string"
        ? state.meta.workspaceId
        : typeof state?.meta?.sessionId === "string"
        ? state.meta.sessionId
        : undefined;
      if (workspaceId) {
        run.workspaceId = workspaceId;
        run.sessionId = workspaceId;
      }
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
      setWorkspaceId(state);
      run.traces = Array.isArray(state.traces) ? [...state.traces] : undefined;
      if (shouldBroadcast) {
        emitTestBot({ type: "testBotStatus", run });
      }
    };

    const pendingTraceEvents: Array<TraceEvent> = [];
    const flushPendingTraceEvents = (state: SavedState) => {
      if (!pendingTraceEvents.length) return;
      for (const pending of pendingTraceEvents) {
        appendSessionEvent(state, {
          ...pending,
          kind: "trace",
          category: traceCategory(pending.type),
        } as Record<string, unknown>);
      }
      pendingTraceEvents.length = 0;
    };
    const tracer = (event: TraceEvent) => {
      const stamped = event.ts ? event : { ...event, ts: Date.now() };
      capturedTraces.push(stamped);
      consoleTracer?.(stamped);
      if (savedState?.meta?.sessionId) {
        appendSessionEvent(savedState, {
          ...stamped,
          kind: "trace",
          category: traceCategory(stamped.type),
        } as Record<string, unknown>);
      } else {
        pendingTraceEvents.push(stamped);
      }
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
      streamOpts?: {
        onStreamText?: (chunk: string) => void;
        allowEmptyAssistant?: boolean;
      },
    ): Promise<string> => {
      const assistantMessage = getLastAssistantMessage(history)?.trim() || "";
      const seedPrompt = !assistantMessage && streamOpts?.allowEmptyAssistant
        ? DEFAULT_TEST_BOT_SEED_PROMPT
        : undefined;
      if (!assistantMessage && !seedPrompt) return "";
      const result = await runDeckWithFallback({
        path: botDeckPath,
        input: botInput,
        inputProvided: botInput !== undefined,
        modelProvider: opts.modelProvider,
        state: deckBotState,
        allowRootStringInput: true,
        initialUserMessage: assistantMessage || seedPrompt,
        onStateUpdate: (state) => {
          deckBotState = state;
        },
        stream: Boolean(streamOpts?.onStreamText),
        onStreamText: streamOpts?.onStreamText,
        responsesMode: opts.responsesMode,
        workerSandbox: opts.workerSandbox,
        signal: controller.signal,
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
        const effectiveStartMode = rootStartMode ?? "assistant";
        const shouldRunInitial = effectiveStartMode !== "user" ||
          Boolean(initialUserMessage);
        if (!controller.signal.aborted && shouldRunInitial) {
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
            responsesMode: opts.responsesMode,
            workerSandbox: resolveWorkerSandboxForSignalAwareRun({
              workerSandbox: opts.workerSandbox,
              signal: controller.signal,
            }),
            signal: controller.signal,
            onStateUpdate: (state) => {
              const nextStateWithSource = applyUserMessageRefSource(
                savedState,
                state,
                "scenario",
              );
              const nextMeta = {
                ...workspaceMeta,
                ...(nextStateWithSource.meta ?? {}),
                testBot: true,
                testBotRunId: runId,
                testBotConfigPath: botConfigPath,
                testBotName,
                scenarioRunId: runId,
                selectedScenarioDeckId,
                selectedScenarioDeckLabel,
                scenarioConfigPath: botConfigPath,
                ...(run.initFill ? { testBotInitFill: run.initFill } : {}),
                ...(runOpts.workspaceId
                  ? { workspaceId: runOpts.workspaceId }
                  : {}),
              };
              const enriched = persistSessionState({
                ...nextStateWithSource,
                meta: nextMeta,
                traces: capturedTraces,
              });
              savedState = enriched;
              entry.state = enriched;
              flushPendingTraceEvents(enriched);
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
              emitTestBot({
                type: "testBotStream",
                workspaceId: run.workspaceId ?? runOpts.workspaceId,
                runId,
                role: "user",
                chunk,
                turn,
                ts: Date.now(),
              }),
            allowEmptyAssistant: effectiveStartMode === "user" &&
              !getLastAssistantMessage(history),
          });
          emitTestBot({
            type: "testBotStreamEnd",
            workspaceId: run.workspaceId ?? runOpts.workspaceId,
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
            responsesMode: opts.responsesMode,
            workerSandbox: resolveWorkerSandboxForSignalAwareRun({
              workerSandbox: opts.workerSandbox,
              signal: controller.signal,
            }),
            signal: controller.signal,
            onStateUpdate: (state) => {
              const nextStateWithSource = applyUserMessageRefSource(
                savedState,
                state,
                "scenario",
              );
              const nextMeta = {
                ...workspaceMeta,
                ...(nextStateWithSource.meta ?? {}),
                testBot: true,
                testBotRunId: runId,
                testBotConfigPath: botConfigPath,
                testBotName,
                scenarioRunId: runId,
                selectedScenarioDeckId,
                selectedScenarioDeckLabel,
                scenarioConfigPath: botConfigPath,
                ...(run.initFill ? { testBotInitFill: run.initFill } : {}),
                ...(runOpts.workspaceId
                  ? { workspaceId: runOpts.workspaceId }
                  : {}),
              };
              const enriched = persistSessionState({
                ...nextStateWithSource,
                meta: nextMeta,
                traces: capturedTraces,
              });
              savedState = enriched;
              entry.state = enriched;
              flushPendingTraceEvents(enriched);
              appendFromState(enriched);
            },
            onStreamText: (chunk) =>
              emitTestBot({
                type: "testBotStream",
                workspaceId: run.workspaceId ?? runOpts.workspaceId,
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
          emitTestBot({
            type: "testBotStreamEnd",
            workspaceId: run.workspaceId ?? runOpts.workspaceId,
            runId,
            role: "assistant",
            turn,
            ts: Date.now(),
          });
        }
        run.status = controller.signal.aborted ? "canceled" : "completed";
        emitTestBot({ type: "testBotStatus", run });
      } catch (err) {
        if (controller.signal.aborted || isRunCanceledError(err)) {
          run.status = "canceled";
          run.error = undefined;
        } else {
          run.status = "error";
          run.error = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          logger.error(
            `[sim] scenario run failed runId=${runId} workspaceId=${
              run.workspaceId ?? runOpts.workspaceId ?? "unknown"
            } rootDeck=${resolvedDeckPath} scenarioDeck=${botDeckPath} error=${run.error}${
              stack ? `\n${stack}` : ""
            }`,
          );
        }
        emitTestBot({ type: "testBotStatus", run });
      } finally {
        if (savedState?.messages) {
          const snapshot = buildTestBotSnapshot(savedState);
          run.messages = snapshot.messages;
          run.toolInserts = snapshot.toolInserts;
        }
        setWorkspaceId(savedState);
        run.traces = Array.isArray(savedState?.traces)
          ? [...(savedState?.traces ?? [])]
          : undefined;
        if (savedState) {
          entry.state = savedState;
        }
        run.finishedAt = new Date().toISOString();
        entry.abort = null;
        entry.promise = null;
        emitTestBot({ type: "testBotStatus", run });
      }
    };

    entry.promise = loop();
    emitTestBot({ type: "testBotStatus", run });
    return run;
  };

  const _persistFailedInitFill = (args: {
    error: string;
    initFill: TestBotInitFill | undefined;
    botDeckPath: string;
    botDeckId?: string;
    botDeckLabel?: string;
  }): { workspaceId?: string; workspacePath?: string } => {
    const failedRunId = randomId("testbot");
    const testBotName = path.basename(args.botDeckPath).replace(
      /\.deck\.(md|ts)$/i,
      "",
    );
    const selectedScenarioDeckId = args.botDeckId ?? testBotName;
    const selectedScenarioDeckLabel = args.botDeckLabel ?? testBotName;
    const actionCallId = randomId("initfill");
    const traces: Array<TraceEvent> = [
      {
        type: "tool.call",
        runId: failedRunId,
        actionCallId,
        name: "gambit_test_bot_init_fill",
        args: { missing: args.initFill?.requested ?? [] } as never,
        toolKind: "internal",
      },
      {
        type: "tool.result",
        runId: failedRunId,
        actionCallId,
        name: "gambit_test_bot_init_fill",
        result: {
          error: args.error,
          provided: args.initFill?.provided,
        } as never,
        toolKind: "internal",
      },
    ];
    const failedState = persistSessionState({
      runId: failedRunId,
      messages: [],
      traces,
      meta: {
        testBot: true,
        testBotRunId: failedRunId,
        testBotConfigPath: args.botDeckPath,
        testBotName,
        scenarioRunId: failedRunId,
        selectedScenarioDeckId,
        selectedScenarioDeckLabel,
        scenarioConfigPath: args.botDeckPath,
        testBotInitFill: args.initFill,
        testBotInitFillError: args.error,
      },
    });
    const workspaceId = typeof failedState.meta?.workspaceId === "string"
      ? failedState.meta.workspaceId
      : undefined;
    const workspacePath = typeof failedState.meta?.sessionStatePath === "string"
      ? failedState.meta.sessionStatePath
      : undefined;
    if (workspacePath) {
      logger.warn(
        `[sim] init fill failed; workspace state saved to ${workspacePath}`,
      );
    }
    return { workspaceId, workspacePath };
  };

  const resolvePreferredDeckPath = async (
    candidate: string,
  ): Promise<string> => {
    if (path.basename(candidate) === "PROMPT.md") return candidate;
    const promptPath = path.join(path.dirname(candidate), "PROMPT.md");
    try {
      const stat = await Deno.stat(promptPath);
      if (stat.isFile) return promptPath;
    } catch {
      // ignore missing PROMPT.md
    }
    return candidate;
  };

  const createDeckLoadPromise = (): Promise<LoadedDeck | null> =>
    resolvePreferredDeckPath(resolvedDeckPath)
      .then((preferredPath) => {
        resolvedDeckPath = preferredPath;
        return loadDeck(preferredPath);
      })
      .then((deck) => {
        resolvedDeckPath = deck.path;
        buildBotRootCache.clear();
        deckGraphqlConfigCache.clear();
        deckSlug = deckSlugFromPath(resolvedDeckPath);
        rootStartMode = deck.startMode === "assistant" ||
            deck.startMode === "user"
          ? deck.startMode
          : undefined;
        deckLabel = typeof deck.label === "string"
          ? deck.label
          : toDeckLabel(deck.path);
        availableTestDecks = (deck.testDecks ?? []).map((testDeck, index) => {
          const label = testDeck.label && typeof testDeck.label === "string"
            ? testDeck.label
            : toDeckLabel(testDeck.path);
          const id = testDeck.id && typeof testDeck.id === "string"
            ? testDeck.id
            : slugify(`${label || "test-deck"}-${index}`);
          const maxTurns = parseDeckMaxTurns(
            (testDeck as { maxTurns?: unknown }).maxTurns,
          );
          return {
            id,
            label: label || id,
            description: typeof testDeck.description === "string"
              ? testDeck.description
              : undefined,
            path: testDeck.path,
            ...(maxTurns !== undefined ? { maxTurns } : {}),
          };
        });
        updateTestDeckRegistry(availableTestDecks);
        availableGraderDecks = (deck.graderDecks ?? []).map(
          (graderDeck, index) => {
            const label = graderDeck.label &&
                typeof graderDeck.label === "string"
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
        logWorkspaceRefreshDebug("deck.reload.success", {
          resolvedDeckPath,
          ...summarizeScenarioDeckRegistry(),
          graderDeckCount: availableGraderDecks.length,
        });
        return deck;
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logWorkspaceRefreshDebug("deck.reload.failure", {
          resolvedDeckPath,
          error: message,
          missingPath: extractMissingReadfilePath(message),
          ...summarizeScenarioDeckRegistry(),
          graderDeckCount: availableGraderDecks.length,
        });
        logger.warn(`[sim] failed to load deck: ${message}`);
        // Preserve last-known-good registries on reload failure.
        return null;
      });

  const createSchemaPromise = (
    loadPromise: Promise<LoadedDeck | null>,
  ): Promise<SchemaDescription> =>
    loadPromise
      .then((deck) => {
        if (!deck) {
          return { error: "Deck failed to load" };
        }
        const desc = describeZodSchema(deck.inputSchema);
        const tools = mapDeckTools(deck.actionDecks);
        const next = tools ? { ...desc, tools } : desc;
        if (hasInitialContext) {
          return { ...next, defaults: initialContext };
        }
        return next;
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[sim] failed to load deck schema: ${message}`);
        return { error: message };
      });

  let deckLoadPromise: Promise<LoadedDeck | null> = createDeckLoadPromise();
  let schemaPromise: Promise<SchemaDescription> = createSchemaPromise(
    deckLoadPromise,
  );

  const reloadPrimaryDeck = () => {
    deckLoadPromise = createDeckLoadPromise();
    schemaPromise = createSchemaPromise(deckLoadPromise);
  };
  const readDeckGraphqlConfigCached = async (
    deckPath: string,
  ): Promise<Awaited<ReturnType<typeof describeDeckGraphqlConfigFromPath>>> => {
    const cached = deckGraphqlConfigCache.get(deckPath);
    if (cached) return cached;
    const loaded = await describeDeckGraphqlConfigFromPath(deckPath);
    deckGraphqlConfigCache.set(deckPath, loaded);
    return loaded;
  };

  const wantsSourceMap = Boolean(opts.sourceMap);
  const bundlePlatform = opts.bundlePlatform ?? "deno";
  const autoBundle = opts.autoBundle ?? true;
  const forceBundle = opts.forceBundle ?? false;
  const needsBundle = !hasReactBundle() ||
    (wantsSourceMap && !hasReactBundleSourceMap()) ||
    isReactBundleStale();
  const shouldAutoBundle = autoBundle && moduleLocation.isLocal &&
    (forceBundle || needsBundle);
  if (autoBundle && !moduleLocation.isLocal && opts.verbose) {
    logger.log(
      "[sim] auto-bundle disabled for remote package; using packaged bundle.",
    );
  }
  if (autoBundle && moduleLocation.isLocal && !shouldAutoBundle) {
    logger.log("[sim] auto-bundle enabled; bundle already up to date.");
  }
  if (shouldAutoBundle) {
    logger.log(
      `[sim] auto-bundle enabled; rebuilding simulator UI (${
        forceBundle ? "forced" : "stale"
      })...`,
    );
    logger.log(
      `[sim] bundling simulator UI (${forceBundle ? "forced" : "stale"})...`,
    );
    try {
      const decode = new TextDecoder();
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
        stdout: "piped",
        stderr: "piped",
      });
      const out = p.outputSync();
      if (!out.success) {
        const stderr = decode.decode(out.stderr).trim();
        const stdout = decode.decode(out.stdout).trim();
        const details = stderr || stdout || `exit ${out.code}`;
        throw new Error(
          `simulator UI bundle command failed (exit ${out.code}): ${details}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (forceBundle) {
        throw new Error(`[sim] auto-bundle failed: ${message}`);
      }
      logger.warn(`[sim] auto-bundle failed: ${message}`);
    }
  }

  const ensureWorkspaceStateForBuild = (
    workspaceId: string,
  ): SavedState => {
    const state = readSessionStateStrict(workspaceId, { withTraces: true });
    if (!state) {
      throw new Error("Workspace not found");
    }
    return state;
  };

  const broadcastBuild = (
    workspaceId: string,
    payload: Record<string, unknown>,
  ) => {
    const state = readSessionState(workspaceId);
    if (state) {
      appendWorkspaceEnvelope(state, "build", payload);
    }
    appendDurableStreamEvent(WORKSPACE_STREAM_ID, payload);
  };

  const startWorkspaceBuildRun = (args: {
    workspaceId: string;
    message: string;
  }): BuildBotRunStatus => {
    const workspaceId = args.workspaceId;
    const active = buildBotRuns.get(workspaceId);
    if (active?.run.status === "running") {
      throw new Error("Build run already in progress for this workspace.");
    }

    const state = ensureWorkspaceStateForBuild(workspaceId);
    const projection = readBuildState(workspaceId);
    const seedRun = projection?.run;
    const runId = seedRun?.id && seedRun.id.trim().length > 0
      ? seedRun.id
      : randomId("build");
    const trimmedMessage = args.message.trim();
    const run: BuildBotRunStatus = {
      id: runId,
      status: "running",
      startedAt: new Date().toISOString(),
      error: undefined,
      finishedAt: undefined,
      messages: Array.isArray(seedRun?.messages) ? [...seedRun!.messages] : [],
      traces: Array.isArray(seedRun?.traces) ? [...seedRun!.traces] : [],
      toolInserts: Array.isArray(seedRun?.toolInserts)
        ? [...seedRun!.toolInserts]
        : [],
    };
    if (trimmedMessage.length > 0) {
      run.messages = [
        ...run.messages,
        { role: "user", content: trimmedMessage, messageSource: "manual" },
      ];
    }

    const controller = new AbortController();
    const entry: BuildBotRunEntry = {
      run,
      state,
      promise: null,
      abort: controller,
    };
    buildBotRuns.set(workspaceId, entry);

    const onStateUpdate = (next: SavedState) => {
      const enriched = persistSessionState({
        ...next,
        meta: {
          ...(next.meta ?? {}),
          workspaceId,
        },
      });
      entry.state = enriched;
      const snapshot = buildTestBotSnapshot(enriched);
      run.messages = snapshot.messages;
      run.toolInserts = snapshot.toolInserts;
      const nextTraces = Array.isArray(enriched.traces)
        ? [...enriched.traces]
        : [];
      if (nextTraces.length > 0) {
        run.traces = nextTraces;
      } else if (!Array.isArray(run.traces)) {
        run.traces = [];
      }
      broadcastBuild(workspaceId, {
        type: "buildBotStatus",
        workspaceId,
        run,
      });
    };

    const tracer = (trace: TraceEvent) => {
      const event = trace.ts ? trace : { ...trace, ts: Date.now() };
      const currentTraces = Array.isArray(run.traces) ? run.traces : [];
      run.traces = [...currentTraces, event];
      broadcastBuild(workspaceId, {
        type: "buildBotTrace",
        workspaceId,
        runId,
        event,
      });
    };

    const turn = run.messages.filter((message) => message.role === "user")
      .length;
    let hasStartedAssistantStreamMessage = false;
    entry.promise = (async () => {
      try {
        broadcastBuild(workspaceId, {
          type: "buildBotStatus",
          workspaceId,
          run,
        });
        await runDeck({
          path: buildAssistantDeckPath,
          input: initialContext,
          inputProvided: hasInitialContext,
          modelProvider: opts.modelProvider,
          defaultModel: opts.model,
          modelOverride: opts.modelForce,
          trace: tracer,
          stream: true,
          state: entry.state ?? undefined,
          allowRootStringInput: true,
          initialUserMessage: trimmedMessage.length > 0 ? trimmedMessage : "",
          responsesMode: opts.responsesMode,
          workerSandbox: resolveWorkerSandboxForSignalAwareRun({
            workerSandbox: opts.workerSandbox,
            signal: controller.signal,
          }),
          signal: controller.signal,
          onStateUpdate,
          onStreamText: (chunk) => {
            if (typeof chunk === "string" && chunk.length > 0) {
              if (!hasStartedAssistantStreamMessage) {
                run.messages = [
                  ...run.messages,
                  {
                    role: "assistant",
                    content: chunk,
                  },
                ];
                hasStartedAssistantStreamMessage = true;
              } else {
                const last = run.messages[run.messages.length - 1];
                if (last?.role === "assistant") {
                  last.content += chunk;
                } else {
                  run.messages = [
                    ...run.messages,
                    {
                      role: "assistant",
                      content: chunk,
                    },
                  ];
                }
              }
            }
            broadcastBuild(workspaceId, {
              type: "buildBotStream",
              workspaceId,
              runId,
              role: "assistant",
              chunk,
              turn,
              ts: Date.now(),
            });
          },
        });
        broadcastBuild(workspaceId, {
          type: "buildBotStreamEnd",
          workspaceId,
          runId,
          role: "assistant",
          turn,
          ts: Date.now(),
        });
        run.status = controller.signal.aborted ? "canceled" : "completed";
        run.error = undefined;
      } catch (err) {
        if (controller.signal.aborted || isRunCanceledError(err)) {
          run.status = "canceled";
          run.error = undefined;
        } else {
          run.status = "error";
          run.error = err instanceof Error ? err.message : String(err);
        }
      } finally {
        run.finishedAt = new Date().toISOString();
        entry.abort = null;
        entry.promise = null;
        broadcastBuild(workspaceId, {
          type: "buildBotStatus",
          workspaceId,
          run,
        });
      }
    })();

    return run;
  };

  const stopWorkspaceBuildRun = async (args: {
    workspaceId: string;
    runId: string;
  }): Promise<BuildBotRunStatus> => {
    const active = buildBotRuns.get(args.workspaceId);
    if (!active || active.run.id !== args.runId) {
      return buildRunFromProjection(args.workspaceId);
    }
    active.abort?.abort();
    try {
      await active.promise;
    } catch {
      // Abort path can reject internally; projection is still authoritative.
    }
    return buildRunFromProjection(args.workspaceId);
  };

  const resetWorkspaceBuild = async (
    workspaceId: string,
  ): Promise<BuildBotRunStatus> => {
    const active = buildBotRuns.get(workspaceId);
    active?.abort?.abort();
    try {
      await active?.promise;
    } catch {
      // Ignore aborted in-flight run.
    }

    const state = ensureWorkspaceStateForBuild(workspaceId);
    const reset = persistSessionState({
      ...state,
      messages: [],
      messageRefs: [],
      traces: [],
      items: [],
    });
    const run: BuildBotRunStatus = {
      id: randomId("build"),
      status: "idle",
      messages: [],
      traces: [],
      toolInserts: [],
    };
    appendWorkspaceEnvelope(reset, "build", {
      type: "buildBotStatus",
      workspaceId,
      run,
    });
    appendDurableStreamEvent(WORKSPACE_STREAM_ID, {
      type: "buildBotStatus",
      workspaceId,
      run,
    });
    return buildRunFromProjection(workspaceId);
  };

  const startWorkspaceScenarioRunForGraphql = async (args: {
    workspaceId: string;
    runId?: string;
    scenarioDeckId?: string | null;
    scenarioInput?: unknown;
    assistantInit?: unknown;
  }): Promise<{
    id: string;
    workspaceId: string;
    status: "idle" | "running" | "completed" | "error" | "canceled";
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    messages: Array<{
      role: string;
      content: string;
      messageRefId?: string;
    }>;
    traces?: Array<Record<string, unknown>>;
    toolInserts?: Array<{
      actionCallId?: string;
      parentActionCallId?: string;
      name?: string;
      index: number;
    }>;
  }> => {
    await activateWorkspaceDeck(args.workspaceId, { forceReload: true });
    const workspaceRecord = workspaceById.get(args.workspaceId);
    if (!workspaceRecord) {
      throw new Error("Workspace not found");
    }
    const requestedDeckId = typeof args.scenarioDeckId === "string" &&
        args.scenarioDeckId.trim().length > 0
      ? args.scenarioDeckId.trim()
      : null;
    const fallbackScenarioDeck: AvailableTestDeck = {
      id: "root",
      label: toDeckLabel(resolvedDeckPath),
      description: "Root simulator deck",
      path: resolvedDeckPath,
    };
    const scenarioDeck = requestedDeckId
      ? resolveTestDeck(requestedDeckId) ??
        (requestedDeckId === resolvedDeckPath ? fallbackScenarioDeck : null)
      // No explicit scenario deck means "manual assistant chat" start, which
      // should use the workspace root deck instead of auto-picking a scenario.
      : fallbackScenarioDeck;
    if (requestedDeckId && !scenarioDeck) {
      throw new Error("Unknown scenario deck selection");
    }
    if (!scenarioDeck) {
      throw new Error("No scenario deck configured for this workspace.");
    }
    try {
      const stat = await Deno.stat(scenarioDeck.path);
      if (!stat.isFile) {
        throw new Error(
          `Scenario deck path is not a file: ${scenarioDeck.path}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        `[sim] workspaceScenarioRunStart deck preflight failed workspaceId=${args.workspaceId} deckId=${scenarioDeck.id} deckPath=${scenarioDeck.path} error=${message}`,
      );
      throw new Error(
        `Scenario deck is unavailable (${scenarioDeck.label}): ${message}`,
      );
    }
    const parseOptionalJsonInput = (
      value: unknown,
      label: string,
    ): unknown => {
      if (value === null || value === undefined) return undefined;
      if (typeof value !== "string") return value;
      const text = value.trim();
      if (text.length === 0) return undefined;
      try {
        return JSON.parse(text);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid JSON";
        throw new Error(`${label} must be valid JSON: ${message}`);
      }
    };
    const parsedScenarioInput = parseOptionalJsonInput(
      args.scenarioInput,
      "scenarioInput",
    );
    const parsedAssistantInit = parseOptionalJsonInput(
      args.assistantInit,
      "assistantInit",
    );
    let assistantInit = parsedAssistantInit;
    if (assistantInit === undefined) {
      try {
        const desc = await schemaPromise as {
          defaults?: unknown;
          schema?: NormalizedSchema;
        };
        assistantInit = desc.defaults !== undefined
          ? cloneValue(desc.defaults)
          : _deriveInitialFromSchema(desc.schema);
      } catch {
        // keep assistantInit undefined when schema introspection fails
      }
    }
    if (!requestedDeckId) {
      const startedAt = new Date().toISOString();
      const manualRun: TestBotRunStatus = {
        id: typeof args.runId === "string" && args.runId.trim().length > 0
          ? args.runId.trim()
          : randomId("testbot"),
        status: "idle",
        workspaceId: args.workspaceId,
        sessionId: args.workspaceId,
        startedAt,
        messages: [],
        traces: [],
        toolInserts: [],
      };
      const existing = readSessionState(args.workspaceId);
      const baseMeta = buildWorkspaceMeta(
        workspaceRecord,
        existing?.meta as Record<string, unknown> | undefined,
      );
      const nextMeta = {
        ...baseMeta,
        testBot: true,
        testBotRunId: manualRun.id,
        testBotConfigPath: scenarioDeck.path,
        testBotName: path.basename(scenarioDeck.path).replace(
          /\.deck\.(md|ts)$/i,
          "",
        ),
        scenarioRunId: manualRun.id,
        selectedScenarioDeckId: scenarioDeck.id,
        selectedScenarioDeckLabel: "Manual assistant chat",
        scenarioConfigPath: scenarioDeck.path,
        scenarioRunMode: "manual",
        workspaceId: args.workspaceId,
      };
      const manualState = persistSessionState({
        ...(existing ?? {
          runId: args.workspaceId,
          messages: [],
        }),
        runId: manualRun.id,
        messages: [],
        messageRefs: [],
        traces: [],
        items: [],
        meta: nextMeta,
      });
      testBotRuns.set(manualRun.id, {
        run: manualRun,
        state: manualState,
        promise: null,
        abort: null,
      });
      broadcastTestBot(
        { type: "testBotStatus", run: manualRun },
        args.workspaceId,
      );
      return {
        id: manualRun.id,
        workspaceId: args.workspaceId,
        status: manualRun.status,
        error: manualRun.error,
        startedAt: manualRun.startedAt,
        finishedAt: manualRun.finishedAt,
        messages: [],
        traces: [],
        toolInserts: [],
      };
    }
    const run = _startTestBotRun({
      runId: args.runId,
      workspaceId: args.workspaceId,
      workspaceRecord,
      botDeckPath: scenarioDeck.path,
      botDeckId: scenarioDeck.id,
      botDeckLabel: scenarioDeck.label,
      maxTurnsOverride: scenarioDeck.maxTurns,
      botInput: parsedScenarioInput,
      deckInput: assistantInit,
      baseMeta: {
        scenarioRunMode: "scenario",
      },
    });
    return {
      id: run.id ?? randomId("testbot"),
      workspaceId: args.workspaceId,
      status: run.status,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      messages: Array.isArray(run.messages) ? [...run.messages] : [],
      traces: Array.isArray(run.traces) ? [...run.traces] : [],
      toolInserts: Array.isArray(run.toolInserts) ? [...run.toolInserts] : [],
    };
  };

  const sendWorkspaceScenarioRunForGraphql = async (args: {
    workspaceId: string;
    runId: string;
    message: string;
  }): Promise<{
    id: string;
    workspaceId: string;
    status: "idle" | "running" | "completed" | "error" | "canceled";
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    messages: Array<{
      role: string;
      content: string;
      messageRefId?: string;
    }>;
    traces?: Array<Record<string, unknown>>;
    toolInserts?: Array<{
      actionCallId?: string;
      parentActionCallId?: string;
      name?: string;
      index: number;
    }>;
  }> => {
    await activateWorkspaceDeck(args.workspaceId, { forceReload: true });
    const workspaceRecord = workspaceById.get(args.workspaceId);
    if (!workspaceRecord) {
      throw new Error("Workspace not found");
    }

    const active = testBotRuns.get(args.runId);
    if (
      active &&
      active.run.status === "running" &&
      (active.run.workspaceId === args.workspaceId ||
        active.run.sessionId === args.workspaceId)
    ) {
      throw new Error("Scenario run already in progress.");
    }

    const activeMatchesWorkspace = active
      ? (active.run.workspaceId === args.workspaceId ||
        active.run.sessionId === args.workspaceId)
      : false;
    let state: SavedState | undefined = activeMatchesWorkspace
      ? (active?.state ?? undefined)
      : undefined;
    if (!state) {
      try {
        state = readSessionStateStrict(args.workspaceId, { withTraces: true });
      } catch {
        state = undefined;
      }
    }
    if (!state) {
      throw new Error("Workspace state unavailable for scenario send.");
    }
    const stateMeta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : {};
    const stateRunId = typeof stateMeta.scenarioRunId === "string"
      ? stateMeta.scenarioRunId
      : typeof stateMeta.testBotRunId === "string"
      ? stateMeta.testBotRunId
      : null;
    if (stateRunId !== args.runId) {
      throw new Error(
        "Scenario run is not the active run state. Open latest run first.",
      );
    }

    const scenarioDeckPath = typeof stateMeta.scenarioConfigPath === "string"
      ? stateMeta.scenarioConfigPath
      : typeof stateMeta.testBotConfigPath === "string"
      ? stateMeta.testBotConfigPath
      : null;
    if (!scenarioDeckPath) {
      throw new Error("Scenario deck path unavailable for this run.");
    }

    const scenarioDeckId = typeof stateMeta.selectedScenarioDeckId === "string"
      ? stateMeta.selectedScenarioDeckId
      : undefined;
    const scenarioDeckLabel =
      typeof stateMeta.selectedScenarioDeckLabel === "string"
        ? stateMeta.selectedScenarioDeckLabel
        : undefined;
    const userMessageSource = stateMeta.scenarioRunMode === "manual"
      ? "manual"
      : "scenario";
    const runMaxTurns = typeof stateMeta.testBotMaxTurns === "number" &&
        Number.isFinite(stateMeta.testBotMaxTurns)
      ? Math.round(stateMeta.testBotMaxTurns)
      : undefined;
    const existingRun = active?.run;
    const run: TestBotRunStatus = {
      id: args.runId,
      status: "running",
      workspaceId: args.workspaceId,
      sessionId: args.workspaceId,
      startedAt: existingRun?.startedAt ??
        (typeof stateMeta.startedAt === "string"
          ? stateMeta.startedAt
          : null) ??
        new Date().toISOString(),
      finishedAt: undefined,
      error: undefined,
      maxTurns: existingRun?.maxTurns ?? runMaxTurns,
      messages: existingRun?.messages ? [...existingRun.messages] : [],
      traces: existingRun?.traces
        ? [...existingRun.traces]
        : Array.isArray(state.traces)
        ? [...state.traces]
        : [],
      toolInserts: existingRun?.toolInserts ? [...existingRun.toolInserts] : [],
      initFill:
        (stateMeta as { testBotInitFill?: TestBotInitFill }).testBotInitFill ??
          existingRun?.initFill,
    };

    const controller = new AbortController();
    const entry: TestBotRunEntry = {
      run,
      state,
      promise: null,
      abort: controller,
    };
    testBotRuns.set(args.runId, entry);

    const emitTestBot = (payload: unknown) =>
      broadcastTestBot(payload, args.workspaceId);
    const baseMeta = buildWorkspaceMeta(workspaceRecord, stateMeta);
    let savedState: SavedState | undefined = state;
    const capturedTraces: Array<TraceEvent> = Array.isArray(state.traces)
      ? [...state.traces]
      : [];

    const appendFromState = (nextState: SavedState) => {
      const snapshot = buildTestBotSnapshot(nextState);
      run.messages = snapshot.messages;
      run.toolInserts = snapshot.toolInserts;
      run.traces = Array.isArray(nextState.traces)
        ? [...nextState.traces]
        : undefined;
      emitTestBot({ type: "testBotStatus", run });
    };

    const tracer = (event: TraceEvent) => {
      const stamped = event.ts ? event : { ...event, ts: Date.now() };
      capturedTraces.push(stamped);
      emitTestBot({
        type: "testBotTrace",
        workspaceId: args.workspaceId,
        runId: args.runId,
        event: stamped,
      });
    };

    const trimmedMessage = args.message.trim();
    const turn = run.messages.filter((message) => message.role === "user")
      .length;
    if (trimmedMessage.length > 0) {
      run.messages = [
        ...run.messages,
        { role: "user", content: trimmedMessage },
      ];
    }
    let hasStartedAssistantStreamMessage = false;
    entry.promise = (async () => {
      try {
        emitTestBot({ type: "testBotStatus", run });
        const rootResult = await runDeck({
          path: scenarioDeckPath,
          input: undefined,
          inputProvided: false,
          modelProvider: opts.modelProvider,
          defaultModel: opts.model,
          modelOverride: opts.modelForce,
          trace: tracer,
          stream: true,
          state: savedState,
          allowRootStringInput: true,
          initialUserMessage: trimmedMessage,
          responsesMode: opts.responsesMode,
          workerSandbox: resolveWorkerSandboxForSignalAwareRun({
            workerSandbox: opts.workerSandbox,
            signal: controller.signal,
          }),
          signal: controller.signal,
          onStateUpdate: (nextState) => {
            const sourced = applyUserMessageRefSource(
              savedState,
              nextState,
              userMessageSource,
            );
            const nextMeta = {
              ...baseMeta,
              ...(sourced.meta ?? {}),
              testBot: true,
              testBotRunId: args.runId,
              testBotConfigPath: scenarioDeckPath,
              testBotName: path.basename(scenarioDeckPath).replace(
                /\.deck\.(md|ts)$/i,
                "",
              ),
              scenarioRunId: args.runId,
              ...(scenarioDeckId
                ? { selectedScenarioDeckId: scenarioDeckId }
                : {}),
              ...(scenarioDeckLabel
                ? { selectedScenarioDeckLabel: scenarioDeckLabel }
                : {}),
              scenarioConfigPath: scenarioDeckPath,
              scenarioRunMode: userMessageSource === "manual"
                ? "manual"
                : "scenario",
              ...(run.initFill ? { testBotInitFill: run.initFill } : {}),
              workspaceId: args.workspaceId,
              ...(run.maxTurns ? { testBotMaxTurns: run.maxTurns } : {}),
            };
            const enriched = persistSessionState({
              ...sourced,
              meta: nextMeta,
              traces: capturedTraces,
            });
            savedState = enriched;
            entry.state = enriched;
            appendFromState(enriched);
          },
          onStreamText: (chunk) => {
            if (typeof chunk === "string" && chunk.length > 0) {
              if (!hasStartedAssistantStreamMessage) {
                run.messages = [
                  ...run.messages,
                  { role: "assistant", content: chunk },
                ];
                hasStartedAssistantStreamMessage = true;
              } else {
                const last = run.messages[run.messages.length - 1];
                if (last?.role === "assistant") {
                  last.content += chunk;
                }
              }
            }
            emitTestBot({
              type: "testBotStream",
              workspaceId: args.workspaceId,
              runId: args.runId,
              role: "assistant",
              chunk,
              turn,
              ts: Date.now(),
            });
          },
        });
        if (!isGambitEndSignal(rootResult)) {
          emitTestBot({
            type: "testBotStreamEnd",
            workspaceId: args.workspaceId,
            runId: args.runId,
            role: "assistant",
            turn,
            ts: Date.now(),
          });
        }
        run.status = controller.signal.aborted ? "canceled" : "completed";
        run.error = undefined;
      } catch (err) {
        if (controller.signal.aborted || isRunCanceledError(err)) {
          run.status = "canceled";
          run.error = undefined;
        } else {
          run.status = "error";
          run.error = err instanceof Error ? err.message : String(err);
        }
      } finally {
        if (savedState?.messages) {
          const snapshot = buildTestBotSnapshot(savedState);
          run.messages = snapshot.messages;
          run.toolInserts = snapshot.toolInserts;
          run.traces = Array.isArray(savedState.traces)
            ? [...savedState.traces]
            : run.traces;
        }
        if (savedState) {
          entry.state = savedState;
        }
        run.finishedAt = new Date().toISOString();
        entry.abort = null;
        entry.promise = null;
        emitTestBot({ type: "testBotStatus", run });
      }
    })();

    return {
      id: run.id,
      workspaceId: args.workspaceId,
      status: run.status,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      messages: Array.isArray(run.messages) ? [...run.messages] : [],
      traces: Array.isArray(run.traces) ? [...run.traces] : [],
      toolInserts: Array.isArray(run.toolInserts) ? [...run.toolInserts] : [],
    };
  };

  const readWorkspaceScenarioRunsForGraphql = (
    workspaceId: string,
  ): Array<{
    id: string;
    workspaceId: string;
    status: "idle" | "running" | "completed" | "error" | "canceled";
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    messages: Array<{
      role: string;
      content: string;
      messageRefId?: string;
    }>;
    traces?: Array<Record<string, unknown>>;
    toolInserts?: Array<{
      actionCallId?: string;
      parentActionCallId?: string;
      name?: string;
      index: number;
    }>;
  }> => {
    const latestByRunId = new Map<string, TestBotRunStatus>();
    const persistedState = readSessionState(workspaceId);
    if (persistedState) {
      const metaRuns = listScenarioRunStatusesFromStateMeta(
        persistedState,
        workspaceId,
      );
      if (metaRuns.length > 0) {
        for (const run of metaRuns) {
          latestByRunId.set(run.id, run);
        }
      } else {
        for (
          const run of listPersistedTestRunStatuses(persistedState, workspaceId)
        ) {
          latestByRunId.set(run.id, run);
        }
      }
    }
    for (const entry of testBotRuns.values()) {
      const run = entry.run;
      if (
        run.workspaceId !== workspaceId &&
        run.sessionId !== workspaceId
      ) {
        continue;
      }
      if (!run.id || run.id.trim().length === 0) continue;
      latestByRunId.set(run.id, run);
    }
    const records = [...latestByRunId.values()].map((run) => ({
      id: run.id,
      workspaceId,
      status: run.status,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      messages: Array.isArray(run.messages) ? [...run.messages] : [],
      traces: Array.isArray(run.traces) ? [...run.traces] : [],
      toolInserts: Array.isArray(run.toolInserts) ? [...run.toolInserts] : [],
    }));
    records.sort((a, b) => {
      const aKey = a.startedAt ?? a.finishedAt ?? a.id;
      const bKey = b.startedAt ?? b.finishedAt ?? b.id;
      return bKey.localeCompare(aKey);
    });
    return records;
  };

  const stopWorkspaceScenarioRunForGraphql = async (args: {
    workspaceId: string;
    runId: string;
  }): Promise<{
    id: string;
    workspaceId: string;
    status: "idle" | "running" | "completed" | "error" | "canceled";
    error?: string;
    startedAt?: string;
    finishedAt?: string;
    messages: Array<{
      role: string;
      content: string;
      messageRefId?: string;
    }>;
    traces?: Array<Record<string, unknown>>;
    toolInserts?: Array<{
      actionCallId?: string;
      parentActionCallId?: string;
      name?: string;
      index: number;
    }>;
  }> => {
    const active = testBotRuns.get(args.runId);
    if (
      active &&
      (active.run.workspaceId === args.workspaceId ||
        active.run.sessionId === args.workspaceId)
    ) {
      active.abort?.abort();
      try {
        await active.promise;
      } catch {
        // Abort path can reject internally; run projection remains authoritative.
      }
    }

    const latest = readWorkspaceScenarioRunsForGraphql(args.workspaceId).find(
      (run) => run.id === args.runId,
    );
    if (latest) return latest;
    throw new Error(`Scenario run ${args.runId} not found`);
  };

  const toWorkspaceGradeRunForGraphql = (
    run: GradingRunRecord,
    flags: Array<GradingFlag>,
  ): {
    id: string;
    workspaceId: string;
    scenarioRunId?: string;
    graderId: string;
    graderPath: string;
    graderLabel?: string;
    status: "running" | "completed" | "error";
    runAt?: string;
    error?: string;
    summary?: {
      score?: number;
      reason?: string;
    };
    turns: Array<{
      id: string;
      runId: string;
      turnIndex: number;
      turnNumber: number;
      refId: string;
      score?: number;
      reason?: string;
      priorUser?: string;
      gradedAssistant?: string;
    }>;
  } => {
    const flagByRef = new Map(flags.map((entry) => [entry.refId, entry]));
    const result = run.result && typeof run.result === "object"
      ? run.result as Record<string, unknown>
      : null;
    const turns =
      result && result.mode === "turns" && Array.isArray(result.turns)
        ? result.turns as Array<Record<string, unknown>>
        : [];
    const totalTurns = typeof result?.totalTurns === "number" &&
        Number.isFinite(result.totalTurns)
      ? result.totalTurns
      : turns.length;
    const normalizedTurns = turns.map((turn, index) => {
      const turnIndex =
        typeof turn.index === "number" && Number.isFinite(turn.index)
          ? turn.index
          : index;
      const turnNumber = totalTurns > 0
        ? Math.min(totalTurns, index + 1)
        : index + 1;
      const turnInput = turn.input;
      const turnResult = turn.result;
      const { score, reason } = extractGradeScoreAndReason(turnResult);
      const context = extractGradeTurnContext(turnInput);
      const messageToGrade = turnInput && typeof turnInput === "object"
        ? (turnInput as { messageToGrade?: unknown }).messageToGrade
        : undefined;
      const messageRefId =
        messageToGrade && typeof messageToGrade === "object" &&
          typeof (messageToGrade as { messageRefId?: unknown }).messageRefId ===
            "string"
          ? (messageToGrade as { messageRefId: string }).messageRefId
          : undefined;
      const fallbackRefId = `gradingRun:${run.id}#turn:${turnIndex}`;
      const refId = messageRefId ?? fallbackRefId;
      const turnFlag = flagByRef.get(refId);
      return {
        id: `${run.id}:turn:${turnIndex}`,
        runId: run.id,
        turnIndex,
        turnNumber,
        refId,
        score,
        reason,
        priorUser: context.priorUser,
        gradedAssistant: context.gradedAssistant,
        flagReason: turnFlag?.reason,
      };
    });
    const summaryFromResult = extractGradeScoreAndReason(run.result);
    const scenarioRunId = deriveScenarioRunIdFromGradingRun(run);
    return {
      id: run.id,
      workspaceId: run.workspaceId ?? "",
      scenarioRunId,
      graderId: run.graderId,
      graderPath: run.graderPath,
      graderLabel: run.graderLabel,
      status: run.status,
      runAt: run.runAt,
      error: run.error,
      summary: summaryFromResult.score !== undefined ||
          summaryFromResult.reason !== undefined
        ? summaryFromResult
        : undefined,
      turns: normalizedTurns.map((turn) => ({
        id: turn.id,
        runId: turn.runId,
        turnIndex: turn.turnIndex,
        turnNumber: turn.turnNumber,
        refId: turn.refId,
        score: turn.score,
        reason: turn.reason,
        priorUser: turn.priorUser,
        gradedAssistant: turn.gradedAssistant,
      })),
    };
  };

  const emitGradeWorkspaceEvent = (
    workspaceId: string,
    payload: Record<string, unknown>,
  ) => {
    appendDurableStreamEvent(WORKSPACE_STREAM_ID, {
      ...payload,
      workspaceId,
    });
  };

  const emitVerifyWorkspaceEvent = (
    workspaceId: string,
    payload: Record<string, unknown>,
  ) => {
    appendDurableStreamEvent(WORKSPACE_STREAM_ID, {
      ...payload,
      workspaceId,
    });
  };

  const readWorkspaceVerifyBatchesForGraphql = (
    workspaceId: string,
  ): Array<{
    id: string;
    workspaceId: string;
    graderId: string;
    scenarioRunId?: string;
    status: "idle" | "running" | "completed" | "error";
    startedAt?: string;
    finishedAt?: string;
    requested: number;
    active: number;
    completed: number;
    failed: number;
    requests: Array<{
      id: string;
      status: "queued" | "running" | "completed" | "error";
      runId?: string;
      error?: string;
    }>;
  }> => {
    const state = readSessionState(workspaceId);
    if (!state) return [];
    return readWorkspaceVerifyBatchesFromState(state).map((batch) => ({
      ...batch,
      workspaceId: workspaceId,
    }));
  };

  const createWorkspaceVerifyBatchRunForGraphql = async (args: {
    workspaceId: string;
    graderId: string;
    scenarioRunId?: string | null;
    batchSize: number;
    concurrency: number;
  }): Promise<{
    id: string;
    workspaceId: string;
    graderId: string;
    scenarioRunId?: string;
    status: "idle" | "running" | "completed" | "error";
    startedAt?: string;
    finishedAt?: string;
    requested: number;
    active: number;
    completed: number;
    failed: number;
    requests: Array<{
      id: string;
      status: "queued" | "running" | "completed" | "error";
      runId?: string;
      error?: string;
    }>;
  }> => {
    await activateWorkspaceDeck(args.workspaceId, {
      source: "graphql:createWorkspaceVerifyBatchRun",
    });
    const grader = _resolveGraderDeck(args.graderId);
    if (!grader) {
      throw new Error(`Unknown grader deck: ${args.graderId}`);
    }

    const state = readSessionStateStrict(args.workspaceId, {
      withTraces: true,
    });
    if (!state) {
      throw new Error(`Workspace ${args.workspaceId} not found`);
    }

    const explicitScenarioRunId = typeof args.scenarioRunId === "string" &&
        args.scenarioRunId.trim().length > 0
      ? args.scenarioRunId.trim()
      : null;
    const runFromState =
      state.meta && typeof state.meta.scenarioRunId === "string"
        ? state.meta.scenarioRunId
        : null;
    const selectedScenarioRunId = explicitScenarioRunId ?? runFromState;
    const scenarioRun = selectedScenarioRunId
      ? readWorkspaceScenarioRunsForGraphql(args.workspaceId).find((entry) =>
        entry.id === selectedScenarioRunId
      )
      : null;
    if (selectedScenarioRunId && !scenarioRun) {
      throw new Error(`Scenario run ${selectedScenarioRunId} not found`);
    }

    const normalizedBatchSize = Math.max(
      1,
      Math.min(
        VERIFY_BATCH_SIZE_MAX,
        Number.isFinite(args.batchSize) ? Math.round(args.batchSize) : 1,
      ),
    );
    const normalizedConcurrency = Math.max(
      1,
      Math.min(
        VERIFY_BATCH_CONCURRENCY_MAX,
        normalizedBatchSize,
        Number.isFinite(args.concurrency) ? Math.round(args.concurrency) : 1,
      ),
    );

    const now = new Date().toISOString();
    const batchId = randomId("vbatch");
    let batch: WorkspaceVerifyBatchRecordForGraphql = {
      id: batchId,
      workspaceId: args.workspaceId,
      graderId: grader.id,
      scenarioRunId: selectedScenarioRunId ?? undefined,
      status: "running",
      startedAt: now,
      finishedAt: undefined,
      requested: normalizedBatchSize,
      active: 0,
      completed: 0,
      failed: 0,
      requests: Array.from(
        { length: normalizedBatchSize },
        (_value, index) => ({
          id: `${batchId}:${index + 1}`,
          status: "queued",
        }),
      ),
    };

    let persistedState = persistSessionState(
      upsertWorkspaceVerifyBatchInState(state, batch),
    );
    const persistAndBroadcastBatch = (reason: string) => {
      const latest = readSessionStateStrict(args.workspaceId, {
        withTraces: true,
      }) ?? persistedState;
      persistedState = persistSessionState(
        upsertWorkspaceVerifyBatchInState(latest, batch),
      );
      appendGradingLog(persistedState, {
        type: "gambit.verify.batch",
        workspaceId: args.workspaceId,
        reason,
        batch,
      });
      emitVerifyWorkspaceEvent(args.workspaceId, {
        type: "gambit.verify.batch",
        reason,
        batch,
      });
    };
    persistAndBroadcastBatch("created");

    let updateQueue = Promise.resolve();
    const updateBatchRequest = async (
      requestIndex: number,
      patch: Partial<WorkspaceVerifyBatchRequestRecordForGraphql>,
    ) => {
      updateQueue = updateQueue.then(() => {
        if (requestIndex < 0 || requestIndex >= batch.requests.length) return;
        const nextRequests = batch.requests.map((request, index) =>
          index === requestIndex ? { ...request, ...patch } : request
        );
        const active = nextRequests.filter((request) =>
          request.status === "running"
        ).length;
        const completed =
          nextRequests.filter((request) => request.status === "completed")
            .length;
        const failed =
          nextRequests.filter((request) => request.status === "error").length;
        const terminal = completed + failed === batch.requested && active === 0;
        batch = {
          ...batch,
          requests: nextRequests,
          active,
          completed,
          failed,
          status: terminal ? (failed > 0 ? "error" : "completed") : "running",
          finishedAt: terminal ? new Date().toISOString() : undefined,
        };
        persistAndBroadcastBatch("request-update");
      });
      await updateQueue;
    };

    let cursor = 0;
    const workers = Array.from(
      { length: normalizedConcurrency },
      () =>
        (async () => {
          while (true) {
            const requestIndex = cursor;
            cursor += 1;
            if (requestIndex >= normalizedBatchSize) return;
            await updateBatchRequest(requestIndex, { status: "running" });
            try {
              const run = await createWorkspaceGradeRunForGraphql({
                workspaceId: args.workspaceId,
                graderId: grader.id,
                scenarioRunId: selectedScenarioRunId,
              });
              if (run.status === "completed") {
                await updateBatchRequest(requestIndex, {
                  status: "completed",
                  runId: run.id,
                  error: undefined,
                });
              } else {
                await updateBatchRequest(requestIndex, {
                  status: "error",
                  runId: run.id,
                  error: run.error ??
                    `Grade run ended with status ${run.status}`,
                });
              }
            } catch (error) {
              await updateBatchRequest(requestIndex, {
                status: "error",
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        })(),
    );

    await Promise.all(workers);
    await updateQueue;
    return batch;
  };

  const readWorkspaceGradingFlagsForGraphql = (
    workspaceId: string,
  ): Array<GradingFlag> => {
    const state = readSessionState(workspaceId);
    if (!state) return [];
    return readGradingFlagsFromState(state);
  };

  const readWorkspaceGradeRunsForGraphql = (
    workspaceId: string,
  ): Array<{
    id: string;
    workspaceId: string;
    scenarioRunId?: string;
    graderId: string;
    graderPath: string;
    graderLabel?: string;
    status: "running" | "completed" | "error";
    runAt?: string;
    error?: string;
    summary?: {
      score?: number;
      reason?: string;
    };
    turns: Array<{
      id: string;
      runId: string;
      turnIndex: number;
      turnNumber: number;
      refId: string;
      score?: number;
      reason?: string;
      priorUser?: string;
      gradedAssistant?: string;
    }>;
  }> => {
    const state = readSessionState(workspaceId);
    if (!state) return [];
    const runs = readGradingRunsFromState(state).map((entry) => ({
      ...entry,
      workspaceId,
    }));
    const flags = readGradingFlagsFromState(state);
    const projected = runs.map((run) =>
      toWorkspaceGradeRunForGraphql(run, flags)
    );
    projected.sort((a, b) => {
      const left = a.runAt ?? a.id;
      const right = b.runAt ?? b.id;
      return right.localeCompare(left);
    });
    return projected;
  };

  const createWorkspaceGradeRunForGraphql = async (args: {
    workspaceId: string;
    graderId: string;
    scenarioRunId?: string | null;
  }): Promise<{
    id: string;
    workspaceId: string;
    scenarioRunId?: string;
    graderId: string;
    graderPath: string;
    graderLabel?: string;
    status: "running" | "completed" | "error";
    runAt?: string;
    error?: string;
    summary?: {
      score?: number;
      reason?: string;
    };
    turns: Array<{
      id: string;
      runId: string;
      turnIndex: number;
      turnNumber: number;
      refId: string;
      score?: number;
      reason?: string;
      priorUser?: string;
      gradedAssistant?: string;
    }>;
  }> => {
    await activateWorkspaceDeck(args.workspaceId, {
      source: "graphql:createWorkspaceGradeRun",
    });
    const grader = _resolveGraderDeck(args.graderId);
    if (!grader) {
      throw new Error(`Unknown grader deck: ${args.graderId}`);
    }
    const state = readSessionStateStrict(args.workspaceId, {
      withTraces: true,
    });
    if (!state) {
      throw new Error(`Workspace ${args.workspaceId} not found`);
    }

    const explicitScenarioRunId = typeof args.scenarioRunId === "string" &&
        args.scenarioRunId.trim().length > 0
      ? args.scenarioRunId.trim()
      : null;
    const runFromState =
      state.meta && typeof state.meta.scenarioRunId === "string"
        ? state.meta.scenarioRunId
        : null;
    const selectedScenarioRunId = explicitScenarioRunId ?? runFromState;
    const scenarioRun = selectedScenarioRunId
      ? readWorkspaceScenarioRunsForGraphql(args.workspaceId).find((entry) =>
        entry.id === selectedScenarioRunId
      )
      : null;
    if (selectedScenarioRunId && !scenarioRun) {
      throw new Error(`Scenario run ${selectedScenarioRunId} not found`);
    }
    const artifacts = scenarioRun
      ? _buildScenarioConversationArtifactsFromRun(scenarioRun)
      : _buildScenarioConversationArtifacts(state);
    const metaForGrading = (() => {
      const baseMeta = state.meta && typeof state.meta === "object"
        ? state.meta as Record<string, unknown>
        : {};
      const next = { ...baseMeta };
      delete next.calibrationRuns;
      delete next.gradingRuns;
      return next;
    })();
    if (selectedScenarioRunId) {
      metaForGrading.scenarioRunId = selectedScenarioRunId;
    }
    const sessionPayload = {
      runId: state.runId,
      messages: artifacts.messages,
      messageRefs: state.messageRefs,
      feedback: state.feedback,
      notes: state.notes,
      conversationScore: state.conversationScore,
      traces: Array.isArray(state.traces) ? state.traces : [],
      meta: metaForGrading,
    };

    const runId = randomId("grade");
    const runAt = new Date().toISOString();
    const runningRun: GradingRunRecord = {
      id: runId,
      workspaceId: args.workspaceId,
      scenarioRunId: selectedScenarioRunId ?? undefined,
      graderId: grader.id,
      graderPath: grader.path,
      graderLabel: grader.label,
      status: "running",
      runAt,
      input: { session: sessionPayload },
    };
    let persistedState = persistSessionState(
      upsertGradingRunInState(state, runningRun),
    );
    appendGradingLog(persistedState, {
      type: "gambit.grade.status",
      workspaceId: args.workspaceId,
      run: runningRun,
    });
    emitGradeWorkspaceEvent(args.workspaceId, {
      type: "gambit.grade.status",
      run: runningRun,
    });

    let completedRun: GradingRunRecord = runningRun;
    try {
      const graderDeck = await loadDeck(grader.path);
      const runMode =
        gradeSchemaHasField(graderDeck.inputSchema, "messageToGrade")
          ? "turns"
          : "conversation";
      const result = runMode === "conversation"
        ? await runDeckWithFallback({
          path: grader.path,
          input: { session: sessionPayload },
          inputProvided: true,
          modelProvider: opts.modelProvider,
          responsesMode: opts.responsesMode,
          workerSandbox: opts.workerSandbox,
        })
        : {
          mode: "turns",
          totalTurns: artifacts.assistantTurns.length,
          turns: await Promise.all(artifacts.assistantTurns.map(
            async (turn) => {
              const messageToGrade =
                turn.message && typeof turn.message === "object"
                  ? {
                    ...(turn.message as Record<string, unknown>),
                    messageRefId: turn.messageRefId,
                  }
                  : turn.message;
              const input = {
                session: sessionPayload,
                messageToGrade,
              };
              const turnResult = await runDeckWithFallback({
                path: grader.path,
                input,
                inputProvided: true,
                modelProvider: opts.modelProvider,
                responsesMode: opts.responsesMode,
                workerSandbox: opts.workerSandbox,
              });
              return {
                index: turn.conversationIndex,
                input,
                result: turnResult,
              };
            },
          )),
        };
      completedRun = {
        ...runningRun,
        status: "completed",
        result,
        error: undefined,
      };
    } catch (error) {
      completedRun = {
        ...runningRun,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }

    persistedState = persistSessionState(
      upsertGradingRunInState(persistedState, completedRun),
    );
    appendGradingLog(persistedState, {
      type: "gambit.grade.status",
      workspaceId: args.workspaceId,
      run: completedRun,
    });
    emitGradeWorkspaceEvent(args.workspaceId, {
      type: "gambit.grade.status",
      run: completedRun,
    });
    const flags = readGradingFlagsFromState(persistedState);
    return toWorkspaceGradeRunForGraphql(completedRun, flags);
  };

  const toggleWorkspaceGradeFlagForGraphql = (args: {
    workspaceId: string;
    refId: string;
    runId: string;
    turnIndex?: number | null;
  }): Promise<Array<GradingFlag>> => {
    const state = readSessionStateStrict(args.workspaceId, {
      withTraces: true,
    });
    if (!state) throw new Error(`Workspace ${args.workspaceId} not found`);
    const existing = readGradingFlagsFromState(state);
    const refId = args.refId.trim();
    if (!refId) throw new Error("Missing grade flag refId");
    const existingIndex = existing.findIndex((entry) => entry.refId === refId);
    const nextFlags = [...existing];
    if (existingIndex >= 0) {
      nextFlags.splice(existingIndex, 1);
    } else {
      nextFlags.push({
        id: randomId("gflag"),
        refId,
        runId: args.runId,
        turnIndex: typeof args.turnIndex === "number"
          ? args.turnIndex
          : undefined,
        createdAt: new Date().toISOString(),
      });
    }
    const persistedState = persistSessionState(
      writeGradingFlagsToState(state, nextFlags),
    );
    appendGradingLog(persistedState, {
      type: "gambit.grade.flag",
      workspaceId: args.workspaceId,
      action: existingIndex >= 0 ? "remove" : "add",
      refId,
      flags: nextFlags,
    });
    emitGradeWorkspaceEvent(args.workspaceId, {
      type: "gambit.grade.flag",
      action: existingIndex >= 0 ? "remove" : "add",
      refId,
      runId: args.runId,
    });
    return Promise.resolve(readGradingFlagsFromState(persistedState));
  };

  const updateWorkspaceGradeFlagReasonForGraphql = (args: {
    workspaceId: string;
    refId: string;
    reason: string;
  }): Promise<Array<GradingFlag>> => {
    const state = readSessionStateStrict(args.workspaceId, {
      withTraces: true,
    });
    if (!state) throw new Error(`Workspace ${args.workspaceId} not found`);
    const existing = readGradingFlagsFromState(state);
    const refId = args.refId.trim();
    const index = existing.findIndex((entry) => entry.refId === refId);
    if (index < 0) {
      throw new Error(`Flag not found for refId: ${refId}`);
    }
    const nextFlags = [...existing];
    nextFlags[index] = {
      ...nextFlags[index],
      reason: args.reason,
    };
    const persistedState = persistSessionState(
      writeGradingFlagsToState(state, nextFlags),
    );
    appendGradingLog(persistedState, {
      type: "gambit.grade.flag",
      workspaceId: args.workspaceId,
      action: "reason",
      refId,
      reason: args.reason,
      flags: nextFlags,
    });
    emitGradeWorkspaceEvent(args.workspaceId, {
      type: "gambit.grade.flag",
      action: "reason",
      refId,
      runId: nextFlags[index]?.runId,
    });
    return Promise.resolve(readGradingFlagsFromState(persistedState));
  };

  const server = Deno.serve(
    { port, signal: opts.signal, onListen: () => {} },
    async (req) => {
      const url = new URL(req.url);
      const _callApi = async (args: {
        path: string;
        method: string;
        query?: string | null;
        body?: string | null;
      }): Promise<{
        status: number;
        ok: boolean;
        body: string;
        contentType?: string;
      }> => {
        const rawPath = typeof args.path === "string" ? args.path.trim() : "";
        if (!rawPath.startsWith("/")) {
          throw new Error("Path must start with '/'");
        }
        if (rawPath === "/graphql" || rawPath.startsWith("/graphql?")) {
          throw new Error("Recursive /graphql proxy calls are not allowed");
        }
        if (
          rawPath !== "/schema" &&
          rawPath !== "/graphql/stream" &&
          rawPath !== "/graphql/streams" &&
          !rawPath.startsWith(GRAPHQL_STREAMS_PREFIX)
        ) {
          throw new Error(
            "Only /schema, /graphql/stream, /graphql/streams, and /graphql/streams/* paths are allowed",
          );
        }
        const target = new URL(rawPath, url);
        if (typeof args.query === "string" && args.query.trim().length > 0) {
          const normalizedQuery = args.query.startsWith("?")
            ? args.query.slice(1)
            : args.query;
          target.search = normalizedQuery;
        }
        const method = args.method.toUpperCase();
        const bodyText = typeof args.body === "string" ? args.body : null;
        const response = await fetch(target, {
          method,
          headers: bodyText === null
            ? undefined
            : { "content-type": "application/json" },
          body: bodyText,
        });
        return {
          status: response.status,
          ok: response.ok,
          body: await response.text(),
          contentType: response.headers.get("content-type") ?? undefined,
        };
      };
      const readWorkspaceFiles: ReadWorkspaceFiles = async (args) => {
        const root = await resolveBuildBotRoot(args.workspaceId);
        const fileId = typeof args.id === "string" ? args.id.trim() : "";
        const pathPrefix = typeof args.pathPrefix === "string"
          ? args.pathPrefix.trim()
          : "";

        const normalizeRelativePath = (value: string) =>
          value.split(/\\|\//g).filter(Boolean).join("/");
        const isInternalWorkspacePath = (value: string): boolean => {
          const normalized = normalizeRelativePath(value);
          return normalized === ".gambit" ||
            normalized.startsWith(".gambit/");
        };

        const readTextContent = async (
          fullPath: string,
        ): Promise<string | null> => {
          try {
            return await Deno.readTextFile(fullPath);
          } catch {
            return null;
          }
        };

        const toRecord = async (
          fullPath: string,
          relPath: string,
          stat: Deno.FileInfo,
        ): Promise<WorkspaceFileReadRecord> => {
          const normalizedPath = normalizeRelativePath(relPath);
          return {
            id: asGambitID(
              `workspace-file:${args.workspaceId}:${normalizedPath}`,
            ),
            path: asGambitWorkspaceRelativePath(normalizedPath),
            size: typeof stat.size === "number" ? stat.size : null,
            modifiedAt: stat.mtime
              ? asGambitISODateTime(stat.mtime.toISOString())
              : null,
            content: await readTextContent(fullPath),
          };
        };

        if (fileId.length > 0) {
          try {
            const idPrefix = `workspace-file:${args.workspaceId}:`;
            if (!fileId.startsWith(idPrefix)) return [];
            const idPath = fileId.slice(idPrefix.length);
            if (idPath.length === 0) return [];
            const resolved = await resolveBuildBotPath(root, idPath);
            if (!resolved.stat.isFile) return [];
            if (isInternalWorkspacePath(resolved.relativePath)) return [];
            return [
              await toRecord(
                resolved.fullPath,
                resolved.relativePath,
                resolved.stat,
              ),
            ];
          } catch {
            return [];
          }
        }

        const records: Array<WorkspaceFileReadRecord> = [];
        const pending: Array<string> = [root];

        while (pending.length > 0) {
          const current = pending.pop();
          if (!current) continue;
          for await (const entry of Deno.readDir(current)) {
            const fullPath = path.join(current, entry.name);
            let stat: Deno.FileInfo;
            try {
              stat = await Deno.lstat(fullPath);
            } catch {
              continue;
            }
            if (stat.isSymlink) continue;
            if (stat.isDirectory) {
              pending.push(fullPath);
              continue;
            }
            if (!stat.isFile) continue;
            const relativePath = normalizeRelativePath(
              path.relative(root, fullPath),
            );
            if (relativePath.length === 0) continue;
            if (isInternalWorkspacePath(relativePath)) continue;
            if (
              pathPrefix.length > 0 &&
              !relativePath.startsWith(normalizeRelativePath(pathPrefix))
            ) {
              continue;
            }
            records.push(await toRecord(fullPath, relativePath, stat));
          }
        }

        records.sort((a, b) => a.path.localeCompare(b.path));
        return records;
      };

      if (url.pathname === WORKSPACES_API_BASE) {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        return new Response(JSON.stringify({ workspaces: listSessions() }), {
          headers: { "content-type": "application/json" },
        });
      }
      const workspaceTestRunGetMatch = url.pathname.match(
        new RegExp(`^${WORKSPACES_API_BASE}/([^/]+)/test/([^/]+)$`),
      );
      if (workspaceTestRunGetMatch) {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const workspaceId = decodeURIComponent(workspaceTestRunGetMatch[1]);
          const requestedTestRunId = decodeURIComponent(
            workspaceTestRunGetMatch[2],
          );
          await logWorkspaceBotRoot(
            `${WORKSPACES_API_BASE}/:id/test/:runId`,
            workspaceId,
          );
          await activateWorkspaceDeck(workspaceId);
          const payload = await _buildWorkspaceReadModel(workspaceId, {
            requestedTestDeckPath: url.searchParams.get("deckPath"),
            requestedTestRunId,
          });
          if ("error" in payload) {
            return new Response(JSON.stringify({ error: payload.error }), {
              status: payload.status,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(_safeJsonStringify(payload), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      const workspaceGradeRunGetMatch = url.pathname.match(
        new RegExp(`^${WORKSPACES_API_BASE}/([^/]+)/grade/([^/]+)$`),
      );
      if (workspaceGradeRunGetMatch) {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const workspaceId = decodeURIComponent(workspaceGradeRunGetMatch[1]);
          const requestedGradeRunId = decodeURIComponent(
            workspaceGradeRunGetMatch[2],
          );
          await logWorkspaceBotRoot(
            `${WORKSPACES_API_BASE}/:id/grade/:runId`,
            workspaceId,
          );
          await activateWorkspaceDeck(workspaceId);
          const payload = await _buildWorkspaceReadModel(workspaceId, {
            requestedTestDeckPath: url.searchParams.get("deckPath"),
            requestedGradeRunId,
          });
          if ("error" in payload) {
            return new Response(JSON.stringify({ error: payload.error }), {
              status: payload.status,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(_safeJsonStringify(payload), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      const workspaceGetMatch = url.pathname.match(
        new RegExp(`^${WORKSPACES_API_BASE}/([^/]+)$`),
      );
      if (workspaceGetMatch) {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const workspaceId = decodeURIComponent(workspaceGetMatch[1]);
          await logWorkspaceBotRoot(`${WORKSPACES_API_BASE}/:id`, workspaceId);
          await activateWorkspaceDeck(workspaceId);
          const payload = await _buildWorkspaceReadModel(workspaceId, {
            requestedTestDeckPath: url.searchParams.get("deckPath"),
          });
          if ("error" in payload) {
            return new Response(JSON.stringify({ error: payload.error }), {
              status: payload.status,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(_safeJsonStringify(payload), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (url.pathname === `${WORKSPACE_API_BASE}/new`) {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          let onboarding = false;
          try {
            const body = await req.json() as { onboarding?: unknown };
            onboarding = body.onboarding === true;
          } catch {
            // ignore malformed body
          }
          const workspace = await _createWorkspaceSession({ onboarding });
          await activateWorkspaceDeck(workspace.id);
          return new Response(
            JSON.stringify({
              workspaceId: workspace.id,
              deckPath: workspace.rootDeckPath,
              workspaceDir: workspace.rootDir,
              createdAt: workspace.createdAt,
              workspaceSchemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (url.pathname === `${WORKSPACE_API_BASE}/delete`) {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json().catch(() => ({})) as Record<
            string,
            unknown
          >;
          const workspaceId = _getWorkspaceIdFromBody(body);
          if (!workspaceId) {
            throw new Error("Missing workspaceId");
          }
          const deleted = _deleteSessionState(workspaceId);
          if (!deleted) {
            return new Response(
              JSON.stringify({ error: "Workspace not found" }),
              { status: 404, headers: { "content-type": "application/json" } },
            );
          }
          stopWorkspaceFsWatcher(workspaceId);
          workspaceById.delete(workspaceId);
          buildBotRuns.delete(workspaceId);
          return new Response(
            JSON.stringify({
              workspaceId,
              deleted: true,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (url.pathname === `${WORKSPACE_API_BASE}/feedback`) {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json().catch(() => ({})) as {
            workspaceId?: string;
            runId?: string;
            messageRefId?: string;
            score?: number | null;
            reason?: string;
          };
          const workspaceId = _getWorkspaceIdFromBody(body);
          if (!workspaceId) {
            throw new Error("Missing workspaceId");
          }
          if (!body.messageRefId) {
            throw new Error("Missing messageRefId");
          }
          if (
            body.score !== null &&
            (typeof body.score !== "number" || Number.isNaN(body.score))
          ) {
            throw new Error("Invalid score");
          }
          const state = readSessionState(workspaceId);
          if (!state) {
            throw new Error("Workspace not found");
          }
          const requestedRunId = typeof body.runId === "string" &&
              body.runId.trim().length > 0
            ? body.runId.trim()
            : undefined;
          const feedbackEligible = _isFeedbackEligibleMessageRef(
            state,
            body.messageRefId,
          ) ||
            (requestedRunId
              ? _isFeedbackEligiblePersistedTestRunMessageRef(
                state,
                requestedRunId,
                body.messageRefId,
              )
              : false);
          if (!feedbackEligible) {
            throw new Error("Feedback target is not eligible");
          }
          const existing = state.feedback ?? [];
          const idx = existing.findIndex((entry) =>
            entry.messageRefId === body.messageRefId
          );
          let entry: FeedbackEntry | undefined;
          let feedback: Array<FeedbackEntry> = existing;
          let deleted = false;
          if (body.score === null) {
            if (idx >= 0) {
              feedback = existing.filter((_, i) => i !== idx);
              deleted = true;
            }
          } else {
            const clamped = Math.max(-3, Math.min(3, Math.round(body.score)));
            const reason = typeof body.reason === "string"
              ? body.reason
              : idx >= 0
              ? existing[idx].reason
              : undefined;
            const runId = requestedRunId ??
              (typeof state.runId === "string" ? state.runId : "session");
            const scenarioRunId = requestedRunId ??
              (typeof state.meta?.scenarioRunId === "string"
                ? state.meta.scenarioRunId
                : runId);
            const now = new Date().toISOString();
            entry = idx >= 0
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
            if (entry) {
              (entry as Record<string, unknown>).workspaceId = workspaceId;
              (entry as Record<string, unknown>).scenarioRunId = scenarioRunId;
            }
            feedback = idx >= 0
              ? existing.map((item, i) => i === idx ? entry! : item)
              : [...existing, entry];
          }
          const nextState = persistSessionState({
            ...state,
            feedback,
          });
          appendSessionEvent(nextState, {
            type: "feedback.update",
            kind: "artifact",
            category: "feedback",
            workspaceId,
            scenarioRunId: typeof nextState.meta?.scenarioRunId === "string"
              ? nextState.meta.scenarioRunId
              : nextState.runId,
            messageRefId: body.messageRefId,
            feedback: entry,
            deleted,
          });
          const testBotRunId = typeof nextState.meta?.testBotRunId === "string"
            ? nextState.meta.testBotRunId
            : undefined;
          if (testBotRunId) {
            const testEntry = testBotRuns.get(testBotRunId);
            if (testEntry) {
              syncTestBotRunFromState(testEntry.run, nextState);
              broadcastTestBot(
                { type: "testBotStatus", run: testEntry.run },
                workspaceId,
              );
            }
          }
          return new Response(
            JSON.stringify({
              workspaceId,
              feedback: entry,
              saved: !deleted,
              deleted,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (url.pathname === "/api/test") {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const workspaceId = getWorkspaceIdFromQuery(url);
          await logWorkspaceBotRoot("/api/test", workspaceId);
          if (workspaceId) {
            await activateWorkspaceDeck(workspaceId);
          }
          await deckLoadPromise.catch(() => null);
          const requestedDeck = url.searchParams.get("deckPath");
          const selection = requestedDeck
            ? resolveTestDeck(requestedDeck)
            : availableTestDecks[0];
          if (requestedDeck && !selection) {
            return new Response(
              JSON.stringify({ error: "Unknown scenario deck selection" }),
              { status: 400, headers: { "content-type": "application/json" } },
            );
          }
          if (!selection) {
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
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (url.pathname === "/api/test/run") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json().catch(() => ({})) as Record<
            string,
            unknown
          >;
          let workspaceId = _getWorkspaceIdFromBody(body);
          if (!workspaceId) {
            const created = await _createWorkspaceSession();
            workspaceId = created.id;
          }
          _ensureWorkspaceSession(workspaceId);
          await logWorkspaceBotRoot("/api/test/run", workspaceId);
          await activateWorkspaceDeck(workspaceId);
          let run = await startWorkspaceScenarioRunForGraphql({
            workspaceId,
            scenarioDeckId: typeof body.botDeckPath === "string"
              ? body.botDeckPath
              : typeof body.scenarioDeckId === "string"
              ? body.scenarioDeckId
              : null,
            scenarioInput: body.botInput,
            assistantInit: body.context ?? body.init,
          });
          const initialUserMessage = typeof body.initialUserMessage === "string"
            ? body.initialUserMessage.trim()
            : "";
          if (initialUserMessage.length > 0) {
            run = await sendWorkspaceScenarioRunForGraphql({
              workspaceId,
              runId: run.id,
              message: initialUserMessage,
            });
          }
          const liveRun = testBotRuns.get(run.id)?.run;
          const runPayload = liveRun?.maxTurns !== undefined
            ? { ...run, maxTurns: liveRun.maxTurns }
            : run;
          return new Response(JSON.stringify({ run: runPayload }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (url.pathname === "/api/test/message") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json().catch(() => ({})) as Record<
            string,
            unknown
          >;
          let workspaceId = _getWorkspaceIdFromBody(body);
          const requestedRunId = typeof body.runId === "string"
            ? body.runId.trim()
            : "";
          if (!workspaceId && requestedRunId) {
            const active = testBotRuns.get(requestedRunId)?.run;
            workspaceId = active?.workspaceId ?? active?.sessionId;
          }
          if (!workspaceId) {
            const created = await _createWorkspaceSession();
            workspaceId = created.id;
          }
          _ensureWorkspaceSession(workspaceId);
          await logWorkspaceBotRoot("/api/test/message", workspaceId);
          await activateWorkspaceDeck(workspaceId);
          const existingRun = requestedRunId.length > 0
            ? readWorkspaceScenarioRunsForGraphql(workspaceId).find((run) =>
              run.id === requestedRunId
            )
            : undefined;
          let runId = existingRun?.id;
          if (!runId) {
            const started = await startWorkspaceScenarioRunForGraphql({
              runId: requestedRunId || undefined,
              workspaceId,
              scenarioDeckId: typeof body.botDeckPath === "string"
                ? body.botDeckPath
                : typeof body.scenarioDeckId === "string"
                ? body.scenarioDeckId
                : null,
              scenarioInput: body.botInput,
              assistantInit: body.context ?? body.init,
            });
            runId = started.id;
            const initialMessage = typeof body.message === "string"
              ? body.message.trim()
              : "";
            if (initialMessage.length === 0) {
              const liveStarted = testBotRuns.get(started.id)?.run;
              const startedPayload = liveStarted?.maxTurns !== undefined
                ? { ...started, maxTurns: liveStarted.maxTurns }
                : started;
              return new Response(JSON.stringify({ run: startedPayload }), {
                headers: { "content-type": "application/json" },
              });
            }
          }
          const message = typeof body.message === "string" ? body.message : "";
          const run = await sendWorkspaceScenarioRunForGraphql({
            workspaceId,
            runId,
            message,
          });
          const liveRun = testBotRuns.get(run.id)?.run;
          const runPayload = liveRun?.maxTurns !== undefined
            ? { ...run, maxTurns: liveRun.maxTurns }
            : run;
          return new Response(JSON.stringify({ run: runPayload }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (url.pathname === "/api/test/stop") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json().catch(() => ({})) as {
            runId?: unknown;
            workspaceId?: unknown;
          };
          const runId = typeof body.runId === "string" ? body.runId : "";
          if (!runId) {
            return new Response(
              JSON.stringify({
                stopped: false,
                run: {
                  id: "",
                  status: "idle",
                  messages: [],
                  traces: [],
                  toolInserts: [],
                },
              }),
              { headers: { "content-type": "application/json" } },
            );
          }
          const existing = testBotRuns.get(runId);
          const workspaceId = typeof body.workspaceId === "string"
            ? body.workspaceId
            : existing?.run.workspaceId ?? existing?.run.sessionId;
          const wasRunning = Boolean(existing?.promise);
          if (!workspaceId) {
            existing?.abort?.abort();
            return new Response(
              JSON.stringify({
                stopped: wasRunning,
                run: existing?.run ?? {
                  id: runId,
                  status: "idle",
                  messages: [],
                  traces: [],
                  toolInserts: [],
                },
              }),
              { headers: { "content-type": "application/json" } },
            );
          }
          const run = await stopWorkspaceScenarioRunForGraphql({
            workspaceId,
            runId,
          });
          return new Response(JSON.stringify({ stopped: wasRunning, run }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (
        url.pathname === "/api/codex/trust-workspace" ||
        url.pathname === "/api/build/provider-status"
      ) {
        if (req.method !== "GET" && req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        const isLegacyCodexTrustEndpoint =
          url.pathname === "/api/codex/trust-workspace";
        let provider = "codex-cli";
        let workspaceId: string | undefined;
        let online = true;
        if (req.method === "POST") {
          try {
            const body = await req.json() as {
              workspaceId?: unknown;
              online?: unknown;
              provider?: unknown;
            };
            if (typeof body.workspaceId === "string") {
              workspaceId = body.workspaceId;
            }
            if (
              !isLegacyCodexTrustEndpoint &&
              body.provider === "claude-code-cli"
            ) {
              provider = "claude-code-cli";
            }
            if (
              body.online === true ||
              body.online === "true" ||
              body.online === 1 ||
              body.online === "1"
            ) {
              online = true;
            } else if (
              body.online === false ||
              body.online === "false" ||
              body.online === 0 ||
              body.online === "0" ||
              body.online === "no"
            ) {
              online = false;
            }
          } catch {
            // Ignore malformed body and fall back to query/default workspace.
          }
        }
        if (!workspaceId) {
          workspaceId = getWorkspaceIdFromQuery(url);
        }
        if (
          !isLegacyCodexTrustEndpoint &&
          url.searchParams.get("provider") === "claude-code-cli"
        ) {
          provider = "claude-code-cli";
        }
        const onlineQuery = url.searchParams.get("online");
        if (
          onlineQuery === "1" || onlineQuery === "true" ||
          onlineQuery === "yes"
        ) {
          online = true;
        } else if (
          onlineQuery === "0" || onlineQuery === "false" ||
          onlineQuery === "no"
        ) {
          online = false;
        }
        try {
          await logWorkspaceBotRoot(url.pathname, workspaceId);
          if (!isLegacyCodexTrustEndpoint && provider === "claude-code-cli") {
            return new Response(
              JSON.stringify({
                ok: true,
                provider,
                loggedIn: false,
                loginStatus:
                  "Claude Code status check is not yet supported in this build.",
                writeEnabled: false,
              }),
              { headers: { "content-type": "application/json" } },
            );
          }
          const result = await readCodexWorkspaceStatus(workspaceId, online);
          if (!isLegacyCodexTrustEndpoint) {
            return new Response(
              JSON.stringify({
                ok: true,
                provider,
                loggedIn: result.codexLoggedIn,
                loginStatus: result.codexLoginStatus,
                writeEnabled: result.writeEnabled,
                trustedPath: result.trustedPath,
              }),
              { headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              ok: true,
              ...result,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(
            JSON.stringify({ ok: false, error: message }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (url.pathname === "/api/simulator/run") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json().catch(() => ({})) as Record<
            string,
            unknown
          >;
          const requestedWorkspaceId = _getWorkspaceIdFromBody(body);
          let workspaceId = requestedWorkspaceId;
          if (!workspaceId) {
            const created = await _createWorkspaceSession();
            workspaceId = created.id;
          }
          if (requestedWorkspaceId) {
            try {
              readSessionStateStrict(requestedWorkspaceId, {
                withTraces: true,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              return new Response(JSON.stringify({ error: message }), {
                status: 400,
                headers: { "content-type": "application/json" },
              });
            }
          }
          _ensureWorkspaceSession(workspaceId);
          await logWorkspaceBotRoot(url.pathname, workspaceId);
          await activateWorkspaceDeck(workspaceId);
          let run = await startWorkspaceScenarioRunForGraphql({
            workspaceId,
            scenarioDeckId: typeof body.botDeckPath === "string"
              ? body.botDeckPath
              : typeof body.scenarioDeckId === "string"
              ? body.scenarioDeckId
              : null,
            scenarioInput: body.botInput,
            assistantInit: body.context ?? body.init ??
              (typeof body.input === "string"
                ? JSON.stringify(body.input)
                : body.input),
          });
          const initialUserMessage = typeof body.message === "string"
            ? body.message.trim()
            : "";
          if (initialUserMessage.length > 0) {
            run = await sendWorkspaceScenarioRunForGraphql({
              workspaceId,
              runId: run.id,
              message: initialUserMessage,
            });
          }
          const liveRun = testBotRuns.get(run.id)?.run;
          const runPayload = liveRun?.maxTurns !== undefined
            ? { ...run, maxTurns: liveRun.maxTurns }
            : run;
          return new Response(
            JSON.stringify({
              run: runPayload,
              runId: run.id,
              workspaceId,
            }),
            {
              headers: { "content-type": "application/json" },
            },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (url.pathname === "/api/build/message") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json().catch(() => ({})) as Record<
            string,
            unknown
          >;
          let workspaceId = _getWorkspaceIdFromBody(body);
          if (!workspaceId && typeof body.runId === "string") {
            workspaceId = body.runId;
          }
          if (!workspaceId) {
            const created = await _createWorkspaceSession();
            workspaceId = created.id;
          }
          _ensureWorkspaceSession(workspaceId);
          await logWorkspaceBotRoot(url.pathname, workspaceId);
          await activateWorkspaceDeck(workspaceId);
          const message = typeof body.message === "string"
            ? body.message
            : typeof body.input === "string"
            ? body.input
            : "";
          const run = startWorkspaceBuildRun({
            workspaceId,
            message,
          });
          return new Response(JSON.stringify({ run }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const status = message.includes("already in progress") ? 409 : 400;
          return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (url.pathname === "/api/build/stop") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json().catch(() => ({})) as Record<
            string,
            unknown
          >;
          const workspaceId = _getWorkspaceIdFromBody(body);
          if (!workspaceId) {
            throw new Error("Missing workspaceId");
          }
          const active = buildBotRuns.get(workspaceId);
          const wasRunning = Boolean(active?.promise);
          const runId = active?.run.id ??
            readWorkspaceBuildRunForGraphql(workspaceId).id;
          const run = await stopWorkspaceBuildRun({
            workspaceId,
            runId,
          });
          return new Response(JSON.stringify({ stopped: wasRunning, run }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (url.pathname === "/api/build/reset") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json().catch(() => ({})) as Record<
            string,
            unknown
          >;
          const workspaceId = _getWorkspaceIdFromBody(body);
          if (!workspaceId) {
            throw new Error("Missing workspaceId");
          }
          const run = await resetWorkspaceBuild(workspaceId);
          return new Response(JSON.stringify({ reset: true, run }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (url.pathname === "/api/build/files") {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const workspaceId = getWorkspaceIdFromQuery(url) ??
            activeWorkspaceId ??
            "";
          await logWorkspaceBotRoot("/api/build/files", workspaceId);
          const root = await resolveBuildBotRoot(workspaceId);
          const records = await readWorkspaceFiles({
            workspaceId: asGambitID(workspaceId),
          });
          const entries = records.map((record) => ({
            path: record.path,
            type: "file" as const,
            size: typeof record.size === "number" ? record.size : undefined,
            modifiedAt: record.modifiedAt ?? undefined,
          }));
          return new Response(JSON.stringify({ root, entries }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (url.pathname === "/api/build/file") {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        const workspaceId = getWorkspaceIdFromQuery(url) ?? activeWorkspaceId ??
          "";
        await logWorkspaceBotRoot("/api/build/file", workspaceId);
        const inputPath = url.searchParams.get("path") ?? "";
        if (!inputPath) {
          return new Response(JSON.stringify({ error: "Missing path" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        try {
          const root = await resolveBuildBotRoot(workspaceId);
          const resolved = await resolveBuildBotPath(root, inputPath);
          if (!resolved.stat.isFile) {
            return new Response(
              JSON.stringify({ error: "Path is not a file" }),
              {
                status: 400,
                headers: { "content-type": "application/json" },
              },
            );
          }
          if (
            typeof resolved.stat.size === "number" &&
            resolved.stat.size > MAX_FILE_PREVIEW_BYTES
          ) {
            return new Response(
              JSON.stringify({
                path: resolved.relativePath,
                tooLarge: true,
                size: resolved.stat.size,
              }),
              {
                headers: { "content-type": "application/json" },
              },
            );
          }
          const bytes = await Deno.readFile(resolved.fullPath);
          const text = readPreviewText(bytes);
          if (text === null) {
            return new Response(
              JSON.stringify({
                path: resolved.relativePath,
                binary: true,
                size: resolved.stat.size,
              }),
              {
                headers: { "content-type": "application/json" },
              },
            );
          }
          return new Response(
            JSON.stringify({
              path: resolved.relativePath,
              contents: text,
              size: resolved.stat.size,
            }),
            {
              headers: { "content-type": "application/json" },
            },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return new Response(JSON.stringify({ error: message }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
      }
      if (url.pathname.startsWith("/api/")) {
        return new Response("Not found", { status: 404 });
      }
      if (url.pathname === "/graphql/streams") {
        return handleGraphqlStreamMultiplexRequest(req);
      }
      if (url.pathname.startsWith(GRAPHQL_STREAMS_PREFIX)) {
        return handleDurableStreamRequest(req);
      }
      const simulatorGraphqlOperations: SimulatorGraphqlOperations = {
        listWorkspaces: () => Promise.resolve(listSessions()),
        createWorkspace: async () => {
          const created = await _createWorkspaceSession();
          return { workspaceId: created.id };
        },
        deleteWorkspace: (workspaceId: string) => {
          const deleted = _deleteSessionState(workspaceId);
          if (deleted) {
            stopWorkspaceFsWatcher(workspaceId);
            workspaceById.delete(workspaceId);
            buildBotRuns.delete(workspaceId);
          }
          return Promise.resolve({ ok: deleted });
        },
        readWorkspaceBuildRun: (workspaceId: string) =>
          Promise.resolve(readWorkspaceBuildRunForGraphql(workspaceId)),
        createWorkspaceBuildRun: async (
          workspaceId: string,
          message: string,
        ) => await startWorkspaceBuildRun({ workspaceId, message }),
        stopWorkspaceBuildRun: async (workspaceId: string, runId: string) =>
          await stopWorkspaceBuildRun({ workspaceId, runId }),
        resetWorkspaceBuild: async (workspaceId: string) =>
          await resetWorkspaceBuild(workspaceId),
        createWorkspaceScenarioRun: async (args: {
          workspaceId: string;
          scenarioDeckId?: string | null;
          scenarioInput?: unknown;
          assistantInit?: unknown;
        }) => await startWorkspaceScenarioRunForGraphql(args),
        sendWorkspaceScenarioRun: async (args: {
          workspaceId: string;
          runId: string;
          message: string;
        }) => await sendWorkspaceScenarioRunForGraphql(args),
        stopWorkspaceScenarioRun: async (args: {
          workspaceId: string;
          runId: string;
        }) => await stopWorkspaceScenarioRunForGraphql(args),
        readWorkspaceScenarioRuns: async (workspaceId: string) =>
          await readWorkspaceScenarioRunsForGraphql(workspaceId),
        readWorkspaceModelStatus: async (args: {
          workspaceId: string;
          model: "codex";
          checkOnline?: boolean;
        }) => {
          if (args.model !== "codex") {
            return {
              model: args.model,
              workspaceId: args.workspaceId,
              available: false,
              requiresLogin: false,
              loggedIn: false,
              statusText: "Model status is unavailable.",
              writeEnabled: false,
            };
          }
          const status = await readCodexWorkspaceStatus(
            args.workspaceId,
            args.checkOnline,
          );
          return {
            model: "codex" as const,
            workspaceId: args.workspaceId,
            available: status.writeEnabled && status.codexLoggedIn,
            requiresLogin: !status.codexLoggedIn,
            loggedIn: status.codexLoggedIn,
            statusText: status.codexLoginStatus,
            trustedPath: status.trustedPath,
            writeEnabled: status.writeEnabled,
          };
        },
        listWorkspaceGraderDecks: async (workspaceId: string) => {
          await activateWorkspaceDeck(workspaceId, {
            source: "graphql:listWorkspaceGraderDecks",
          });
          return availableGraderDecks.map((deck) => ({
            id: deck.id,
            label: deck.label,
            description: deck.description,
            path: deck.path,
          }));
        },
        readWorkspaceGradeRuns: async (workspaceId: string) =>
          await readWorkspaceGradeRunsForGraphql(workspaceId),
        readWorkspaceGradingFlags: async (workspaceId: string) =>
          await readWorkspaceGradingFlagsForGraphql(workspaceId),
        createWorkspaceGradeRun: async (args: {
          workspaceId: string;
          graderId: string;
          scenarioRunId?: string | null;
        }) => await createWorkspaceGradeRunForGraphql(args),
        toggleWorkspaceGradeFlag: async (args: {
          workspaceId: string;
          refId: string;
          runId: string;
          turnIndex?: number | null;
        }) => await toggleWorkspaceGradeFlagForGraphql(args),
        updateWorkspaceGradeFlagReason: async (args: {
          workspaceId: string;
          refId: string;
          reason: string;
        }) => await updateWorkspaceGradeFlagReasonForGraphql(args),
        readWorkspaceVerifyBatches: async (workspaceId: string) =>
          await readWorkspaceVerifyBatchesForGraphql(workspaceId),
        createWorkspaceVerifyBatchRun: async (args: {
          workspaceId: string;
          graderId: string;
          scenarioRunId?: string | null;
          batchSize: number;
          concurrency: number;
        }) => await createWorkspaceVerifyBatchRunForGraphql(args),
        listWorkspaceScenarioDecks: async (workspaceId: string) => {
          logWorkspaceRefreshDebug("graphql.scenarioDecks.list.begin", {
            workspaceId,
            resolvedDeckPath,
            ...summarizeScenarioDeckRegistry(),
          });
          await activateWorkspaceDeck(workspaceId, {
            source: "graphql:listWorkspaceScenarioDecks",
          });
          logWorkspaceRefreshDebug("graphql.scenarioDecks.list.afterActivate", {
            workspaceId,
            resolvedDeckPath,
            ...summarizeScenarioDeckRegistry(),
          });
          const enrichedDecks = await Promise.all(availableTestDecks.map(
            async (deck) => {
              const config = await readDeckGraphqlConfigCached(deck.path);
              return {
                id: deck.id,
                label: deck.label,
                description: deck.description,
                path: deck.path,
                maxTurns: deck.maxTurns,
                inputSchema: config.inputSchema,
                defaults: config.defaults,
                inputSchemaError: config.inputSchemaError,
              };
            },
          ));
          const result = enrichedDecks.map((deck) => ({
            id: deck.id,
            label: deck.label,
            description: deck.description,
            path: deck.path,
            maxTurns: deck.maxTurns,
            inputSchema: deck.inputSchema,
            defaults: deck.defaults,
            inputSchemaError: deck.inputSchemaError,
          }));
          logWorkspaceRefreshDebug("graphql.scenarioDecks.list.return", {
            workspaceId,
            returnedDeckCount: result.length,
            returnedDeckPaths: result.slice(0, 12).map((deck) => deck.path),
          });
          return result;
        },
        readWorkspaceAssistantDeck: async (workspaceId: string) => {
          await activateWorkspaceDeck(workspaceId, {
            source: "graphql:readWorkspaceAssistantDeck",
          });
          const primaryDeckPath = resolvedDeckPath;
          return await readDeckGraphqlConfigCached(primaryDeckPath);
        },
      };
      if (url.pathname === "/graphql/stream") {
        return await handleGraphqlSubscriptionStreamRequest(req, {
          readWorkspaceFiles,
          ...simulatorGraphqlOperations,
        });
      }
      if (url.pathname === "/graphql") {
        return await gambitYoga.fetch(req, {
          readWorkspaceFiles,
          ...simulatorGraphqlOperations,
        });
      }
      if (url.pathname === "/v1/responses") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        if (!opts.modelProvider.responses) {
          return jsonResponse(
            { error: "Configured provider does not support responses." },
            501,
          );
        }
        try {
          const body = parseBodyObject(await req.json());
          const model = typeof body.model === "string" ? body.model : undefined;
          if (!model) {
            throw new Error("model is required");
          }
          const input = normalizeInputItems(body.input);
          const stream = body.stream === true;
          const instructions = typeof body.instructions === "string"
            ? body.instructions
            : undefined;
          const previousResponseId =
            typeof body.previous_response_id === "string"
              ? body.previous_response_id
              : undefined;
          const store = typeof body.store === "boolean"
            ? body.store
            : undefined;
          const tools = normalizeTools(body.tools);
          const toolChoice = normalizeToolChoice(body.tool_choice);
          const reasoning = (body.reasoning &&
              typeof body.reasoning === "object" &&
              !Array.isArray(body.reasoning))
            ? body.reasoning as CreateResponseRequest["reasoning"]
            : undefined;
          const parallelToolCalls =
            typeof body.parallel_tool_calls === "boolean"
              ? body.parallel_tool_calls
              : undefined;
          const maxToolCalls = typeof body.max_tool_calls === "number"
            ? body.max_tool_calls
            : undefined;
          const temperature = typeof body.temperature === "number"
            ? body.temperature
            : undefined;
          const topP = typeof body.top_p === "number" ? body.top_p : undefined;
          const frequencyPenalty = typeof body.frequency_penalty === "number"
            ? body.frequency_penalty
            : undefined;
          const presencePenalty = typeof body.presence_penalty === "number"
            ? body.presence_penalty
            : undefined;
          const maxOutputTokens = typeof body.max_output_tokens === "number"
            ? body.max_output_tokens
            : undefined;
          const topLogprobs = typeof body.top_logprobs === "number"
            ? body.top_logprobs
            : undefined;
          const truncation = body.truncation === "auto" ||
              body.truncation === "disabled"
            ? body.truncation
            : undefined;
          const text = (body.text && typeof body.text === "object" &&
              !Array.isArray(body.text))
            ? body.text as CreateResponseRequest["text"]
            : undefined;
          const streamOptions = (body.stream_options &&
              typeof body.stream_options === "object" &&
              !Array.isArray(body.stream_options))
            ? body.stream_options as CreateResponseRequest["stream_options"]
            : undefined;
          const background = typeof body.background === "boolean"
            ? body.background
            : undefined;
          const include = Array.isArray(body.include)
            ? body.include.filter((entry): entry is string =>
              typeof entry === "string"
            )
            : undefined;
          const serviceTier = body.service_tier === "auto" ||
              body.service_tier === "default" || body.service_tier === "flex" ||
              body.service_tier === "priority"
            ? body.service_tier
            : undefined;
          const metadata = (body.metadata &&
              typeof body.metadata === "object" &&
              !Array.isArray(body.metadata))
            ? body.metadata as Record<string, JSONValue>
            : undefined;
          const safetyIdentifier = typeof body.safety_identifier === "string"
            ? body.safety_identifier
            : undefined;
          const promptCacheKey = typeof body.prompt_cache_key === "string"
            ? body.prompt_cache_key
            : undefined;
          const passthrough: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(body)) {
            if (
              key === "model" || key === "input" || key === "stream" ||
              key === "instructions" || key === "tools" ||
              key === "tool_choice" || key === "max_output_tokens" ||
              key === "previous_response_id" || key === "store" ||
              key === "reasoning" || key === "parallel_tool_calls" ||
              key === "max_tool_calls" || key === "temperature" ||
              key === "top_p" || key === "frequency_penalty" ||
              key === "presence_penalty" || key === "include" ||
              key === "text" || key === "stream_options" ||
              key === "background" || key === "truncation" ||
              key === "service_tier" || key === "top_logprobs" ||
              key === "metadata" || key === "safety_identifier" ||
              key === "prompt_cache_key" || key === "params"
            ) {
              continue;
            }
            passthrough[key] = value;
          }
          const explicitParams = (body.params &&
              typeof body.params === "object" &&
              !Array.isArray(body.params))
            ? body.params as Record<string, unknown>
            : undefined;
          const params = explicitParams || Object.keys(passthrough).length > 0
            ? { ...(explicitParams ?? {}), ...passthrough }
            : undefined;
          const requestBody: CreateResponseRequest = {
            model,
            input,
            instructions,
            previous_response_id: previousResponseId,
            store,
            tools,
            tool_choice: toolChoice,
            reasoning,
            parallel_tool_calls: parallelToolCalls,
            max_tool_calls: maxToolCalls,
            temperature,
            top_p: topP,
            frequency_penalty: frequencyPenalty,
            presence_penalty: presencePenalty,
            stream,
            stream_options: streamOptions,
            max_output_tokens: maxOutputTokens,
            top_logprobs: topLogprobs,
            truncation,
            text,
            include,
            background,
            service_tier: serviceTier,
            metadata,
            safety_identifier: safetyIdentifier,
            prompt_cache_key: promptCacheKey,
            params,
          };

          if (!stream) {
            const response = await opts.modelProvider.responses({
              request: requestBody,
            });
            return jsonResponse(
              toStrictResponseResource({
                request: requestBody,
                response,
              }),
            );
          }

          const streamBody = new ReadableStream<Uint8Array>({
            start: async (controller) => {
              let sequence = 1;
              const itemIdByOutputIndex = new Map<number, string>();
              const streamRequest: CreateResponseRequest = {
                ...requestBody,
                stream: true,
              };
              try {
                const result = await opts.modelProvider.responses!({
                  request: streamRequest,
                  onStreamEvent: (event: ResponseEvent) => {
                    if (event.type === "response.created") {
                      controller.enqueue(
                        sseFrame({
                          type: "response.created",
                          sequence_number: sequence++,
                          response: toStrictResponseResource({
                            request: streamRequest,
                            response: event.response,
                            statusOverride: "in_progress",
                          }),
                        }),
                      );
                      return;
                    }
                    if (event.type === "response.output_text.delta") {
                      const itemId = event.item_id ??
                        itemIdByOutputIndex.get(event.output_index) ??
                        `msg_${event.output_index + 1}`;
                      itemIdByOutputIndex.set(event.output_index, itemId);
                      controller.enqueue(
                        sseFrame({
                          type: "response.output_text.delta",
                          sequence_number: sequence++,
                          output_index: event.output_index,
                          item_id: itemId,
                          content_index: event.content_index ?? 0,
                          delta: event.delta,
                          logprobs: event.logprobs ?? [],
                        }),
                      );
                      return;
                    }
                    if (event.type === "response.output_text.done") {
                      const itemId = event.item_id ??
                        itemIdByOutputIndex.get(event.output_index) ??
                        `msg_${event.output_index + 1}`;
                      itemIdByOutputIndex.set(event.output_index, itemId);
                      controller.enqueue(
                        sseFrame({
                          type: "response.output_text.done",
                          sequence_number: sequence++,
                          output_index: event.output_index,
                          item_id: itemId,
                          content_index: event.content_index ?? 0,
                          text: event.text,
                          logprobs: [],
                        }),
                      );
                      return;
                    }
                    if (event.type === "response.completed") {
                      controller.enqueue(
                        sseFrame({
                          type: "response.completed",
                          sequence_number: sequence++,
                          response: toStrictResponseResource({
                            request: streamRequest,
                            response: event.response,
                            statusOverride: "completed",
                          }),
                        }),
                      );
                      return;
                    }
                    if (event.type === "response.failed") {
                      controller.enqueue(
                        sseFrame({
                          type: "response.failed",
                          sequence_number: sequence++,
                          response: {
                            ...toStrictResponseResource({
                              request: streamRequest,
                              response: {
                                id: `resp_${crypto.randomUUID().slice(0, 8)}`,
                                object: "response",
                                output: [],
                                status: "failed",
                                error: event.error ??
                                  { message: "Unknown error" },
                              },
                              statusOverride: "failed",
                            }),
                            error: event.error ?? { message: "Unknown error" },
                          },
                        }),
                      );
                    }
                  },
                });
                controller.enqueue(
                  sseFrame({
                    type: "response.completed",
                    sequence_number: sequence++,
                    response: toStrictResponseResource({
                      request: streamRequest,
                      response: result,
                      statusOverride: "completed",
                    }),
                  }),
                );
                controller.enqueue(
                  new TextEncoder().encode("data: [DONE]\n\n"),
                );
              } catch (err) {
                controller.enqueue(
                  sseFrame({
                    type: "error",
                    code: "internal_error",
                    message: err instanceof Error ? err.message : String(err),
                    param: null,
                  }),
                );
              } finally {
                controller.close();
              }
            },
          });
          return new Response(streamBody, {
            headers: {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              "connection": "keep-alive",
            },
          });
        } catch (err) {
          return jsonResponse(
            { error: err instanceof Error ? err.message : String(err) },
            400,
          );
        }
      }
      if (url.pathname === "/favicon.ico") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const data = await Deno.readFile(simulatorFaviconDistPath);
          return new Response(req.method === "HEAD" ? null : data, {
            headers: { "content-type": "image/x-icon" },
          });
        } catch {
          try {
            const data = await Deno.readFile(simulatorFaviconSrcPath);
            return new Response(req.method === "HEAD" ? null : data, {
              headers: { "content-type": "image/x-icon" },
            });
          } catch {
            return new Response("Not found", { status: 404 });
          }
        }
      }

      const matchedEntrypoint = Array.from(simulatorIsographAppRoutes).find(
        ([pattern]) =>
          matchSimulatorRouteWithParams(url.pathname, pattern).match,
      )?.[1];
      const maybePathRedirect = (() => {
        if (!matchedEntrypoint) return null;
        const globals = globalThis as typeof globalThis & {
          __GAMBIT_CURRENT_PATH__?: unknown;
        };
        const previousPath = globals.__GAMBIT_CURRENT_PATH__;
        globals.__GAMBIT_CURRENT_PATH__ = url.pathname;
        try {
          return getRedirectFromEntrypoint(matchedEntrypoint);
        } finally {
          if (previousPath === undefined) {
            delete globals.__GAMBIT_CURRENT_PATH__;
          } else {
            globals.__GAMBIT_CURRENT_PATH__ = previousPath;
          }
        }
      })();
      if (maybePathRedirect) {
        return createServerRedirectResponse(maybePathRedirect.location);
      }

      const uiRoutesResponse = await handleUiRoutes({
        url,
        workspaceRouteBase: WORKSPACE_ROUTE_BASE,
        activeWorkspaceId,
        activeWorkspaceOnboarding,
        resolvedDeckPath,
        deckLabel,
        getWorkspaceIdFromQuery,
        activateWorkspaceDeck,
        schemaPromise,
        deckLoadPromise,
        canServeReactBundle,
        simulatorReactHtml: (rootDeckPath, rootDeckLabel, opts) =>
          simulatorReactHtml(
            rootDeckPath,
            rootDeckLabel,
            opts,
          ),
        toDeckLabel,
        readReactBundle,
        shouldAdvertiseSourceMap,
        readReactBundleSourceMap,
      });
      if (uiRoutesResponse) return uiRoutesResponse;

      return new Response("Not found", { status: 404 });
    },
  );

  const listenPort = (server.addr as Deno.NetAddr).port;
  logger.log(
    `Simulator listening on http://localhost:${listenPort} (deck=${resolvedDeckPath})`,
  );
  server.finished.finally(() => {
    for (const workspaceId of workspaceFsWatchers.keys()) {
      stopWorkspaceFsWatcher(workspaceId);
    }
  });
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

function newestMtimeInDir(dirPath: string): number | undefined {
  const stack: Array<string> = [dirPath];
  let newest: number | undefined = undefined;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: Array<Deno.DirEntry>;
    try {
      entries = Array.from(Deno.readDirSync(current));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile) continue;
      try {
        const stat = Deno.statSync(entryPath);
        if (!stat.isFile) continue;
        const mtime = stat.mtime?.getTime();
        if (typeof mtime !== "number") continue;
        newest = newest === undefined ? mtime : Math.max(newest, mtime);
      } catch {
        continue;
      }
    }
  }
  return newest;
}

function isReactBundleStale(): boolean {
  try {
    const bundleStat = Deno.statSync(simulatorBundlePath);
    if (!bundleStat.isFile) return false;
    const bundleTime = bundleStat.mtime?.getTime();
    if (typeof bundleTime !== "number") {
      return false;
    }
    const srcRoot = path.resolve(moduleDir, "..", "simulator-ui", "src");
    const newestSource = newestMtimeInDir(srcRoot);
    if (typeof newestSource !== "number") return false;
    return newestSource > bundleTime;
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

async function simulatorReactHtml(
  deckPath: string,
  deckLabel?: string,
  opts?: {
    workspaceId?: string | null;
    onboarding?: boolean;
    currentPath?: string;
  },
  readWorkspaceFiles?: ReadWorkspaceFiles,
  operations?: SimulatorGraphqlOperations,
): Promise<string> {
  const safeDeckPath = deckPath.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const safeDeckLabel =
    deckLabel?.replaceAll("<", "&lt;").replaceAll(">", "&gt;") ?? null;
  const buildTabEnabled = (() => {
    const raw = Deno.env.get("GAMBIT_SIMULATOR_BUILD_TAB");
    if (raw === undefined) return true;
    const normalized = raw.trim().toLowerCase();
    return !(normalized === "0" || normalized === "false" ||
      normalized === "no" ||
      normalized === "off");
  })();
  const verifyTabEnabled = (() => {
    const raw = Deno.env.get("GAMBIT_SIMULATOR_VERIFY_TAB");
    if (raw === undefined) return true;
    const normalized = raw.trim().toLowerCase();
    return !(normalized === "0" || normalized === "false" ||
      normalized === "no" ||
      normalized === "off");
  })();
  const chatAccordionEnabled = (() => {
    const raw = Deno.env.get("GAMBIT_SIMULATOR_CHAT_ACCORDION");
    if (raw === undefined) return true;
    const normalized = raw.trim().toLowerCase();
    return normalized === "1" || normalized === "true" ||
      normalized === "yes" ||
      normalized === "on";
  })();
  const buildStreamDebugEnabled = (() => {
    const raw = Deno.env.get("GAMBIT_SIMULATOR_BUILD_STREAM_DEBUG");
    if (raw === undefined) return false;
    const normalized = raw.trim().toLowerCase();
    return normalized === "1" || normalized === "true" ||
      normalized === "yes" ||
      normalized === "on";
  })();
  const gambitDev = (() => {
    const raw = (Deno.env.get("GAMBIT_ENV") ?? Deno.env.get("NODE_ENV") ?? "")
      .trim()
      .toLowerCase();
    return raw === "development" || raw === "dev" || raw === "local";
  })();
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
  const workspaceId = opts?.workspaceId ?? null;
  const workspaceOnboarding = Boolean(opts?.onboarding);
  const buildChatProvider = (() => {
    const raw = (Deno.env.get("GAMBIT_SIMULATOR_BUILD_CHAT_PROVIDER") ?? "")
      .trim()
      .toLowerCase();
    return raw === "claude-code-cli" ? "claude-code-cli" : "codex-cli";
  })();
  const currentPath = opts?.currentPath ?? "/";
  const serializeForScript = (value: unknown): string =>
    JSON.stringify(value)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");

  let rootMarkup = "";
  let isoPreloads: Record<string, unknown> = {};
  if (readWorkspaceFiles) {
    try {
      const globals = globalThis as typeof globalThis & {
        __GAMBIT_CURRENT_PATH__?: unknown;
        __GAMBIT_DECK_PATH__?: unknown;
        __GAMBIT_DECK_LABEL__?: unknown;
        __GAMBIT_VERSION__?: unknown;
        __GAMBIT_BUILD_TAB_ENABLED__?: unknown;
        __GAMBIT_VERIFY_TAB_ENABLED__?: unknown;
        __GAMBIT_CHAT_ACCORDION_ENABLED__?: unknown;
        __GAMBIT_WORKSPACE_ID__?: unknown;
        __GAMBIT_WORKSPACE_ONBOARDING__?: unknown;
        __GAMBIT_BUILD_STREAM_DEBUG__?: unknown;
        __GAMBIT_DEV__?: unknown;
      };
      const previousPath = globals.__GAMBIT_CURRENT_PATH__;
      const previousDeckPath = globals.__GAMBIT_DECK_PATH__;
      const previousDeckLabel = globals.__GAMBIT_DECK_LABEL__;
      const previousVersion = globals.__GAMBIT_VERSION__;
      const previousBuildTabEnabled = globals.__GAMBIT_BUILD_TAB_ENABLED__;
      const previousVerifyTabEnabled = globals.__GAMBIT_VERIFY_TAB_ENABLED__;
      const previousChatAccordionEnabled =
        globals.__GAMBIT_CHAT_ACCORDION_ENABLED__;
      const previousWorkspaceId = globals.__GAMBIT_WORKSPACE_ID__;
      const previousWorkspaceOnboarding =
        globals.__GAMBIT_WORKSPACE_ONBOARDING__;
      const previousBuildStreamDebug = globals.__GAMBIT_BUILD_STREAM_DEBUG__;
      const previousDev = globals.__GAMBIT_DEV__;
      globals.__GAMBIT_CURRENT_PATH__ = currentPath;
      globals.__GAMBIT_DECK_PATH__ = safeDeckPath;
      globals.__GAMBIT_DECK_LABEL__ = safeDeckLabel;
      globals.__GAMBIT_VERSION__ = gambitVersion;
      globals.__GAMBIT_BUILD_TAB_ENABLED__ = buildTabEnabled;
      globals.__GAMBIT_VERIFY_TAB_ENABLED__ = verifyTabEnabled;
      globals.__GAMBIT_CHAT_ACCORDION_ENABLED__ = chatAccordionEnabled;
      globals.__GAMBIT_WORKSPACE_ID__ = workspaceId;
      globals.__GAMBIT_WORKSPACE_ONBOARDING__ = workspaceOnboarding;
      globals.__GAMBIT_BUILD_STREAM_DEBUG__ = buildStreamDebugEnabled;
      globals.__GAMBIT_DEV__ = gambitDev;
      try {
        const { environment, preloads } = getSimulatorIsographEnvironment(
          readWorkspaceFiles,
          operations,
        );
        const stream = await renderToReadableStream(
          createElement(AppRoot, { environment, initialPath: currentPath }),
        );
        if ("allReady" in stream && stream.allReady) {
          await stream.allReady;
        }
        rootMarkup = await new Response(stream).text();
        isoPreloads = preloads;
      } finally {
        if (previousPath === undefined) {
          delete globals.__GAMBIT_CURRENT_PATH__;
        } else {
          globals.__GAMBIT_CURRENT_PATH__ = previousPath;
        }
        if (previousDeckPath === undefined) {
          delete globals.__GAMBIT_DECK_PATH__;
        } else {
          globals.__GAMBIT_DECK_PATH__ = previousDeckPath;
        }
        if (previousDeckLabel === undefined) {
          delete globals.__GAMBIT_DECK_LABEL__;
        } else {
          globals.__GAMBIT_DECK_LABEL__ = previousDeckLabel;
        }
        if (previousVersion === undefined) {
          delete globals.__GAMBIT_VERSION__;
        } else {
          globals.__GAMBIT_VERSION__ = previousVersion;
        }
        if (previousBuildTabEnabled === undefined) {
          delete globals.__GAMBIT_BUILD_TAB_ENABLED__;
        } else {
          globals.__GAMBIT_BUILD_TAB_ENABLED__ = previousBuildTabEnabled;
        }
        if (previousVerifyTabEnabled === undefined) {
          delete globals.__GAMBIT_VERIFY_TAB_ENABLED__;
        } else {
          globals.__GAMBIT_VERIFY_TAB_ENABLED__ = previousVerifyTabEnabled;
        }
        if (previousChatAccordionEnabled === undefined) {
          delete globals.__GAMBIT_CHAT_ACCORDION_ENABLED__;
        } else {
          globals.__GAMBIT_CHAT_ACCORDION_ENABLED__ =
            previousChatAccordionEnabled;
        }
        if (previousWorkspaceId === undefined) {
          delete globals.__GAMBIT_WORKSPACE_ID__;
        } else {
          globals.__GAMBIT_WORKSPACE_ID__ = previousWorkspaceId;
        }
        if (previousWorkspaceOnboarding === undefined) {
          delete globals.__GAMBIT_WORKSPACE_ONBOARDING__;
        } else {
          globals.__GAMBIT_WORKSPACE_ONBOARDING__ = previousWorkspaceOnboarding;
        }
        if (previousBuildStreamDebug === undefined) {
          delete globals.__GAMBIT_BUILD_STREAM_DEBUG__;
        } else {
          globals.__GAMBIT_BUILD_STREAM_DEBUG__ = previousBuildStreamDebug;
        }
        if (previousDev === undefined) {
          delete globals.__GAMBIT_DEV__;
        } else {
          globals.__GAMBIT_DEV__ = previousDev;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rootMarkup =
        `<div style="padding:16px;font-family:ui-sans-serif,system-ui,sans-serif;color:#b91c1c">SSR error: ${
          message.replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        }</div>`;
    }
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Gambit Debug</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
${globalStyles}
  </style>
</head>
<body>
  <div id="root">${rootMarkup}</div>
  <script>
    window.__GAMBIT_DECK_PATH__ = ${JSON.stringify(safeDeckPath)};
    window.__GAMBIT_DECK_LABEL__ = ${JSON.stringify(safeDeckLabel)};
    window.__GAMBIT_VERSION__ = ${JSON.stringify(gambitVersion)};
    window.__GAMBIT_BUILD_TAB_ENABLED__ = ${JSON.stringify(buildTabEnabled)};
    window.__GAMBIT_VERIFY_TAB_ENABLED__ = ${JSON.stringify(verifyTabEnabled)};
    window.__GAMBIT_CHAT_ACCORDION_ENABLED__ = ${
    JSON.stringify(
      chatAccordionEnabled,
    )
  };
    window.__GAMBIT_WORKSPACE_ID__ = ${JSON.stringify(workspaceId)};
    window.__GAMBIT_WORKSPACE_ONBOARDING__ = ${
    JSON.stringify(
      workspaceOnboarding,
    )
  };
    window.__GAMBIT_BUILD_STREAM_DEBUG__ = ${
    JSON.stringify(
      buildStreamDebugEnabled,
    )
  };
    window.__GAMBIT_BUILD_CHAT_PROVIDER__ = ${
    JSON.stringify(
      buildChatProvider,
    )
  };
    window.__GAMBIT_DEV__ = ${JSON.stringify(gambitDev)};
    window.__GAMBIT_CURRENT_PATH__ = ${JSON.stringify(currentPath)};
    window.__ISO_PRELOADED__ = ${serializeForScript(isoPreloads)};
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

function resolveWorkerSandboxForSignalAwareRun(args: {
  workerSandbox?: boolean;
  signal?: AbortSignal;
}): boolean | undefined {
  // gambit-core currently rejects worker sandbox runs when an AbortSignal is
  // supplied. Simulator flows require signals for stop/reset cancellation, so
  // force in-process execution for those runs.
  if (args.signal) return false;
  return args.workerSandbox;
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
  responsesMode?: boolean;
  workerSandbox?: boolean;
  signal?: AbortSignal;
  onCancel?: () => unknown | Promise<unknown>;
}): Promise<unknown> {
  const workerSandbox = resolveWorkerSandboxForSignalAwareRun({
    workerSandbox: args.workerSandbox,
    signal: args.signal,
  });
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
      responsesMode: args.responsesMode,
      workerSandbox,
      signal: args.signal,
      onCancel: args.onCancel,
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
        responsesMode: args.responsesMode,
        workerSandbox,
        signal: args.signal,
        onCancel: args.onCancel,
      });
    }
    throw error;
  }
}
