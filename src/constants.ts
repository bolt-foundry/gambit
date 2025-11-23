export const DEFAULT_GUARDRAILS = {
  maxDepth: 3,
  maxPasses: 3,
  timeoutMs: 120_000,
} as const;

export const RESERVED_TOOL_PREFIX = "gambit_";
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const MAX_TOOL_NAME_LENGTH = 64;
export const TOOL_REFERENCE_CONTEXT = "gambit_get_reference_context";
export const TOOL_ERROR_EVENT = "gambit_error_event";
export const TOOL_SUSPENSE_EVENT = "gambit_suspense_event";

export const DEFAULT_SUSPENSE_DELAY_MS = 800;
