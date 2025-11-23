import type { ZodTypeAny } from "zod";

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JSONValue }
  | JSONValue[];

export type ModelParams = {
  model?: string;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens?: number;
};

export type Guardrails = {
  maxDepth: number;
  maxPasses: number;
  timeoutMs: number;
};

export type Activity = string;

export type ActionDefinition = {
  name: string;
  path: string;
  description?: string;
  activity?: Activity;
};

export type ErrorHandlerConfig = {
  path: string;
  activity?: Activity;
};

export type SuspenseHandlerConfig = {
  path: string;
  delayMs?: number;
  activity?: Activity;
};

export type BaseDefinition = {
  activity?: Activity;
  inputSchema?: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  actions?: readonly ActionDefinition[];
  embeds?: readonly string[];
  guardrails?: Partial<Guardrails>;
};

export type DeckDefinition = BaseDefinition & {
  kind: "gambit.deck";
  modelParams?: ModelParams;
  errorHandler?: ErrorHandlerConfig;
  suspenseHandler?: SuspenseHandlerConfig;
  suspenseDelayMs?: number;
  prompt?: string;
};

export type CardDefinition = BaseDefinition & {
  kind: "gambit.card";
  body?: string;
  inputFragment?: ZodTypeAny;
  outputFragment?: ZodTypeAny;
};

export type ReferenceContext = {
  runId: string;
  actionCallId: string;
  parentActionCallId?: string;
  input: unknown;
  action: {
    name: string;
    path: string;
    activity?: Activity;
    description?: string;
  };
};

export type ErrorEnvelope = {
  kind: "error";
  runId: string;
  actionCallId: string;
  parentActionCallId?: string;
  message: string;
  code?: string;
  details?: JSONValue;
  activity?: Activity;
  source: {
    deckPath: string;
    actionName: string;
  };
  payload?: JSONValue;
  meta?: Record<string, JSONValue>;
};

export type SuspenseEnvelope = {
  kind: "suspense";
  runId: string;
  actionCallId: string;
  parentActionCallId?: string;
  message: string;
  activity?: Activity;
  source: {
    deckPath: string;
    actionName: string;
  };
  trigger: {
    reason: "timeout";
    elapsedMs: number;
  };
  meta?: Record<string, JSONValue>;
};

export type ExecutionContext = {
  runId: string;
  actionCallId: string;
  parentActionCallId?: string;
  depth: number;
  activity?: Activity;
  input: unknown;
  spawnAndWait: (opts: { path: string; input: unknown }) => Promise<unknown>;
  fail: (opts: { message: string; code?: string; details?: JSONValue }) => never;
  return: (payload: unknown) => Promise<unknown>;
};

export type DeckExecutor = (ctx: ExecutionContext) => unknown | Promise<unknown>;

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, JSONValue>;
  };
};

export type ModelProvider = {
  chat: (input: {
    model: string;
    messages: ModelMessage[];
    tools?: ToolDefinition[];
  }) => Promise<{
    message: ModelMessage;
    finishReason: "stop" | "tool_calls" | "length";
    toolCalls?: Array<{
      id: string;
      name: string;
      args: Record<string, JSONValue>;
    }>;
  }>;
};

export type LoadedCard = CardDefinition & {
  path: string;
  cards?: LoadedCard[];
};

export type LoadedDeck = DeckDefinition & {
  path: string;
  cards: LoadedCard[];
  actions: ActionDefinition[];
  executor?: DeckExecutor;
  guardrails?: Partial<Guardrails>;
};

export type ToolCallResult = {
  toolContent: string;
  extraMessages?: ModelMessage[];
};

export type TraceEvent =
  | { type: "run.start"; runId: string }
  | { type: "run.end"; runId: string }
  | {
    type: "deck.start";
    runId: string;
    deckPath: string;
    actionCallId: string;
  }
  | {
    type: "deck.end";
    runId: string;
    deckPath: string;
    actionCallId: string;
  }
  | {
    type: "action.start";
    runId: string;
    actionCallId: string;
    name: string;
    path: string;
  }
  | {
    type: "action.end";
    runId: string;
    actionCallId: string;
    name: string;
    path: string;
  }
  | {
    type: "event";
    runId: string;
    actionCallId: string;
    name: string;
    payload: JSONValue;
  };
