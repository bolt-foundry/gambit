import type { ZodTypeAny } from "zod";
import type { SavedState } from "./state.ts";
import type {
  PermissionDeclaration,
  PermissionDeclarationInput,
  PermissionTrace,
} from "./permissions.ts";

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
  model?: string | Array<string>;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens?: number;
  verbosity?: "low" | "medium" | "high";
  reasoning?: {
    effort?: "none" | "low" | "medium" | "high" | "xhigh";
    summary?: "concise" | "detailed" | "auto";
  };
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
  permissions?: PermissionDeclarationInput;
};

export type ActionDeckDefinition = DeckReferenceDefinition & {
  name: string;
  execute?: string;
  contextSchema?: ZodTypeAny;
  responseSchema?: ZodTypeAny;
};

export type ExternalToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: ZodTypeAny;
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
  startMode?: "assistant" | "user";
  contextSchema?: ZodTypeAny;
  responseSchema?: ZodTypeAny;
  /**
   * @deprecated Use contextSchema instead.
   */
  inputSchema?: ZodTypeAny;
  /**
   * @deprecated Use responseSchema instead.
   */
  outputSchema?: ZodTypeAny;
  allowEnd?: boolean;
  /**
   * @deprecated Use actionDecks/testDecks/graderDecks instead.
   */
  actions?: ReadonlyArray<ActionDeckDefinition>;
  actionDecks?: ReadonlyArray<ActionDeckDefinition>;
  testDecks?: ReadonlyArray<TestDeckDefinition>;
  graderDecks?: ReadonlyArray<GraderDeckDefinition>;
  permissions?: PermissionDeclarationInput;
  guardrails?: Partial<Guardrails>;
};

export type DeckDefinition<Input = unknown> = BaseDefinition & {
  kind: "gambit.deck";
  modelParams?: ModelParams;
  tools?: ReadonlyArray<ExternalToolDefinition>;
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
  contextFragment?: ZodTypeAny;
  responseFragment?: ZodTypeAny;
  /**
   * @deprecated Use contextFragment instead.
   */
  inputFragment?: ZodTypeAny;
  /**
   * @deprecated Use responseFragment instead.
   */
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
  initialUserMessage?: unknown;
  getSessionMeta: <T = unknown>(key: string) => T | undefined;
  setSessionMeta: (key: string, value: unknown) => void;
  appendMessage: (
    message: { role: "user" | "assistant"; content: string },
  ) => void;
  log: (entry: LogEntry | string) => void;
  spawnAndWait: (opts: {
    path: string;
    input: unknown;
    initialUserMessage?: unknown;
  }) => Promise<unknown>;
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

export type ResponseTextContent =
  | { type: "input_text"; text: string }
  | { type: "output_text"; text: string }
  | { type: "summary_text"; text: string }
  | { type: "reasoning_text"; text: string };

export type ResponseMessageItem = {
  type: "message";
  role: "system" | "user" | "assistant";
  content: Array<ResponseTextContent>;
  id?: string;
};

export type ResponseFunctionCallItem = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  id?: string;
};

export type ResponseFunctionCallOutputItem = {
  type: "function_call_output";
  call_id: string;
  output: string;
  id?: string;
};

export type ResponseReasoningItem = {
  type: "reasoning";
  id?: string;
  content?: Array<ResponseTextContent>;
  summary: Array<ResponseTextContent>;
  encrypted_content?: string | null;
};

export type ResponseItem =
  | ResponseMessageItem
  | ResponseFunctionCallItem
  | ResponseFunctionCallOutputItem
  | ResponseReasoningItem;

export type ResponseToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, JSONValue>;
  };
};

export type ResponseToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } }
  | {
    type: "allowed_tools";
    tools: Array<{ type: "function"; name: string }>;
    mode?: "none" | "auto" | "required";
  };

export type ResponseReasoningConfig = {
  effort?: "none" | "low" | "medium" | "high" | "xhigh" | null;
  summary?: "auto" | "concise" | "detailed" | null;
};

export type ResponseTextConfig = {
  format?:
    | { type: "text" }
    | { type: "json_object" }
    | {
      type: "json_schema";
      name?: string;
      description?: string | null;
      schema?: JSONValue | null;
      strict?: boolean;
    }
    | null;
  verbosity?: "low" | "medium" | "high";
};

export type ResponseAllowedTool = { type: "function"; name: string };

export type CreateResponseRequest = {
  model: string;
  input: Array<ResponseItem>;
  instructions?: string;
  tools?: Array<ResponseToolDefinition>;
  tool_choice?: ResponseToolChoice;
  allowed_tools?: Array<ResponseAllowedTool>;
  previous_response_id?: string;
  store?: boolean;
  reasoning?: ResponseReasoningConfig;
  parallel_tool_calls?: boolean;
  max_tool_calls?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  stream_options?: {
    include_obfuscation?: boolean;
  };
  background?: boolean;
  max_output_tokens?: number;
  top_logprobs?: number;
  truncation?: "auto" | "disabled";
  text?: ResponseTextConfig;
  service_tier?: "auto" | "default" | "flex" | "priority";
  include?: Array<string>;
  metadata?: Record<string, JSONValue>;
  safety_identifier?: string;
  prompt_cache_key?: string;
  params?: Record<string, unknown>;
};

