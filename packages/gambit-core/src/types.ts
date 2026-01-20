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

export type OpenResponseItemStatus = "in_progress" | "completed" | "incomplete";

export type OpenResponseMessageRole =
  | "system"
  | "user"
  | "assistant"
  | "tool"
  | "developer";

export type OpenResponseContentPart =
  | {
    type: "input_text";
    text: string;
  }
  | {
    type: "output_text";
    text: string;
    annotations?: Array<unknown>;
    logprobs?: Array<unknown>;
  }
  | {
    type: "text";
    text: string;
  }
  | {
    type: "summary_text";
    text: string;
  }
  | {
    type: "reasoning_text";
    text: string;
  }
  | {
    type: "refusal";
    refusal: string;
  }
  | {
    type: "input_image";
    image_url: string | null;
    detail: "low" | "high" | "auto";
  }
  | {
    type: "input_file";
    filename?: string;
    file_url?: string;
  }
  | {
    type: "input_video";
    video_url: string;
  };

export type OpenResponseItem =
  | {
    type: "message";
    id?: string;
    status?: OpenResponseItemStatus;
    role: OpenResponseMessageRole;
    content: string | Array<OpenResponseContentPart> | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  }
  | {
    type: "function_call";
    id?: string;
    status?: OpenResponseItemStatus;
    call_id: string;
    name: string;
    arguments: string;
  }
  | {
    type: "function_call_output";
    id?: string;
    status?: OpenResponseItemStatus;
    call_id: string;
    output: string;
  }
  | {
    type: "reasoning";
    id?: string;
    status?: OpenResponseItemStatus;
    summary: Array<OpenResponseContentPart>;
    content?: Array<OpenResponseContentPart> | null;
    encrypted_content?: string;
  }
  | {
    type: "item_reference";
    id: string;
  }
  | {
    type: "output_text";
    text: string;
  };

export type OpenResponseMessageItem = Extract<
  OpenResponseItem,
  { type: "message" }
>;

export type OpenResponseUsageDetails = {
  cached_tokens?: number;
  reasoning_tokens?: number;
};

export type OpenResponseUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: OpenResponseUsageDetails;
  output_tokens_details?: OpenResponseUsageDetails;
  // Legacy naming for compatibility.
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type OpenResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
    type: "json_schema";
    name: string;
    description?: string | null;
    schema: Record<string, JSONValue> | null;
    strict?: boolean | null;
  };

export type OpenResponseToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; name?: string };

export type OpenResponseReasoning = {
  effort?: "none" | "low" | "medium" | "high" | "xhigh";
  summary?: "concise" | "detailed" | "auto";
};

export type OpenResponseStreamOptions = {
  include_obfuscation?: boolean;
};

export type OpenResponseInput = string | Array<OpenResponseItem> | null;

export type OpenResponseCreateRequest = {
  model: string;
  input: OpenResponseInput;
  tools?: Array<ToolDefinition>;
  tool_choice?: OpenResponseToolChoice;
  stream?: boolean;
  stream_options?: OpenResponseStreamOptions;
  instructions?: string | null;
  previous_response_id?: string | null;
  truncation?: "auto" | "disabled";
  reasoning?: OpenResponseReasoning | null;
  max_output_tokens?: number;
  max_tool_calls?: number;
  parallel_tool_calls?: boolean;
  include?: Array<
    "reasoning.encrypted_content" | "message.output_text.logprobs"
  >;
  metadata?: Record<string, JSONValue>;
  store?: boolean;
  background?: boolean;
  safety_identifier?: string;
  service_tier?: string;
  prompt_cache_key?: string;
  top_logprobs?: number;
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  text?: OpenResponseFormat;
  state?: SavedState;
  params?: Record<string, unknown>;
};

