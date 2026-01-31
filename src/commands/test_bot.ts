import { isGambitEndSignal, runDeck } from "@molt-foundry/gambit-core";
import { loadState, saveState } from "@molt-foundry/gambit-core";
import type { ModelProvider, TraceEvent } from "@molt-foundry/gambit-core";
import { loadDeck } from "@molt-foundry/gambit-core";
import type { ZodTypeAny } from "zod";
import {
  defaultTestBotStatePath,
  enrichStateMeta,
  findLastAssistantMessage,
} from "../cli_utils.ts";

const logger = console;

function shouldRetryWithStringInput(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    return error.message.includes("Schema validation failed");
  }
  return false;
}

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

type TestBotInitFill = {
  requested: Array<string>;
  applied?: unknown;
  provided?: unknown;
  error?: string;
};

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
    return typeof value === "string" && value.trim() == "" ? [key] : [];
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
    "You are filling missing required init fields for a Gambit Test Bot run.",
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

export async function runDeckWithFallback(args: {
  path: string;
  input?: unknown;
  inputProvided?: boolean;
  modelProvider: ModelProvider;
  defaultModel?: string;
  modelOverride?: string;
  state?: import("@molt-foundry/gambit-core").SavedState;
  allowRootStringInput?: boolean;
  initialUserMessage?: string;
  onStateUpdate?: (
    state: import("@molt-foundry/gambit-core").SavedState,
  ) => void;
  stream?: boolean;
  onStreamText?: (chunk: string) => void;
  trace?: (
    event: import("@molt-foundry/gambit-core").TraceEvent,
  ) => void;
  responsesMode?: boolean;
}): Promise<unknown> {
  try {
    return await runDeck({
      path: args.path,
      input: args.input,
      inputProvided: args.inputProvided,
      modelProvider: args.modelProvider,
      defaultModel: args.defaultModel,
      modelOverride: args.modelOverride,
      state: args.state,
      allowRootStringInput: args.allowRootStringInput,
      initialUserMessage: args.initialUserMessage,
      onStateUpdate: args.onStateUpdate,
      stream: args.stream,
      onStreamText: args.onStreamText,
      trace: args.trace,
      responsesMode: args.responsesMode,
    });
  } catch (error) {
    if (args.input === undefined && shouldRetryWithStringInput(error)) {
      return await runDeck({
        path: args.path,
        input: "",
        inputProvided: true,
        modelProvider: args.modelProvider,
        defaultModel: args.defaultModel,
        modelOverride: args.modelOverride,
        state: args.state,
        allowRootStringInput: args.allowRootStringInput,
        initialUserMessage: args.initialUserMessage,
        onStateUpdate: args.onStateUpdate,
        stream: args.stream,
        onStreamText: args.onStreamText,
        trace: args.trace,
        responsesMode: args.responsesMode,
      });
    }
    throw error;
  }
}