export type ResponseUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
};

export type CreateResponseResponse = {
  id: string;
  object: "response";
  model?: string;
  created_at?: number;
  completed_at?: number | null;
  previous_response_id?: string | null;
  instructions?: string | null;
  reasoning?: ResponseReasoningConfig | null;
  created?: number;
  status?: "completed" | "in_progress" | "failed";
  output: Array<ResponseItem>;
  tools?: Array<ResponseToolDefinition>;
  tool_choice?: ResponseToolChoice;
  parallel_tool_calls?: boolean;
  truncation?: "auto" | "disabled";
  text?: ResponseTextConfig;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  top_logprobs?: number;
  temperature?: number;
  max_output_tokens?: number | null;
  max_tool_calls?: number | null;
  store?: boolean;
  background?: boolean;
  service_tier?: "auto" | "default" | "flex" | "priority";
  metadata?: Record<string, JSONValue>;
  safety_identifier?: string | null;
  prompt_cache_key?: string | null;
  usage?: ResponseUsage;
  error?: { code?: string; message?: string } | null;
  updatedState?: SavedState;
};

export type ResponseEvent =
  | {
    type: "response.created";
    response: CreateResponseResponse;
    sequence_number?: number;
  }
  | {
    type: "tool.call";
    actionCallId: string;
    name: string;
    args?: JSONValue;
  }
  | {
    type: "tool.result";
    actionCallId: string;
    name: string;
    result?: JSONValue;
  }
  | {
    type: "response.output_text.delta";
    output_index: number;
    delta: string;
    item_id?: string;
    content_index?: number;
    sequence_number?: number;
    logprobs?: Array<{
      token?: string;
      logprob?: number;
    }>;
  }
  | {
    type: "response.output_text.done";
    output_index: number;
    text: string;
    item_id?: string;
    content_index?: number;
    sequence_number?: number;
  }
  | {
    type: "response.output_item.added";
    output_index: number;
    item: ResponseItem;
    sequence_number?: number;
  }
  | {
    type: "response.output_item.done";
    output_index: number;
    item: ResponseItem;
    sequence_number?: number;
  }
  | {
    type: "response.reasoning.delta";
    output_index: number;
    item_id: string;
    content_index: number;
    delta: string;
    sequence_number?: number;
    obfuscation?: string;
  }
  | {
    type: "response.reasoning.done";
    output_index: number;
    item_id: string;
    content_index: number;
    text: string;
    sequence_number?: number;
  }
  | {
    type: "response.reasoning_summary_text.delta";
    output_index: number;
    item_id: string;
    summary_index: number;
    delta: string;
    sequence_number?: number;
    obfuscation?: string;
  }
  | {
    type: "response.reasoning_summary_text.done";
    output_index: number;
    item_id: string;
    summary_index: number;
    text: string;
    sequence_number?: number;
  }
  | {
    type: "response.reasoning_summary_part.added";
    output_index: number;
    item_id: string;
    summary_index: number;
    part: ResponseTextContent;
    sequence_number?: number;
  }
  | {
    type: "response.reasoning_summary_part.done";
    output_index: number;
    item_id: string;
    summary_index: number;
    part: ResponseTextContent;
    sequence_number?: number;
  }
  | {
    type: "response.completed";
    response: CreateResponseResponse;
    sequence_number?: number;
  }
  | {
    type: "response.failed";
    error: { code?: string; message?: string };
    sequence_number?: number;
  };

export type ModelProvider = {
  responses?: (input: {
    request: CreateResponseRequest;
    state?: SavedState;
    deckPath?: string;
    signal?: AbortSignal;
    onStreamEvent?: (event: ResponseEvent) => void;
    onTraceEvent?: (event: ProviderTraceEvent) => void;
  }) => Promise<CreateResponseResponse>;
  resolveModel?: (input: {
    model: string | Array<string>;
    params?: Record<string, unknown>;
    deckPath?: string;
  }) => Promise<{
    model: string;
    params?: Record<string, unknown>;
  }>;
  chat: (input: {
    model: string;
    messages: Array<ModelMessage>;
    tools?: Array<ToolDefinition>;
    stream?: boolean;
    state?: SavedState;
    deckPath?: string;
    signal?: AbortSignal;
    onStreamText?: (chunk: string) => void;
    onStreamEvent?: (event: Record<string, JSONValue>) => void;
    onTraceEvent?: (event: ProviderTraceEvent) => void;
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
      reasoningTokens?: number;
    };
  }>;
};

