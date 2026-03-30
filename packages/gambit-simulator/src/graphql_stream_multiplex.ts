import {
  appendDurableStreamEvent,
  deleteDurableStream,
  getDurableStreamNextOffset,
  readDurableStreamEvents,
  subscribeDurableStream,
} from "@bolt-foundry/gambit/src/durable_streams.ts";

type DurableStreamEvent = {
  offset: number;
  data: unknown;
  createdAt: string;
};

type GraphqlSubscriptionOperation = {
  query: string;
  operationName?: string;
  variables: Record<string, unknown>;
};

type StreamMultiplexEnvelope = {
  type: "subscribed" | "next" | "error" | "unsubscribed";
  sessionId: string;
  subscriptionId: string;
  streamId: string;
  operationName?: string;
  operationVariables?: Record<string, unknown>;
  sourceOffset?: number;
  payload?: unknown;
  reason?: string;
  createdAt: string;
};

type StreamSessionOpenControl = {
  action: "open";
  sessionId?: string;
};

type StreamSessionStartControl = {
  action: "start";
  sessionId: string;
  subscriptionId: string;
  streamId: string;
  fromOffset?: number;
};

type StreamSessionSubscribeControl = {
  action: "subscribe";
  sessionId: string;
  subscriptionId: string;
  operation: GraphqlSubscriptionOperation;
  fromOffset?: number;
};

type StreamSessionStopControl = {
  action: "stop";
  sessionId: string;
  subscriptionId: string;
};

type StreamSessionUnsubscribeControl = {
  action: "unsubscribe";
  sessionId: string;
  subscriptionId: string;
};

type StreamSessionCloseControl = {
  action: "close";
  sessionId: string;
};

type StreamMultiplexControl =
  | StreamSessionOpenControl
  | StreamSessionStartControl
  | StreamSessionSubscribeControl
  | StreamSessionStopControl
  | StreamSessionUnsubscribeControl
  | StreamSessionCloseControl;

type SubscriptionPayloadProjector = (
  payload: unknown,
  operation: GraphqlSubscriptionOperation | null,
) => unknown | null;

type ActiveSubscription = {
  subscriptionId: string;
  streamId: string;
  operation: GraphqlSubscriptionOperation | null;
  replaying: boolean;
  bufferedEvents: Array<DurableStreamEvent>;
  nextSourceOffset: number;
  projectPayload: SubscriptionPayloadProjector;
  unsubscribeSource: (() => void) | null;
};

type StreamSessionState = {
  sessionId: string;
  streamId: string;
  activeSubscriptions: Map<string, ActiveSubscription>;
  liveConnections: number;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
};

const GRAPHQL_STREAM_SESSION_PREFIX = "graphql-subscriptions:";
const WORKSPACE_STREAM_ID = "gambit-workspace";
const SESSION_IDLE_TTL_MS = 2 * 60 * 1000;
const HEARTBEAT_MS = 15 * 1000;

