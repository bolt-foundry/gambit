import * as path from "@std/path";
import { copy, ensureDir, existsSync } from "@std/fs";
import { parse } from "@std/jsonc";
import { parse as parseToml } from "@std/toml";
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
  OutgoingMessage,
  SchemaDescription,
  SessionMeta,
} from "./server_types.ts";
import { createSessionStore } from "./server_session_store.ts";
import {
  handleFeedbackRoutes,
  handleGradingReferenceRoute,
} from "./server_feedback_grading_routes.ts";
import { handleUiRoutes } from "./server_ui_routes.ts";
import {
  resolveWorkspaceIdFromRecord,
  resolveWorkspaceIdFromSearchParams,
  WORKSPACE_API_BASE,
  WORKSPACE_ROUTE_BASE,
  WORKSPACE_STATE_SCHEMA_VERSION,
  WORKSPACES_API_BASE,
  workspaceSchemaError,
} from "./workspace_contract.ts";
import {
  appendDurableStreamEvent,
  handleDurableStreamRequest,
} from "./durable_streams.ts";
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
const SIMULATOR_STREAM_ID = "gambit-simulator";
const WORKSPACE_STREAM_ID = "gambit-workspace";
const GRADE_STREAM_ID = "gambit-grade";
const TEST_STREAM_ID = "gambit-test";
const BUILD_STREAM_ID = "gambit-build";
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
const GAMBIT_BOT_SOURCE_DECK_URL = new URL(
  "./decks/gambit-bot/PROMPT.md",
  import.meta.url,
);
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
  await copy(GAMBIT_BOT_POLICY_DIR, dest, { overwrite: false });
}
let availableTestDecks: Array<AvailableTestDeck> = [];
const testDeckByPath = new Map<string, AvailableTestDeck>();
const testDeckById = new Map<string, AvailableTestDeck>();
let availableGraderDecks: Array<AvailableGraderDeck> = [];
const graderDeckByPath = new Map<string, AvailableGraderDeck>();
const graderDeckById = new Map<string, AvailableGraderDeck>();

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

