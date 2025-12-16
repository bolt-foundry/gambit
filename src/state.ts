import * as path from "@std/path";
import type { ModelMessage } from "./types.ts";

export type SavedState = {
  runId: string;
  messages: Array<ModelMessage>;
  meta?: Record<string, unknown>;
};

export function loadState(filePath: string): SavedState | undefined {
  const resolved = path.resolve(filePath);
  try {
    const text = Deno.readTextFileSync(resolved);
    const parsed = JSON.parse(text);
    if (
      parsed && typeof parsed === "object" && Array.isArray(parsed.messages)
    ) {
      return parsed as SavedState;
    }
  } catch {
    // ignore missing or invalid state
  }
  return undefined;
}

export function saveState(filePath: string, state: SavedState) {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(resolved, JSON.stringify(state, null, 2));
}
