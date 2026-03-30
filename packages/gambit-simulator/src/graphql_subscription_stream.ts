import {
  appendDurableStreamEvent,
  deleteDurableStream,
  getDurableStreamNextOffset,
  readDurableStreamEvents,
  subscribeDurableStream,
} from "@bolt-foundry/gambit/src/durable_streams.ts";
import {
  type GambitGraphqlContext,
  gambitSimulatorSchema,
} from "./simulator_graphql.ts";
import {
  type ExecutionResult,
  getOperationAST,
  type GraphQLError,
  parse,
  subscribe,
  validate,
} from "graphql";

type GraphqlSubscriptionStreamEnvelope = {
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

type GraphqlSubscriptionStreamControlSubscribe = {
  action: "subscribe";
  sessionId: string;
  subscriptionId: string;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

type GraphqlSubscriptionStreamControlUnsubscribe = {
  action: "unsubscribe";
  sessionId: string;
  subscriptionId: string;
};

type GraphqlSubscriptionStreamControlClose = {
  action: "close";
  sessionId: string;
};

type GraphqlSubscriptionStreamControlRequest =
  | GraphqlSubscriptionStreamControlSubscribe
  | GraphqlSubscriptionStreamControlUnsubscribe
  | GraphqlSubscriptionStreamControlClose;

type ActiveSubscription = {
  subscriptionId: string;
  operationId: string;
  operationName: string | null;
  iterator: AsyncIterator<ExecutionResult>;
  stopReason: string | null;
};

type GraphqlStreamSessionState = {
  sessionId: string;
  streamId: string;
  activeSubscriptions: Map<string, ActiveSubscription>;
  liveConnections: number;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
};

type DurableStreamEvent = {
  offset: number;
  data: unknown;
  createdAt: string;
};

const GRAPHQL_STREAM_SESSION_PREFIX = "graphql-subscriptions:";
const SESSION_IDLE_TTL_MS = 2 * 60 * 1000;
const HEARTBEAT_MS = 15 * 1000;

const sessions = new Map<string, GraphqlStreamSessionState>();

function getOrCreateSession(sessionId: string): GraphqlStreamSessionState {
  const existing = sessions.get(sessionId);
  if (existing) return existing;

  const created: GraphqlStreamSessionState = {
    sessionId,
    streamId: `${GRAPHQL_STREAM_SESSION_PREFIX}${sessionId}`,
    activeSubscriptions: new Map(),
    liveConnections: 0,
    cleanupTimer: null,
  };
  sessions.set(sessionId, created);
  return created;
}

function stopCleanupTimer(session: GraphqlStreamSessionState): void {
  if (session.cleanupTimer === null) return;
  clearTimeout(session.cleanupTimer);
  session.cleanupTimer = null;
}

function scheduleCleanupIfIdle(session: GraphqlStreamSessionState): void {
  if (session.liveConnections > 0) return;
  if (session.cleanupTimer !== null) return;

  if (session.activeSubscriptions.size === 0) {
    sessions.delete(session.sessionId);
    deleteDurableStream(session.streamId);
    return;
  }

  session.cleanupTimer = setTimeout(() => {
    session.cleanupTimer = null;
    if (session.liveConnections > 0) return;

    const subscriptionIds = [...session.activeSubscriptions.keys()];
    void (async () => {
      for (const subscriptionId of subscriptionIds) {
        await stopSubscription(session, subscriptionId, "session_idle_timeout");
      }
      if (
        session.liveConnections === 0 && session.activeSubscriptions.size === 0
      ) {
        sessions.delete(session.sessionId);
        deleteDurableStream(session.streamId);
      }
    })();
  }, SESSION_IDLE_TTL_MS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeGraphqlErrors(
  errors: ReadonlyArray<GraphQLError> | undefined,
):
  | Array<{
    message: string;
    path?: Array<string | number>;
    code?: string;
  }>
  | undefined {
  if (!errors || errors.length === 0) return undefined;
  return errors.map((error) => ({
    message: error.message,
    path: Array.isArray(error.path) ? [...error.path] : undefined,
    code: typeof error.extensions?.["code"] === "string"
      ? error.extensions["code"]
      : undefined,
  }));
}

function makeOperationId(
  query: string,
  operationName: string | null,
  variables: Record<string, unknown> | undefined,
): string {
  const raw = `${operationName ?? "anonymous"}:${query}:${
    JSON.stringify(variables ?? {})
  }`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `op_${(hash >>> 0).toString(16)}`;
}

function appendEnvelope(
  session: GraphqlStreamSessionState,
  payload: Omit<GraphqlSubscriptionStreamEnvelope, "createdAt">,
): number {
  const appended = appendDurableStreamEvent(
    session.streamId,
    {
      ...payload,
      createdAt: new Date().toISOString(),
    } satisfies GraphqlSubscriptionStreamEnvelope,
  );
  return appended.offset;
}

function formatSse(event: DurableStreamEvent): string {
  const eventName = event.data && typeof event.data === "object" &&
      !Array.isArray(event.data) &&
      typeof (event.data as { type?: unknown }).type === "string"
    ? (event.data as { type: string }).type
    : "graphql.stream";
  return `id: ${event.offset}\nevent: ${eventName}\ndata: ${
    JSON.stringify(event.data)
  }\n\n`;
}

function asNumberOrNull(raw: string | null): number | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseControlRequest(
  payload: unknown,
): GraphqlSubscriptionStreamControlRequest | null {
  if (!isRecord(payload)) return null;
  const action = payload.action;

  if (action === "subscribe") {
    if (
      typeof payload.sessionId !== "string" ||
      typeof payload.subscriptionId !== "string" ||
      typeof payload.query !== "string"
    ) {
      return null;
    }
    const variables = isRecord(payload.variables)
      ? payload.variables
      : undefined;
    return {
      action,
      sessionId: payload.sessionId.trim(),
      subscriptionId: payload.subscriptionId.trim(),
      query: payload.query,
      variables,
      operationName: typeof payload.operationName === "string"
        ? payload.operationName
        : undefined,
    };
  }

  if (action === "unsubscribe") {
    if (
      typeof payload.sessionId !== "string" ||
      typeof payload.subscriptionId !== "string"
    ) {
      return null;
    }
    return {
      action,
      sessionId: payload.sessionId.trim(),
      subscriptionId: payload.subscriptionId.trim(),
    };
  }

  if (action === "close") {
    if (typeof payload.sessionId !== "string") return null;
    return {
      action,
      sessionId: payload.sessionId.trim(),
    };
  }

  return null;
}

async function stopSubscription(
  session: GraphqlStreamSessionState,
  subscriptionId: string,
  reason: string,
): Promise<boolean> {
  const active = session.activeSubscriptions.get(subscriptionId);
  if (!active) return false;

  active.stopReason = reason;
  session.activeSubscriptions.delete(subscriptionId);

  try {
    await settleIteratorReturn(active.iterator);
  } catch {
    // Best-effort iterator cleanup.
  }

  appendEnvelope(session, {
    type: "unsubscribed",
    sessionId: session.sessionId,
    subscriptionId,
    operationId: active.operationId,
    operationName: active.operationName,
    reason,
  });
  scheduleCleanupIfIdle(session);
  return true;
}

async function settleIteratorReturn(
  iterator: AsyncIterator<ExecutionResult>,
): Promise<void> {
  if (typeof iterator.return !== "function") return;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      Promise.resolve(iterator.return?.()).then(() => {}).catch(() => {}),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 250);
      }),
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}

async function runSubscriptionPump(
  session: GraphqlStreamSessionState,
  active: ActiveSubscription,
): Promise<void> {
  try {
    while (session.activeSubscriptions.get(active.subscriptionId) === active) {
      const next = await active.iterator.next();
      if (next.done) break;

      const payload = next.value;
      appendEnvelope(session, {
        type: "next",
        sessionId: session.sessionId,
        subscriptionId: active.subscriptionId,
        operationId: active.operationId,
        operationName: active.operationName,
        payload: payload.data ?? null,
        errors: normalizeGraphqlErrors(payload.errors),
      });
    }
  } catch (error) {
    appendEnvelope(session, {
      type: "error",
      sessionId: session.sessionId,
      subscriptionId: active.subscriptionId,
      operationId: active.operationId,
      operationName: active.operationName,
      reason: "subscription_pump_failed",
      errors: [{
        message: error instanceof Error ? error.message : String(error),
      }],
    });
  } finally {
    const current = session.activeSubscriptions.get(active.subscriptionId);
    if (current === active) {
      session.activeSubscriptions.delete(active.subscriptionId);
      appendEnvelope(session, {
        type: "complete",
        sessionId: session.sessionId,
        subscriptionId: active.subscriptionId,
        operationId: active.operationId,
        operationName: active.operationName,
        reason: active.stopReason ?? "completed",
      });
    }
    scheduleCleanupIfIdle(session);
  }
}

async function handleSubscribeControl(
  _request: Request,
  session: GraphqlStreamSessionState,
  control: GraphqlSubscriptionStreamControlSubscribe,
  context: GambitGraphqlContext,
): Promise<Response> {
  const query = control.query.trim();
  if (!query) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing_query" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  if (!control.subscriptionId) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing_subscription_id" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const operationName = control.operationName?.trim() || null;
  const operationId = makeOperationId(query, operationName, control.variables);

  await stopSubscription(session, control.subscriptionId, "replaced");

  let document;
  try {
    document = parse(query);
  } catch (error) {
    appendEnvelope(session, {
      type: "error",
      sessionId: session.sessionId,
      subscriptionId: control.subscriptionId,
      operationId,
      operationName,
      reason: "invalid_graphql_query",
      errors: [{
        message: error instanceof Error ? error.message : String(error),
      }],
    });
    return new Response(
      JSON.stringify({ ok: false, error: "invalid_graphql_query" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const validationErrors = validate(gambitSimulatorSchema, document);
  if (validationErrors.length > 0) {
    appendEnvelope(session, {
      type: "error",
      sessionId: session.sessionId,
      subscriptionId: control.subscriptionId,
      operationId,
      operationName,
      reason: "subscription_validation_failed",
      errors: normalizeGraphqlErrors(validationErrors),
    });
    return new Response(
      JSON.stringify({ ok: false, error: "subscription_validation_failed" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const operation = getOperationAST(document, operationName ?? undefined);
  if (!operation || operation.operation !== "subscription") {
    appendEnvelope(session, {
      type: "error",
      sessionId: session.sessionId,
      subscriptionId: control.subscriptionId,
      operationId,
      operationName,
      reason: "operation_must_be_subscription",
    });
    return new Response(
      JSON.stringify({ ok: false, error: "operation_must_be_subscription" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  let iterator: AsyncIterator<ExecutionResult>;
  try {
    const subscribed = await subscribe({
      schema: gambitSimulatorSchema,
      document,
      contextValue: context,
      variableValues: control.variables,
      operationName: operationName ?? undefined,
    });

    if (!isAsyncIterable<ExecutionResult>(subscribed)) {
      const single = subscribed as ExecutionResult;
      appendEnvelope(session, {
        type: "error",
        sessionId: session.sessionId,
        subscriptionId: control.subscriptionId,
        operationId,
        operationName,
        reason: "subscription_start_failed",
        payload: single.data ?? null,
        errors: normalizeGraphqlErrors(single.errors),
      });
      return new Response(
        JSON.stringify({ ok: false, error: "subscription_start_failed" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }

    iterator = subscribed[Symbol.asyncIterator]();
  } catch (error) {
    appendEnvelope(session, {
      type: "error",
      sessionId: session.sessionId,
      subscriptionId: control.subscriptionId,
      operationId,
      operationName,
      reason: "subscription_start_failed",
      errors: [{
        message: error instanceof Error ? error.message : String(error),
      }],
    });
    return new Response(
      JSON.stringify({ ok: false, error: "subscription_start_failed" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const active: ActiveSubscription = {
    subscriptionId: control.subscriptionId,
    operationId,
    operationName,
    iterator,
    stopReason: null,
  };
  session.activeSubscriptions.set(control.subscriptionId, active);
  stopCleanupTimer(session);
  appendEnvelope(session, {
    type: "subscribed",
    sessionId: session.sessionId,
    subscriptionId: control.subscriptionId,
    operationId,
    operationName,
  });
  void runSubscriptionPump(session, active);

  return new Response(
    JSON.stringify({
      ok: true,
      nextOffset: getDurableStreamNextOffset(session.streamId),
    }),
    {
      status: 202,
      headers: { "content-type": "application/json" },
    },
  );
}

async function handleUnsubscribeControl(
  session: GraphqlStreamSessionState,
  control: GraphqlSubscriptionStreamControlUnsubscribe,
): Promise<Response> {
  const removed = await stopSubscription(
    session,
    control.subscriptionId,
    "unsubscribed_by_client",
  );
  return new Response(
    JSON.stringify({
      ok: true,
      removed,
      nextOffset: getDurableStreamNextOffset(session.streamId),
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

async function handleCloseControl(
  session: GraphqlStreamSessionState,
): Promise<Response> {
  const subscriptionIds = [...session.activeSubscriptions.keys()];
  for (const subscriptionId of subscriptionIds) {
    await stopSubscription(session, subscriptionId, "session_closed");
  }
  const nextOffset = getDurableStreamNextOffset(session.streamId);
  if (session.liveConnections === 0 && session.activeSubscriptions.size === 0) {
    sessions.delete(session.sessionId);
    deleteDurableStream(session.streamId);
  }
  return new Response(
    JSON.stringify({
      ok: true,
      nextOffset,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

async function handleControlRequest(
  request: Request,
  context: GambitGraphqlContext,
): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "invalid_json" }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const control = parseControlRequest(payload);
  if (!control) {
    return new Response(
      JSON.stringify({ ok: false, error: "invalid_request" }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    );
  }

  if (!control.sessionId) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing_session_id" }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const session = getOrCreateSession(control.sessionId);
  stopCleanupTimer(session);

  if (control.action === "subscribe") {
    return await handleSubscribeControl(request, session, control, context);
  }
  if (control.action === "unsubscribe") {
    return await handleUnsubscribeControl(session, control);
  }
  return await handleCloseControl(session);
}

function handleSseRequest(request: Request): Response {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";
  if (!sessionId) {
    return new Response("sessionId is required", { status: 400 });
  }

  const session = getOrCreateSession(sessionId);
  stopCleanupTimer(session);
  session.liveConnections += 1;

  const offsetFromQuery = asNumberOrNull(url.searchParams.get("offset"));
  const offsetFromLastEventId = asNumberOrNull(
    request.headers.get("last-event-id"),
  );
  const startOffset = Math.max(
    0,
    offsetFromLastEventId !== null
      ? offsetFromLastEventId + 1
      : (offsetFromQuery ?? 0),
  );

  const replay = readDurableStreamEvents(session.streamId, startOffset);
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribeLive: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const teardown = (
    controller?: ReadableStreamDefaultController<Uint8Array>,
  ) => {
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
        // No-op if already closed.
      }
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": graphql stream open\n\n"));
      for (const event of replay as Array<DurableStreamEvent>) {
        controller.enqueue(encoder.encode(formatSse(event)));
      }

      unsubscribeLive = subscribeDurableStream(
        session.streamId,
        (event) => {
          try {
            controller.enqueue(
              encoder.encode(formatSse(event as DurableStreamEvent)),
            );
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

      request.signal.addEventListener("abort", () => teardown(controller), {
        once: true,
      });
    },
    cancel() {
      teardown();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-graphql-stream-session": sessionId,
      "stream-next-offset": String(
        getDurableStreamNextOffset(session.streamId),
      ),
    },
  });
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return !!value &&
    typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === "function";
}

export async function handleGraphqlSubscriptionStreamRequest(
  request: Request,
  context: GambitGraphqlContext,
): Promise<Response> {
  if (request.method === "GET") {
    return await handleSseRequest(request);
  }
  if (request.method === "POST") {
    return await handleControlRequest(request, context);
  }
  return new Response("Method not allowed", {
    status: 405,
    headers: { allow: "GET, POST" },
  });
}
