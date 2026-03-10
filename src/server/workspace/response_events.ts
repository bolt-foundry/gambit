import type { SavedState, TraceEvent } from "@bolt-foundry/gambit-core";

const asJsonValue = (value: unknown): unknown => {
  if (
    value === null || typeof value === "string" ||
    typeof value === "number" || typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => asJsonValue(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (
      const [key, entry] of Object.entries(value as Record<string, unknown>)
    ) {
      out[key] = asJsonValue(entry);
    }
    return out;
  }
  return String(value);
};

const hashStringFNV1a = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const tracePayloadFingerprint = (payload: Record<string, unknown>): string =>
  hashStringFNV1a(JSON.stringify(asJsonValue(payload)));

const messageContentFingerprint = (content: unknown): string =>
  hashStringFNV1a(JSON.stringify(asJsonValue(content)));

const stringifyMessageContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  const normalized = asJsonValue(content);
  if (typeof normalized === "string") return normalized;
  try {
    return JSON.stringify(normalized);
  } catch {
    return String(content);
  }
};

const traceToRecord = (trace: TraceEvent): Record<string, unknown> => {
  return !trace || typeof trace !== "object" || Array.isArray(trace)
    ? {}
    : trace as Record<string, unknown>;
};

export const createOpenResponsesEventPersistence = (deps: {
  sanitizeJsonRecord: (
    value: Record<string, unknown>,
  ) => Record<string, unknown>;
  appendOpenResponsesRunEvent: (
    state: SavedState,
    event: {
      workspace_id: string;
      run_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      idempotency_key: string;
      created_at: string;
    },
  ) => Promise<unknown> | unknown;
}) => {
  const persistOpenResponsesTraceEvent = (
    state: SavedState | null | undefined,
    trace: TraceEvent,
    fallbackRunId?: string,
  ) => {
    if (!state) return;
    const rawPayload = traceToRecord(trace);
    const eventType = typeof rawPayload.type === "string"
      ? rawPayload.type
      : "";
    if (!eventType.startsWith("response.")) return;
    const runId = typeof rawPayload.runId === "string" &&
        rawPayload.runId.length > 0
      ? rawPayload.runId
      : fallbackRunId;
    if (!runId) return;
    const eventTs = typeof rawPayload.ts === "number" &&
        Number.isFinite(rawPayload.ts)
      ? rawPayload.ts
      : Date.now();
    const eventScope = typeof rawPayload.item_id === "string"
      ? rawPayload.item_id
      : typeof rawPayload.actionCallId === "string"
      ? rawPayload.actionCallId
      : typeof rawPayload.output_index === "number"
      ? String(rawPayload.output_index)
      : typeof rawPayload.sequence_number === "number"
      ? String(rawPayload.sequence_number)
      : "event";
    const payload = deps.sanitizeJsonRecord(rawPayload);
    const payloadFingerprint = tracePayloadFingerprint(payload);
    void deps.appendOpenResponsesRunEvent(state, {
      workspace_id: "",
      run_id: runId,
      event_type: eventType,
      payload,
      idempotency_key:
        `${runId}:${eventType}:${eventTs}:${eventScope}:${payloadFingerprint}`,
      created_at: new Date(eventTs).toISOString(),
    });
  };

  const persistCanonicalUserInputEvent = (args: {
    state: SavedState | null | undefined;
    runId: string;
    message: string;
    source: "build" | "scenario" | "manual" | "artifact";
  }) => {
    if (!args.state) return;
    const content = args.message.trim();
    if (!content) return;
    const eventTs = Date.now();
    void deps.appendOpenResponsesRunEvent(args.state, {
      workspace_id: "",
      run_id: args.runId,
      event_type: "input.item",
      payload: {
        type: "input.item",
        role: "user",
        content: [{ type: "input_text", text: content }],
        source: args.source,
      },
      idempotency_key: `${args.runId}:input.item:${args.source}:${eventTs}:${
        content.slice(0, 64)
      }`,
      created_at: new Date(eventTs).toISOString(),
    });
  };

  const persistCanonicalStateMessages = (args: {
    state: SavedState | null | undefined;
    runId: string;
    startIndex?: number;
    source: "build" | "scenario" | "manual" | "artifact";
  }) => {
    if (!args.state || !Array.isArray(args.state.messages)) return;
    const refs = Array.isArray(args.state.messageRefs)
      ? args.state.messageRefs
      : [];
    const startIndex = Math.max(0, args.startIndex ?? 0);
    for (
      let index = startIndex;
      index < args.state.messages.length;
      index += 1
    ) {
      const message = args.state.messages[index];
      if (
        !message || (message.role !== "user" && message.role !== "assistant")
      ) {
        continue;
      }
      const content = stringifyMessageContent(message.content).trim();
      if (!content) continue;
      const ref = refs[index];
      const messageRefId =
        typeof ref?.id === "string" && ref.id.trim().length > 0
          ? ref.id.trim()
          : undefined;
      const fingerprint = messageContentFingerprint(message.content);
      if (message.role === "user") {
        void deps.appendOpenResponsesRunEvent(args.state, {
          workspace_id: "",
          run_id: args.runId,
          event_type: "input.item",
          payload: {
            type: "input.item",
            role: "user",
            content: [{ type: "input_text", text: content }],
            source: args.source,
            ...(messageRefId ? { message_id: messageRefId, messageRefId } : {}),
          },
          idempotency_key: `${args.runId}:input.item:canonical:${
            messageRefId ?? index
          }:${fingerprint}`,
          created_at: new Date().toISOString(),
        });
        continue;
      }
      void deps.appendOpenResponsesRunEvent(args.state, {
        workspace_id: "",
        run_id: args.runId,
        event_type: "response.output_item.done",
        payload: {
          type: "response.output_item.done",
          output_index: index,
          item: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: content }],
            ...(messageRefId ? { messageRefId } : {}),
          },
        },
        idempotency_key: `${args.runId}:response.output_item.done:canonical:${
          messageRefId ?? index
        }:${fingerprint}`,
        created_at: new Date().toISOString(),
      });
    }
  };

  const persistOpenResponsesTracesFromState = (
    state: SavedState | null | undefined,
    fallbackRunId?: string,
  ) => {
    if (!state || !Array.isArray(state.traces)) return;
    for (const trace of state.traces) {
      persistOpenResponsesTraceEvent(state, trace, fallbackRunId);
    }
  };

  return {
    persistOpenResponsesTraceEvent,
    persistCanonicalUserInputEvent,
    persistCanonicalStateMessages,
    persistOpenResponsesTracesFromState,
  };
};
