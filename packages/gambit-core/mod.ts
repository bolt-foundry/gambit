/**
 * Gambit core exports for authoring and running decks/cards with runtime helpers.
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
/** Hooks and scheduled handlers for decks. */
export type { HandlersConfig } from "./src/types.ts";
/** JSON-serializable value type used throughout Gambit. */
export type { JSONValue } from "./src/types.ts";
/** Open Responses content payload types. */
export type {
  CreateResponseRequest,
  CreateResponseResponse,
  ResponseEvent,
  ResponseFunctionCallItem,
  ResponseFunctionCallOutputItem,
  ResponseItem,
  ResponseMessageItem,
  ResponseTextContent,
  ResponseToolChoice,
  ResponseToolDefinition,
  ResponseUsage,
} from "./src/types.ts";
/** Test deck definition shape. */
export type { TestDeckDefinition } from "./src/types.ts";
/** Permission declaration shape used by deck metadata and config layers. */
export type {
  PermissionDeclaration,
  PermissionDeclarationInput,
  PermissionTrace,
} from "./src/permissions.ts";
/** Permission contract helpers (normalization/intersection/matching). */
export {
  canRunCommand,
  canRunPath,
  intersectPermissions,
  normalizePermissionDeclaration,
  resolveEffectivePermissions,
} from "./src/permissions.ts";
/** Check if a value is an explicit end-of-run signal. */
export { isGambitEndSignal } from "./src/runtime.ts";
/** Run a deck and return its execution result. */
export { runDeck } from "./src/runtime.ts";
/** Cancellation error type surfaced when a run is aborted. */
export { isRunCanceledError, RunCanceledError } from "./src/runtime.ts";
/** Signal for explicitly ending a Gambit run. */
export type { GambitEndSignal } from "./src/runtime.ts";
/** Runtime run options accepted by `runDeck`. */
export type { RunOptions } from "./src/runtime.ts";
/** Default guardrail settings applied to deck runs. */
export { DEFAULT_GUARDRAILS } from "./src/constants.ts";
/** Reserved tool name prefix for Gambit tools. */
export { RESERVED_TOOL_PREFIX } from "./src/constants.ts";
/** Render a deck to a human-readable outline or debug view. */
export { renderDeck } from "./src/render.ts";
/** Options for deck rendering. */
export type { RenderDeckOptions } from "./src/render.ts";
/** Result data from rendering a deck. */
export type { RenderDeckResult } from "./src/render.ts";
/** Schema helpers for ensuring Zod input/output shapes. */
export { assertZodSchema, toJsonSchema } from "./src/schema.ts";
/** Gambit CLI helpers and internal primitives. */
export { GAMBIT_TOOL_CONTEXT, GAMBIT_TOOL_INIT } from "./src/constants.ts";
/** Load a deck definition from disk. */
export { loadDeck } from "./src/loader.ts";
/** Persisted run state stored on disk. */
export { loadState, saveState } from "./src/state.ts";
/** Persisted run state shape. */
export type { SavedState } from "./src/state.ts";
/** Feedback entries tracked during runs. */
export type { FeedbackEntry } from "./src/state.ts";
/** Deck definition after resolution and expansion. */
export type { LoadedDeck } from "./src/types.ts";
/** Model message exchanged with providers. */
export type { ModelMessage } from "./src/types.ts";
/** Model provider interface for LLM backends. */
export type { ModelProvider } from "./src/types.ts";
/** Tool definition passed to model providers. */
export type { ToolDefinition } from "./src/types.ts";
/** Trace events emitted during execution. */
export type { ProviderTraceEvent, TraceEvent } from "./src/types.ts";
