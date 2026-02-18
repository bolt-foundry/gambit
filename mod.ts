/**
 * Gambit exports for authoring and running decks/cards with runtime helpers.
 *
 * @module
 */
/** Define a reusable card with shared behavior, tools, or guardrails. */
export { defineCard } from "@bolt-foundry/gambit-core";
/** Define a deck, the primary unit of execution. */
export { defineDeck } from "@bolt-foundry/gambit-core";
/** Action deck definition shape. */
export type { ActionDeckDefinition } from "@bolt-foundry/gambit-core";
/** Card definition shape. */
export type { CardDefinition } from "@bolt-foundry/gambit-core";
/** Deck definition shape. */
export type { DeckDefinition } from "@bolt-foundry/gambit-core";
/** Reference to another deck. */
export type { DeckReferenceDefinition } from "@bolt-foundry/gambit-core";
/** Execution context passed to decks. */
export type { ExecutionContext } from "@bolt-foundry/gambit-core";
/** Grader deck definition shape. */
export type { GraderDeckDefinition } from "@bolt-foundry/gambit-core";
/** Guardrails definition and hooks. */
export type { Guardrails } from "@bolt-foundry/gambit-core";
/** JSON-serializable value type used throughout Gambit. */
export type { JSONValue } from "@bolt-foundry/gambit-core";
/** Model provider interface for LLM backends. */
export type { ModelProvider } from "@bolt-foundry/gambit-core";
/** Scenario deck definition shape. */
export type { TestDeckDefinition } from "@bolt-foundry/gambit-core";
/** Check if a value is an explicit end-of-run signal. */
export { isGambitEndSignal } from "@bolt-foundry/gambit-core";
/** Check whether an error represents runtime cancellation. */
export { isRunCanceledError } from "@bolt-foundry/gambit-core";
/** Build a runtime with CLI-equivalent provider defaults and routing. */
export { createDefaultedRuntime } from "./src/default_runtime.ts";
/** Runtime defaults/options for the `runDeck` wrapper. */
export type {
  CreateDefaultedRuntimeOptions,
  DefaultedRuntime,
  DefaultedRuntimeRunOptions,
  RunDeckWithDefaultsOptions,
} from "./src/default_runtime.ts";
/** Session artifact persistence config for default runtime runs. */
export type { SessionArtifactsConfig } from "./src/session_artifacts.ts";
/** Run a deck with default provider/model/runtime behavior. */
export { runDeck } from "./src/default_runtime.ts";
/** Run a deck directly through gambit-core without gambit defaults. */
export { runDeck as runDeckCore } from "@bolt-foundry/gambit-core";
/** Signal for explicitly ending a Gambit run. */
export type { GambitEndSignal } from "@bolt-foundry/gambit-core";
/** OpenAI Chat Completions compatibility helper for a deck. */
export { chatCompletionsWithDeck } from "./src/openai_compat.ts";
/** OpenAI-compatible request payload. */
export type { ChatCompletionsRequest } from "./src/openai_compat.ts";
/** OpenAI-compatible response payload. */
export type { ChatCompletionsResponse } from "./src/openai_compat.ts";
/** Render a deck to a human-readable outline or debug view. */
export { renderDeck } from "@bolt-foundry/gambit-core";
/** Options for deck rendering. */
export type { RenderDeckOptions } from "@bolt-foundry/gambit-core";
/** Result data from rendering a deck. */
export type { RenderDeckResult } from "@bolt-foundry/gambit-core";
/** Provider factory for OpenRouter-backed model calls. */
export { createOpenRouterProvider } from "./src/providers/openrouter.ts";
/** Provider factory for Ollama-backed model calls. */
export { createOllamaProvider } from "./src/providers/ollama.ts";
/** Provider factory for Google Gemini-backed model calls. */
export { createGoogleProvider } from "./src/providers/google.ts";
/** Start the WebSocket simulator server for the Gambit UI. */
export { startWebSocketSimulator } from "./src/server.ts";
