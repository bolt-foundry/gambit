export const DEFAULT_GUARDRAILS = {
  maxDepth: 3,
  maxPasses: 3,
  timeoutMs: 120_000,
} as const;

export const RESERVED_TOOL_PREFIX = "gambit.";
export const TOOL_REFERENCE_CONTEXT = "gambit.get_reference_context";
export const TOOL_ERROR_EVENT = "gambit.error_event";
export const TOOL_SUSPENSE_EVENT = "gambit.suspense_event";

export const DEFAULT_SUSPENSE_DELAY_MS = 800;
