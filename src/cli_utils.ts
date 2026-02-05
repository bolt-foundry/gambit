import * as path from "@std/path";
import {
  GAMBIT_TOOL_CONTEXT,
  GAMBIT_TOOL_INIT,
} from "@bolt-foundry/gambit-core";
import type { ModelMessage } from "@bolt-foundry/gambit-core";
import type { SavedState } from "@bolt-foundry/gambit-core";

export function parsePortValue(
  value: unknown,
  label = "port",
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return n;
}

export function normalizeFlagList(
  value: string | Array<string> | undefined,
): Array<string> {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

export function slugifyDeckPath(deckPath: string): string {
  const baseName = path.basename(deckPath || "deck");
  const withoutExt = baseName.replace(/\.[^.]+$/, "");
  const slug = withoutExt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /^-+|-+$/g,
    "",
  );
  return slug || "session";
}

const PROJECT_ROOT_MARKERS = ["deno.json", "deno.jsonc", "package.json"];

function findProjectRoot(startDir: string): string | undefined {
  let current = startDir;
  while (true) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      try {
        const candidate = path.join(current, marker);
        const info = Deno.statSync(candidate);
        if (info.isFile) return current;
      } catch {
        // ignore
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

export function resolveProjectRoot(startDir: string): string | undefined {
  return findProjectRoot(startDir);
}

export function defaultSessionRoot(deckPath: string): string {
  const resolvedDeckPath = path.resolve(deckPath);
  const deckDir = path.dirname(resolvedDeckPath);
  const projectRoot = findProjectRoot(deckDir);
  const baseDir = projectRoot ?? deckDir;
  return path.join(baseDir, ".gambit", "sessions");
}

export function defaultTestBotStatePath(deckPath: string): string {
  const slug = slugifyDeckPath(deckPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(
    defaultSessionRoot(deckPath),
    `${slug}-${stamp}`,
    "state.json",
  );
}

export function enrichStateMeta(
  state: SavedState,
  deckPath: string,
): SavedState {
  const meta = { ...(state.meta ?? {}) };
  if (typeof meta.deck !== "string") meta.deck = deckPath;
  if (typeof meta.deckSlug !== "string") {
    meta.deckSlug = slugifyDeckPath(deckPath);
  }
  return { ...state, meta };
}

export function parseContext(raw?: string): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function parseMessage(raw?: string): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function parseBotInput(raw?: string): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function findLastAssistantMessage(
  messages: Array<ModelMessage>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "assistant") {
      return typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content ?? "");
    }
  }
  return undefined;
}

export function extractContextInput(state?: SavedState): unknown {
  if (!state) return undefined;
  if (state.format === "responses" && Array.isArray(state.items)) {
    return extractContextInputFromItems(state.items);
  }
  if (!state.messages) return undefined;
  const contextToolNames = new Set<string>([
    GAMBIT_TOOL_CONTEXT,
    GAMBIT_TOOL_INIT,
  ]);
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const msg = state.messages[i];
    if (msg.role === "tool" && contextToolNames.has(msg.name ?? "")) {
      const content = msg.content;
      if (typeof content !== "string") return undefined;
      try {
        return JSON.parse(content);
      } catch {
        return content;
      }
    }
  }
  return undefined;
}

function extractContextInputFromItems(
  items: NonNullable<SavedState["items"]>,
): unknown {
  const contextToolNames = new Set<string>([
    GAMBIT_TOOL_CONTEXT,
    GAMBIT_TOOL_INIT,
  ]);
  const callNameById = new Map<string, string>();
  for (const item of items) {
    if (item.type === "function_call") {
      callNameById.set(item.call_id, item.name);
    }
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type !== "function_call_output") continue;
    const name = callNameById.get(item.call_id);
    if (!name || !contextToolNames.has(name)) continue;
    try {
      return JSON.parse(item.output);
    } catch {
      return item.output;
    }
  }
  return undefined;
}
