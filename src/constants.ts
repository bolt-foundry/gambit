export const DEFAULT_GUARDRAILS = {
  maxDepth: 3,
  maxPasses: 3,
  timeoutMs: 120_000,
} as const;

export const RESERVED_TOOL_PREFIX = "gambit_";
export const TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MAX_TOOL_NAME_LENGTH = 64;
export const TOOL_INIT = "gambit_init";
export const TOOL_PING = "gambit_ping";
export const TOOL_COMPLETE = "gambit_complete";

export const DEFAULT_SUSPENSE_DELAY_MS = 800;
