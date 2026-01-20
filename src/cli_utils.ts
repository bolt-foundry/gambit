import * as path from "@std/path";
import { GAMBIT_TOOL_INIT } from "@bolt-foundry/gambit-core";
import type {
  OpenResponseContentPart,
  OpenResponseItem,
  SavedState,
} from "@bolt-foundry/gambit-core";

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

function contentText(parts: Array<OpenResponseContentPart>): string {
  return parts.map((part) => {
    switch (part.type) {
      case "input_text":
      case "output_text":
      case "text":
      case "summary_text":
      case "reasoning_text":
        return part.text;
      case "refusal":
        return part.refusal;
      default:
        return "";
    }
  }).join("");
}

export function findLastAssistantMessage(
  messages: Array<OpenResponseItem>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.type === "message" && msg.role === "assistant") {
      if (typeof msg.content === "string") return msg.content;
      if (Array.isArray(msg.content)) {
        return contentText(msg.content);
      }
      return JSON.stringify(msg.content ?? "");
    }
  }
  return undefined;
}

export function extractContextInput(state?: SavedState): unknown {
  if (!state?.messages) return undefined;
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const msg = state.messages[i];
    if (
      msg.type === "message" && msg.role === "tool" &&
      msg.name === GAMBIT_TOOL_INIT
    ) {
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
