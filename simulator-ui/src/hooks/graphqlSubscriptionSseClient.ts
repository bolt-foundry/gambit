export type GraphqlSseEnvelope = {
  type: "subscribed" | "next" | "error" | "complete" | "unsubscribed";
  sessionId: string;
  subscriptionId: string;
  operationId: string;
  operationName: string | null;
  payload?: unknown;
  errors?: Array<{
    message: string;
    path?: Array<string | number>;
    code?: string;
  }>;
  reason?: string;
  createdAt: string;
};

type StreamMeta = {
  offset: number | null;
  eventType: string;
};

type EnvelopeListener = (
  event: GraphqlSseEnvelope,
  streamMeta: StreamMeta,
) => void;

type ClientOptions = {
  sessionId?: string;
  offsetStorageKey?: string;
  closeWhenIdle?: boolean;
};

type SubscribeRequest = {
  subscriptionId: string;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  onEnvelope: EnvelopeListener;
};

type UnsubscribeOptions = {
  notifyServer?: boolean;
};

const DEFAULT_SESSION_KEY = "gambit.graphql.stream.session_id";
const DEFAULT_OFFSET_KEY = "gambit.graphql.stream.offset";
const GRAPHQL_STREAM_EVENT_TYPES: Array<GraphqlSseEnvelope["type"]> = [
  "subscribed",
  "next",
  "error",
  "complete",
  "unsubscribed",
];

function readOffset(storageKey: string): number | null {
  try {
    const raw = globalThis.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeOffset(storageKey: string, offset: number) {
  try {
    globalThis.localStorage.setItem(storageKey, String(offset));
  } catch {
    // Ignore storage write failures.
  }
}

function getSessionOffsetStorageKey(
  baseKey: string,
  sessionId: string,
): string {
  return `${baseKey}.${sessionId}`;
}

function getOrCreateSessionId(): string {
  try {
    const existing = globalThis.sessionStorage.getItem(DEFAULT_SESSION_KEY);
    if (existing && existing.trim().length > 0) return existing;
    const created = crypto.randomUUID();
    globalThis.sessionStorage.setItem(DEFAULT_SESSION_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isGraphqlEnvelope(value: unknown): value is GraphqlSseEnvelope {
  if (!isRecord(value)) return false;
  return typeof value.type === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.subscriptionId === "string" &&
    typeof value.operationId === "string" &&
    typeof value.createdAt === "string";
}

async function postControl(body: Record<string, unknown>): Promise<void> {
  const response = await fetch("/graphql/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`GraphQL stream control failed (${response.status})`);
  }
}

export class GraphqlSubscriptionSseClient {
  readonly #sessionId: string;
  readonly #offsetStorageKey: string;
  readonly #closeWhenIdle: boolean;
  #source: EventSource | null = null;
  readonly #listeners = new Map<string, Set<EnvelopeListener>>();

  constructor(options?: ClientOptions) {
    this.#sessionId = options?.sessionId?.trim() || getOrCreateSessionId();
    this.#offsetStorageKey = getSessionOffsetStorageKey(
      options?.offsetStorageKey ?? DEFAULT_OFFSET_KEY,
      this.#sessionId,
    );
    this.#closeWhenIdle = options?.closeWhenIdle ?? true;
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  #ensureSource() {
    if (this.#source) return;

    const origin = globalThis.location?.origin ?? "http://localhost";
    const url = new URL("/graphql/stream", origin);
    url.searchParams.set("sessionId", this.#sessionId);
    const offset = readOffset(this.#offsetStorageKey);
    if (offset !== null) {
      url.searchParams.set("offset", String(offset));
    }

    const source = new EventSource(url.toString());
    const handleMessage = (message: MessageEvent<string>) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.data);
      } catch {
        return;
      }
      if (!isGraphqlEnvelope(parsed)) return;
      const envelope = parsed;
      const offsetValue = Number(message.lastEventId);
      if (Number.isFinite(offsetValue)) {
        writeOffset(this.#offsetStorageKey, offsetValue + 1);
      }
      const listeners = this.#listeners.get(envelope.subscriptionId);
      if (!listeners || listeners.size === 0) return;
      for (const listener of listeners) {
        listener(envelope, {
          offset: Number.isFinite(offsetValue) ? offsetValue : null,
          eventType: message.type,
        });
      }
    };

    for (const type of GRAPHQL_STREAM_EVENT_TYPES) {
      source.addEventListener(type, handleMessage as EventListener);
    }
    this.#source = source;
  }

  async subscribe(
    request: SubscribeRequest,
  ): Promise<(options?: UnsubscribeOptions) => Promise<void>> {
    if (!request.subscriptionId.trim()) {
      throw new Error("subscriptionId is required");
    }
    if (!request.query.trim()) {
      throw new Error("query is required");
    }

    this.#ensureSource();

    let listeners = this.#listeners.get(request.subscriptionId);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(request.subscriptionId, listeners);
    }
    listeners.add(request.onEnvelope);

    try {
      await postControl({
        action: "subscribe",
        sessionId: this.#sessionId,
        subscriptionId: request.subscriptionId,
        query: request.query,
        variables: request.variables ?? {},
        operationName: request.operationName ?? undefined,
      });
    } catch (error) {
      const current = this.#listeners.get(request.subscriptionId);
      if (current) {
        current.delete(request.onEnvelope);
        if (current.size === 0) {
          this.#listeners.delete(request.subscriptionId);
        }
      }
      if (this.#listeners.size === 0 && this.#closeWhenIdle) {
        this.close();
      }
      throw error;
    }

    return async (options?: UnsubscribeOptions) => {
      const notifyServer = options?.notifyServer !== false;
      const current = this.#listeners.get(request.subscriptionId);
      if (current) {
        current.delete(request.onEnvelope);
        if (current.size === 0) {
          this.#listeners.delete(request.subscriptionId);
          if (notifyServer) {
            await postControl({
              action: "unsubscribe",
              sessionId: this.#sessionId,
              subscriptionId: request.subscriptionId,
            });
          }
        }
      }
      if (this.#listeners.size === 0 && this.#closeWhenIdle) {
        this.close();
      }
    };
  }

  close() {
    if (this.#source) {
      this.#source.close();
      this.#source = null;
    }
  }
}

let globalClient: GraphqlSubscriptionSseClient | null = null;

export function getGraphqlSubscriptionSseClient(): GraphqlSubscriptionSseClient {
  if (globalClient) return globalClient;
  globalClient = new GraphqlSubscriptionSseClient({
    closeWhenIdle: false,
  });
  return globalClient;
}
