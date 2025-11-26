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
    userFirst?: boolean;
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
  userFirst?: boolean;
}): ReturnType<typeof Deno.serve> {
  const port = opts.port ?? 8000;
  const consoleTracer = opts.verbose ? makeConsoleTracer() : undefined;

  const server = Deno.serve(
    { port, signal: opts.signal, onListen: () => {} },
    (req) => {
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

      const traceHandler = (forward: boolean) => (event: TraceEvent) => {
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
        const tracer = forwardTrace || opts.verbose
          ? traceHandler(forwardTrace)
          : undefined;
        const userFirst = msg.userFirst ?? opts.userFirst ?? false;

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
            userFirst,
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
    },
  );

  const listenPort = (server.addr as Deno.NetAddr).port;
  console.log(
    `WebSocket simulator listening on ws://localhost:${listenPort}/websocket (deck=${opts.deckPath})`,
  );
  return server;
}

function parseIncoming(
  data: unknown,
  decoder: TextDecoder,
): IncomingMessage | null {
  try {
    const raw = typeof data === "string"
      ? data
      : decoder.decode(data as ArrayBuffer);
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
    body { font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: linear-gradient(135deg, #eaf2ff, #f7f9ff); color: #0f172a; }
    .shell { max-width: 960px; margin: 24px auto; padding: 16px; }
    .card { background: white; border-radius: 16px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); padding: 16px; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    header h1 { margin: 0; font-size: 20px; }
    header .meta { font-size: 12px; color: #475569; }
    .transcript { background: #f5f7fb; border-radius: 14px; padding: 12px; height: 420px; overflow-y: auto; border: 1px solid #e2e8f0; }
    .row { display: flex; margin: 6px 0; }
    .row.user { justify-content: flex-end; }
    .row.assistant, .row.trace, .row.system, .row.error { justify-content: flex-start; }
    .row.meta { justify-content: center; }
    .bubble { max-width: 70%; padding: 10px 12px; border-radius: 16px; line-height: 1.4; white-space: pre-wrap; position: relative; }
    .bubble.user { background: #0b93f6; color: white; border-bottom-right-radius: 4px; }
    .bubble.assistant { background: #e5e5ea; color: #111; border-bottom-left-radius: 4px; }
    .bubble.system { background: #fff3cd; color: #8a6d3b; border-bottom-left-radius: 4px; }
    .bubble.suspense { background: #fff3cd; color: #8a6d3b; border-bottom-left-radius: 4px; }
    .bubble.trace, .bubble.meta { background: #e2e8f0; color: #475569; border-bottom-left-radius: 4px; border-bottom-right-radius: 4px; }
    .bubble.error { background: #fee2e2; color: #b91c1c; border-bottom-left-radius: 4px; }
    .bubble.collapsible { cursor: pointer; }
    .bubble .details { display: none; margin-top: 6px; padding-top: 6px; border-top: 1px solid #cbd5e1; font-size: 12px; white-space: pre-wrap; }
    .bubble.open .details { display: block; }
    .bubble .chevron { position: absolute; right: 10px; top: 10px; font-size: 12px; color: #94a3b8; }
    form { margin-top: 12px; display: flex; gap: 8px; align-items: flex-end; }
    textarea { flex: 1; height: 100px; border-radius: 10px; border: 1px solid #cbd5e1; padding: 10px; font-family: monospace; resize: vertical; background: white; }
    .controls { display: flex; align-items: center; gap: 8px; }
    button { padding: 10px 14px; border: none; border-radius: 10px; background: #0b93f6; color: white; cursor: pointer; font-weight: 600; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    label { font-size: 13px; color: #475569; display: inline-flex; align-items: center; gap: 4px; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <header>
        <div>
          <h1>Gambit WebSocket Simulator</h1>
          <div class="meta">Deck: <code>${deckPath}</code> · Socket: <code>/websocket</code></div>
        </div>
        <div id="status">connecting...</div>
      </header>
      <div id="transcript" class="transcript"></div>
      <form id="composer">
        <textarea id="input" placeholder='Type input as text, or toggle JSON below.'></textarea>
        <div class="controls">
          <label><input type="checkbox" id="asJson" /> JSON</label>
          <button type="submit" id="send">Send</button>
        </div>
      </form>
    </div>
  </div>
  <script>
    const transcript = document.getElementById("transcript");
    const status = document.getElementById("status");
    const input = document.getElementById("input");
    const asJson = document.getElementById("asJson");
    const composer = document.getElementById("composer");
    const btn = document.getElementById("send");
    let currentAssistant = null;
    let suspenseBubble = null;
    let streamMode = "assistant";

    const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/websocket";
    let ws = null;

    function scrollBottom() {
      transcript.scrollTop = transcript.scrollHeight;
    }

    function addBubble(role, text, opts = {}) {
      const row = document.createElement("div");
      row.className = "row " + (opts.middle ? "meta" : role);
      const bubble = document.createElement("div");
      bubble.className = "bubble " + role;
      bubble.textContent = text;
      if (opts.collapsible) {
        bubble.classList.add("collapsible", "meta");
        const chev = document.createElement("span");
        chev.textContent = "▾";
        chev.className = "chevron";
        bubble.appendChild(chev);
        const details = document.createElement("div");
        details.className = "details";
        details.textContent = opts.details ?? "";
        bubble.appendChild(details);
        bubble.addEventListener("click", () => {
          const open = bubble.classList.toggle("open");
          chev.textContent = open ? "▴" : "▾";
        });
      }
      row.appendChild(bubble);
      transcript.appendChild(row);
      scrollBottom();
      return bubble;
    }

    function formatPayload(p) {
      if (typeof p === "string") return p;
      try { return JSON.stringify(p, null, 2); } catch { return String(p); }
    }

    function handleMessage(msg) {
      switch (msg.type) {
        case "ready":
          status.textContent = "ready";
          addBubble("system", "Server ready.");
          break;
        case "pong":
          status.textContent = "pong";
          break;
        case "stream": {
          const chunk = msg.chunk ?? "";
          const target = streamMode === "suspense" ? "suspense" : "assistant";
          if (target === "suspense") {
            if (!suspenseBubble) suspenseBubble = addBubble("suspense", "");
            suspenseBubble.textContent += chunk;
          } else {
            if (!currentAssistant) currentAssistant = addBubble("assistant", "");
            currentAssistant.textContent += chunk;
          }
          scrollBottom();
          break;
        }
        case "result": {
          const content = formatPayload(msg.result);
          if (!currentAssistant) {
            addBubble("assistant", content);
          } else if (!currentAssistant.textContent.trim()) {
            currentAssistant.textContent = content;
          }
          currentAssistant = null;
          suspenseBubble = null;
          streamMode = "assistant";
          status.textContent = "connected";
          break;
        }
        case "error":
          addBubble("error", "Error: " + (msg.message ?? "unknown"));
          currentAssistant = null;
          suspenseBubble = null;
          streamMode = "assistant";
          status.textContent = "error";
          break;
        case "trace": {
          const ev = msg.event || {};
          const label = ev.type || "trace";
          const summary = label.replace("action.", "action ").replace("deck.", "deck ");
          addBubble("trace", "• " + summary, {
            middle: true,
            collapsible: true,
            details: formatPayload(ev),
          });
          if (ev.type === "event" && typeof ev.name === "string" && ev.name.startsWith("suspense.")) {
            streamMode = "suspense";
          }
          break;
        }
        default:
          addBubble("system", JSON.stringify(msg));
      }
    }

    function connect() {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => { status.textContent = "connected"; };
      ws.onclose = () => { status.textContent = "closed"; currentAssistant = null; suspenseBubble = null; streamMode = "assistant"; };
      ws.onerror = () => { status.textContent = "error"; };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          handleMessage(msg);
        } catch {
          addBubble("system", String(ev.data));
        }
      };
    }

    connect();

    composer.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        addBubble("system", "Socket not connected.");
        return;
      }
      let val = input.value;
      if (asJson.checked) {
        try { val = JSON.parse(val); } catch (err) { addBubble("error", "JSON parse error: " + err); return; }
      }
      const display = asJson.checked ? formatPayload(val) : String(val);
      addBubble("user", display);
      currentAssistant = null;
      suspenseBubble = null;
      streamMode = "assistant";
      ws.send(JSON.stringify({ type: "run", input: val, stream: true, trace: true }));
      status.textContent = "sent";
      input.value = "";
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        btn.click();
      }
    });
  </script>
</body>
</html>`;
}