function getPathValue(value: unknown, path: Array<string>): unknown {
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

function setPathValue(
  value: unknown,
  path: Array<string>,
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

function buildInitFillPrompt(args: {
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

function parseInitFillOutput(
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

function validateInitInput(schema: ZodTypeAny | undefined, value: unknown) {
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
  return {
    type: "reasoning",
    id: item.id ?? `rs_${index + 1}`,
    content: (item.content ?? []).map((part) => toStrictContentPart(part)),
    summary: item.summary.map((part) => toStrictContentPart(part)),
    encrypted_content: item.encrypted_content ?? null,
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
  const consoleTracer = opts.verbose ? makeConsoleTracer() : undefined;
  let resolvedDeckPath = resolveDeckPath(opts.deckPath);
  const buildBotRootCache = new Map<string, string>();
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
    promise: Promise<void> | null;
    abort: AbortController | null;
  };
  const testBotRuns = new Map<string, TestBotRunEntry>();
  const broadcastTestBot = (payload: unknown, workspaceId?: string) => {
    if (workspaceId) {
      const state = readSessionState(workspaceId);
      if (state) {
        appendWorkspaceEnvelope(
          state,
          "test",
          payload as Record<string, unknown>,
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

  const MAX_FILE_PREVIEW_BYTES = 250_000;

  type BuildBotFileEntry = {
    path: string;
    type: "file" | "dir";
    size?: number;
    modifiedAt?: string;
    label?: string;
  };

  const shouldReadBuildDeckLabel = (relativePath: string): boolean => {
    const lower = path.basename(relativePath).toLowerCase();
    return lower === "prompt.md" || lower.endsWith(".deck.md");
  };

  const readBuildDeckLabel = async (
    fullPath: string,
  ): Promise<string | undefined> => {
    try {
      const text = await Deno.readTextFile(fullPath);
      const lines = text.split(/\r?\n/);
      if (lines[0] !== "+++") return undefined;
      const endIndex = lines.indexOf("+++", 1);
      if (endIndex === -1) return undefined;
      const frontmatter = lines.slice(1, endIndex).join("\n");
      const parsed = parseToml(frontmatter) as Record<string, unknown>;
      const label = typeof parsed.label === "string" ? parsed.label.trim() : "";
      return label.length > 0 ? label : undefined;
    } catch {
      return undefined;
    }
  };

  const listBuildBotFiles = async (
    root: string,
  ): Promise<Array<BuildBotFileEntry>> => {
    const entries: Array<BuildBotFileEntry> = [];
    const shouldSkipRelativePath = (relativePath: string) => {
      const segments = relativePath.split(/\\|\//g).filter(Boolean);
      return segments.includes(".gambit");
    };
    const walk = async (dir: string, relativePrefix: string) => {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isSymlink) continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = relativePrefix
          ? path.join(relativePrefix, entry.name)
          : entry.name;
        if (shouldSkipRelativePath(relPath)) continue;
        if (entry.isDirectory) {
          entries.push({ path: relPath, type: "dir" });
          await walk(fullPath, relPath);
        } else if (entry.isFile) {
          const info = await Deno.stat(fullPath);
          const label = shouldReadBuildDeckLabel(relPath)
            ? await readBuildDeckLabel(fullPath)
            : undefined;
          entries.push({
            path: relPath,
            type: "file",
            size: info.size,
            modifiedAt: info.mtime ? info.mtime.toISOString() : undefined,
            label,
          });
        }
      }
    };
    await walk(root, "");
    return entries;
  };

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

  const isBuildStreamDebugEnabled = (() => {
    const raw = Deno.env.get("GAMBIT_BUILD_STREAM_DEBUG")?.trim()
      .toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
  })();

  const logBuildStreamDebug = (
    event: string,
    payload?: Record<string, unknown>,
  ) => {
    if (!isBuildStreamDebugEnabled) return;
    const ts = new Date().toISOString();
    if (payload && Object.keys(payload).length > 0) {
      logger.info(
        `[build-stream-debug] ${ts} ${event} ${JSON.stringify(payload)}`,
      );
      return;
    }
    logger.info(`[build-stream-debug] ${ts} ${event}`);
  };

  const broadcastBuildBot = (payload: unknown, workspaceId?: string) => {
    const record = payload && typeof payload === "object"
      ? payload as Record<string, unknown>
      : null;
    const type = record && typeof record.type === "string"
      ? record.type
      : "(unknown)";
    const runId = record && typeof record.runId === "string"
      ? record.runId
      : record && record.run && typeof record.run === "object" &&
          typeof (record.run as { id?: unknown }).id === "string"
      ? (record.run as { id: string }).id
      : undefined;
    const traceType = type === "buildBotTrace" && record &&
        record.event && typeof record.event === "object" &&
        typeof (record.event as { type?: unknown }).type === "string"
      ? (record.event as { type: string }).type
      : undefined;
    logBuildStreamDebug("broadcastBuildBot", {
      type,
      runId,
      traceType,
    });
    const eventWorkspaceId = workspaceId ??
      (typeof runId === "string" ? runId : undefined);
    if (eventWorkspaceId) {
      const state = readSessionState(eventWorkspaceId);
      if (state) {
        appendWorkspaceEnvelope(
          state,
          "build",
          payload as Record<string, unknown>,
        );
      }
    }
    appendDurableStreamEvent(WORKSPACE_STREAM_ID, payload);
    appendDurableStreamEvent(BUILD_STREAM_ID, payload);
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
    parseFiniteInteger,
    selectCanonicalScenarioRunSummary,
    appendWorkspaceEnvelope,
    appendSessionEvent,
    appendFeedbackLog,
    appendGradingLog,
    appendServerErrorLog,
    persistSessionState,
    readSessionStateStrict,
    readSessionState,
    readBuildState,
  } = createSessionStore({
    sessionsRoot,
    ensureDir,
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

  const createWorkspaceSession = async (
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

  const activateWorkspaceDeck = async (workspaceId?: string | null) => {
    if (!workspaceId) return;
    const record = resolveWorkspaceRecord(workspaceId);
    if (!record) return;
    const nextPath = resolveDeckPath(record.rootDeckPath);
    if (nextPath === resolvedDeckPath) return;
    resolvedDeckPath = nextPath;
    buildBotRootCache.delete("default");
    reloadPrimaryDeck();
    await deckLoadPromise.catch(() => null);
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

  const getWorkspaceIdFromQuery = (url: URL): string | undefined =>
    resolveWorkspaceIdFromSearchParams(url.searchParams);

  const getWorkspaceIdFromBody = (
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

  const buildWorkspaceReadModel = async (
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

  const buildScenarioConversationArtifacts = (
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

  const buildScenarioConversationArtifactsFromRun = (
    run: TestBotRunStatus,
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

  const isFeedbackEligibleMessageRef = (
    state: SavedState,
    messageRefId: string,
  ): boolean => {
    const { message, ref } = resolveMessageByRef(state, messageRefId);
    if (!message) return false;
    if (message.role === "assistant") return true;
    if (message.role === "user" && ref?.source === "scenario") return true;
    return summarizeRespondCall(message) !== null;
  };

  const isFeedbackEligiblePersistedTestRunMessageRef = (
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

  const syncBuildBotRunFromState = (
    run: BuildBotRunStatus,
    state: SavedState,
  ) => {
    const snapshot = buildTestBotSnapshot(state);
    run.messages = snapshot.messages;
    run.toolInserts = snapshot.toolInserts;
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

  const startTestBotRun = (runOpts: {
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
            workerSandbox: opts.workerSandbox,
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
            workerSandbox: opts.workerSandbox,
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
              flushPendingTraceEvents(enriched);
              appendFromState(enriched);
            },
            onStreamText: (chunk) =>
              emitTestBot({
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
          emitTestBot({
            type: "testBotStreamEnd",
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

  const persistFailedInitFill = (args: {
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

  const server = Deno.serve(
    { port, signal: opts.signal, onListen: () => {} },
    async (req) => {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/durable-streams/stream/")) {
        return handleDurableStreamRequest(req);
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

      const workspaceTestRunGetMatch = url.pathname.match(
        new RegExp(`^${WORKSPACES_API_BASE}/([^/]+)/test/([^/]+)$`),
      );
      if (workspaceTestRunGetMatch) {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        const workspaceId = decodeURIComponent(workspaceTestRunGetMatch[1]);
        const requestedTestRunId = decodeURIComponent(
          workspaceTestRunGetMatch[2],
        );
        await logWorkspaceBotRoot(
          `${WORKSPACES_API_BASE}/:id/test/:runId`,
          workspaceId,
        );
        await activateWorkspaceDeck(workspaceId);
        const payload = await buildWorkspaceReadModel(workspaceId, {
          requestedTestDeckPath: url.searchParams.get("deckPath"),
          requestedTestRunId,
        });
        if ("error" in payload) {
          return new Response(
            JSON.stringify({ error: payload.error }),
            {
              status: payload.status,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify(payload), {
          headers: { "content-type": "application/json" },
        });
      }

      const workspaceGradeRunGetMatch = url.pathname.match(
        new RegExp(`^${WORKSPACES_API_BASE}/([^/]+)/grade/([^/]+)$`),
      );
      if (workspaceGradeRunGetMatch) {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        const workspaceId = decodeURIComponent(workspaceGradeRunGetMatch[1]);
        const requestedGradeRunId = decodeURIComponent(
          workspaceGradeRunGetMatch[2],
        );
        await logWorkspaceBotRoot(
          `${WORKSPACES_API_BASE}/:id/grade/:runId`,
          workspaceId,
        );
        await activateWorkspaceDeck(workspaceId);
        const payload = await buildWorkspaceReadModel(workspaceId, {
          requestedTestDeckPath: url.searchParams.get("deckPath"),
          requestedGradeRunId,
        });
        if ("error" in payload) {
          return new Response(
            JSON.stringify({ error: payload.error }),
            {
              status: payload.status,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify(payload), {
          headers: { "content-type": "application/json" },
        });
      }

      const workspaceGetMatch = url.pathname.match(
        new RegExp(`^${WORKSPACES_API_BASE}/([^/]+)$`),
      );
      if (workspaceGetMatch) {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        const workspaceId = decodeURIComponent(workspaceGetMatch[1]);
        await logWorkspaceBotRoot(`${WORKSPACES_API_BASE}/:id`, workspaceId);
        await activateWorkspaceDeck(workspaceId);
        const payload = await buildWorkspaceReadModel(workspaceId, {
          requestedTestDeckPath: url.searchParams.get("deckPath"),
        });
        if ("error" in payload) {
          return new Response(
            JSON.stringify({ error: payload.error }),
            {
              status: payload.status,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify(payload), {
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname === "/api/calibrate/run") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as {
            workspaceId?: string;
            graderId?: string;
            scenarioRunId?: string;
          };
          const workspaceId = getWorkspaceIdFromBody(body);
          if (!workspaceId) {
            throw new Error("Missing workspaceId");
          }
          await logWorkspaceBotRoot("/api/calibrate/run", workspaceId);
          await activateWorkspaceDeck(workspaceId);
          await deckLoadPromise.catch(() => null);
          const grader = body.graderId
            ? resolveGraderDeck(body.graderId)
            : availableGraderDecks[0];
          if (!grader) {
            throw new Error("Unknown grader deck selection");
          }
          const sessionState = readSessionState(workspaceId);
          if (!sessionState) {
            throw new Error("Workspace not found");
          }
          const requestedScenarioRunId =
            typeof body.scenarioRunId === "string" &&
              body.scenarioRunId.trim().length > 0
              ? body.scenarioRunId
              : undefined;
          const requestedLiveRun = requestedScenarioRunId
            ? testBotRuns.get(requestedScenarioRunId)?.run
            : undefined;
          const requestedLiveRunMatchesWorkspace = Boolean(
            requestedLiveRun &&
              (requestedLiveRun.workspaceId === workspaceId ||
                requestedLiveRun.sessionId === workspaceId),
          );
          const requestedPersistedRun = requestedScenarioRunId
            ? readPersistedTestRunStatusById(
              sessionState,
              workspaceId,
              requestedScenarioRunId,
            )
            : null;
          const selectedScenarioRun = requestedLiveRunMatchesWorkspace
            ? requestedLiveRun
            : requestedPersistedRun;
          if (requestedScenarioRunId && !selectedScenarioRun) {
            throw new Error(
              `Scenario run "${requestedScenarioRunId}" not found for workspace`,
            );
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
          const conversationArtifacts = selectedScenarioRun
            ? buildScenarioConversationArtifactsFromRun(selectedScenarioRun)
            : buildScenarioConversationArtifacts(sessionState);
          const conversationMessages = conversationArtifacts.messages;
          const activeScenarioRunId = requestedScenarioRunId ??
            (typeof sessionState.meta?.scenarioRunId === "string" &&
                sessionState.meta.scenarioRunId.trim().length > 0
              ? sessionState.meta.scenarioRunId
              : undefined);
          const sessionMetaForPayload = {
            ...(metaForGrading ?? {}),
            ...(activeScenarioRunId
              ? {
                scenarioRunId: activeScenarioRunId,
                testBotRunId: activeScenarioRunId,
              }
              : {}),
          };
          const sessionPayload = {
            messages: conversationMessages.length > 0
              ? conversationMessages.map((msg) => ({
                role: msg.role,
                content: msg.content,
                name: msg.name,
              }))
              : undefined,
            meta: sessionMetaForPayload,
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
            appendGradingLog(nextState, {
              type: "grading.run",
              run: nextEntry,
            });
            const sessionMeta = buildSessionMeta(workspaceId, nextState);
            appendDurableStreamEvent(WORKSPACE_STREAM_ID, {
              type: "calibrateSession",
              workspaceId,
              run: nextEntry,
              session: sessionMeta,
            });
            appendDurableStreamEvent(GRADE_STREAM_ID, {
              type: "calibrateSession",
              workspaceId,
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
                  workspaceId,
                  graderId: grader.id,
                  graderPath: grader.path,
                  graderLabel: grader.label,
                  status: "running",
                  runAt: startedAt,
                  gradingRunId: runId,
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
                  responsesMode: opts.responsesMode,
                });
              }
              const messages = sessionPayload.messages ?? [];
              const assistantTurns = conversationArtifacts.assistantTurns;
              const totalTurns = assistantTurns.length;
              const turns: Array<{
                index: number;
                gradingRunId: string;
                artifactRevisionId: string;
                messageRefId?: string;
                message: unknown;
                input: unknown;
                result: unknown;
              }> = [];
              entry = {
                id: runId,
                workspaceId,
                graderId: grader.id,
                graderPath: grader.path,
                graderLabel: grader.label,
                status: "running",
                runAt: startedAt,
                gradingRunId: runId,
                input: { session: sessionPayload },
                result: { mode: "turns", totalTurns, turns: [] },
              };
              currentState = upsertCalibrationRun(currentState, entry);
              if (totalTurns === 0) {
                return { mode: "turns", totalTurns, turns: [] };
              }
              for (const turnEntry of assistantTurns) {
                const msg = turnEntry.message;
                const idx = turnEntry.conversationIndex;
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
                  responsesMode: opts.responsesMode,
                });
                turns.push({
                  index: idx,
                  gradingRunId: runId,
                  artifactRevisionId: randomId("grade-rev"),
                  messageRefId: turnEntry.messageRefId,
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
              workspaceId,
              graderId: grader.id,
              graderPath: grader.path,
              graderLabel: grader.label,
              status: "completed",
              runAt: startedAt,
              gradingRunId: runId,
              input: { session: sessionPayload },
              result,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error("[sim] calibrate run failed", {
              workspaceId,
              runId,
              runMode,
              graderId: grader.id,
              graderPath: grader.path,
              error: message,
              stack: err instanceof Error ? err.stack : undefined,
            });
            entry = {
              id: runId,
              workspaceId,
              graderId: grader.id,
              graderPath: grader.path,
              graderLabel: grader.label,
              status: "error",
              runAt: startedAt,
              gradingRunId: runId,
              input: { session: sessionPayload },
              error: message,
            };
          }
          const nextState = upsertCalibrationRun(currentState, entry);
          const sessionMeta = buildSessionMeta(workspaceId, nextState);
          return new Response(
            JSON.stringify({
              workspaceId,
              run: entry,
              session: sessionMeta,
            }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error("[sim] /api/calibrate/run request failed", {
            error: message,
            stack: err instanceof Error ? err.stack : undefined,
          });
          return new Response(
            JSON.stringify({
              error: message,
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
            workspaceId?: string;
            refId?: string;
            runId?: string;
            turnIndex?: number;
            reason?: string;
          };
          const workspaceId = getWorkspaceIdFromBody(body);
          if (!workspaceId || !body.refId) {
            throw new Error("Missing workspaceId or refId");
          }
          await logWorkspaceBotRoot("/api/calibrate/flag", workspaceId);
          const state = readSessionState(workspaceId);
          if (!state) {
            throw new Error("Workspace not found");
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
          let flagEntry: GradingFlag | undefined;
          if (flagIndex >= 0) {
            flagEntry = existingFlags[flagIndex];
            nextFlags = existingFlags.filter((_, idx) => idx !== flagIndex);
            flagged = false;
          } else {
            const now = new Date().toISOString();
            flagEntry = {
              id: randomId("flag"),
              refId: body.refId,
              runId: body.runId,
              turnIndex: body.turnIndex,
              reason: body.reason?.trim() || undefined,
              createdAt: now,
            };
            nextFlags = [
              ...existingFlags,
              flagEntry,
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
          appendGradingLog(updated, {
            type: "grading.flag",
            flagged,
            flag: flagEntry,
            refId: body.refId,
          });
          const sessionMeta = buildSessionMeta(workspaceId, updated);
          appendDurableStreamEvent(WORKSPACE_STREAM_ID, {
            type: "calibrateSession",
            workspaceId,
            session: sessionMeta,
          });
          appendDurableStreamEvent(GRADE_STREAM_ID, {
            type: "calibrateSession",
            workspaceId,
            session: sessionMeta,
          });
          return new Response(
            JSON.stringify({
              workspaceId,
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
            workspaceId?: string;
            refId?: string;
            reason?: string;
          };
          const workspaceId = getWorkspaceIdFromBody(body);
          if (!workspaceId || !body.refId) {
            throw new Error("Missing workspaceId or refId");
          }
          await logWorkspaceBotRoot("/api/calibrate/flag/reason", workspaceId);
          const state = readSessionState(workspaceId);
          if (!state) {
            throw new Error("Workspace not found");
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
          appendGradingLog(updated, {
            type: "grading.flag.reason",
            flag: updatedFlag,
            refId: body.refId,
          });
          const sessionMeta = buildSessionMeta(workspaceId, updated);
          appendDurableStreamEvent(WORKSPACE_STREAM_ID, {
            type: "calibrateSession",
            workspaceId,
            session: sessionMeta,
          });
          appendDurableStreamEvent(GRADE_STREAM_ID, {
            type: "calibrateSession",
            workspaceId,
            session: sessionMeta,
          });
          return new Response(
            JSON.stringify({
              workspaceId,
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

      const gradingReferenceResponse = await handleGradingReferenceRoute({
        url,
        req,
        getWorkspaceIdFromBody,
        logWorkspaceBotRoot,
        readSessionState,
        persistSessionState,
        appendGradingLog,
        buildSessionMeta,
        appendDurableStreamEvent,
        workspaceStreamId: WORKSPACE_STREAM_ID,
        gradeStreamId: GRADE_STREAM_ID,
        parseFiniteInteger,
        randomId,
      });
      if (gradingReferenceResponse) return gradingReferenceResponse;

      if (url.pathname === "/api/test") {
        if (req.method === "GET") {
          const workspaceId = getWorkspaceIdFromQuery(url);
          await logWorkspaceBotRoot("/api/test", workspaceId);
          await activateWorkspaceDeck(workspaceId);
          await deckLoadPromise.catch(() => null);
          const requestedDeck = url.searchParams.get("deckPath");
          const selection = requestedDeck
            ? resolveTestDeck(requestedDeck)
            : availableTestDecks[0];
          if (requestedDeck && !selection) {
            return new Response(
              JSON.stringify({
                error: "Unknown scenario deck selection",
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

      if (url.pathname === "/api/test/run") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        let maxTurnsOverride: number | undefined = undefined;
        let deckInput: unknown = undefined;
        let botInput: unknown = undefined;
        let initialUserMessage: string | undefined = undefined;
        let botDeckSelection: AvailableTestDeck | undefined;
        let inheritBotInput = false;
        let userProvidedDeckInput = false;
        let initFillRequestMissing: Array<string> | undefined = undefined;
        let sessionId: string | undefined = undefined;
        try {
          const body = await req.json() as {
            maxTurns?: number;
            init?: unknown;
            context?: unknown;
            botInput?: unknown;
            initialUserMessage?: unknown;
            botDeckPath?: string;
            inheritBotInput?: unknown;
            initFill?: { missing?: unknown };
            workspaceId?: string;
          };
          if (
            typeof body.maxTurns === "number" && Number.isFinite(body.maxTurns)
          ) {
            maxTurnsOverride = body.maxTurns;
          }
          deckInput = body.context ?? body.init;
          if (body.context !== undefined || body.init !== undefined) {
            userProvidedDeckInput = true;
          }
          if (body.init !== undefined && body.context === undefined) {
            logger.warn(
              '[gambit] Received deprecated "init" field in test API; use "context" instead.',
            );
          }
          botInput = body.botInput;
          if (typeof body.inheritBotInput === "boolean") {
            inheritBotInput = body.inheritBotInput;
          }
          if (body.initFill && Array.isArray(body.initFill.missing)) {
            initFillRequestMissing = body.initFill.missing.filter((entry) =>
              typeof entry === "string" && entry.trim().length > 0
            ) as Array<string>;
          }
          sessionId = getWorkspaceIdFromBody(body);
          if (typeof body.botDeckPath === "string") {
            const resolved = resolveTestDeck(body.botDeckPath);
            if (!resolved) {
              return new Response(
                JSON.stringify({ error: "Unknown scenario deck selection" }),
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
        if (sessionId) {
          await logWorkspaceBotRoot("/api/test/run", sessionId);
          await activateWorkspaceDeck(sessionId);
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
        if (
          !userProvidedDeckInput && inheritBotInput && botInput !== undefined
        ) {
          deckInput = cloneValue(botInput);
        }
        if (!botDeckSelection) {
          return new Response(
            JSON.stringify({ error: "No scenario decks configured" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        let initFillInfo: TestBotInitFill | undefined;
        let initFillTrace: {
          args: Record<string, unknown>;
          result: Record<string, unknown>;
        } | undefined;
        try {
          const rootDeck = await deckLoadPromise.catch(() => null);
          const rootSchema = rootDeck?.contextSchema ?? rootDeck?.inputSchema;
          const normalizedSchema = rootSchema
            ? normalizeSchema(rootSchema)
            : undefined;
          const missing = normalizedSchema
            ? findMissingRequiredFields(normalizedSchema, deckInput)
            : [];
          const requested = initFillRequestMissing?.length
            ? missing.filter((entry) => initFillRequestMissing?.includes(entry))
            : missing;
          if (requested.length > 0) {
            const fillPrompt = buildInitFillPrompt({
              missing: requested,
              current: deckInput,
              schema: normalizedSchema,
            });
            const fillOutput = await runDeckWithFallback({
              path: botDeckSelection.path,
              input: botInput,
              inputProvided: botInput !== undefined,
              modelProvider: opts.modelProvider,
              allowRootStringInput: true,
              initialUserMessage: fillPrompt,
              responsesMode: opts.responsesMode,
            });
            const parsed = parseInitFillOutput(fillOutput);
            if (parsed.error) {
              initFillInfo = {
                requested,
                provided: fillOutput,
                error: parsed.error,
              };
              const failure = persistFailedInitFill({
                error: parsed.error,
                initFill: initFillInfo,
                botDeckPath: botDeckSelection.path,
                botDeckId: botDeckSelection.id,
                botDeckLabel: botDeckSelection.label,
              });
              return new Response(
                JSON.stringify({
                  error: parsed.error,
                  initFill: initFillInfo,
                  workspaceId: failure.workspaceId,
                  workspacePath: failure.workspacePath,
                }),
                {
                  status: 400,
                  headers: { "content-type": "application/json" },
                },
              );
            }
            let appliedObject: Record<string, unknown> = {};
            let appliedRoot: unknown = undefined;
            let nextInput = deckInput;
            for (const pathKey of requested) {
              const segments = pathKey === "(root)" ? [] : pathKey.split(".");
              const leafSchema = getSchemaAtPath(normalizedSchema, segments);
              const currentValue = getPathValue(nextInput, segments);
              if (
                currentValue !== undefined && currentValue !== null &&
                !(typeof currentValue === "string" &&
                  (leafSchema?.kind === "string" ||
                    leafSchema?.kind === "enum") &&
                  currentValue.trim() === "") &&
                !(Array.isArray(currentValue) && leafSchema?.kind === "array" &&
                  currentValue.length === 0)
              ) {
                continue;
              }
              const fillValue = getPathValue(parsed.data, segments);
              if (fillValue === undefined) continue;
              if (segments.length === 0) {
                nextInput = fillValue;
                appliedRoot = fillValue;
                continue;
              }
              nextInput = setPathValue(nextInput, segments, fillValue);
              const appliedValue = setPathValue(
                appliedObject,
                segments,
                fillValue,
              );
              if (appliedValue && typeof appliedValue === "object") {
                appliedObject = appliedValue as Record<string, unknown>;
              }
            }
            const validated = validateInitInput(rootSchema, nextInput);
            deckInput = validated;
            const remainingMissing = normalizedSchema
              ? findMissingRequiredFields(normalizedSchema, deckInput)
              : [];
            if (remainingMissing.length > 0) {
              const message = `Init fill incomplete: missing ${
                remainingMissing.join(", ")
              }`;
              initFillInfo = {
                requested,
                applied: appliedRoot !== undefined
                  ? appliedRoot
                  : Object.keys(appliedObject).length
                  ? appliedObject
                  : undefined,
                provided: parsed.data,
                error: message,
              };
              const failure = persistFailedInitFill({
                error: message,
                initFill: initFillInfo,
                botDeckPath: botDeckSelection.path,
                botDeckId: botDeckSelection.id,
                botDeckLabel: botDeckSelection.label,
              });
              return new Response(
                JSON.stringify({
                  error: message,
                  initFill: initFillInfo,
                  workspaceId: failure.workspaceId,
                  workspacePath: failure.workspacePath,
                }),
                {
                  status: 400,
                  headers: { "content-type": "application/json" },
                },
              );
            }
            initFillInfo = {
              requested,
              applied: appliedRoot !== undefined
                ? appliedRoot
                : Object.keys(appliedObject).length
                ? appliedObject
                : undefined,
              provided: parsed.data,
            };
            initFillTrace = {
              args: {
                missing: requested,
              },
              result: {
                applied: initFillInfo.applied,
                provided: initFillInfo.provided,
              },
            };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          initFillInfo = initFillInfo ?? {
            requested: [],
          };
          initFillInfo.error = message;
          const failure = persistFailedInitFill({
            error: message,
            initFill: initFillInfo,
            botDeckPath: botDeckSelection.path,
            botDeckId: botDeckSelection.id,
            botDeckLabel: botDeckSelection.label,
          });
          return new Response(
            JSON.stringify({
              error: message,
              initFill: initFillInfo,
              workspaceId: failure.workspaceId,
              workspacePath: failure.workspacePath,
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const existingSessionState = sessionId
          ? readSessionState(sessionId)
          : undefined;
        const workspaceRecord = sessionId
          ? resolveWorkspaceRecord(sessionId) ?? {
            id: sessionId,
            rootDir: path.dirname(resolvedDeckPath),
            rootDeckPath: resolvedDeckPath,
            createdAt: new Date().toISOString(),
          }
          : undefined;
        if (workspaceRecord && !resolveWorkspaceRecord(sessionId)) {
          registerWorkspace(workspaceRecord);
        }
        const run = startTestBotRun({
          maxTurnsOverride,
          deckInput,
          botInput,
          initialUserMessage,
          botDeckPath: botDeckSelection.path,
          botDeckId: botDeckSelection.id,
          botDeckLabel: botDeckSelection.label,
          initFill: initFillInfo,
          initFillTrace,
          workspaceId: sessionId,
          workspaceRecord,
          baseMeta: existingSessionState?.meta as Record<string, unknown> ??
            undefined,
        });
        return new Response(
          JSON.stringify({ run }),
          { headers: { "content-type": "application/json" } },
        );
      }

      if (url.pathname === "/api/test/message") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        // 1) Parse request payload and stitch together run/session state.
        let payload: {
          runId?: unknown;
          workspaceId?: unknown;
          message?: unknown;
          context?: unknown;
          init?: unknown;
          botDeckPath?: unknown;
          model?: unknown;
          modelForce?: unknown;
          stream?: unknown;
        } = {};
        try {
          payload = await req.json();
        } catch {
          // ignore parse errors
        }
        const requestedRunId = typeof payload.runId === "string"
          ? payload.runId
          : undefined;
        let runId = requestedRunId;
        const workspaceId = (() => {
          const workspaceId = typeof payload.workspaceId === "string" &&
              payload.workspaceId.trim().length > 0
            ? payload.workspaceId
            : undefined;
          if (workspaceId) return workspaceId;
          return undefined;
        })();
        await logWorkspaceBotRoot("/api/test/message", workspaceId);
        if (workspaceId) {
          await activateWorkspaceDeck(workspaceId);
        }
        let savedState = workspaceId
          ? readSessionState(workspaceId, { withTraces: true })
          : undefined;
        if (savedState && requestedRunId) {
          const savedRunId = typeof savedState.meta?.testBotRunId === "string"
            ? savedState.meta.testBotRunId
            : savedState.runId;
          if (!savedRunId || savedRunId !== requestedRunId) {
            // Explicit runId in the same workspace means "start a fresh run".
            savedState = undefined;
          }
        }
        if (!savedState && runId) {
          const entry = testBotRuns.get(runId);
          const runWorkspaceId = entry?.run.workspaceId ?? entry?.run.sessionId;
          if (
            runWorkspaceId &&
            (!workspaceId || runWorkspaceId === workspaceId)
          ) {
            savedState = readSessionState(runWorkspaceId, {
              withTraces: true,
            });
          }
        }
        if (savedState && !runId) {
          runId = typeof savedState.meta?.testBotRunId === "string"
            ? savedState.meta.testBotRunId
            : savedState.runId;
        }
        runId = runId ?? randomId("testbot");
        const workspaceRecord = workspaceId
          ? resolveWorkspaceRecord(workspaceId) ?? {
            id: workspaceId,
            rootDir: path.dirname(resolvedDeckPath),
            rootDeckPath: resolvedDeckPath,
            createdAt: new Date().toISOString(),
          }
          : undefined;
        if (workspaceRecord && !resolveWorkspaceRecord(workspaceId)) {
          registerWorkspace(workspaceRecord);
        }
        const workspaceMeta = workspaceRecord
          ? buildWorkspaceMeta(
            workspaceRecord,
            savedState?.meta as Record<string, unknown> ?? {},
          )
          : (savedState?.meta ?? {});
        const existingEntry = testBotRuns.get(runId);
        if (existingEntry?.promise) {
          return new Response(
            JSON.stringify({ error: "Scenario run already in progress" }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }
        // 2) Resolve which scenario deck to use and derive initial input.
        await deckLoadPromise.catch(() => null);
        const requestedDeck = typeof payload.botDeckPath === "string"
          ? payload.botDeckPath
          : undefined;
        const selection = (() => {
          if (requestedDeck) return resolveTestDeck(requestedDeck);
          const metaPath =
            typeof savedState?.meta?.testBotConfigPath === "string"
              ? savedState.meta.testBotConfigPath
              : undefined;
          if (metaPath) return resolveTestDeck(metaPath);
          return availableTestDecks[0];
        })();
        if (requestedDeck && !selection) {
          return new Response(
            JSON.stringify({ error: "Unknown scenario deck selection" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const botConfigPath = selection?.path ?? resolvedDeckPath;
        const testBotName = selection
          ? path.basename(botConfigPath).replace(/\.deck\.(md|ts)$/i, "")
          : toDeckLabel(resolvedDeckPath);
        const selectedScenarioDeckId = selection?.id ?? testBotName;
        const selectedScenarioDeckLabel = selection?.label ?? testBotName;
        const message = typeof payload.message === "string"
          ? payload.message.trim()
          : "";
        const hasSavedMessages = (savedState?.messages?.length ?? 0) > 0;
        let deckInput = payload.context ?? payload.init;
        if (!hasSavedMessages && deckInput === undefined) {
          try {
            const desc = await schemaPromise;
            deckInput = desc.defaults !== undefined
              ? desc.defaults
              : deriveInitialFromSchema(desc.schema);
          } catch {
            // ignore; keep undefined
          }
        }
        const stream = typeof payload.stream === "boolean"
          ? payload.stream
          : true;
        const deckForStart = await deckLoadPromise.catch(() => null);
        const startMode = deckForStart &&
            (deckForStart.startMode === "assistant" ||
              deckForStart.startMode === "user")
          ? deckForStart.startMode
          : "assistant";
        const startOnly = !message && startMode === "assistant" &&
          !hasSavedMessages;
        if (!message && !startOnly) {
          return new Response(
            JSON.stringify({ error: "Missing message" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        // 3) Initialize the run, sync from prior session state, and prep tracing.
        const entry = existingEntry ?? {
          run: {
            id: runId,
            status: "idle",
            messages: [],
            traces: [],
            toolInserts: [],
          },
          promise: null,
          abort: null,
        };
        testBotRuns.set(runId, entry);
        const run = entry.run;
        const emitTestBot = (payload: unknown) =>
          broadcastTestBot(payload, run.workspaceId ?? workspaceId ?? runId);
        run.status = "running";
        run.error = undefined;
        run.startedAt = run.startedAt ?? new Date().toISOString();
        if (savedState) {
          syncTestBotRunFromState(run, savedState);
        }
        emitTestBot({ type: "testBotStatus", run });
        const controller = new AbortController();
        entry.abort = controller;
        const isAborted = () => controller.signal.aborted;
        const capturedTraces = Array.isArray(savedState?.traces)
          ? cloneTraces(savedState.traces)
          : [];
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
        const appendFromState = (state: SavedState) => {
          const snapshot = buildTestBotSnapshot(state);
          run.messages = snapshot.messages;
          run.toolInserts = snapshot.toolInserts;
          run.traces = Array.isArray(state.traces)
            ? [...state.traces]
            : undefined;
          const nextWorkspaceId = typeof state.meta?.workspaceId === "string"
            ? state.meta.workspaceId
            : typeof state.meta?.sessionId === "string"
            ? state.meta.sessionId
            : undefined;
          if (nextWorkspaceId) {
            run.workspaceId = nextWorkspaceId;
            run.sessionId = nextWorkspaceId;
          }
          emitTestBot({ type: "testBotStatus", run });
        };
        // 4) Execute the deck run(s): optional assistant start, then user message.
        entry.promise = (async () => {
          try {
            const countAssistantMessages = (state?: SavedState): number => {
              if (!state?.messages?.length) return 0;
              let count = 0;
              for (const msg of state.messages) {
                if (msg?.role === "assistant") count += 1;
              }
              return count;
            };
            const runOnce = async (
              initialUserMessage: string | undefined,
              turn: number,
              shouldStream = stream,
            ) => {
              if (isAborted()) return undefined;
              const hasSavedMessages = (savedState?.messages?.length ?? 0) > 0;
              const inputProvided = !hasSavedMessages &&
                deckInput !== undefined;
              const input = inputProvided ? deckInput : undefined;
              const result = await runDeck({
                path: resolvedDeckPath,
                input,
                inputProvided,
                modelProvider: opts.modelProvider,
                isRoot: true,
                allowRootStringInput: true,
                defaultModel: typeof payload.model === "string"
                  ? payload.model
                  : opts.model,
                modelOverride: typeof payload.modelForce === "string"
                  ? payload.modelForce
                  : opts.modelForce,
                trace: tracer,
                stream: shouldStream,
                state: savedState,
                responsesMode: opts.responsesMode,
                signal: controller.signal,
                initialUserMessage,
                onStateUpdate: (state) => {
                  if (isAborted()) return;
                  const nextStateWithSource = applyUserMessageRefSource(
                    savedState,
                    state,
                    "manual",
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
                    ...(workspaceId ? { workspaceId } : {}),
                  };
                  const enriched = persistSessionState({
                    ...nextStateWithSource,
                    meta: nextMeta,
                    traces: capturedTraces,
                  });
                  savedState = enriched;
                  flushPendingTraceEvents(enriched);
                  appendFromState(enriched);
                },
                onStreamText: (chunk) =>
                  emitTestBot({
                    type: "testBotStream",
                    runId,
                    role: "assistant",
                    chunk,
                    turn,
                    ts: Date.now(),
                  }),
              });
              if (isAborted()) return result;
              if (shouldStream) {
                emitTestBot({
                  type: "testBotStreamEnd",
                  runId,
                  role: "assistant",
                  turn,
                  ts: Date.now(),
                });
              }
              return result;
            };
            let assistantTurn = countAssistantMessages(savedState);
            if (
              startMode === "assistant" &&
              !hasSavedMessages
            ) {
              if (isAborted()) {
                run.status = "canceled";
                return;
              }
              await runOnce(undefined, assistantTurn, stream);
              assistantTurn += 1;
            }
            let result: unknown = undefined;
            if (message) {
              if (isAborted()) {
                run.status = "canceled";
                return;
              }
              result = await runOnce(message, assistantTurn, stream);
            }
            if (isAborted()) {
              run.status = "canceled";
            } else if (result !== undefined && isGambitEndSignal(result)) {
              run.status = "completed";
            } else {
              run.status = "completed";
            }
          } catch (err) {
            if (isAborted() || isRunCanceledError(err)) {
              run.status = "canceled";
              run.error = undefined;
            } else {
              run.status = "error";
              run.error = err instanceof Error ? err.message : String(err);
              logger.warn(
                `[sim] build bot run failed (workspaceId=${workspaceId}): ${run.error}`,
              );
            }
          } finally {
            if (savedState) {
              syncTestBotRunFromState(run, savedState);
            }
            run.finishedAt = new Date().toISOString();
            entry.abort = null;
            entry.promise = null;
            emitTestBot({ type: "testBotStatus", run });
          }
        })();
        // 5) Return the current run snapshot to the caller.
        return new Response(
          JSON.stringify({ run }),
          { headers: { "content-type": "application/json" } },
        );
      }

      if (url.pathname === "/api/test/stop") {
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
        if (entry?.run?.status === "running") {
          entry.run.status = "canceled";
          entry.run.finishedAt = entry.run.finishedAt ??
            new Date().toISOString();
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

      if (url.pathname === "/api/build/reset") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        let workspaceId: string | undefined = undefined;
        try {
          const body = await req.json() as {
            runId?: string;
            workspaceId?: string;
          };
          workspaceId = getWorkspaceIdFromBody(body);
        } catch {
          // ignore
        }
        if (!workspaceId) {
          return new Response(
            JSON.stringify({ error: "Missing workspaceId" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const entry = buildBotRuns.get(workspaceId);
        if (entry?.abort) {
          entry.abort.abort();
        }
        if (entry?.run) {
          if (entry.run.status === "running") {
            entry.run.status = "canceled";
          }
          entry.run.finishedAt = entry.run.finishedAt ??
            new Date().toISOString();
          const state = readSessionState(workspaceId);
          if (state) {
            persistSessionState({
              ...state,
              meta: {
                ...(state.meta ?? {}),
                buildStatus: entry.run.status,
                buildFinishedAt: entry.run.finishedAt,
                buildError: entry.run.error,
              },
            });
          }
        }
        buildBotRuns.delete(workspaceId);
        broadcastBuildBot({
          type: "buildBotStatus",
          run: {
            id: workspaceId,
            status: "idle",
            messages: [],
            traces: [],
            toolInserts: [],
          },
        }, workspaceId);
        return new Response(JSON.stringify({ reset: true }), {
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname === "/api/build/stop") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        let workspaceId: string | undefined = undefined;
        try {
          const body = await req.json() as {
            runId?: string;
            workspaceId?: string;
          };
          workspaceId = getWorkspaceIdFromBody(body);
        } catch {
          // ignore
        }
        if (!workspaceId) {
          return new Response(
            JSON.stringify({ error: "Missing workspaceId" }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        const entry = buildBotRuns.get(workspaceId);
        const wasRunning = Boolean(entry?.promise);
        if (entry?.abort) {
          entry.abort.abort();
        }
        if (entry?.run?.status === "running") {
          entry.run.status = "canceled";
          entry.run.finishedAt = entry.run.finishedAt ??
            new Date().toISOString();
        }
        if (entry?.run) {
          const state = readSessionState(workspaceId);
          if (state) {
            persistSessionState({
              ...state,
              meta: {
                ...(state.meta ?? {}),
                buildStatus: entry.run.status,
                buildFinishedAt: entry.run.finishedAt,
                buildError: entry.run.error,
              },
            });
          }
        }
        const run = entry?.run ?? {
          id: workspaceId,
          status: "idle",
          messages: [],
          traces: [],
          toolInserts: [],
        };
        broadcastBuildBot(
          { type: "buildBotStatus", run, state: entry?.state ?? undefined },
          workspaceId,
        );
        return new Response(
          JSON.stringify({
            stopped: wasRunning,
            run,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }

      if (url.pathname === "/api/build/message") {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        let payload: {
          runId?: unknown;
          workspaceId?: unknown;
          message?: unknown;
          model?: unknown;
          modelForce?: unknown;
        } = {};
        try {
          payload = await req.json();
        } catch {
          // ignore
        }
        let workspaceId = typeof payload.workspaceId === "string"
          ? payload.workspaceId
          : typeof payload.runId === "string"
          ? payload.runId
          : undefined;
        if (!workspaceId) {
          const created = await createWorkspaceSession();
          workspaceId = created.id;
        }
        await logWorkspaceBotRoot("/api/build/message", workspaceId);
        const message = typeof payload.message === "string"
          ? payload.message
          : "";

        const workspaceRecord = resolveWorkspaceRecord(workspaceId) ?? {
          id: workspaceId,
          rootDir: path.dirname(resolvedDeckPath),
          rootDeckPath: resolvedDeckPath,
          createdAt: new Date().toISOString(),
        };
        if (!resolveWorkspaceRecord(workspaceId)) {
          registerWorkspace(workspaceRecord);
        }

        const existingEntry = buildBotRuns.get(workspaceId);
        if (existingEntry?.promise) {
          return new Response(
            JSON.stringify({ error: "Run already in progress" }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }

        const entry = existingEntry ?? {
          run: {
            id: workspaceId,
            status: "idle",
            messages: [],
            traces: [],
            toolInserts: [],
          },
          state: null,
          promise: null,
          abort: null,
        };
        buildBotRuns.set(workspaceId, entry);

        if (!entry.state) {
          const projection = readBuildState(workspaceId);
          if (projection?.state) {
            entry.state = projection.state;
          }
        }

        const run = entry.run;
        run.status = "running";
        run.error = undefined;
        run.startedAt = run.startedAt ?? new Date().toISOString();
        if (entry.state) {
          syncBuildBotRunFromState(run, entry.state);
        }
        broadcastBuildBot({
          type: "buildBotStatus",
          run,
          state: entry.state ?? undefined,
        }, workspaceId);
        const workspaceBaseState = readSessionState(workspaceId) ?? {
          runId: workspaceId,
          messages: [],
          meta: {},
        };
        persistSessionState({
          ...workspaceBaseState,
          meta: {
            ...buildWorkspaceMeta(
              workspaceRecord,
              workspaceBaseState.meta ?? {},
            ),
            buildStatus: run.status,
            buildStartedAt: run.startedAt,
          },
        });

        const controller = new AbortController();
        entry.abort = controller;
        const isAborted = () => controller.signal.aborted;

        const botDeckUrl = new URL(
          "./decks/gambit-bot/PROMPT.md",
          import.meta.url,
        );
        if (botDeckUrl.protocol !== "file:") {
          run.status = "error";
          run.error = "Unable to resolve Gambit Bot deck path";
          broadcastBuildBot({ type: "buildBotStatus", run }, workspaceId);
          const state = readSessionState(workspaceId);
          if (state) {
            persistSessionState({
              ...state,
              meta: {
                ...(state.meta ?? {}),
                buildStatus: "error",
                buildError: run.error,
                buildFinishedAt: new Date().toISOString(),
              },
            });
          }
          return new Response(
            JSON.stringify({ error: run.error }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        const botDeckPath = path.fromFileUrl(botDeckUrl);

        let botRoot: string;
        try {
          botRoot = await resolveBuildBotRoot(workspaceId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          run.status = "error";
          run.error = msg;
          broadcastBuildBot({ type: "buildBotStatus", run }, workspaceId);
          const state = readSessionState(workspaceId);
          if (state) {
            persistSessionState({
              ...state,
              meta: {
                ...(state.meta ?? {}),
                buildStatus: "error",
                buildError: msg,
                buildFinishedAt: new Date().toISOString(),
              },
            });
          }
          return new Response(
            JSON.stringify({ error: msg }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        const prevBotRoot = Deno.env.get("GAMBIT_BOT_ROOT");
        Deno.env.set("GAMBIT_BOT_ROOT", botRoot);

        const capturedTraces = Array.isArray(entry.state?.traces)
          ? cloneTraces(entry.state!.traces!)
          : [];
        const tracer = (event: TraceEvent) => {
          const stamped = event.ts ? event : { ...event, ts: Date.now() };
          capturedTraces.push(stamped);
          consoleTracer?.(stamped);
          broadcastBuildBot({
            type: "buildBotTrace",
            runId: workspaceId,
            event: stamped,
          }, workspaceId);
        };

        const appendFromState = (state: SavedState) => {
          syncBuildBotRunFromState(run, state);
          run.traces = Array.isArray(state.traces) ? [...state.traces] : [];
          broadcastBuildBot(
            { type: "buildBotStatus", run, state },
            workspaceId,
          );
          const base = readSessionState(workspaceId) ?? {
            runId: workspaceId,
            messages: [],
            meta: {},
          };
          persistSessionState({
            ...base,
            meta: {
              ...buildWorkspaceMeta(workspaceRecord, base.meta ?? {}),
              buildStatus: run.status,
              buildStartedAt: run.startedAt,
              buildFinishedAt: run.finishedAt,
              buildError: run.error,
            },
          });
        };

        entry.promise = (async () => {
          try {
            const runOnce = async (
              initialUserMessage: string | undefined,
              turn: number,
              shouldStream = true,
            ) => {
              if (isAborted()) return undefined;
              const result = await runDeck({
                path: botDeckPath,
                input: undefined,
                inputProvided: false,
                modelProvider: opts.modelProvider,
                allowRootStringInput: true,
                defaultModel: typeof payload.model === "string"
                  ? payload.model
                  : opts.model,
                modelOverride: typeof payload.modelForce === "string"
                  ? payload.modelForce
                  : opts.modelForce,
                trace: tracer,
                stream: shouldStream,
                state: entry.state ?? undefined,
                responsesMode: opts.responsesMode,
                signal: controller.signal,
                initialUserMessage,
                onStateUpdate: (state) => {
                  if (isAborted()) return;
                  const nextState: SavedState = {
                    ...state,
                    traces: capturedTraces,
                  };
                  entry.state = nextState;
                  appendFromState(nextState);
                },
                onStreamText: (chunk) =>
                  broadcastBuildBot({
                    type: "buildBotStream",
                    runId: workspaceId,
                    role: "assistant",
                    chunk,
                    turn,
                    ts: Date.now(),
                  }, workspaceId),
              });
              if (shouldStream) {
                broadcastBuildBot({
                  type: "buildBotStreamEnd",
                  runId: workspaceId,
                  role: "assistant",
                  turn,
                  ts: Date.now(),
                }, workspaceId);
              }
              return result;
            };

            const hasSavedMessages = (entry.state?.messages?.length ?? 0) > 0;
            let assistantTurn = 0;
            if (Array.isArray(entry.state?.messages)) {
              for (const msg of entry.state!.messages) {
                if (msg?.role === "assistant") assistantTurn += 1;
              }
            }
            if (!hasSavedMessages && message.trim().length === 0) {
              await runOnce(undefined, assistantTurn, true);
            } else {
              await runOnce(message, assistantTurn, true);
            }

            if (isAborted()) {
              run.status = "canceled";
            } else {
              run.status = "completed";
            }
          } catch (err) {
            if (isAborted() || isRunCanceledError(err)) {
              run.status = "canceled";
              run.error = undefined;
            } else {
              run.status = "error";
              run.error = err instanceof Error ? err.message : String(err);
              logger.warn(
                `[sim] build bot run failed (workspaceId=${workspaceId}): ${run.error}`,
              );
            }
          } finally {
            run.finishedAt = new Date().toISOString();
            entry.abort = null;
            entry.promise = null;
            const base = readSessionState(workspaceId) ?? {
              runId: workspaceId,
              messages: [],
              meta: {},
            };
            persistSessionState({
              ...base,
              meta: {
                ...buildWorkspaceMeta(workspaceRecord, base.meta ?? {}),
                buildStatus: run.status,
                buildStartedAt: run.startedAt,
                buildFinishedAt: run.finishedAt,
                buildError: run.error,
              },
            });
            try {
              reloadPrimaryDeck();
            } catch (err) {
              logger.warn(
                `[sim] failed to reload primary deck after build: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }
            broadcastBuildBot(
              { type: "buildBotStatus", run, state: entry.state ?? undefined },
              workspaceId,
            );
            if (prevBotRoot === undefined) {
              try {
                Deno.env.delete("GAMBIT_BOT_ROOT");
              } catch {
                // ignore
              }
            } else {
              Deno.env.set("GAMBIT_BOT_ROOT", prevBotRoot);
            }
          }
        })();

        return new Response(JSON.stringify({ run }), {
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname === "/api/build/files") {
        if (req.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const workspaceId = getWorkspaceIdFromQuery(url);
          await logWorkspaceBotRoot("/api/build/files", workspaceId);
          const root = await resolveBuildBotRoot(workspaceId);
          const entries = await listBuildBotFiles(root);
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
        const workspaceId = getWorkspaceIdFromQuery(url);
        await logWorkspaceBotRoot("/api/build/file", workspaceId);
        const inputPath = url.searchParams.get("path") ?? "";
        if (!inputPath) {
          appendServerErrorLog(workspaceId, {
            endpoint: "/api/build/file",
            status: 400,
            message: "Missing path",
            method: req.method,
          });
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
          if (resolved.stat.size > MAX_FILE_PREVIEW_BYTES) {
            return new Response(
              JSON.stringify({
                path: resolved.relativePath,
                tooLarge: true,
                size: resolved.stat.size,
              }),
              { headers: { "content-type": "application/json" } },
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
              { headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              path: resolved.relativePath,
              contents: text,
              size: resolved.stat.size,
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
          workspaceId?: string;
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
        if (payload.workspaceId) {
          let loaded: SavedState | undefined;
          try {
            loaded = readSessionStateStrict(payload.workspaceId, {
              withTraces: true,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            emitSimulator({ type: "error", message });
            return new Response(
              JSON.stringify({ error: message }),
              { status: 400, headers: { "content-type": "application/json" } },
            );
          }
          if (!loaded) {
            const message = "Workspace not found";
            emitSimulator({ type: "error", message });
            return new Response(
              JSON.stringify({ error: message }),
              { status: 404, headers: { "content-type": "application/json" } },
            );
          }
          simulatorSavedState = loaded;
          simulatorCapturedTraces = Array.isArray(loaded.traces)
            ? cloneTraces(loaded.traces)
            : [];
        }
        simulatorCurrentRunId = undefined;
        const stream = payload.stream ?? true;
        const forwardTrace = payload.trace ?? true;
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
          if (stamped.type === "run.start") {
            simulatorCurrentRunId = stamped.runId;
          }
          simulatorCapturedTraces.push(stamped);
          consoleTracer?.(stamped);
          if (forwardTrace) emitSimulator({ type: "trace", event: stamped });
          if (simulatorSavedState?.meta?.sessionId) {
            appendSessionEvent(simulatorSavedState, {
              ...stamped,
              kind: "trace",
              category: traceCategory(stamped.type),
            } as Record<string, unknown>);
          } else {
            pendingTraceEvents.push(stamped);
          }
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
            responsesMode: opts.responsesMode,
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
              flushPendingTraceEvents(enrichedState);
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
              workspaceId: simulatorSavedState?.meta?.workspaceId,
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
            workspaceId?: string;
            runId?: string;
            messageRefId?: string;
            score?: number | null;
            reason?: string;
          };
          const workspaceId = getWorkspaceIdFromBody(body);
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
          let state: SavedState | undefined;
          try {
            state = readSessionStateStrict(workspaceId, { withTraces: true });
          } catch (err) {
            throw new Error(
              err instanceof Error ? err.message : String(err),
            );
          }
          if (!state) throw new Error("Workspace not found");
          const requestedRunId = typeof body.runId === "string" &&
              body.runId.trim().length > 0
            ? body.runId.trim()
            : undefined;
          const feedbackEligible = isFeedbackEligibleMessageRef(
            state,
            body.messageRefId,
          ) ||
            (requestedRunId
              ? isFeedbackEligiblePersistedTestRunMessageRef(
                state,
                requestedRunId,
                body.messageRefId,
              )
              : false);
          if (!feedbackEligible) {
            throw new Error("Feedback target is not eligible");
          }
          simulatorSavedState = state;
          simulatorCapturedTraces = Array.isArray(state.traces)
            ? cloneTraces(state.traces)
            : [];
          const existing = state.feedback ?? [];
          const idx = existing.findIndex((f) =>
            f.messageRefId === body.messageRefId
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
              : undefined;
            const runId = requestedRunId ??
              (typeof state.runId === "string" ? state.runId : "run");
            const scenarioRunId = typeof state.meta?.scenarioRunId === "string"
              ? state.meta.scenarioRunId
              : runId;
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
              ? existing.map((f, i) => i === idx ? entry! : f)
              : [...existing, entry];
          }
          const enriched = persistSessionState({
            ...state,
            feedback,
            traces: simulatorCapturedTraces,
          });
          appendFeedbackLog(enriched, {
            type: "feedback.update",
            messageRefId: body.messageRefId,
            feedback: entry,
            deleted,
          });
          appendSessionEvent(enriched, {
            type: "feedback.update",
            kind: "artifact",
            category: "feedback",
            workspaceId,
            scenarioRunId: typeof enriched.meta?.scenarioRunId === "string"
              ? enriched.meta.scenarioRunId
              : enriched.runId,
            messageRefId: body.messageRefId,
            feedback: entry,
            deleted,
          });
          simulatorSavedState = enriched;
          emitSimulator({ type: "state", state: enriched });
          return new Response(
            JSON.stringify({ feedback: entry, deleted }),
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
            workspaceId?: string;
            runId?: string;
            text?: string;
          };
          const workspaceId = getWorkspaceIdFromBody(body);
          if (!workspaceId) {
            throw new Error("Missing workspaceId");
          }
          let state: SavedState | undefined;
          try {
            state = readSessionStateStrict(workspaceId, { withTraces: true });
          } catch (err) {
            throw new Error(
              err instanceof Error ? err.message : String(err),
            );
          }
          if (!state) throw new Error("Workspace not found");
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
          appendSessionEvent(enriched, {
            type: "notes.update",
            kind: "artifact",
            category: "notes",
            workspaceId,
            notes: enriched.notes,
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
            workspaceId?: string;
            runId?: string;
            score?: number;
          };
          const workspaceId = getWorkspaceIdFromBody(body);
          if (!workspaceId) {
            throw new Error("Missing workspaceId");
          }
          if (typeof body.score !== "number" || Number.isNaN(body.score)) {
            throw new Error("Invalid score");
          }
          let state: SavedState | undefined;
          try {
            state = readSessionStateStrict(workspaceId, { withTraces: true });
          } catch (err) {
            throw new Error(
              err instanceof Error ? err.message : String(err),
            );
          }
          if (!state) throw new Error("Workspace not found");
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
          appendSessionEvent(enriched, {
            type: "conversation.score.update",
            kind: "artifact",
            category: "score",
            workspaceId,
            conversationScore: enriched.conversationScore,
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
          const body = await req.json() as {
            workspaceId?: string;
            runId?: string;
          };
          const workspaceId = getWorkspaceIdFromBody(body);
          if (!workspaceId) {
            throw new Error("Missing workspaceId");
          }
          let state: SavedState | undefined;
          try {
            state = readSessionStateStrict(workspaceId, { withTraces: true });
          } catch (err) {
            throw new Error(
              err instanceof Error ? err.message : String(err),
            );
          }
          if (!state) {
            throw new Error("Workspace not found");
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

      if (url.pathname === `${WORKSPACE_API_BASE}/notes`) {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as {
            workspaceId?: string;
            text?: string;
          };
          const workspaceId = getWorkspaceIdFromBody(body);
          if (!workspaceId) {
            throw new Error("Missing workspaceId");
          }
          const state = readSessionState(workspaceId);
          if (!state) {
            throw new Error("Workspace not found");
          }
          const now = new Date().toISOString();
          const nextState = persistSessionState({
            ...state,
            notes: { text: body.text ?? "", updatedAt: now },
          });
          appendSessionEvent(nextState, {
            type: "notes.update",
            kind: "artifact",
            category: "notes",
            workspaceId,
            notes: nextState.notes,
          });
          return new Response(
            JSON.stringify({
              workspaceId,
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

      if (url.pathname === `${WORKSPACE_API_BASE}/feedback`) {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as {
            workspaceId?: string;
            runId?: string;
            messageRefId?: string;
            score?: number | null;
            reason?: string;
          };
          const workspaceId = getWorkspaceIdFromBody(body);
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
          const feedbackEligible = isFeedbackEligibleMessageRef(
            state,
            body.messageRefId,
          ) ||
            (requestedRunId
              ? isFeedbackEligiblePersistedTestRunMessageRef(
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
          appendFeedbackLog(nextState, {
            type: "feedback.update",
            messageRefId: body.messageRefId,
            feedback: entry,
            deleted,
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
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
      }

      if (url.pathname === `${WORKSPACE_API_BASE}/delete`) {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }
        try {
          const body = await req.json() as { workspaceId?: string };
          const workspaceId = getWorkspaceIdFromBody(body);
          if (!workspaceId) {
            throw new Error("Missing workspaceId");
          }
          const removed = deleteSessionState(workspaceId);
          if (!removed) {
            return new Response(
              JSON.stringify({ error: "Workspace not found" }),
              { status: 404, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              workspaceId,
              deleted: true,
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

      const feedbackResponse = await handleFeedbackRoutes({
        url,
        req,
        sessionsRoot,
        getWorkspaceIdFromBody,
        readSessionState,
        persistSessionState,
        appendFeedbackLog,
        appendSessionEvent,
      });
      if (feedbackResponse) return feedbackResponse;

      const uiRoutesResponse = await handleUiRoutes({
        url,
        req,
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
        simulatorReactHtml,
        toDeckLabel,
        readReactBundle,
        shouldAdvertiseSourceMap,
        readReactBundleSourceMap,
        listSessions,
        createWorkspaceSession,
        workspaceStateSchemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
      });
      if (uiRoutesResponse) return uiRoutesResponse;

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

function simulatorReactHtml(
  deckPath: string,
  deckLabel?: string,
  opts?: { workspaceId?: string | null; onboarding?: boolean },
): string {
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
    window.__GAMBIT_DECK_PATH__ = ${JSON.stringify(safeDeckPath)};
    window.__GAMBIT_DECK_LABEL__ = ${JSON.stringify(safeDeckLabel)};
    window.__GAMBIT_VERSION__ = ${JSON.stringify(gambitVersion)};
    window.__GAMBIT_BUILD_TAB_ENABLED__ = ${JSON.stringify(buildTabEnabled)};
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
  responsesMode?: boolean;
  workerSandbox?: boolean;
  signal?: AbortSignal;
  onCancel?: () => unknown | Promise<unknown>;
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
      responsesMode: args.responsesMode,
      workerSandbox: args.workerSandbox,
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
        workerSandbox: args.workerSandbox,
        signal: args.signal,
        onCancel: args.onCancel,
      });
    }
    throw error;
  }
}
