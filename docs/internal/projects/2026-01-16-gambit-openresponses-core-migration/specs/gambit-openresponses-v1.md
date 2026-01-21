+++
scope = "Project"
authority = "spec"
lifecycle = "beta"
area_owner = "engineering"
+++

# Gambit Open Responses V1 Contract

Owner: engineering\
Date: 2026-01-16\
Scope: Gambit core Open Responses subset for the migration.

## Purpose

Define the concrete Open Responses subset Gambit implements so core, adapters,
CLI, and tests can move forward without guessing at shapes or behavior.

## Scope decisions (v1)

- Text-only content parts: `input_text` and `output_text`.
- Item types: `message`, `function_call`, `function_call_output`.
- No multimodal items (images/files), no reasoning items, no tool call graphs.
- Streaming: text deltas and item-level events only. Adapters may opt out.
- Tool arguments and outputs are stored as JSON strings for fidelity.

## Canonical types (TypeScript-ish)

```ts
type JSONValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JSONValue }
  | Array<JSONValue>;

type ResponseTextContent =
  | { type: "input_text"; text: string }
  | { type: "output_text"; text: string };

type ResponseMessageItem = {
  type: "message";
  role: "system" | "user" | "assistant";
  content: Array<ResponseTextContent>;
  id?: string;
};

type ResponseFunctionCallItem = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  id?: string;
};

type ResponseFunctionCallOutputItem = {
  type: "function_call_output";
  call_id: string;
  output: string;
  id?: string;
};

type ResponseItem =
  | ResponseMessageItem
  | ResponseFunctionCallItem
  | ResponseFunctionCallOutputItem;

type ResponseToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, JSONValue>;
  };
};

type ResponseToolChoice =
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

type CreateResponseRequest = {
  model: string;
  input: Array<ResponseItem>;
  instructions?: string;
  tools?: Array<ResponseToolDefinition>;
  tool_choice?: ResponseToolChoice;
  stream?: boolean;
  max_output_tokens?: number;
  metadata?: Record<string, JSONValue>;
  // Provider-specific passthrough (temperature, etc.).
  params?: Record<string, unknown>;
};

type ResponseUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

type CreateResponseResponse = {
  id: string;
  object: "response";
  model?: string;
  created?: number;
  status?: "completed" | "in_progress" | "failed";
  output: Array<ResponseItem>;
  usage?: ResponseUsage;
  error?: { code?: string; message?: string };
};
```

## Streaming events (minimal set)

Adapters may emit any Open Responses event, but Gambit only relies on these:

```ts
type ResponseEvent =
  | { type: "response.created"; response: CreateResponseResponse }
  | {
    type: "response.output_text.delta";
    output_index: number;
    delta: string;
    item_id?: string;
  }
  | {
    type: "response.output_text.done";
    output_index: number;
    text: string;
    item_id?: string;
  }
  | {
    type: "response.output_item.added";
    output_index: number;
    item: ResponseItem;
  }
  | {
    type: "response.output_item.done";
    output_index: number;
    item: ResponseItem;
  }
  | { type: "response.completed"; response: CreateResponseResponse }
  | { type: "response.failed"; error: { code?: string; message?: string } };
```

Streaming contract:

- If `stream` is true, adapters should call `onStreamEvent` for each event and
  still return the aggregated `CreateResponseResponse` once complete.
- If an adapter cannot stream, it ignores `stream` and returns a completed
  response without emitting events.
- `response.output_text.delta` is the only event Gambit uses for incremental UI
  updates; item events are used for tool calls.

## Mapping rules (chat <-> responses)

Chat message -> response items:

- `system` -> `message` item with `input_text`.
- `user` -> `message` item with `input_text`.
- `assistant` -> `message` item with `output_text` (if text exists).
- `assistant.tool_calls[]` -> one `function_call` item per tool call.
- `tool` -> `function_call_output` with `call_id = tool_call_id`.

Responses -> chat (compat shim):

- `message` item role `assistant` becomes the `message` payload.
- `function_call` items become `tool_calls[]` on the assistant message.
- `function_call_output` items become `tool` messages with `tool_call_id`.

