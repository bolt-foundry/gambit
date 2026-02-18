import type { SavedState, TraceEvent } from "@bolt-foundry/gambit-core";

export type AvailableTestDeck = {
  id: string;
  label: string;
  description?: string;
  path: string;
};

export type AvailableGraderDeck = {
  id: string;
  label: string;
  description?: string;
  path: string;
};

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

export type DeckToolDescription = {
  name: string;
  label?: string;
  description?: string;
  path?: string;
};

export type SchemaDescription = {
  schema?: NormalizedSchema;
  defaults?: unknown;
  error?: string;
  tools?: Array<DeckToolDescription>;
};

export type GradingRunRecord = {
  id: string;
  workspaceId?: string;
  gradingRunId?: string;
  graderId: string;
  graderPath: string;
  graderLabel?: string;
  status: "running" | "completed" | "error";
  runAt?: string;
  referenceSample?: {
    score: number;
    reason: string;
    evidence?: Array<string>;
    artifactRevisionId?: string;
    workspaceId?: string;
    gradingRunId?: string;
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
  createdAt: string;
};

export type SessionMeta = {
  id: string;
  deck?: string;
  deckSlug?: string;
  testBotName?: string;
  createdAt?: string;
  gradingRuns?: Array<GradingRunRecord>;
  sessionDir?: string;
  statePath?: string;
};

export type OutgoingMessage =
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
