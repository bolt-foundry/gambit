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
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response(simulatorHtml(opts.deckPath), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname !== "/websocket") {
      return new Response("Not found", { status: 404 });
    }

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
    `WebSocket simulator listening on ws://localhost:${listenPort}/websocket (deck=${opts.deckPath})`,
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

function simulatorHtml(deckPath: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Gambit WebSocket Simulator</title>
  <style>
    body { font-family: sans-serif; margin: 16px; max-width: 900px; }
    textarea { width: 100%; height: 120px; font-family: monospace; }
    pre { background: #111; color: #0f0; padding: 12px; height: 240px; overflow: auto; }
    button { padding: 8px 12px; margin-top: 8px; }
    code { background: #eee; padding: 2px 4px; }
  </style>
</head>
<body>
  <h1>Gambit WebSocket Simulator</h1>
  <p>Deck: <code>${deckPath}</code></p>
  <p>Connects to <code>/websocket</code> and sends <code>{ type: "run", input }</code>. Streams and results appear below.</p>
  <textarea id="input" placeholder='Type input (string or JSON)'></textarea>
  <div>
    <label><input type="checkbox" id="asJson" /> Parse input as JSON</label>
    <button id="send">Send</button>
    <span id="status">connecting...</span>
  </div>
  <pre id="log"></pre>
  <script>
    const log = document.getElementById("log");
    const status = document.getElementById("status");
    const input = document.getElementById("input");
    const asJson = document.getElementById("asJson");
    const btn = document.getElementById("send");

    function append(line) {
      const now = new Date().toISOString();
      log.textContent += "[" + now + "] " + line + "\\n";
      log.scrollTop = log.scrollHeight;
    }

    const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/websocket";
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => { status.textContent = "connected"; };
    ws.onclose = () => { status.textContent = "closed"; };
    ws.onerror = () => { status.textContent = "error"; };
    ws.onmessage = (ev) => append(ev.data);

    btn.onclick = () => {
      let val = input.value;
      if (asJson.checked) {
        try { val = JSON.parse(val); } catch (err) { append("JSON parse error: " + err); return; }
      }
      ws.send(JSON.stringify({ type: "run", input: val, stream: true, trace: false }));
    };
  </script>
</body>
</html>`;
}
