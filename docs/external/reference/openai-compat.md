# OpenAI Chat Completions compatibility

Gambit, an agent harness framework, can act as a drop-in-ish wrapper around the
OpenAI Chat Completions request/response shape, while still letting you point at
a Gambit deck for system prompt + deck-defined action decks.

This is useful when you already have code that constructs Chat Completions
requests and you want to:

- keep the same request shape (`{ model, messages, tools, ... }`)
- optionally execute _deck-defined_ tools (Gambit action decks)
- return a full OpenAI-shaped `chat.completion` response object

## API

Use `chatCompletionsWithDeck`:

```ts
import {
  chatCompletionsWithDeck,
  createOpenRouterProvider,
} from "jsr:@molt-foundry/gambit";

const provider = createOpenRouterProvider({
  apiKey: Deno.env.get("OPENROUTER_API_KEY")!,
});

const result = await chatCompletionsWithDeck({
  deckPath: "./path/to/root.deck.md",
  modelProvider: provider,
  request: {
    model: "openai/gpt-4o-mini",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0,
  },
});

console.log(result.choices[0].message);
```

## System prompt behavior

Gambit will ensure the deck system prompt is present.

- If the request contains a `system` message that differs from the deck system
  prompt, Gambit logs a warning and prepends the deck prompt anyway.
- If the request already includes a `system` message that exactly matches the
  deck prompt, Gambit won’t add a duplicate.

## Tool call behavior (deck tools vs external tools)

Gambit only executes tool calls that match the deck’s action decks:

- If the model requests a tool call whose `name` matches a deck action deck,
  `chatCompletionsWithDeck` runs the child deck and appends a `tool` message
  with the result, then continues the loop.
- If the model requests any tool call that is _not_ a deck action, Gambit does
  not execute it; it returns the tool call in the response (with
  `finish_reason: "tool_calls"`), so your caller can run external tools.

To disable executing deck tools entirely:

```ts
await chatCompletionsWithDeck({
  deckPath,
  modelProvider: provider,
  executeDeckTools: false,
  request,
});
```

### Name collisions

If you provide external `tools` in the request and an external tool has the same
name as a deck action deck, Gambit throws a startup error (ambiguous executor).

## Response extras

The response matches the OpenAI `chat.completion` shape and also includes a
non-standard `gambit` field containing the full transcript and metadata.
