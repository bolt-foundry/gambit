/**
 * Gambit exports for authoring and running decks/cards with runtime helpers.
 *
 * @module
 */
/** Define a reusable card with shared behavior, tools, or guardrails. */
export { defineCard } from "@molt-foundry/gambit-core";
/** Define a deck, the primary unit of execution. */
export { defineDeck } from "@molt-foundry/gambit-core";
/** Action deck definition shape. */
export type { ActionDeckDefinition } from "@molt-foundry/gambit-core";
/** Card definition shape. */
export type { CardDefinition } from "@molt-foundry/gambit-core";
/** Deck definition shape. */
export type { DeckDefinition } from "@molt-foundry/gambit-core";
/** Reference to another deck. */
export type { DeckReferenceDefinition } from "@molt-foundry/gambit-core";
/** Execution context passed to decks. */
export type { ExecutionContext } from "@molt-foundry/gambit-core";
/** Grader deck definition shape. */
export type { GraderDeckDefinition } from "@molt-foundry/gambit-core";
/** Guardrails definition and hooks. */
export type { Guardrails } from "@molt-foundry/gambit-core";
/** JSON-serializable value type used throughout Gambit. */
export type { JSONValue } from "@molt-foundry/gambit-core";
/** Model provider interface for LLM backends. */
export type { ModelProvider } from "@molt-foundry/gambit-core";
/** Test deck definition shape. */
export type { TestDeckDefinition } from "@molt-foundry/gambit-core";
/** Check if a value is an explicit end-of-run signal. */
export { isGambitEndSignal } from "@molt-foundry/gambit-core";
/** Run a deck and return its execution result. */
export { runDeck } from "@molt-foundry/gambit-core";
/** Signal for explicitly ending a Gambit run. */
export type { GambitEndSignal } from "@molt-foundry/gambit-core";
/** OpenAI Chat Completions compatibility helper for a deck. */
export { chatCompletionsWithDeck } from "./src/openai_compat.ts";
/** OpenAI-compatible request payload. */
export type { ChatCompletionsRequest } from "./src/openai_compat.ts";
/** OpenAI-compatible response payload. */
export type { ChatCompletionsResponse } from "./src/openai_compat.ts";
/** Render a deck to a human-readable outline or debug view. */
export { renderDeck } from "@molt-foundry/gambit-core";
/** Options for deck rendering. */
export type { RenderDeckOptions } from "@molt-foundry/gambit-core";
/** Result data from rendering a deck. */
export type { RenderDeckResult } from "@molt-foundry/gambit-core";
/** Provider factory for OpenRouter-backed model calls. */
export { createOpenRouterProvider } from "./src/providers/openrouter.ts";
/** Provider factory for Ollama-backed model calls. */
export { createOllamaProvider } from "./src/providers/ollama.ts";
/** Provider factory for Google Gemini-backed model calls. */
export { createGoogleProvider } from "./src/providers/google.ts";
/** Start the WebSocket simulator server for the Gambit UI. */
export { startWebSocketSimulator } from "./src/server.ts";