Gambit synthetic tools:

- `gambit_context`, `gambit_respond`, `gambit_complete`, `gambit_end` are
  represented as `function_call` items and `function_call_output` items.
  (`gambit_init` remains as a deprecated alias.)
- The `output` or `arguments` fields carry raw JSON strings for fidelity.

## Provider interface (core)

`ModelProvider` gains a responses method and keeps chat for compatibility:

```ts
type ModelProvider = {
  responses: (input: {
    request: CreateResponseRequest;
    state?: SavedState;
    onStreamEvent?: (event: ResponseEvent) => void;
  }) => Promise<CreateResponseResponse>;
  chat?: (input: {
    model: string;
    messages: Array<ModelMessage>;
    tools?: Array<ResponseToolDefinition>;
    stream?: boolean;
    state?: SavedState;
    onStreamText?: (chunk: string) => void;
    params?: Record<string, unknown>;
  }) => Promise<{
    message: ModelMessage;
    finishReason: "stop" | "tool_calls" | "length";
    toolCalls?: Array<
      { id: string; name: string; args: Record<string, JSONValue> }
    >;
    updatedState?: SavedState;
    usage?: ResponseUsage;
  }>;
};
```

Notes:

- `responses` is the canonical interface in gambit-core.
- Provider-specific configuration and environment variables live in
  `packages/gambit`, not gambit-core.

## State and trace schema

SavedState (v2) stores items, with chat as backward-compatible input:

```ts
type SavedState = {
  format?: "chat" | "responses";
  runId: string;
  messages?: Array<ModelMessage>; // legacy
  items?: Array<ResponseItem>; // canonical when format = "responses"
  messageRefs?: Array<{ id: string; role: string }>;
  traces?: Array<TraceEvent>;
  meta?: Record<string, unknown>;
  feedback?: Array<FeedbackEntry>;
  notes?: SessionNotes;
  conversationScore?: SessionRating;
};
```

Rules:

- If `format` is missing and `messages` exists, treat as chat.
- When in responses mode, persist `items` and set `format: "responses"`.
- During migration, `messages`/`messageRefs` may be derived from items to keep
  CLI and simulator UI stable.

Trace events:

- Keep `model.call` and `model.result` event types for UI compatibility.
- Add `mode: "chat" | "responses"` plus `items` or `output` when in responses
  mode; include a derived `message` when possible for backwards display.

## Flag decisions

These flag names are locked for the migration.

- `GAMBIT_OPENROUTER_RESPONSES=1` enables the OpenRouter responses adapter while
  the runtime is still chat-first (Phase 2).
- `GAMBIT_RESPONSES_MODE=1` or CLI `--responses` switches runtime/state to
  responses mode (Phase 3).
- `GAMBIT_CHAT_FALLBACK=1` forces chat mode after the default switch (Phase 4+).
- Default remains chat until Phase 4; after the switch, chat is only via the
  fallback flag.

## Test coverage checklist

- Core runtime tests for item-first execution and `--context`/`--init`
  equivalence in responses mode.
- SavedState load/save tests covering chat-only, responses-only, and mixed
  formats.
- Provider adapter tests for OpenRouter chat vs responses mode.
- CLI smoke tests covering `run`, `repl`, and `test-bot` with `--responses`.
- Simulator state tests validating trace UI renders responses items safely.

## Minimal examples

Request:

```json
{
  "model": "openai/gpt-4.1-mini",
  "input": [
    {
      "type": "message",
      "role": "system",
      "content": [{ "type": "input_text", "text": "Be helpful." }]
    },
    {
      "type": "message",
      "role": "user",
      "content": [{ "type": "input_text", "text": "Summarize this." }]
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "gambit_respond",
        "parameters": { "type": "object", "properties": {} }
      }
    }
  ]
}
```

Response:

```json
{
  "id": "resp_123",
  "object": "response",
  "status": "completed",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [{ "type": "output_text", "text": "Here is the summary." }]
    }
  ]
}
```

See `openresponses-api.md` for the full external spec.
