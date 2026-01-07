import * as path from "@std/path";
import { GAMBIT_TOOL_INIT } from "@bolt-foundry/gambit-core/internal/constants";
import type { ModelMessage } from "@bolt-foundry/gambit-core/internal/types";
import type { SavedState } from "@bolt-foundry/gambit-core/internal/state";

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

export function defaultTestBotStatePath(deckPath: string): string {
  const slug = slugifyDeckPath(deckPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(
    ".gambit",
    "sessions",
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

export function parseInit(raw?: string): unknown {
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

export function extractInitInput(state?: SavedState): unknown {
  if (!state?.messages) return undefined;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const msg = state.messages[i];
    if (msg.role === "tool" && msg.name === GAMBIT_TOOL_INIT) {
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
