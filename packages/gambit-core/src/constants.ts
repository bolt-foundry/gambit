export const DEFAULT_GUARDRAILS = {
  maxDepth: 3,
  maxPasses: 10,
  timeoutMs: 120_000,
} as const;

export const RESERVED_TOOL_PREFIX = "gambit_";
export const TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MAX_TOOL_NAME_LENGTH = 64;
export const GAMBIT_TOOL_CONTEXT = "gambit_context";
/**
 * @deprecated Use GAMBIT_TOOL_CONTEXT instead.
 */
export const GAMBIT_TOOL_INIT = "gambit_init";
export const GAMBIT_TOOL_RESPOND = "gambit_respond";
export const GAMBIT_TOOL_COMPLETE = "gambit_complete";
export const GAMBIT_TOOL_END = "gambit_end";
export const BUILTIN_TOOL_NAME_SET: ReadonlySet<string> = new Set([
  GAMBIT_TOOL_CONTEXT,
  GAMBIT_TOOL_INIT,
  GAMBIT_TOOL_RESPOND,
  GAMBIT_TOOL_COMPLETE,
  GAMBIT_TOOL_END,
]);

// Default delay for busy/idle handler triggers.
export const DEFAULT_STATUS_DELAY_MS = 800;
