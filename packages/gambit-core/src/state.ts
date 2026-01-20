import * as path from "@std/path";
import type {
  OpenResponseItem,
  OpenResponseMessageItem,
  TraceEvent,
} from "./types.ts";

export type SavedState = {
  runId: string;
  messages: Array<OpenResponseItem>;
  meta?: Record<string, unknown>;
  messageRefs?: Array<MessageRef>;
  feedback?: Array<FeedbackEntry>;
  traces?: Array<TraceEvent>;
  notes?: SessionNotes;
  conversationScore?: SessionRating;
};

export type MessageRef = {
  id: string;
  type: OpenResponseItem["type"];
  role?: OpenResponseMessageItem["role"];
};

export type FeedbackEntry = {
  id: string;
  runId: string;
  messageRefId: string;
  score: number;
  reason?: string;
  createdAt: string;
};

export type SessionNotes = {
  text?: string;
  updatedAt?: string;
};

export type SessionRating = {
  score: number;
  updatedAt?: string;
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
