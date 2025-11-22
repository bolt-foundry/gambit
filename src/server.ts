import { runDeck } from "./runtime.ts";
import { makeConsoleTracer } from "./trace.ts";
import type { ModelProvider, TraceEvent } from "./types.ts";

type IncomingMessage =
  | {
    type: "run";
    input?: unknown;
    stream?: boolean;
    model?: string;
    modelForce?: string;
    trace?: boolean;
  }
  | { type: "ping" };

type OutgoingMessage =
  | { type: "ready"; deck: string; port: number }
  | { type: "pong" }
  | { type: "stream"; chunk: string; runId?: string }
  | { type: "result"; result: unknown; runId?: string; streamed: boolean }
  | { type: "trace"; event: TraceEvent }
  | { type: "error"; message: string; runId?: string };

export function startWebSocketSimulator(opts: {
  deckPath: string;
  modelProvider: ModelProvider;
  model?: string;
  modelForce?: string;
  port?: number;
  verbose?: boolean;
  signal?: AbortSignal;
}): ReturnType<typeof Deno.serve> {
  const port = opts.port ?? 8000;
  const consoleTracer = opts.verbose ? makeConsoleTracer() : undefined;

  const server = Deno.serve({ port, signal: opts.signal, onListen: () => {} }, (req) => {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket endpoint", { status: 400 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);
    const decoder = new TextDecoder();

    let running = false;
    let currentRunId: string | undefined;

    const safeSend = (payload: OutgoingMessage) => {
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(payload));
        }
      } catch {
        // ignore send failures
      }
    };

    const traceHandler = (forward: boolean) =>
    (event: TraceEvent) => {
      if (event.type === "run.start") currentRunId = event.runId;
      consoleTracer?.(event);
      if (forward) safeSend({ type: "trace", event });
    };

    socket.onopen = () => {
      safeSend({ type: "ready", deck: opts.deckPath, port });
    };

    socket.onmessage = async (ev) => {
      const msg = parseIncoming(ev.data, decoder);

      if (!msg) {
        safeSend({ type: "error", message: "Invalid message" });
        return;
      }

      if (msg.type === "ping") {
        safeSend({ type: "pong" });
        return;
      }

      if (running) {
        safeSend({ type: "error", message: "Run already in progress" });
        return;
      }

      running = true;
      currentRunId = undefined;

      const stream = msg.stream ?? true;
      const forwardTrace = Boolean(msg.trace);
      const tracer = forwardTrace || opts.verbose ? traceHandler(forwardTrace) : undefined;

      try {
        const result = await runDeck({
          path: opts.deckPath,
          input: msg.input ?? "",
          modelProvider: opts.modelProvider,
          isRoot: true,
          defaultModel: msg.model ?? opts.model,
          modelOverride: msg.modelForce ?? opts.modelForce,
          trace: tracer,
          stream,
          onStreamText: (chunk) =>
            safeSend({ type: "stream", chunk, runId: currentRunId }),
        });

        safeSend({
          type: "result",
          result,
          runId: currentRunId,
          streamed: stream,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        safeSend({ type: "error", message, runId: currentRunId });
      } finally {
        running = false;
      }
    };

    socket.onclose = () => {
      running = false;
    };
    socket.onerror = () => {
      running = false;
    };

    return response;
  });

  const listenPort = (server.addr as Deno.NetAddr).port;
  console.log(
    `WebSocket simulator listening on ws://localhost:${listenPort}/ (deck=${opts.deckPath})`,
  );
  return server;
}

function parseIncoming(data: unknown, decoder: TextDecoder): IncomingMessage | null {
  try {
    const raw = typeof data === "string" ? data : decoder.decode(data as ArrayBuffer);
    const parsed = JSON.parse(raw) as { type?: unknown };
    if (parsed && typeof parsed === "object") {
      if (parsed.type === "run" || parsed.type === "ping") {
        return parsed as IncomingMessage;
      }
    }
  } catch {
    // ignore parse errors
  }
  return null;
}
