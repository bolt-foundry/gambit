import type { JSONValue, ResponseEvent } from "./types.ts";

export type OpenResponsesInputItemEvent = {
  type: "input.item";
  role: "user" | "system" | "developer" | "assistant";
  content:
    | string
    | Record<string, unknown>
    | Array<Record<string, unknown>>;
  message_id?: string;
  source?: string;
};

export type OpenResponsesRunEventPayload =
  | ResponseEvent
  | OpenResponsesInputItemEvent
  | Record<string, unknown>;

export type OpenResponsesRunEventV0 = {
  workspace_id: string;
  run_id: string;
  sequence: number;
  event_type: string;
  payload: OpenResponsesRunEventPayload;
  idempotency_key: string;
  created_at: string;
};

export type AppendOpenResponsesRunEventV0Input = {
  workspace_id: string;
  run_id: string;
  event_type: string;
  payload: OpenResponsesRunEventPayload;
  idempotency_key: string;
  created_at?: string;
};

export type ListOpenResponsesRunEventsV0Input = {
  workspace_id: string;
  run_id: string;
  from_sequence?: number;
};

export type SubscribeOpenResponsesRunEventsV0Input =
  & ListOpenResponsesRunEventsV0Input
  & {
    signal?: AbortSignal;
  };

export type OpenResponsesRunEventStoreV0 = {
  append: (
    input: AppendOpenResponsesRunEventV0Input,
  ) => Promise<OpenResponsesRunEventV0>;
  list: (
    input: ListOpenResponsesRunEventsV0Input,
  ) => Promise<Array<OpenResponsesRunEventV0>>;
  subscribe: (
    input: SubscribeOpenResponsesRunEventsV0Input,
  ) => AsyncIterable<OpenResponsesRunEventV0>;
};

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isOpenResponsesRunEventPayload(
  value: unknown,
): value is OpenResponsesRunEventPayload {
  if (!isObjectRecord(value)) return false;
  const type = value.type;
  if (typeof type !== "string" || type.trim().length === 0) return false;
  return true;
}

export function isOpenResponsesRunEventV0(
  value: unknown,
): value is OpenResponsesRunEventV0 {
  if (!isObjectRecord(value)) return false;
  return isNonEmptyString(value.workspace_id) &&
    isNonEmptyString(value.run_id) &&
    isFiniteNonNegativeInteger(value.sequence) &&
    isNonEmptyString(value.event_type) &&
    isOpenResponsesRunEventPayload(value.payload) &&
    isNonEmptyString(value.idempotency_key) &&
    isNonEmptyString(value.created_at);
}

function toNormalizedEventType(payload: OpenResponsesRunEventPayload): string {
  const type = payload.type;
  return typeof type === "string" ? type : "response.event";
}

function normalizeCreatedAt(value: string | undefined): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return new Date().toISOString();
  }
  return value;
}

function assertAppendInput(
  input: AppendOpenResponsesRunEventV0Input,
): AppendOpenResponsesRunEventV0Input {
  if (!isNonEmptyString(input.workspace_id)) {
    throw new Error("workspace_id is required");
  }
  if (!isNonEmptyString(input.run_id)) {
    throw new Error("run_id is required");
  }
  if (!isNonEmptyString(input.event_type)) {
    throw new Error("event_type is required");
  }
  if (!isOpenResponsesRunEventPayload(input.payload)) {
    throw new Error("payload must be an object with a non-empty type");
  }
  if (!isNonEmptyString(input.idempotency_key)) {
    throw new Error("idempotency_key is required");
  }
  return {
    ...input,
    workspace_id: input.workspace_id.trim(),
    run_id: input.run_id.trim(),
    event_type: input.event_type.trim(),
    idempotency_key: input.idempotency_key.trim(),
  };
}

export function toOpenResponsesRunEventV0(
  input: AppendOpenResponsesRunEventV0Input & { sequence: number },
): OpenResponsesRunEventV0 {
  const normalized = assertAppendInput(input);
  if (!isFiniteNonNegativeInteger(input.sequence)) {
    throw new Error("sequence must be a non-negative integer");
  }
  return {
    workspace_id: normalized.workspace_id,
    run_id: normalized.run_id,
    sequence: input.sequence,
    event_type: normalized.event_type ||
      toNormalizedEventType(normalized.payload),
    payload: normalized.payload,
    idempotency_key: normalized.idempotency_key,
    created_at: normalizeCreatedAt(normalized.created_at),
  };
}

export function serializeOpenResponsesRunEventV0(
  event: OpenResponsesRunEventV0,
): Record<string, JSONValue> {
  return {
    workspace_id: event.workspace_id,
    run_id: event.run_id,
    sequence: event.sequence,
    event_type: event.event_type,
    // Payload shape is validated by runtime guards before persistence.
    payload: event.payload as unknown as JSONValue,
    idempotency_key: event.idempotency_key,
    created_at: event.created_at,
  };
}