const sessions = new Map<string, StreamSessionState>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseOffset(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function asNumberOrNull(raw: string | null): number | null {
  if (raw == null || raw.trim().length === 0) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseVariables(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseGraphqlOperation(
  value: unknown,
): GraphqlSubscriptionOperation | null {
  if (!isRecord(value)) return null;
  if (typeof value.query !== "string" || value.query.trim().length === 0) {
    return null;
  }
  const operationName = typeof value.operationName === "string"
    ? value.operationName.trim()
    : undefined;
  return {
    query: value.query,
    operationName: operationName && operationName.length > 0
      ? operationName
      : undefined,
    variables: parseVariables(value.variables),
  };
}

function makeSessionStreamId(sessionId: string): string {
  return `${GRAPHQL_STREAM_SESSION_PREFIX}${sessionId}`;
}

function getSession(sessionId: string): StreamSessionState | null {
  return sessions.get(sessionId) ?? null;
}

function createSession(sessionId: string): StreamSessionState {
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const created: StreamSessionState = {
    sessionId,
    streamId: makeSessionStreamId(sessionId),
    activeSubscriptions: new Map(),
    liveConnections: 0,
    cleanupTimer: null,
  };
  sessions.set(sessionId, created);
  return created;
}

function stopCleanupTimer(session: StreamSessionState): void {
  if (session.cleanupTimer === null) return;
  clearTimeout(session.cleanupTimer);
  session.cleanupTimer = null;
}

function maybeDeleteIdleSession(session: StreamSessionState): void {
  if (session.liveConnections > 0) return;
  if (session.activeSubscriptions.size > 0) return;
  sessions.delete(session.sessionId);
  deleteDurableStream(session.streamId);
}

function scheduleCleanupIfIdle(session: StreamSessionState): void {
  if (session.liveConnections > 0) return;
  if (session.cleanupTimer !== null) return;

  if (session.activeSubscriptions.size === 0) {
    maybeDeleteIdleSession(session);
    return;
  }

  session.cleanupTimer = setTimeout(() => {
    session.cleanupTimer = null;
    if (session.liveConnections > 0) return;

    const subscriptionIds = [...session.activeSubscriptions.keys()];
    for (const subscriptionId of subscriptionIds) {
      stopSubscription(
        session,
        subscriptionId,
        "session_idle_timeout",
        false,
      );
    }
    maybeDeleteIdleSession(session);
  }, SESSION_IDLE_TTL_MS);
}

function parseControlRequest(body: unknown): StreamMultiplexControl | null {
  if (!isRecord(body)) return null;
  const action = body.action;
  if (action === "open") {
    return {
      action,
      sessionId: typeof body.sessionId === "string"
        ? body.sessionId.trim()
        : undefined,
    };
  }

  if (action === "start") {
    if (
      typeof body.sessionId !== "string" ||
      typeof body.subscriptionId !== "string" ||
      typeof body.streamId !== "string"
    ) {
      return null;
    }
    return {
      action,
      sessionId: body.sessionId.trim(),
      subscriptionId: body.subscriptionId.trim(),
      streamId: body.streamId.trim(),
      fromOffset: parseOffset(body.fromOffset),
    };
  }

  if (action === "subscribe") {
    if (
      typeof body.sessionId !== "string" ||
      typeof body.subscriptionId !== "string"
    ) {
      return null;
    }
    const operation = parseGraphqlOperation(body.operation);
    if (!operation) return null;
    return {
      action,
      sessionId: body.sessionId.trim(),
      subscriptionId: body.subscriptionId.trim(),
      operation,
      fromOffset: parseOffset(body.fromOffset),
    };
  }

  if (action === "stop") {
    if (
      typeof body.sessionId !== "string" ||
      typeof body.subscriptionId !== "string"
    ) {
      return null;
    }
    return {
      action,
      sessionId: body.sessionId.trim(),
      subscriptionId: body.subscriptionId.trim(),
    };
  }

  if (action === "unsubscribe") {
    if (
      typeof body.sessionId !== "string" ||
      typeof body.subscriptionId !== "string"
    ) {
      return null;
    }
    return {
      action,
      sessionId: body.sessionId.trim(),
      subscriptionId: body.subscriptionId.trim(),
    };
  }

  if (action === "close") {
    if (typeof body.sessionId !== "string") {
      return null;
    }
    return {
      action,
      sessionId: body.sessionId.trim(),
    };
  }

  return null;
}

function payloadAsRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return payload as Record<string, unknown>;
}

function deriveWorkspaceId(payload: Record<string, unknown>): string | null {
  if (
    typeof payload.workspaceId === "string" && payload.workspaceId.length > 0
  ) {
    return payload.workspaceId;
  }
  const run = payloadAsRecord(payload.run);
  if (run && typeof run.id === "string" && run.id.length > 0) {
    return run.id;
  }
  if (typeof payload.runId === "string" && payload.runId.length > 0) {
    return payload.runId;
  }
  return null;
}

function projectBuildSubscriptionPayload(
  payload: unknown,
  operation: GraphqlSubscriptionOperation | null,
): unknown | null {
  const record = payloadAsRecord(payload);
  if (!record || typeof record.type !== "string") return null;
  const expectedWorkspaceId = typeof operation?.variables?.workspaceId ===
      "string"
    ? operation.variables.workspaceId
    : null;
  const actualWorkspaceId = deriveWorkspaceId(record);

  if (
    expectedWorkspaceId &&
    actualWorkspaceId &&
    expectedWorkspaceId !== actualWorkspaceId
  ) {
    return null;
  }

  if (
    record.type === "buildBotStatus" || record.type === "gambit.build.status"
  ) {
    return {
      type: "gambit.build.status",
      workspaceId: actualWorkspaceId ?? expectedWorkspaceId,
      run: record.run ?? null,
    };
  }
  if (record.type === "buildBotTrace" || record.type === "gambit.build.trace") {
    return {
      type: "gambit.build.trace",
      workspaceId: actualWorkspaceId ?? expectedWorkspaceId,
      runId: typeof record.runId === "string" ? record.runId : null,
      event: record.event ?? null,
    };
  }
  if (
    record.type === "buildBotStream" ||
    record.type === "gambit.build.stream.delta"
  ) {
    return {
      type: "gambit.build.stream.delta",
      workspaceId: actualWorkspaceId ?? expectedWorkspaceId,
      runId: typeof record.runId === "string" ? record.runId : null,
      role: typeof record.role === "string" ? record.role : null,
      chunk: typeof record.chunk === "string" ? record.chunk : "",
      turn: typeof record.turn === "number" ? record.turn : null,
    };
  }
  if (
    record.type === "buildBotStreamEnd" ||
    record.type === "gambit.build.stream.done"
  ) {
    return {
      type: "gambit.build.stream.done",
      workspaceId: actualWorkspaceId ?? expectedWorkspaceId,
      runId: typeof record.runId === "string" ? record.runId : null,
      role: typeof record.role === "string" ? record.role : null,
      turn: typeof record.turn === "number" ? record.turn : null,
    };
  }
  return null;
}

function projectRawPayload(payload: unknown): unknown {
  return payload;
}

function resolveStreamFromOperation(
  operation: GraphqlSubscriptionOperation,
): { streamId: string; projectPayload: SubscriptionPayloadProjector } | null {
  const operationName = operation.operationName ?? "";
  const query = operation.query;
  const buildOperation = operationName === "GambitBuildReadSubscription" ||
    /gambitBuildReadSubscription/.test(query);
  const workspaceUpdatesOperation = operationName === "WorkspaceUpdates" ||
    /workspaceUpdates/.test(query);
  if (buildOperation || workspaceUpdatesOperation) {
    return {
      streamId: WORKSPACE_STREAM_ID,
      projectPayload: projectBuildSubscriptionPayload,
    };
  }
  return null;
}

function appendEnvelope(
  session: StreamSessionState,
  payload: Omit<StreamMultiplexEnvelope, "createdAt">,
): number {
  const appended = appendDurableStreamEvent(
    session.streamId,
    {
      ...payload,
      createdAt: new Date().toISOString(),
    } satisfies StreamMultiplexEnvelope,
  );
  return appended.offset;
}

function normalizeSseEventType(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "graphql.stream";
  }
  const record = value as Record<string, unknown>;
  const rawType = typeof record.type === "string"
    ? record.type.trim()
    : "graphql.stream";
  if (!rawType) return "graphql.stream";
  const normalized = rawType.replace(/[^A-Za-z0-9_.-]/g, "_");
  return normalized.length > 0 ? normalized : "graphql.stream";
}

function formatSse(event: DurableStreamEvent): string {
  return `id: ${event.offset}\nevent: ${
    normalizeSseEventType(event.data)
  }\ndata: ${JSON.stringify(event.data)}\n\n`;
}

function stopSubscription(
  session: StreamSessionState,
  subscriptionId: string,
  reason: string,
  scheduleCleanup = true,
): boolean {
  const active = session.activeSubscriptions.get(subscriptionId);
  if (!active) return false;

  session.activeSubscriptions.delete(subscriptionId);
  active.unsubscribeSource?.();

  appendEnvelope(session, {
    type: "unsubscribed",
    sessionId: session.sessionId,
    subscriptionId: active.subscriptionId,
    streamId: active.streamId,
    operationName: active.operation?.operationName,
    operationVariables: active.operation?.variables,
    reason,
  });

  if (scheduleCleanup) {
    scheduleCleanupIfIdle(session);
  }
  return true;
}

function forwardSubscriptionEvent(
  session: StreamSessionState,
  active: ActiveSubscription,
  event: DurableStreamEvent,
): void {
  if (event.offset < active.nextSourceOffset) return;
  const projectedPayload = active.projectPayload(event.data, active.operation);
  active.nextSourceOffset = event.offset + 1;
  if (projectedPayload === null) return;
  appendEnvelope(session, {
    type: "next",
    sessionId: session.sessionId,
    subscriptionId: active.subscriptionId,
    streamId: active.streamId,
    operationName: active.operation?.operationName,
    operationVariables: active.operation?.variables,
    sourceOffset: event.offset,
    payload: projectedPayload,
  });
}

function startSubscription(
  session: StreamSessionState,
  control: StreamSessionStartControl | StreamSessionSubscribeControl,
): number {
  stopSubscription(session, control.subscriptionId, "replaced");

  const resolved = control.action === "subscribe"
    ? resolveStreamFromOperation(control.operation)
    : null;
  if (control.action === "subscribe" && !resolved) {
    return appendEnvelope(session, {
      type: "error",
      sessionId: session.sessionId,
      subscriptionId: control.subscriptionId,
      streamId: "",
      operationName: control.operation.operationName,
      operationVariables: control.operation.variables,
      reason: "unsupported_operation",
      payload: { message: "unsupported_operation" },
    });
  }

  const streamId = control.action === "subscribe"
    ? (resolved?.streamId ?? "")
    : control.streamId;
  const operation = control.action === "subscribe" ? control.operation : null;
  const projectPayload = control.action === "subscribe"
    ? (resolved?.projectPayload ?? projectRawPayload)
    : projectRawPayload;

  const requestedFromOffset = parseOffset(control.fromOffset ?? 0);
  const sourceNextOffset = getDurableStreamNextOffset(streamId);
  const fromOffset = Math.min(requestedFromOffset, sourceNextOffset);

  const active: ActiveSubscription = {
    subscriptionId: control.subscriptionId,
    streamId,
    operation,
    replaying: true,
    bufferedEvents: [],
    nextSourceOffset: fromOffset,
    projectPayload,
    unsubscribeSource: null,
  };

  const sourceListener = (event: DurableStreamEvent) => {
    if (active.replaying) {
      active.bufferedEvents.push(event);
      return;
    }
    forwardSubscriptionEvent(session, active, event);
  };

  active.unsubscribeSource = subscribeDurableStream(
    streamId,
    sourceListener,
  );

  session.activeSubscriptions.set(control.subscriptionId, active);

  const replayEvents = readDurableStreamEvents(
    streamId,
    active.nextSourceOffset,
  );
  for (const event of replayEvents) {
    forwardSubscriptionEvent(session, active, event);
  }

  active.replaying = false;
  if (active.bufferedEvents.length > 0) {
    const buffered = [...active.bufferedEvents].sort((a, b) =>
      a.offset - b.offset
    );
    active.bufferedEvents = [];
    for (const event of buffered) {
      forwardSubscriptionEvent(session, active, event);
    }
  }

  return appendEnvelope(session, {
    type: "subscribed",
    sessionId: session.sessionId,
    subscriptionId: control.subscriptionId,
    streamId,
    operationName: operation?.operationName,
    operationVariables: operation?.variables,
    sourceOffset: active.nextSourceOffset,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

async function handleControlRequest(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  const control = parseControlRequest(payload);
  if (!control) {
    return jsonResponse({ ok: false, error: "invalid_request" }, 400);
  }

  if (control.action === "open") {
    const requestedSessionId = control.sessionId?.trim() ?? "";
    const sessionId = requestedSessionId || crypto.randomUUID();
    createSession(sessionId);
    return jsonResponse({
      ok: true,
      sessionId,
      nextOffset: getDurableStreamNextOffset(makeSessionStreamId(sessionId)),
    });
  }

  if (!control.sessionId) {
    return jsonResponse({ ok: false, error: "missing_session_id" }, 400);
  }

  const session = getSession(control.sessionId);
  if (!session) {
    return jsonResponse({ ok: false, error: "session_not_found" }, 404);
  }

  stopCleanupTimer(session);

  if (control.action === "start" || control.action === "subscribe") {
    if (!control.subscriptionId) {
      return jsonResponse({ ok: false, error: "missing_subscription_id" }, 400);
    }
    if (control.action === "start" && !control.streamId) {
      return jsonResponse({ ok: false, error: "missing_stream_id" }, 400);
    }

    startSubscription(session, control);
    return jsonResponse(
      {
        ok: true,
        nextOffset: getDurableStreamNextOffset(session.streamId),
      },
      202,
    );
  }

  if (control.action === "stop" || control.action === "unsubscribe") {
    const removed = stopSubscription(
      session,
      control.subscriptionId,
      "unsubscribed_by_client",
    );
    return jsonResponse({
      ok: true,
      removed,
      nextOffset: getDurableStreamNextOffset(session.streamId),
    });
  }

  const subscriptionIds = [...session.activeSubscriptions.keys()];
  for (const subscriptionId of subscriptionIds) {
    stopSubscription(session, subscriptionId, "session_closed", false);
  }
  stopCleanupTimer(session);
  maybeDeleteIdleSession(session);

  return jsonResponse({
    ok: true,
    sessionId: session.sessionId,
    nextOffset: getDurableStreamNextOffset(session.streamId),
  });
}

function handleSseRequest(request: Request): Response {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";
  if (!sessionId) {
    return new Response("sessionId is required", { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return new Response("session not found", { status: 404 });
  }

  stopCleanupTimer(session);
  session.liveConnections += 1;

  const offsetFromQuery = asNumberOrNull(url.searchParams.get("offset"));
  const offsetFromEventId = asNumberOrNull(
    request.headers.get("last-event-id"),
  );
  const startOffset = Math.max(0, offsetFromEventId ?? offsetFromQuery ?? 0);

  const replay = readDurableStreamEvents(session.streamId, startOffset);
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribeLive: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const teardown = (
    controller?: ReadableStreamDefaultController<Uint8Array>,
  ): void => {
    if (closed) return;
    closed = true;

    if (unsubscribeLive) {
      unsubscribeLive();
      unsubscribeLive = null;
    }
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    session.liveConnections = Math.max(0, session.liveConnections - 1);
    scheduleCleanupIfIdle(session);

    if (controller) {
      try {
        controller.close();
      } catch {
        // already closed
      }
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": graphql stream open\n\n"));
      for (const event of replay) {
        controller.enqueue(encoder.encode(formatSse(event)));
      }

      unsubscribeLive = subscribeDurableStream(
        session.streamId,
        (event: DurableStreamEvent) => {
          try {
            controller.enqueue(encoder.encode(formatSse(event)));
          } catch {
            teardown(controller);
          }
        },
      );

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          teardown(controller);
        }
      }, HEARTBEAT_MS);

      request.signal.addEventListener("abort", () => {
        teardown(controller);
      });
    },
    cancel() {
      teardown();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    },
  });
}

export async function handleGraphqlStreamMultiplexRequest(
  request: Request,
): Promise<Response> {
  if (request.method === "POST") {
    return await handleControlRequest(request);
  }
  if (request.method === "GET") {
    return await handleSseRequest(request);
  }
  return new Response("Method not allowed", { status: 405 });
}
