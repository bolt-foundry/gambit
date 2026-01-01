import type { ZodTypeAny } from "zod";
import type { SavedState } from "./state.ts";

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JSONValue }
  | Array<JSONValue>;

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  title?: string;
  message?: string;
  body?: unknown;
  level?: LogLevel;
  meta?: unknown;
};

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

export type DeckReferenceDefinition = {
  path: string;
  label?: Label;
  description?: string;
  id?: string;
};

export type ActionDeckDefinition = DeckReferenceDefinition & {
  name: string;
};

export type TestDeckDefinition = DeckReferenceDefinition;

export type GraderDeckDefinition = DeckReferenceDefinition;

export type ErrorHandlerConfig = { path: string; label?: Label };
export type BusyHandlerConfig = {
  path: string;
  delayMs?: number;
  repeatMs?: number;
  label?: Label;
  // Deprecated alias; if provided, mapped to repeatMs.
  intervalMs?: number;
};
export type IdleHandlerConfig = {
  path: string;
  delayMs?: number;
  repeatMs?: number;
  label?: Label;
  // Deprecated alias; if provided, mapped to repeatMs.
  intervalMs?: number;
};
// onInterval kept for backward compatibility; prefer onBusy.
export type IntervalHandlerConfig = BusyHandlerConfig;
export type HandlersConfig = {
  onError?: ErrorHandlerConfig;
  onBusy?: BusyHandlerConfig;
  onIdle?: IdleHandlerConfig;
  onInterval?: IntervalHandlerConfig;
};

export type BaseDefinition = {
  label?: Label;
  inputSchema?: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  allowEnd?: boolean;
  /**
   * @deprecated Use actionDecks/testDecks/graderDecks instead.
   */
  actions?: ReadonlyArray<ActionDeckDefinition>;
  actionDecks?: ReadonlyArray<ActionDeckDefinition>;
  testDecks?: ReadonlyArray<TestDeckDefinition>;
  graderDecks?: ReadonlyArray<GraderDeckDefinition>;
  guardrails?: Partial<Guardrails>;
};

export type DeckDefinition<Input = unknown> = BaseDefinition & {
  kind: "gambit.deck";
  modelParams?: ModelParams;
  handlers?: HandlersConfig;
  prompt?: string; // deprecated; prefer body
  body?: string;
  run?: DeckExecutor<Input>;
  execute?: DeckExecutor<Input>;
  respond?: boolean;
};

export type CardDefinition = BaseDefinition & {
  kind: "gambit.card";
  body?: string;
  inputFragment?: ZodTypeAny;
  outputFragment?: ZodTypeAny;
  respond?: boolean;
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
  log: (entry: LogEntry | string) => void;
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
    messages: Array<ModelMessage>;
    tools?: Array<ToolDefinition>;
    stream?: boolean;
    state?: SavedState;
    onStreamText?: (chunk: string) => void;
    /**
     * Provider-specific pass-through parameters (e.g. OpenAI chat completion
     * fields like temperature/max_tokens).
     */
    params?: Record<string, unknown>;
  }) => Promise<{
    message: ModelMessage;
    finishReason: "stop" | "tool_calls" | "length";
    toolCalls?: Array<{
      id: string;
      name: string;
      args: Record<string, JSONValue>;
    }>;
    updatedState?: SavedState;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }>;
};

type WithDeckRefs<T> = Omit<
  T,
  "actions" | "actionDecks" | "testDecks" | "graderDecks"
>;

export type LoadedCard = WithDeckRefs<CardDefinition> & {
  path: string;
  cards?: Array<LoadedCard>;
  actionDecks: Array<ActionDeckDefinition>;
  /**
   * @deprecated Use actionDecks instead.
   */
  actions: Array<ActionDeckDefinition>;
  testDecks: Array<TestDeckDefinition>;
  graderDecks: Array<GraderDeckDefinition>;
};

export type LoadedDeck = WithDeckRefs<DeckDefinition> & {
  path: string;
  cards: Array<LoadedCard>;
  actionDecks: Array<ActionDeckDefinition>;
  /**
   * @deprecated Use actionDecks instead.
   */
  actions: Array<ActionDeckDefinition>;
  testDecks: Array<TestDeckDefinition>;
  graderDecks: Array<GraderDeckDefinition>;
  executor?: DeckExecutor;
  guardrails?: Partial<Guardrails>;
  inlineEmbeds?: boolean;
};

export type ToolCallResult = {
  toolContent: string;
  extraMessages?: Array<ModelMessage>;
};

export type TraceEvent =
  & {
    ts?: number;
  }
  & (
    | {
      type: "run.start";
      runId: string;
      deckPath?: string;
      input?: JSONValue;
      initialUserMessage?: JSONValue;
    }
    | {
      type: "message.user";
      runId: string;
      actionCallId: string;
      deckPath: string;
      message: ModelMessage;
      parentActionCallId?: string;
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
      messages: Array<ModelMessage>;
      tools?: Array<ToolDefinition>;
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
    }
    | {
      type: "log";
      runId: string;
      deckPath: string;
      actionCallId: string;
      parentActionCallId?: string;
      level?: LogLevel;
      title?: string;
      message: string;
      body?: unknown;
      meta?: unknown;
    }
    | {
      type: "monolog";
      runId: string;
      deckPath: string;
      actionCallId: string;
      parentActionCallId?: string;
      content: JSONValue;
    }
  );