export type OpenResponseCreateResponse = {
  id: string;
  object?: "response";
  created_at?: number;
  completed_at?: number | null;
  status?: string;
  incomplete_details?: { reason: string } | null;
  error?: { code: string; message: string } | null;
  model?: string;
  previous_response_id?: string | null;
  instructions?: string | null;
  tools?: Array<ToolDefinition>;
  tool_choice?: OpenResponseToolChoice;
  truncation?: "auto" | "disabled";
  parallel_tool_calls?: boolean;
  text?: OpenResponseFormat;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  top_logprobs?: number;
  temperature?: number;
  reasoning?: OpenResponseReasoning | null;
  max_output_tokens?: number;
  max_tool_calls?: number;
  store?: boolean;
  background?: boolean;
  service_tier?: string;
  metadata?: Record<string, JSONValue>;
  safety_identifier?: string;
  prompt_cache_key?: string;
  output: Array<OpenResponseItem>;
  finishReason?: "stop" | "tool_calls" | "length";
  updatedState?: SavedState;
  usage?: OpenResponseUsage;
};

export type OpenResponseEvent =
  | {
    type: "response.output_text.delta";
    delta: string;
    item_id?: string;
    sequence_number?: number;
    output_index?: number;
    content_index?: number;
    logprobs?: Array<unknown>;
    obfuscation?: string;
  }
  | {
    type: "response.output_text.done";
    text?: string;
    item_id?: string;
    sequence_number?: number;
    output_index?: number;
    content_index?: number;
    logprobs?: Array<unknown>;
  }
  | {
    type: "response.output_item.added" | "response.output_item.done";
    item?: OpenResponseItem;
    output_index?: number;
    sequence_number?: number;
  }
  | {
    type: "response.content_part.added" | "response.content_part.done";
    part?: OpenResponseContentPart;
    item_id?: string;
    output_index?: number;
    content_index?: number;
    sequence_number?: number;
  }
  | {
    type: "response.function_call_arguments.delta";
    delta?: string;
    item_id?: string;
    output_index?: number;
    sequence_number?: number;
    obfuscation?: string;
  }
  | {
    type: "response.function_call_arguments.done";
    arguments?: string;
    item_id?: string;
    output_index?: number;
    sequence_number?: number;
  }
  | {
    type: "response.refusal.delta";
    delta?: string;
    item_id?: string;
    output_index?: number;
    content_index?: number;
    sequence_number?: number;
  }
  | {
    type: "response.refusal.done";
    refusal?: string;
    item_id?: string;
    output_index?: number;
    content_index?: number;
    sequence_number?: number;
  }
  | {
    type: "response.reasoning.delta";
    delta?: string;
    item_id?: string;
    output_index?: number;
    content_index?: number;
    sequence_number?: number;
    obfuscation?: string;
  }
  | {
    type: "response.reasoning.done";
    text?: string;
    item_id?: string;
    output_index?: number;
    content_index?: number;
    sequence_number?: number;
  }
  | {
    type: "response.reasoning_summary_text.delta";
    delta?: string;
    item_id?: string;
    output_index?: number;
    summary_index?: number;
    sequence_number?: number;
    obfuscation?: string;
  }
  | {
    type: "response.reasoning_summary_text.done";
    text?: string;
    item_id?: string;
    output_index?: number;
    summary_index?: number;
    sequence_number?: number;
  }
  | {
    type:
      | "response.reasoning_summary_part.added"
      | "response.reasoning_summary_part.done";
    part?: OpenResponseContentPart;
    item_id?: string;
    output_index?: number;
    summary_index?: number;
    sequence_number?: number;
  }
  | {
    type:
      | "response.created"
      | "response.queued"
      | "response.in_progress"
      | "response.failed"
      | "response.incomplete";
    response?: OpenResponseCreateResponse;
    sequence_number?: number;
  }
  | {
    type: "error";
    error?: { code: string; message: string };
    sequence_number?: number;
  }
  | {
    type: "response.completed";
    response: OpenResponseCreateResponse;
    sequence_number?: number;
  };

export type ModelMessage = {
  role: OpenResponseMessageRole;
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
    parameters?: Record<string, JSONValue> | null;
    strict?: boolean;
  };
};

export type ModelProvider = {
  responses: (
    input: OpenResponseCreateRequest & {
      onStreamEvent?: (event: OpenResponseEvent) => void;
    },
  ) => Promise<OpenResponseCreateResponse>;
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
  extraMessages?: Array<OpenResponseItem>;
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
      message: OpenResponseItem;
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
      messages: Array<OpenResponseItem>;
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
      message: OpenResponseItem;
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
