type StreamEvent = {
  offset: number;
  data: unknown;
  createdAt: string;
};

type StreamState = {
  events: Array<StreamEvent>;
  listeners: Set<(event: StreamEvent) => void>;
  nextOffset: number;
};

const streams = new Map<string, StreamState>();
const STREAM_PREFIX = "/api/durable-streams/stream/";

function getStreamState(streamId: string): StreamState {
  const existing = streams.get(streamId);
  if (existing) return existing;
  const created: StreamState = {
    events: [],
    listeners: new Set(),
    nextOffset: 0,
  };
  streams.set(streamId, created);
  return created;
}

function appendEvent(streamId: string, data: unknown): StreamEvent {
  const state = getStreamState(streamId);
  const event: StreamEvent = {
    offset: state.nextOffset,
    data,
    createdAt: new Date().toISOString(),
  };
  state.events.push(event);
  state.nextOffset += 1;
  for (const listener of state.listeners) {
    listener(event);
  }
  return event;
}

export function appendDurableStreamEvent(
  streamId: string,
  data: unknown,
): StreamEvent {
  return appendEvent(streamId, data);
}

export async function handleDurableStreamRequest(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(STREAM_PREFIX)) {
    return new Response("Not found", { status: 404 });
  }
  const streamId = decodeURIComponent(url.pathname.slice(STREAM_PREFIX.length));
  if (!streamId) {
    return new Response("Stream id missing", { status: 400 });
  }

  if (request.method === "POST") {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("Invalid JSON payload", { status: 400 });
    }

    const events = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && "events" in payload
      ? (payload as { events?: Array<unknown> }).events ?? []
      : [payload];

    if (!events.length) {
      return new Response("Missing events", { status: 400 });
    }

    let lastEvent: StreamEvent | undefined;
    for (const event of events) {
      lastEvent = appendEvent(streamId, event);
    }

    return new Response(null, {
      status: 204,
      headers: {
        "Stream-Next-Offset": String((lastEvent?.offset ?? -1) + 1),
      },
    });
  }

  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const offsetParam = url.searchParams.get("offset");
  const offset = offsetParam ? Number(offsetParam) : 0;
  const startOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  const live = url.searchParams.get("live");
  const useSse = live === "sse" || live === "auto";
  const state = getStreamState(streamId);

  if (!useSse) {
    const events = state.events.filter((event) => event.offset >= startOffset);
    return new Response(JSON.stringify({ events }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Stream-Next-Offset": String(state.nextOffset),
      },
    });
  }

  const encoder = new TextEncoder();
  let listener: ((event: StreamEvent) => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": stream open\n\n"));

      for (const event of state.events) {
        if (event.offset < startOffset) continue;
        controller.enqueue(encoder.encode(formatSseEvent(event)));
      }

      listener = (event) => {
        try {
          controller.enqueue(encoder.encode(formatSseEvent(event)));
        } catch {
          if (listener) {
            state.listeners.delete(listener);
          }
        }
      };
      state.listeners.add(listener);

      request.signal.addEventListener("abort", () => {
        if (listener) {
          state.listeners.delete(listener);
        }
        controller.close();
      });
    },
    cancel() {
      if (listener) {
        state.listeners.delete(listener);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

function formatSseEvent(event: StreamEvent): string {
  return `id: ${event.offset}\ndata: ${JSON.stringify(event)}\n\n`;
}
