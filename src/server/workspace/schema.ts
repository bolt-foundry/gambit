import * as path from "@std/path";
import { copy, ensureDir, existsSync } from "@std/fs";
import { loadDeck } from "@bolt-foundry/gambit-core";
import type { LoadedDeck } from "@bolt-foundry/gambit-core";
import type { ZodTypeAny } from "zod";
import { resolveDefaultValue } from "../../server_helpers.ts";
import type {
  DeckToolDescription,
  NormalizedSchema,
  PersistedAssistantDeck,
  SchemaDescription,
} from "../../server_types.ts";

const GAMBIT_BOT_SOURCE_DECK_URL = new URL(
  "../../decks/gambit-bot/PROMPT.md",
  import.meta.url,
);

export const GAMBIT_BOT_SOURCE_DECK_PATH =
  GAMBIT_BOT_SOURCE_DECK_URL.protocol === "file:"
    ? path.fromFileUrl(GAMBIT_BOT_SOURCE_DECK_URL)
    : "";

const GAMBIT_BOT_SOURCE_DIR = GAMBIT_BOT_SOURCE_DECK_URL.protocol === "file:"
  ? path.dirname(path.fromFileUrl(GAMBIT_BOT_SOURCE_DECK_URL))
  : "";

export const GAMBIT_BOT_POLICY_DIR = GAMBIT_BOT_SOURCE_DIR
  ? path.join(GAMBIT_BOT_SOURCE_DIR, "policy")
  : "";

export async function ensureGambitPolicyInBotRoot(root: string) {
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
    if (!(err instanceof Deno.errors.AlreadyExists)) {
      throw err;
    }
  }
}

export async function describeDeckInputSchemaFromPath(
  deckPath: string,
  logger: { warn: (...args: Array<unknown>) => void } = console,
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

export function mapDeckTools(
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

export function describeZodSchema(schema?: ZodTypeAny): SchemaDescription {
  try {
    const normalized = normalizeSchema(schema);
    const defaults = normalized ? materializeDefaults(normalized) : undefined;
    return { schema: normalized, defaults };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

export function schemaHasField(
  schema: NormalizedSchema | undefined,
  field: string,
): boolean {
  return schema?.kind === "object" &&
    Boolean(schema.fields && schema.fields[field]);
}

export function normalizeSchema(
  schema?: ZodTypeAny,
): NormalizedSchema | undefined {
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

export function cloneValue<T>(value: T): T {
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

export function resolveDeckPath(p: string): string {
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

export function deriveInitialFromSchema(
  schema?: NormalizedSchema,
): unknown {
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

export function findMissingRequiredFields(
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
  pathSegments: Array<string>,
): NormalizedSchema | undefined {
  let current = schema;
  for (const segment of pathSegments) {
    if (!current || current.kind !== "object" || !current.fields) return;
    current = current.fields[segment];
  }
  return current;
}

export function buildInitFillPrompt(args: {
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

export function unwrapRespondPayload(output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  const record = output as Record<string, unknown>;
  if ("payload" in record) {
    return record.payload;
  }
  return output;
}

export function parseInitFillOutput(
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

export function validateInitInput(
  schema: ZodTypeAny | undefined,
  value: unknown,
) {
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

export function buildPersistedAssistantDeck(
  deck: LoadedDeck,
): PersistedAssistantDeck {
  const desc = describeZodSchema(deck.inputSchema);
  const tools = mapDeckTools(deck.actionDecks);
  const startMode = deck.startMode === "assistant" || deck.startMode === "user"
    ? deck.startMode
    : "assistant";
  return {
    deck: deck.path,
    startMode,
    modelParams: deck.modelParams ?? undefined,
    inputSchema: desc.schema,
    defaults: desc.defaults,
    tools,
    inputSchemaError: desc.error,
  };
}
