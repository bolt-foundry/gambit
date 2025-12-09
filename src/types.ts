import type { ZodTypeAny } from "zod";
import type { SavedState } from "./state.ts";

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

export type Label = string;

export type ActionDefinition = {
  name: string;
  path: string;
  description?: string;
  label?: Label;
};

export type ErrorHandlerConfig = { path: string; label?: Label };
export type IntervalHandlerConfig = {
  path: string;
  delayMs?: number;
  repeatMs?: number;
  label?: Label;
};
export type HandlersConfig = {
  onError?: ErrorHandlerConfig;
  onInterval?: IntervalHandlerConfig;
};

export type BaseDefinition = {
  label?: Label;
  inputSchema?: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  actions?: readonly ActionDefinition[];
  embeds?: readonly string[];
  guardrails?: Partial<Guardrails>;
  syntheticTools?: { respond?: boolean };
};

export type DeckDefinition<Input = unknown> = BaseDefinition & {
  kind: "gambit.deck";
  modelParams?: ModelParams;
  handlers?: HandlersConfig;
  prompt?: string; // deprecated; prefer body
  body?: string;
  run?: DeckExecutor<Input>;
  execute?: DeckExecutor<Input>;
};

export type CardDefinition = BaseDefinition & {
  kind: "gambit.card";
  body?: string;
  inputFragment?: ZodTypeAny;
  outputFragment?: ZodTypeAny;
};

export type CompleteEnvelope = {
  runId: string;
  actionCallId: string;
  parentActionCallId?: string;
  source: {
    deckPath: string;
    actionName: string;
  };
  status?: number;
  payload?: JSONValue;
  message?: string;
  code?: string;
  meta?: Record<string, JSONValue>;
};

export type ExecutionContext<Input = unknown> = {
  runId: string;
  actionCallId: string;
  parentActionCallId?: string;
  depth: number;
  label?: Label;
  input: Input;
  spawnAndWait: (opts: { path: string; input: unknown }) => Promise<unknown>;
  fail: (
    opts: { message: string; code?: string; details?: JSONValue },
  ) => never;
  return: (payload: unknown) => Promise<unknown>;
};

export interface DeckExecutor<Input = unknown> {
  // Method-style signature is bivariant in strictFunctionTypes, allowing decks
  // to narrow ctx.input in their run signatures.
  (ctx: ExecutionContext<Input>): unknown | Promise<unknown>;
}

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
    stream?: boolean;
    state?: SavedState;
    onStreamText?: (chunk: string) => void;
  }) => Promise<{
    message: ModelMessage;
    finishReason: "stop" | "tool_calls" | "length";
    toolCalls?: Array<{
      id: string;
      name: string;
      args: Record<string, JSONValue>;
    }>;
    updatedState?: SavedState;
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
  | {
    type: "run.start";
    runId: string;
    deckPath?: string;
    input?: JSONValue;
    initialUserMessage?: JSONValue;
  }
  | { type: "run.end"; runId: string }
  | {
    type: "deck.start";
    runId: string;
    deckPath: string;
    actionCallId: string;
    parentActionCallId?: string;
  }
  | {
    type: "deck.end";
    runId: string;
    deckPath: string;
    actionCallId: string;
    parentActionCallId?: string;
  }
  | {
    type: "action.start";
    runId: string;
    actionCallId: string;
    name: string;
    path: string;
    parentActionCallId?: string;
  }
  | {
    type: "action.end";
    runId: string;
    actionCallId: string;
    name: string;
    path: string;
    parentActionCallId?: string;
  }
  | {
    type: "tool.call";
    runId: string;
    actionCallId: string;
    name: string;
    args: JSONValue;
    parentActionCallId?: string;
  }
  | {
    type: "tool.result";
    runId: string;
    actionCallId: string;
    name: string;
    result: JSONValue;
    parentActionCallId?: string;
  }
  | {
    type: "model.call";
    runId: string;
    actionCallId: string;
    deckPath: string;
    model?: string;
    stream?: boolean;
    messageCount?: number;
    toolCount?: number;
    messages: ModelMessage[];
    tools?: ToolDefinition[];
    stateMessages?: number;
    parentActionCallId?: string;
  }
  | {
    type: "model.result";
    runId: string;
    actionCallId: string;
    deckPath: string;
    model?: string;
    finishReason: "stop" | "tool_calls" | "length";
    message: ModelMessage;
    toolCalls?: Array<{
      id: string;
      name: string;
      args: JSONValue;
    }>;
    stateMessages?: number;
    parentActionCallId?: string;
  };
