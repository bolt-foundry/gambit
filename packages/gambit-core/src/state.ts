import * as path from "@std/path";
import type { ModelMessage, ResponseItem, TraceEvent } from "./types.ts";

export type SavedState = {
  runId: string;
  messages: Array<ModelMessage>;
  format?: "chat" | "responses";
  items?: Array<ResponseItem>;
  meta?: Record<string, unknown>;
  messageRefs?: Array<MessageRef>;
  feedback?: Array<FeedbackEntry>;
  traces?: Array<TraceEvent>;
  notes?: SessionNotes;
  conversationScore?: SessionRating;
};

export type MessageRef = {
  id: string;
  role: ModelMessage["role"];
  source?: "scenario" | "manual" | "artifact";
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

function deriveMessagesFromItems(
  items: Array<ResponseItem>,
): Array<ModelMessage> {
  const messages: Array<ModelMessage> = [];
  const callNameById = new Map<string, string>();
  for (const item of items) {
    if (item.type === "message") {
      const text = item.content
        .map((part) => part.text)
        .join("");
      messages.push({
        role: item.role,
        content: text || null,
      });
      continue;
    }
    if (item.type === "function_call") {
      callNameById.set(item.call_id, item.name);
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: item.call_id,
          type: "function",
          function: { name: item.name, arguments: item.arguments },
        }],
      });
      continue;
    }
    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        name: callNameById.get(item.call_id),
        tool_call_id: item.call_id,
        content: item.output,
      });
    }
  }
  return messages;
}

export function loadState(filePath: string): SavedState | undefined {
  const resolved = path.resolve(filePath);
  try {
    const text = Deno.readTextFileSync(resolved);
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const hasMessages = Array.isArray(record.messages);
      const hasItems = Array.isArray(record.items);
      if (!hasMessages && hasItems) {
        record.messages = deriveMessagesFromItems(
          record.items as Array<ResponseItem>,
        );
      }
      if (hasMessages || hasItems) {
        return record as SavedState;
      }
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