export async function runTestBotLoop(opts: {
  rootDeckPath: string;
  botDeckPath: string;
  context?: unknown;
  contextProvided: boolean;
  initialUserMessage?: unknown;
  botInput?: unknown;
  maxTurns: number;
  model?: string;
  modelForce?: string;
  modelProvider: ModelProvider;
  trace?: (event: TraceEvent) => void;
  verbose?: boolean;
  statePath?: string;
  responsesMode?: boolean;
}): Promise<string> {
  let rootState:
    | import("@molt-foundry/gambit-core").SavedState
    | undefined = undefined;
  let botState:
    | import("@molt-foundry/gambit-core").SavedState
    | undefined = undefined;
  const statePath = opts.statePath ??
    defaultTestBotStatePath(opts.rootDeckPath);
  const capturedTraces: Array<
    import("@molt-foundry/gambit-core").TraceEvent
  > = [];
  const traceWrapper = (
    event: import("@molt-foundry/gambit-core").TraceEvent,
  ) => {
    capturedTraces.push(event);
    opts.trace?.(event);
  };
  const saveStateToDisk = (
    state: import("@molt-foundry/gambit-core").SavedState,
  ) => {
    const enriched = enrichStateMeta(
      { ...state, traces: capturedTraces },
      opts.rootDeckPath,
    );
    saveState(statePath, enriched);
  };

  const existingState = loadState(statePath);
  if (existingState) {
    rootState = existingState;
    if (Array.isArray(existingState.traces)) {
      capturedTraces.push(...existingState.traces);
    }
  }

  let initFillMeta: TestBotInitFill | undefined;

  const updateRootState = (
    state: import("@molt-foundry/gambit-core").SavedState,
  ) => {
    const enriched = enrichStateMeta(
      {
        ...state,
        meta: {
          ...(state.meta ?? {}),
          ...(initFillMeta ? { testBotInitFill: initFillMeta } : {}),
        },
      },
      opts.rootDeckPath,
    );
    rootState = enriched;
    saveStateToDisk(enriched);
  };
  let sessionEnded = false;

  const shouldRunRoot = !existingState ||
    opts.initialUserMessage !== undefined;
  let resolvedContext = opts.context;
  let resolvedContextProvided = opts.contextProvided;

  if (shouldRunRoot && !existingState) {
    try {
      const deck = await loadDeck(opts.rootDeckPath);
      const schema = deck.contextSchema ?? deck.inputSchema;
      const normalized = normalizeSchema(schema);
      const missing = normalized
        ? findMissingRequiredFields(normalized, resolvedContext)
        : [];
      if (missing.length > 0) {
        const fillPrompt = buildInitFillPrompt({
          missing,
          current: resolvedContext,
          schema: normalized,
        });
        const fillOutput = await runDeckWithFallback({
          path: opts.botDeckPath,
          input: opts.botInput,
          inputProvided: opts.botInput !== undefined,
          initialUserMessage: fillPrompt,
          modelProvider: opts.modelProvider,
          defaultModel: opts.model,
          modelOverride: opts.modelForce,
          trace: traceWrapper,
          stream: false,
          state: botState,
          allowRootStringInput: true,
          onStateUpdate: (state) => {
            botState = state;
          },
          responsesMode: opts.responsesMode,
        });
        const parsed = parseInitFillOutput(fillOutput);
        if (parsed.error) {
          throw new Error(parsed.error);
        }
        let appliedObject: Record<string, unknown> = {};
        let appliedRoot: unknown = undefined;
        let nextContext = resolvedContext;
        for (const pathKey of missing) {
          const segments = pathKey === "(root)" ? [] : pathKey.split(".");
          const leafSchema = getSchemaAtPath(normalized, segments);
          const currentValue = getPathValue(nextContext, segments);
          if (
            currentValue !== undefined && currentValue !== null &&
            !(typeof currentValue === "string" &&
              (leafSchema?.kind === "string" || leafSchema?.kind === "enum") &&
              currentValue.trim() === "") &&
            !(Array.isArray(currentValue) && leafSchema?.kind === "array" &&
              currentValue.length === 0)
          ) {
            continue;
          }
          const fillValue = getPathValue(parsed.data, segments);
          if (fillValue === undefined) continue;
          if (segments.length === 0) {
            nextContext = fillValue;
            appliedRoot = fillValue;
            continue;
          }
          nextContext = setPathValue(nextContext, segments, fillValue);
          const appliedValue = setPathValue(appliedObject, segments, fillValue);
          if (appliedValue && typeof appliedValue === "object") {
            appliedObject = appliedValue as Record<string, unknown>;
          }
        }
        const validated = validateInitInput(schema, nextContext);
        resolvedContext = validated;
        resolvedContextProvided = true;
        const remainingMissing = normalized
          ? findMissingRequiredFields(normalized, resolvedContext)
          : [];
        if (remainingMissing.length > 0) {
          throw new Error(
            `Init fill incomplete: missing ${remainingMissing.join(", ")}`,
          );
        }
        initFillMeta = {
          requested: missing,
          applied: appliedRoot !== undefined
            ? appliedRoot
            : Object.keys(appliedObject).length
            ? appliedObject
            : undefined,
          provided: parsed.data,
        };
        logger.log(
          `[test-bot] init fill requested: ${missing.join(", ")}`,
        );
        logger.log(
          `[test-bot] init fill applied: ${
            initFillMeta.applied !== undefined
              ? JSON.stringify(initFillMeta.applied)
              : "none"
          }`,
        );
        const actionCallId = randomId("initfill");
        traceWrapper({
          type: "tool.call",
          runId: randomId("testbot"),
          actionCallId,
          name: "gambit_test_bot_init_fill",
          args: {
            missing,
          },
        });
        traceWrapper({
          type: "tool.result",
          runId: randomId("testbot"),
          actionCallId,
          name: "gambit_test_bot_init_fill",
          result: {
            applied: initFillMeta.applied,
            provided: initFillMeta.provided,
          } as unknown as import("@molt-foundry/gambit-core").JSONValue,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[test-bot] init fill failed: ${message}`);
      throw err;
    }
  }

  if (shouldRunRoot) {
    const initialResult = await runDeck({
      path: opts.rootDeckPath,
      input: resolvedContext,
      inputProvided: resolvedContextProvided,
      initialUserMessage: opts.initialUserMessage,
      modelProvider: opts.modelProvider,
      isRoot: true,
      defaultModel: opts.model,
      modelOverride: opts.modelForce,
      trace: traceWrapper,
      stream: false,
      state: rootState,
      onStateUpdate: updateRootState,
      responsesMode: opts.responsesMode,
    });
    if (isGambitEndSignal(initialResult)) {
      sessionEnded = true;
    }
  }

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    if (sessionEnded) break;
    const history = rootState?.messages ?? [];
    const assistantMessage = findLastAssistantMessage(history);
    if (!assistantMessage) break;
    const botResult = await runDeckWithFallback({
      path: opts.botDeckPath,
      input: opts.botInput,
      inputProvided: opts.botInput !== undefined,
      initialUserMessage: assistantMessage,
      modelProvider: opts.modelProvider,
      defaultModel: opts.model,
      modelOverride: opts.modelForce,
      trace: traceWrapper,
      stream: false,
      state: botState,
      allowRootStringInput: true,
      onStateUpdate: (state) => {
        botState = state;
      },
      responsesMode: opts.responsesMode,
    });
    if (isGambitEndSignal(botResult)) {
      sessionEnded = true;
      break;
    }
    const botText = typeof botResult === "string"
      ? botResult
      : JSON.stringify(botResult);
    const userMessage = botText.trim();
    if (!userMessage) break;
    const rootResult = await runDeck({
      path: opts.rootDeckPath,
      input: resolvedContext,
      inputProvided: resolvedContextProvided,
      initialUserMessage: userMessage,
      modelProvider: opts.modelProvider,
      isRoot: true,
      defaultModel: opts.model,
      modelOverride: opts.modelForce,
      trace: traceWrapper,
      stream: false,
      state: rootState,
      onStateUpdate: updateRootState,
      responsesMode: opts.responsesMode,
    });
    if (isGambitEndSignal(rootResult)) {
      sessionEnded = true;
      break;
    }
  }

  return statePath;
}
