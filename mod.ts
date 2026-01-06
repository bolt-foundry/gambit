/**
 * Gambit exports for authoring and running decks/cards with runtime helpers.
 *
 * @module
 */
/** Define a reusable card with shared behavior, tools, or guardrails. */
export { defineCard } from "./src/definitions.ts";
/** Define a deck, the primary unit of execution. */
export { defineDeck } from "./src/definitions.ts";
/** Action deck definition shape. */
export type { ActionDeckDefinition } from "./src/types.ts";
/** Card definition shape. */
export type { CardDefinition } from "./src/types.ts";
/** Deck definition shape. */
export type { DeckDefinition } from "./src/types.ts";
/** Reference to another deck. */
export type { DeckReferenceDefinition } from "./src/types.ts";
/** Execution context passed to decks. */
export type { ExecutionContext } from "./src/types.ts";
/** Grader deck definition shape. */
export type { GraderDeckDefinition } from "./src/types.ts";
/** Guardrails definition and hooks. */
export type { Guardrails } from "./src/types.ts";
/** JSON-serializable value type used throughout Gambit. */
export type { JSONValue } from "./src/types.ts";
/** Model provider interface for LLM backends. */
export type { ModelProvider } from "./src/types.ts";
/** Test deck definition shape. */
export type { TestDeckDefinition } from "./src/types.ts";
/** Check if a value is an explicit end-of-run signal. */
export { isGambitEndSignal } from "./src/runtime.ts";
/** Run a deck and return its execution result. */
export { runDeck } from "./src/runtime.ts";
/** Signal for explicitly ending a Gambit run. */
export type { GambitEndSignal } from "./src/runtime.ts";
/** OpenAI Chat Completions compatibility helper for a deck. */
export { chatCompletionsWithDeck } from "./src/openai_compat.ts";
/** OpenAI-compatible request payload. */
export type { ChatCompletionsRequest } from "./src/openai_compat.ts";
/** OpenAI-compatible response payload. */
export type { ChatCompletionsResponse } from "./src/openai_compat.ts";
/** Render a deck to a human-readable outline or debug view. */
export { renderDeck } from "./src/render.ts";
/** Options for deck rendering. */
export type { RenderDeckOptions } from "./src/render.ts";
/** Result data from rendering a deck. */
export type { RenderDeckResult } from "./src/render.ts";
/** Provider factory for OpenRouter-backed model calls. */
export { createOpenRouterProvider } from "./src/providers/openrouter.ts";
/** Start the WebSocket simulator server for the Gambit UI. */
export { startWebSocketSimulator } from "./src/server.ts";
