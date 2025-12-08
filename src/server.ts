import { runDeck } from "./runtime.ts";
import { makeConsoleTracer } from "./trace.ts";
import type { SavedState } from "./state.ts";
import type { ModelProvider, TraceEvent } from "./types.ts";

type IncomingMessage =
  | {
    type: "run";
    input?: unknown;
    message?: unknown;
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
      let savedState: SavedState | undefined;

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
        const initialUserMessage = msg.message ??
          (savedState ? msg.input : undefined);
        if (opts.verbose) {
          console.log(
            `[sim] starting run runId=${
              savedState?.runId ?? "(new)"
            } messages=${
              savedState?.messages?.length ?? 0
            } stream=${stream}`,
          );
        }

        try {
          const result = await runDeck({
            path: opts.deckPath,
            input: msg.input,
            inputProvided: msg.input !== undefined,
            modelProvider: opts.modelProvider,
            isRoot: true,
            defaultModel: msg.model ?? opts.model,
            modelOverride: msg.modelForce ?? opts.modelForce,
            trace: tracer,
            stream,
            state: savedState,
            onStateUpdate: (state) => {
              savedState = state;
            },
            initialUserMessage,
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
    .shell { max-width: 1080px; margin: 24px auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .card { background: white; border-radius: 16px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); padding: 16px; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    header h1 { margin: 0; font-size: 20px; }
    header .meta { font-size: 12px; color: #475569; }
    .layout { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; }
    .panel-title { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 14px; color: #1f2937; margin-bottom: 6px; }
    .transcript { background: #f5f7fb; border-radius: 14px; padding: 12px; height: 400px; overflow-y: auto; border: 1px solid #e2e8f0; }
    .events { background: #f8fafc; border-radius: 14px; padding: 0; height: 400px; overflow-y: auto; border: 1px solid #e2e8f0; }
    .event-row { display: grid; grid-template-columns: 96px 1fr auto; align-items: start; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
    .event-row:last-child { border-bottom: none; }
    .event-type { font-weight: 700; text-transform: uppercase; font-size: 11px; color: #0f172a; }
    .event-type.assistant { color: #2563eb; }
    .event-type.user { color: #0ea5e9; }
    .event-type.trace { color: #475569; }
    .event-type.error { color: #b91c1c; }
    .event-type.system { color: #8a6d3b; }
    .event-type.suspense { color: #8a6d3b; }
    .event-summary { white-space: pre-wrap; color: #0f172a; }
    .event-actions { display: flex; gap: 8px; align-items: center; }
    .event-details { grid-column: 1 / -1; background: #eef2ff; border-radius: 10px; padding: 8px 10px; font-family: monospace; white-space: pre-wrap; margin: 0; border: 1px solid #cbd5e1; }
    .event-toggle { border: none; background: #e2e8f0; color: #334155; padding: 4px 8px; border-radius: 8px; cursor: pointer; font-size: 12px; }
    .event-toggle:hover { background: #cbd5e1; }
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
      <div class="layout">
        <div>
          <div class="panel-title">
            <span>Conversation</span>
          </div>
          <div id="transcript" class="transcript"></div>
        </div>
        <div>
          <div class="panel-title">
            <span>Traces & Tools</span>
          </div>
          <div id="events" class="events"></div>
        </div>
      </div>
      <form id="composer">
        <textarea id="input" placeholder='Type a user message, or toggle init input below.'></textarea>
        <div class="controls">
          <label><input type="checkbox" id="asJson" /> init input</label>
          <button type="submit" id="send">Send</button>
        </div>
      </form>
    </div>
  </div>
  <script>
    const transcript = document.getElementById("transcript");
    const events = document.getElementById("events");
    const status = document.getElementById("status");
    const input = document.getElementById("input");
    const asJson = document.getElementById("asJson");
    const composer = document.getElementById("composer");
    const btn = document.getElementById("send");
    let currentAssistant = null;
    let suspenseBubble = null;
    let streamMode = "assistant";
    let logAssistant = null;
    let logSuspense = null;
    let waitingForAssistant = false;
    let waitStartedAt = 0;
    let waitTicker = null;
    let waitingForNextAssistant = false;
    let nextAssistantWaitStartedAt = 0;
    let nextAssistantTicker = null;
    let firstSend = true;

    const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/websocket";
    let ws = null;

    function scrollBottom(el) {
      el.scrollTop = el.scrollHeight;
    }

    function addBubble(target, role, text, opts = {}) {
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
      target.appendChild(row);
      scrollBottom(target);
      return bubble;
    }

    function addEvent(role, text, opts = {}) {
      const row = document.createElement("div");
      row.className = "event-row";
      const depth = typeof opts.depth === "number" ? opts.depth : 0;
      if (depth > 0) {
        row.style.marginLeft = (depth * 16) + "px";
      }

      const type = document.createElement("div");
      type.className = "event-type " + role;
      type.textContent = role;

      const summary = document.createElement("div");
      summary.className = "event-summary";
      summary.textContent = text;

      row.appendChild(type);
      row.appendChild(summary);

      if (opts.details) {
        const actions = document.createElement("div");
        actions.className = "event-actions";
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "event-toggle";
        toggle.textContent = "Details";
        const details = document.createElement("pre");
        details.className = "event-details";
        details.textContent = opts.details;
        details.hidden = true;
        toggle.addEventListener("click", () => {
          details.hidden = !details.hidden;
          toggle.textContent = details.hidden ? "Details" : "Hide";
        });
        actions.appendChild(toggle);
        row.appendChild(actions);
        row.appendChild(details);
      } else {
        const spacer = document.createElement("div");
        spacer.className = "event-actions";
        row.appendChild(spacer);
      }

      events.appendChild(row);
      scrollBottom(events);
      return summary;
    }

    function formatPayload(p) {
      if (typeof p === "string") return p;
      try { return JSON.stringify(p, null, 2); } catch { return String(p); }
    }

    function formatDuration(ms) {
      return ms < 1000 ? String(Math.round(ms)) + "ms" : (ms / 1000).toFixed(2) + "s";
    }

    function updateWaitStatus() {
      if (!waitingForAssistant) return;
      const elapsed = performance.now() - waitStartedAt;
      status.textContent = "waiting " + formatDuration(elapsed);
    }

    function startWaitTimer() {
      waitStartedAt = performance.now();
      waitingForAssistant = true;
      if (waitTicker) clearInterval(waitTicker);
      updateWaitStatus();
      waitTicker = setInterval(updateWaitStatus, 250);
    }

    function stopWaitTimer(reason) {
      if (!waitingForAssistant) return;
      const elapsed = performance.now() - waitStartedAt;
      waitingForAssistant = false;
      if (waitTicker) {
        clearInterval(waitTicker);
        waitTicker = null;
      }
      status.textContent = "connected";
      const label = reason ?? "assistant reply";
      addEvent("system", label + " after " + formatDuration(elapsed));
    }

    function clearWaitTimer() {
      waitingForAssistant = false;
      if (waitTicker) {
        clearInterval(waitTicker);
        waitTicker = null;
      }
    }

    function updateNextAssistantStatus() {
      if (!waitingForNextAssistant) return;
      const elapsed = performance.now() - nextAssistantWaitStartedAt;
      status.textContent = "waiting next reply " + formatDuration(elapsed);
    }

    function startNextAssistantWait() {
      nextAssistantWaitStartedAt = performance.now();
      waitingForNextAssistant = true;
      if (nextAssistantTicker) clearInterval(nextAssistantTicker);
      updateNextAssistantStatus();
      nextAssistantTicker = setInterval(updateNextAssistantStatus, 250);
    }

    function stopNextAssistantWait(reason) {
      if (!waitingForNextAssistant) return;
      const elapsed = performance.now() - nextAssistantWaitStartedAt;
      waitingForNextAssistant = false;
      if (nextAssistantTicker) {
        clearInterval(nextAssistantTicker);
        nextAssistantTicker = null;
      }
      if (!waitingForAssistant) status.textContent = "connected";
      const label = reason ?? "next reply";
      addEvent("system", label + " after " + formatDuration(elapsed));
    }

    function clearNextAssistantWait() {
      waitingForNextAssistant = false;
      if (nextAssistantTicker) {
        clearInterval(nextAssistantTicker);
        nextAssistantTicker = null;
      }
    }

    function summarizeTrace(ev) {
      if (!ev || typeof ev !== "object") return "trace";
      const name = typeof ev.name === "string" ? ev.name : undefined;
      switch (ev.type) {
        case "model.call": {
          const msgs = ev.messageCount ?? (ev.messages?.length ?? "?");
          const tools = ev.toolCount ?? (ev.tools?.length ?? 0);
          const stream = ev.stream ? "stream" : "no-stream";
          return "model.call " + (ev.model ?? "(default)") +
            " · msgs=" + msgs + " tools=" + tools + " · " + stream;
        }
        case "model.result": {
          const toolCalls = ev.toolCalls?.length ?? 0;
          const finish = ev.finishReason ?? "?";
          return "model.result " + (ev.model ?? "(default)") +
            " · finish=" + finish + " · toolCalls=" + toolCalls;
        }
        default: {
          const label = String(ev.type || "trace");
          const pretty = label.replace("action.", "action ").replace("deck.", "deck ");
          return "• " + (name ? (pretty + " (" + name + ")") : pretty);
        }
      }
    }

    const traceParents = new Map();

    function recordTraceParent(ev) {
      const id = ev?.actionCallId;
      if (!id) return;
      if (!traceParents.has(id)) {
        traceParents.set(id, ev.parentActionCallId ?? null);
      }
    }

    function traceDepth(ev) {
      const id = ev?.actionCallId;
      if (!id) return 0;
      let depth = 0;
      let current = id;
      const seen = new Set();
      while (traceParents.has(current)) {
        const parent = traceParents.get(current);
        if (!parent) break;
        depth++;
        if (seen.has(parent)) break;
        seen.add(parent);
        current = parent;
      }
      return depth;
    }

    function handleMessage(msg) {
      switch (msg.type) {
        case "ready":
          status.textContent = "ready";
          addEvent("system", "Server ready.");
          break;
        case "pong":
          status.textContent = "pong";
          break;
        case "stream": {
          const chunk = msg.chunk ?? "";
          const target = streamMode === "suspense" ? "suspense" : "assistant";
          if (waitingForAssistant) stopWaitTimer("first token");
          if (waitingForNextAssistant) stopNextAssistantWait("next reply");
          if (target === "suspense") {
            if (!suspenseBubble) suspenseBubble = addBubble(transcript, "suspense", "");
            suspenseBubble.textContent += chunk;
            if (!logSuspense) logSuspense = addEvent("suspense", "");
            logSuspense.textContent += chunk;
          } else {
            if (!currentAssistant) currentAssistant = addBubble(transcript, "assistant", "");
            currentAssistant.textContent += chunk;
            if (!logAssistant) logAssistant = addEvent("assistant", "");
            logAssistant.textContent += chunk;
          }
          scrollBottom(transcript);
          scrollBottom(events);
          break;
        }
        case "result": {
          if (waitingForAssistant) stopWaitTimer("result");
          if (waitingForNextAssistant) stopNextAssistantWait("next reply");
          const content = formatPayload(msg.result);
          if (!currentAssistant) {
            addBubble(transcript, "assistant", content);
          } else if (!currentAssistant.textContent.trim()) {
            currentAssistant.textContent = content;
          }
          if (!logAssistant) {
            addEvent("assistant", content);
          } else if (!logAssistant.textContent.trim()) {
            logAssistant.textContent = content;
          }
          currentAssistant = null;
          suspenseBubble = null;
          streamMode = "assistant";
          logAssistant = null;
          logSuspense = null;
          status.textContent = "connected";
          break;
        }
        case "error":
          if (waitingForAssistant) stopWaitTimer("error");
          if (waitingForNextAssistant) stopNextAssistantWait("error");
          addBubble(events, "error", "Error: " + (msg.message ?? "unknown"));
          currentAssistant = null;
          suspenseBubble = null;
          streamMode = "assistant";
          status.textContent = "error";
          break;
        case "trace": {
          const ev = msg.event || {};
          if (ev.type === "model.call") {
            currentAssistant = null;
            logAssistant = null;
            suspenseBubble = null;
            logSuspense = null;
            streamMode = "assistant";
          }
          const summary = summarizeTrace(ev);
          recordTraceParent(ev);
          const depth = traceDepth(ev);
          addEvent("trace", summary, { collapsible: true, details: formatPayload(ev), depth });
          if (ev.type === "model.result" && ev.finishReason === "tool_calls") {
            startNextAssistantWait();
          }
          break;
        }
        default:
          addEvent("system", JSON.stringify(msg));
      }
    }

    function connect() {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => { status.textContent = "connected"; };
      ws.onclose = () => { status.textContent = "closed"; currentAssistant = null; suspenseBubble = null; streamMode = "assistant"; clearWaitTimer(); clearNextAssistantWait(); };
      ws.onerror = () => { status.textContent = "error"; clearWaitTimer(); clearNextAssistantWait(); };
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
      const isFirst = firstSend;

      if (isFirst && !asJson.checked && String(val).trim() === "") {
        // Assistant-first kickoff with no user turn or deck input.
        currentAssistant = null;
        suspenseBubble = null;
        logAssistant = null;
        logSuspense = null;
        streamMode = "assistant";
        clearNextAssistantWait();
        ws.send(JSON.stringify({ type: "run", stream: true, trace: true }));
        firstSend = false;
        startWaitTimer();
        input.value = "";
        return;
      }

      const display = asJson.checked ? formatPayload(val) : String(val);
      const sendAsInput = asJson.checked;
      addBubble(transcript, "user", display);
      addEvent("user", display);
      currentAssistant = null;
      suspenseBubble = null;
      logAssistant = null;
      logSuspense = null;
      streamMode = "assistant";
      clearNextAssistantWait();
      const payload = sendAsInput
        ? { type: "run", input: val, stream: true, trace: true }
        : { type: "run", message: val, stream: true, trace: true };
      ws.send(JSON.stringify(payload));
      firstSend = false;
      startWaitTimer();
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
