import * as path from "@std/path";
import type { ZodTypeAny } from "zod";
import { loadDeck } from "@bolt-foundry/gambit-core";
import { loadState, saveState } from "@bolt-foundry/gambit-core";
import type { ModelProvider, TraceEvent } from "@bolt-foundry/gambit-core";
import { runDeckWithFallback } from "./test_bot.ts";

const logger = console;

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

const TRACE_EVENT_TYPES = new Set<string>([
  "run.start",
  "message.user",
  "run.end",
  "deck.start",
  "deck.end",
  "action.start",
  "action.end",
  "tool.call",
  "tool.result",
  "model.call",
  "model.result",
  "log",
  "monolog",
]);

function loadTraceEventsFromSession(
  statePath: string,
  state: { meta?: Record<string, unknown> },
): Array<TraceEvent> {
  const meta = state.meta ?? {};
  const eventsPath = typeof meta.sessionEventsPath === "string"
    ? meta.sessionEventsPath
    : path.join(path.dirname(statePath), "events.jsonl");
  try {
    const text = Deno.readTextFileSync(eventsPath);
    const traces: Array<TraceEvent> = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        const kind = typeof record.kind === "string" ? record.kind : "";
        const type = typeof record.type === "string" ? record.type : "";
        if (kind === "trace" || TRACE_EVENT_TYPES.has(type)) {
          traces.push(record as TraceEvent);
        }
      } catch {
        // ignore invalid lines
      }
    }
    return traces;
  } catch {
    return [];
  }
}

function randomId(prefix: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `${prefix}-${suffix}`;
}

function unwrapSchema(schema: ZodTypeAny): { schema: ZodTypeAny } {
  let current: ZodTypeAny = schema;

  while (current && typeof current === "object") {
    const def =
      (current as { _def?: { typeName?: string; [k: string]: unknown } })
        ._def;
    const typeName = def?.typeName;
    if (typeName === "ZodOptional" || typeName === "ZodNullable") {
      current = (def as { innerType: ZodTypeAny }).innerType;
      continue;
    }
    if (typeName === "ZodDefault") {
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

  return { schema: current };
}

function schemaHasField(
  schema: ZodTypeAny | undefined,
  field: string,
): boolean {
  if (!schema) return false;
  const unwrapped = unwrapSchema(schema).schema;
  const def = (unwrapped as { _def?: { typeName?: string; shape?: unknown } })
    ._def;
  if (def?.typeName !== "ZodObject") return false;
  const shape = typeof def.shape === "function" ? def.shape() : def.shape;
  if (!shape || typeof shape !== "object") return false;
  return field in (shape as Record<string, unknown>);
}

function upsertRun(
  state: import("@bolt-foundry/gambit-core").SavedState,
  entry: GradingRunRecord,
) {
  const current = state ?? { runId: randomId("run"), messages: [] };
  const existing = Array.isArray(
      (current.meta as { gradingRuns?: unknown })?.gradingRuns,
    )
    ? ((current.meta as { gradingRuns: Array<GradingRunRecord> }).gradingRuns)
    : Array.isArray(current.meta?.calibrationRuns)
    ? (current.meta?.calibrationRuns as Array<GradingRunRecord>)
    : [];
  const nextRuns = [...existing];
  const index = nextRuns.findIndex((run) => run.id === entry.id);
  if (index >= 0) nextRuns[index] = entry;
  else nextRuns.unshift(entry);
  return {
    ...current,
    meta: {
      ...(current.meta ?? {}),
      gradingRuns: nextRuns,
    },
  };
}

export async function runGraderAgainstState(opts: {
  statePath: string;
  graderPath: string;
  modelProvider: ModelProvider;
  model?: string;
  modelForce?: string;
  trace?: (
    event: import("@bolt-foundry/gambit-core").TraceEvent,
  ) => void;
  responsesMode?: boolean;
}) {
  const state = loadState(opts.statePath);
  if (!state) {
    throw new Error(`State file not found or invalid: ${opts.statePath}`);
  }
  const deck = await loadDeck(opts.graderPath);
  const graderLabel = deck.label ?? path.basename(opts.graderPath);
  const runMode = schemaHasField(deck.inputSchema, "messageToGrade")
    ? "turns"
    : "conversation";
  const metaForGrading = (() => {
    const rawMeta = state.meta;
    if (!rawMeta || typeof rawMeta !== "object") return undefined;
    const next = { ...(rawMeta as Record<string, unknown>) };
    delete next.calibrationRuns;
    delete next.gradingRuns;
    return next;
  })();
  const sessionPayload = {
    runId: state.runId,
    messages: state.messages,
    messageRefs: state.messageRefs,
    feedback: state.feedback,
    notes: state.notes,
    conversationScore: state.conversationScore,
    traces: Array.isArray(state.traces) && state.traces.length > 0
      ? state.traces
      : loadTraceEventsFromSession(opts.statePath, state),
    meta: metaForGrading,
  };

  const startedAt = new Date().toISOString();
  const runId = randomId("grade");
  let entry: GradingRunRecord;
  let currentState = upsertRun(state, {
    id: runId,
    graderId: opts.graderPath,
    graderPath: opts.graderPath,
    graderLabel,
    status: "running",
    runAt: startedAt,
    input: { session: sessionPayload },
  });
  saveState(opts.statePath, currentState);

  try {
    const result = await (async () => {
      if (runMode === "conversation") {
        return await runDeckWithFallback({
          path: opts.graderPath,
          input: { session: sessionPayload },
          inputProvided: true,
          modelProvider: opts.modelProvider,
          modelOverride: opts.modelForce,
          defaultModel: opts.model,
          trace: opts.trace,
          responsesMode: opts.responsesMode,
        });
      }

      const turns = [];
      for (let idx = 0; idx < state.messages.length; idx++) {
        const msg = state.messages[idx];
        if (!msg || msg.role !== "assistant") continue;
        const input = { session: sessionPayload, messageToGrade: msg };
        const turnResult = await runDeckWithFallback({
          path: opts.graderPath,
          input,
          inputProvided: true,
          modelProvider: opts.modelProvider,
          modelOverride: opts.modelForce,
          defaultModel: opts.model,
          trace: opts.trace,
          responsesMode: opts.responsesMode,
        });
        turns.push({
          index: idx,
          message: msg,
          input,
          result: turnResult,
        });
      }
      return { mode: "turns", turns };
    })();
    entry = {
      id: runId,
      graderId: opts.graderPath,
      graderPath: opts.graderPath,
      graderLabel,
      status: "completed",
      runAt: startedAt,
      input: { session: sessionPayload },
      result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    entry = {
      id: runId,
      graderId: opts.graderPath,
      graderPath: opts.graderPath,
      graderLabel,
      status: "error",
      runAt: startedAt,
      input: { session: sessionPayload },
      error: message,
    };
  }
  currentState = upsertRun(currentState, entry);
  saveState(opts.statePath, currentState);
  logger.log(
    `Grading run (${runMode}) saved to ${opts.statePath} [${entry.status}]`,
  );
}