export type ProviderTraceEvent =
  | TraceEvent
  | (
    & Omit<
      Extract<TraceEvent, { type: "tool.call" }>,
      "runId" | "parentActionCallId"
    >
    & {
      runId?: string;
      parentActionCallId?: string;
    }
  )
  | (
    & Omit<
      Extract<TraceEvent, { type: "tool.result" }>,
      "runId" | "parentActionCallId"
    >
    & {
      runId?: string;
      parentActionCallId?: string;
    }
  );

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
  permissions?: PermissionDeclaration;
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
  tools: Array<ExternalToolDefinition>;
  executor?: DeckExecutor;
  guardrails?: Partial<Guardrails>;
  inlineEmbeds?: boolean;
  permissions?: PermissionDeclaration;
};

export type ToolCallResult = {
  toolContent: string;
  extraMessages?: Array<ModelMessage>;
};

export type ToolKind = "action" | "external" | "mcp_bridge" | "internal";

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
      permissions?: PermissionTrace;
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
      permissions?: PermissionTrace;
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
      permissions?: PermissionTrace;
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
      toolKind: ToolKind;
      parentActionCallId?: string;
    }
    | {
      type: "tool.result";
      runId: string;
      actionCallId: string;
      name: string;
      result: JSONValue;
      toolKind: ToolKind;
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
      mode?: "chat" | "responses";
      responseItems?: Array<ResponseItem>;
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
      usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        reasoningTokens?: number;
      };
      mode?: "chat" | "responses";
      responseItems?: Array<ResponseItem>;
      parentActionCallId?: string;
    }
    | {
      type: "model.stream.event";
      runId: string;
      actionCallId: string;
      deckPath?: string;
      model: string;
      event: Record<string, JSONValue>;
      parentActionCallId?: string;
    }
    | {
      type: `response.${string}`;
      _gambit?: {
        run_id?: string;
        action_call_id?: string;
        parent_action_call_id?: string;
        deck_path?: string;
        model?: string;
      } & Record<string, JSONValue>;
      [key: string]: JSONValue | undefined;
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

// Type fixtures to keep Open Responses shapes checked.
const responseMessageFixture: ResponseMessageItem = {
  type: "message",
  role: "user",
  content: [{ type: "input_text", text: "Hello there." }],
  id: "msg_1",
};

const responseFunctionCallFixture: ResponseFunctionCallItem = {
  type: "function_call",
  call_id: "call_1",
  name: "lookup",
  arguments: '{"query":"hello"}',
  id: "call_1",
};

const responseFunctionOutputFixture: ResponseFunctionCallOutputItem = {
  type: "function_call_output",
  call_id: "call_1",
  output: '{"result":"ok"}',
  id: "out_1",
};

const responseAssistantFixture: ResponseMessageItem = {
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text: "Hello!" }],
  id: "msg_2",
};

const responseToolFixture: ResponseToolDefinition = {
  type: "function",
  function: {
    name: "lookup",
    description: "Lookup helper",
    parameters: { query: "string" },
  },
};

const responseToolChoiceFixture: ResponseToolChoice = {
  type: "function",
  function: { name: "lookup" },
};

const createResponseRequestFixture: CreateResponseRequest = {
  model: "gpt-4o-mini",
  input: [
    responseMessageFixture,
    responseFunctionCallFixture,
    responseFunctionOutputFixture,
    responseAssistantFixture,
  ],
  instructions: "Be brief.",
  tools: [responseToolFixture],
  tool_choice: responseToolChoiceFixture,
  stream: true,
  max_output_tokens: 256,
  metadata: { source: "fixture" },
  params: { temperature: 0.2 },
};

const createResponseResponseFixture: CreateResponseResponse = {
  id: "resp_1",
  object: "response",
  model: "gpt-4o-mini",
  created: 1_700_000_000,
  status: "completed",
  output: [responseAssistantFixture],
  usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
};

const responseEventsFixture: Array<ResponseEvent> = [
  { type: "response.created", response: createResponseResponseFixture },
  {
    type: "response.output_text.delta",
    output_index: 0,
    delta: "Hel",
    item_id: "msg_2",
  },
  {
    type: "response.output_text.done",
    output_index: 0,
    text: "Hello!",
    item_id: "msg_2",
  },
  {
    type: "response.output_item.added",
    output_index: 0,
    item: responseAssistantFixture,
  },
  {
    type: "response.output_item.done",
    output_index: 0,
    item: responseAssistantFixture,
  },
  { type: "response.completed", response: createResponseResponseFixture },
];

export const openResponsesTypeFixtures = {
  request: createResponseRequestFixture,
  response: createResponseResponseFixture,
  items: [
    responseMessageFixture,
    responseFunctionCallFixture,
    responseFunctionOutputFixture,
    responseAssistantFixture,
  ],
  events: responseEventsFixture,
  tool: responseToolFixture,
  toolChoice: responseToolChoiceFixture,
};
