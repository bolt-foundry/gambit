const CODEX_APP_SERVER_DEBUG_ENV =
  "BOLT_FOUNDRY_DESKTOP_CHIEF_RUNTIME_DEBUG_CODEX_APP_SERVER";

const STRUCTURAL_STRING_KEYS = new Set([
  "error",
  "method",
  "name",
  "phase",
  "reason",
  "role",
  "server",
  "status",
  "tool",
  "type",
]);

type DebugValue =
  | null
  | boolean
  | number
  | string
  | Array<DebugValue>
  | { [key: string]: DebugValue };

function parseTruthy(value: string | undefined): boolean {
  return value ? /^(1|true|yes)$/i.test(value.trim()) : false;
}

function isSensitiveKey(key: string): boolean {
  return /token|secret|password|authorization|cookie|api[_-]?key/i.test(key);
}

function summarizeStringForDebug(input: {
  key?: string;
  value: string;
}): string {
  if (input.key && isSensitiveKey(input.key)) {
    return `<redacted len=${input.value.length}>`;
  }
  if (input.key && STRUCTURAL_STRING_KEYS.has(input.key)) {
    return input.value;
  }
  return `<string len=${input.value.length}>`;
}

function summarizeDebugValue(
  value: unknown,
  key?: string,
  depth = 0,
): DebugValue {
  if (
    value === null || typeof value === "boolean" || typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return summarizeStringForDebug({ key, value });
  }
  if (typeof value !== "object") {
    return `<${typeof value}>`;
  }
  if (depth >= 5) {
    return "<depth-limit>";
  }
  if (Array.isArray(value)) {
    const summarized = value.slice(0, 5).map((entry) =>
      summarizeDebugValue(entry, undefined, depth + 1)
    );
    if (value.length > summarized.length) {
      summarized.push(`<+${value.length - summarized.length} items>`);
    }
    return summarized;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const summarized: Record<string, DebugValue> = {};
  for (const [entryKey, entryValue] of entries.slice(0, 20)) {
    summarized[entryKey] = summarizeDebugValue(entryValue, entryKey, depth + 1);
  }
  if (entries.length > 20) {
    summarized.__truncatedKeys = entries.length - 20;
  }
  return summarized;
}

export function shouldDebugCodexAppServer(): boolean {
  return parseTruthy(Deno.env.get(CODEX_APP_SERVER_DEBUG_ENV));
}

export function logCodexAppServerDebug(
  event: string,
  details?: Record<string, unknown>,
): void {
  if (!shouldDebugCodexAppServer()) return;
  const summarized = details ? summarizeDebugValue(details) : {};
  globalThis.console.error("[gambit-codex-app-server]", event, summarized);
}

export function summarizeCodexAppServerDebugValue(value: unknown): DebugValue {
  return summarizeDebugValue(value);
}

export { CODEX_APP_SERVER_DEBUG_ENV };
