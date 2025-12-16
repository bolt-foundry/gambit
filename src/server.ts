import { runDeck } from "./runtime.ts";
import { makeConsoleTracer } from "./trace.ts";
import { loadDeck } from "./loader.ts";
import type { SavedState } from "./state.ts";
import type { ModelProvider, TraceEvent } from "./types.ts";
import type { ZodTypeAny } from "zod";

const logger = console;

type IncomingMessage =
  | {
    type: "run";
    input?: unknown;
    message?: unknown;
    stream?: boolean;
    model?: string;
    modelForce?: string;
    trace?: boolean;
    resetState?: boolean;
  }
  | { type: "ping" };

type NormalizedSchema = {
  kind:
    | "string"
    | "number"
    | "boolean"
    | "enum"
    | "object"
    | "array"
    | "unknown";
  optional: boolean;
  description?: string;
  example?: unknown;
  defaultValue?: unknown;
  enumValues?: Array<unknown>;
  fields?: Record<string, NormalizedSchema>;
  items?: NormalizedSchema;
};

type SchemaDescription = {
  schema?: NormalizedSchema;
  defaults?: unknown;
  error?: string;
};

type OutgoingMessage =
  | {
    type: "ready";
    deck: string;
    port: number;
    schema?: NormalizedSchema;
    defaults?: unknown;
    schemaError?: string;
  }
  | { type: "pong" }
  | { type: "stream"; chunk: string; runId?: string }
  | { type: "result"; result: unknown; runId?: string; streamed: boolean }
  | { type: "trace"; event: TraceEvent }
  | { type: "state"; state: SavedState }
  | { type: "error"; message: string; runId?: string };

function resolveDefaultValue(raw: unknown): unknown {
  if (typeof raw === "function") {
    try {
      return raw();
    } catch {
      return undefined;
    }
  }
  return raw;
}

function describeZodSchema(schema?: ZodTypeAny): SchemaDescription {
  try {
    const normalized = normalizeSchema(schema);
    const defaults = normalized ? materializeDefaults(normalized) : undefined;
    return { schema: normalized, defaults };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

function normalizeSchema(schema?: ZodTypeAny): NormalizedSchema | undefined {
  if (!schema) return undefined;
  const unwrapped = unwrapSchema(schema);
  const core = unwrapped.schema;
  if (!core || typeof core !== "object") return undefined;
  const meta = {
    optional: unwrapped.optional,
    description: readDescription(schema) ?? readDescription(core),
    example: readExample(schema) ?? readExample(core),
    defaultValue: unwrapped.defaultValue,
  };
  const typeName = (core as { _def?: { typeName?: string } })._def?.typeName;
  switch (typeName) {
    case "ZodString":
      return { kind: "string", ...meta };
    case "ZodNumber":
      return { kind: "number", ...meta };
    case "ZodBoolean":
      return { kind: "boolean", ...meta };
    case "ZodEnum": {
      const values = (core as { _def: { values: Array<unknown> } })._def.values;
      return { kind: "enum", enumValues: [...values], ...meta };
    }
    case "ZodNativeEnum": {
      const values =
        (core as { _def: { values: Record<string, unknown> } })._def
          .values;
      return { kind: "enum", enumValues: Object.values(values), ...meta };
    }
    case "ZodLiteral": {
      const value = (core as { _def: { value: unknown } })._def.value;
      const defaultValue = meta.defaultValue !== undefined
        ? meta.defaultValue
        : value;
      const { defaultValue: _m, ...restMeta } = meta;
      return {
        kind: "enum",
        enumValues: [value],
        ...restMeta,
        defaultValue,
      };
    }
    case "ZodArray": {
      const items = (core as { _def: { type: ZodTypeAny } })._def.type;
      return {
        kind: "array",
        items: normalizeSchema(items),
        ...meta,
      };
    }
    case "ZodObject": {
      const fields: Record<string, NormalizedSchema> = {};
      const shape =
        (core as { _def: { shape: () => Record<string, ZodTypeAny> } })
          ._def.shape();
      for (const [key, child] of Object.entries(shape)) {
        const normalized = normalizeSchema(child as ZodTypeAny);
        if (normalized) fields[key] = normalized;
      }
      return { kind: "object", fields, ...meta };
    }
    default:
      return { kind: "unknown", ...meta };
  }
}

function unwrapSchema(schema: ZodTypeAny): {
  schema: ZodTypeAny;
  optional: boolean;
  defaultValue?: unknown;
} {
  let current: ZodTypeAny = schema;
  let optional = false;
  let defaultValue: unknown;

  while (current && typeof current === "object") {
    const def =
      (current as { _def?: { typeName?: string; [k: string]: unknown } })
        ._def;
    const typeName = def?.typeName;
    if (typeName === "ZodOptional" || typeName === "ZodNullable") {
      optional = true;
      current = (def as { innerType: ZodTypeAny }).innerType;
      continue;
    }
    if (typeName === "ZodDefault") {
      if (defaultValue === undefined) {
        defaultValue = resolveDefaultValue(
          (def as { defaultValue: unknown }).defaultValue,
        );
      }
      current = (def as { innerType: ZodTypeAny }).innerType;
      continue;
    }
    if (typeName === "ZodEffects") {
      current = (def as { schema: ZodTypeAny }).schema;
      continue;
    }
    if (typeName === "ZodCatch") {
      current = (def as { innerType: ZodTypeAny }).innerType;
      continue;
    }
    if (typeName === "ZodBranded") {
      current = (def as { type: ZodTypeAny }).type;
      continue;
    }
    break;
  }

  return { schema: current, optional, defaultValue };
}

function readDescription(schema?: ZodTypeAny): string | undefined {
  const def = schema && typeof schema === "object"
    ? (schema as { _def?: { description?: unknown } })._def
    : undefined;
  return typeof def?.description === "string" ? def.description : undefined;
}

function readExample(schema?: ZodTypeAny): unknown {
  const def = schema && typeof schema === "object"
    ? (schema as { _def?: Record<string, unknown> })._def
    : undefined;
  if (!def) return undefined;
  const direct = def.example ?? def.examples;
  if (direct !== undefined) return direct;
  const openapi = (def as { openapi?: { example?: unknown } }).openapi;
  if (openapi?.example !== undefined) return openapi.example;
  return undefined;
}

function cloneValue<T>(value: T): T {
  try {
    // @ts-ignore structuredClone is available in Deno
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

function materializeDefaults(schema?: NormalizedSchema): unknown {
  if (!schema) return undefined;
  if (schema.defaultValue !== undefined) return cloneValue(schema.defaultValue);
  if (schema.example !== undefined) return cloneValue(schema.example);

  switch (schema.kind) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.fields ?? {})) {
        const value = materializeDefaults(child);
        if (value !== undefined) out[key] = value;
      }
      return Object.keys(out).length ? out : undefined;
    }
    case "array": {
      if (schema.items) {
        const item = materializeDefaults(schema.items);
        if (item !== undefined) return [item];
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

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
  let resolvedDeckPath = opts.deckPath;
  const schemaPromise: Promise<SchemaDescription> = loadDeck(opts.deckPath)
    .then((deck) => {
      resolvedDeckPath = deck.path;
      return describeZodSchema(deck.inputSchema);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[sim] failed to load deck schema: ${message}`);
      return { error: message };
    });

  const server = Deno.serve(
    { port, signal: opts.signal, onListen: () => {} },
    async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        return new Response(simulatorHtml(opts.deckPath), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/schema") {
        const desc = await schemaPromise;
        return new Response(
          JSON.stringify({
            deck: resolvedDeckPath,
            ...desc,
          }),
          {
            headers: { "content-type": "application/json; charset=utf-8" },
          },
        );
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
        schemaPromise.then((desc) => {
          safeSend({
            type: "ready",
            deck: resolvedDeckPath,
            port: listenPort,
            schema: desc.schema,
            defaults: desc.defaults,
            schemaError: desc.error,
          });
        }).catch(() => {
          safeSend({ type: "ready", deck: resolvedDeckPath, port: listenPort });
        });
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

        if (msg.resetState) {
          savedState = undefined;
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
          logger.log(
            `[sim] starting run runId=${
              savedState?.runId ?? "(new)"
            } messages=${savedState?.messages?.length ?? 0} stream=${stream}`,
          );
        }

        try {
          const result = await runDeck({
            path: opts.deckPath,
            input: msg.input,
            inputProvided: msg.input !== undefined,
            modelProvider: opts.modelProvider,
            isRoot: true,
            allowRootStringInput: true,
            defaultModel: msg.model ?? opts.model,
            modelOverride: msg.modelForce ?? opts.modelForce,
            trace: tracer,
            stream,
            state: savedState,
            onStateUpdate: (state) => {
              savedState = state;
              safeSend({ type: "state", state });
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
  logger.log(
    `WebSocket simulator listening on ws://localhost:${listenPort}/websocket (deck=${resolvedDeckPath})`,
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
    .header-actions { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
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
    .event-type.monolog { color: #475569; }
    .event-type.error { color: #b91c1c; }
    .event-type.system { color: #8a6d3b; }
    .event-type.status { color: #8a6d3b; }
    .event-type.handler { color: #0f766e; }
    .event-summary { white-space: pre-wrap; color: #0f172a; }
    .event-actions { display: flex; gap: 8px; align-items: center; }
    .event-details { grid-column: 1 / -1; background: #eef2ff; border-radius: 10px; padding: 8px 10px; font-family: monospace; white-space: pre-wrap; margin: 0; border: 1px solid #cbd5e1; }
    .event-toggle { border: none; background: #e2e8f0; color: #334155; padding: 4px 8px; border-radius: 8px; cursor: pointer; font-size: 12px; }
    .event-toggle:hover { background: #cbd5e1; }
    .row { display: flex; margin: 6px 0; }
    .row.user { justify-content: flex-end; }
    .row.assistant, .row.trace, .row.system, .row.error, .row.handler, .row.status { justify-content: flex-start; }
    .row.meta { justify-content: center; }
    .bubble { max-width: 70%; padding: 10px 12px; border-radius: 16px; line-height: 1.4; white-space: pre-wrap; position: relative; }
    .bubble.user { background: #0b93f6; color: white; border-bottom-right-radius: 4px; }
    .bubble.assistant { background: #e5e5ea; color: #111; border-bottom-left-radius: 4px; }
    .bubble.system { background: #fff3cd; color: #8a6d3b; border-bottom-left-radius: 4px; }
    .bubble.status { background: #fff3cd; color: #8a6d3b; border-bottom-left-radius: 4px; }
    .bubble.handler { background: #d1fae5; color: #065f46; border-bottom-left-radius: 4px; }
    .bubble.trace, .bubble.meta, .bubble.monolog { background: #e2e8f0; color: #475569; border-bottom-left-radius: 4px; border-bottom-right-radius: 4px; }
    .bubble.error { background: #fee2e2; color: #b91c1c; border-bottom-left-radius: 4px; }
    .bubble.collapsible { cursor: pointer; }
    .bubble .details { display: none; margin-top: 6px; padding-top: 6px; border-top: 1px solid #cbd5e1; font-size: 12px; white-space: pre-wrap; }
    .bubble.open .details { display: block; }
    .bubble .chevron { position: absolute; right: 10px; top: 10px; font-size: 12px; color: #94a3b8; }
    form.composer { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; }
    .controls { display: flex; align-items: center; gap: 8px; justify-content: space-between; flex-wrap: wrap; }
    button { padding: 10px 14px; border: none; border-radius: 10px; background: #0b93f6; color: white; cursor: pointer; font-weight: 600; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .ghost-btn { background: white; color: #0f172a; border: 1px solid #cbd5e1; }
    .ghost-btn:hover:not(:disabled) { background: #f8fafc; }
    label { font-size: 13px; color: #475569; display: inline-flex; align-items: center; gap: 4px; }
    .mode-switch { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .tabs { display: inline-flex; gap: 6px; align-items: center; }
    .tab { padding: 8px 10px; border-radius: 10px; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; cursor: pointer; }
    .tab.active { background: #0b93f6; color: white; border-color: #0b93f6; }
    .panel { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; background: #f8fafc; }
    .field-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .field { display: flex; flex-direction: column; gap: 6px; background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; }
    .field label { font-weight: 600; color: #111827; }
    .field .label-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .field small { color: #475569; font-weight: 500; }
    .badge { padding: 2px 8px; border-radius: 999px; background: #e2e8f0; color: #475569; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .input-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px; width: 100%; }
    textarea.input-box { min-height: 72px; resize: vertical; font-family: monospace; }
    textarea.json-input, textarea.message-input { width: 100%; min-height: 120px; border-radius: 10px; border: 1px solid #cbd5e1; padding: 10px; font-family: monospace; resize: vertical; background: white; }
    .hint { color: #475569; font-size: 12px; }
    .inline-actions { display: inline-flex; align-items: center; gap: 10px; }
    .input-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .reset-note { color: #b45309; font-size: 12px; }
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
        <div class="header-actions">
          <button type="button" id="downloadState" class="ghost-btn" disabled>Download state</button>
          <button type="button" id="reconnect" class="ghost-btn">Reconnect</button>
          <div id="status">connecting...</div>
        </div>
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
      <form id="composer" class="composer">
        <div class="panel">
          <div class="panel-title">User message</div>
          <textarea id="messageInput" class="message-input" placeholder="Send a user message to the assistant"></textarea>
          <div class="hint" id="modeHint">Send runs init (if provided) first, then this message in the same run.</div>
        </div>
        <div id="initPanel" class="panel" hidden>
          <div class="panel-title">Init input (from schema)</div>
          <div class="tabs">
            <button type="button" data-tab="form" class="tab active">Form</button>
            <button type="button" data-tab="json" class="tab">Raw JSON</button>
          </div>
          <div id="formTab">
            <div id="formContainer" class="field-grid"></div>
            <div class="hint" id="formHint">Fields are generated from the deck input schema.</div>
          </div>
          <div id="jsonTab" hidden>
            <textarea id="jsonInput" class="json-input" placeholder='Enter JSON payload for init input'></textarea>
            <div class="hint">Switch back to the form to edit by field. JSON edits will be preserved.</div>
          </div>
        </div>
        <div class="controls">
          <div class="inline-actions">
            <label><input type="checkbox" id="traceToggle" checked /> Trace</label>
            <label><input type="checkbox" id="streamToggle" checked /> Stream</label>
            <label id="resetStateRow" hidden><input type="checkbox" id="resetState" /> Start new run (clear saved state)</label>
          </div>
          <div class="input-row">
            <button type="submit" id="send">Send</button>
          </div>
        </div>
      </form>
    </div>
  </div>
  <script>
    (function() {
      const transcript = document.getElementById("transcript");
      const events = document.getElementById("events");
      const status = document.getElementById("status");
      const downloadBtn = document.getElementById("downloadState");
      const reconnectBtn = document.getElementById("reconnect");
      const composer = document.getElementById("composer");
      const btn = document.getElementById("send");
      const modeHint = document.getElementById("modeHint");
      const formContainer = document.getElementById("formContainer");
      const jsonInput = document.getElementById("jsonInput");
      const messageInput = document.getElementById("messageInput");
      const formTab = document.getElementById("formTab");
      const jsonTab = document.getElementById("jsonTab");
      const initPanel = document.getElementById("initPanel");
      const tabButtons = Array.from(document.querySelectorAll("[data-tab]"));
      const traceToggle = document.getElementById("traceToggle");
      const streamToggle = document.getElementById("streamToggle");
      const resetState = document.getElementById("resetState");
      const resetStateRow = document.getElementById("resetStateRow");
      let currentAssistant = null;
      let statusBubble = null;
      let streamMode = "assistant"; // assistant | status | handler
      let logAssistant = null;
      let logStatus = null;
      let waitingForAssistant = false;
      let waitStartedAt = 0;
      let waitTicker = null;
      let waitingForNextAssistant = false;
      let nextAssistantWaitStartedAt = 0;
      let nextAssistantTicker = null;
      let latestState = null;
      let schemaShape = null;
      let formState = undefined;
      let formTouched = false;
      let jsonDirty = false;
      let activeTab = "form";
      let connectionAttempt = 0;
      const traceParents = new Map();

      const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/websocket";
      let ws = null;

      function scrollBottom(el) {
        el.scrollTop = el.scrollHeight;
      }

      function updateDownloadState(state) {
        latestState = state && typeof state === "object"
          ? JSON.parse(JSON.stringify(state))
          : null;
        downloadBtn.disabled = !latestState;
        resetStateRow.hidden = !latestState;
        if (!latestState) {
          downloadBtn.textContent = "Download state";
          resetState.checked = false;
        } else {
          const runId = typeof latestState.runId === "string"
            ? latestState.runId
            : "session";
          const short = runId.length > 8 ? runId.slice(0, 8) + "..." : runId;
          downloadBtn.textContent = "Download state (" + short + ")";
        }
        updateModeHint();
      }

      downloadBtn.addEventListener("click", () => {
        if (!latestState) return;
        const json = JSON.stringify(latestState, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const runId = String(latestState.runId || "session").replace(/[^a-zA-Z0-9._-]/g, "_");
        a.href = url;
        a.download = "gambit_state_" + runId + ".json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
      });

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
          case "log": {
            const summary = ev.title ?? ev.message ?? "";
            return "log - " + summary;
          }
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
          case "monolog": {
            const text = (() => {
              if (typeof ev.content === "string") return ev.content;
              try { return JSON.stringify(ev.content); } catch { return String(ev.content); }
            })();
            const snippet = text.length > 120 ? text.slice(0, 117) + "..." : text;
            return "monolog · " + snippet;
          }
          default: {
            const label = String(ev.type || "trace");
            const pretty = label.replace("action.", "action ").replace("deck.", "deck ");
            return "• " + (name ? (pretty + " (" + name + ")") : pretty);
          }
        }
      }

      function traceRole(ev) {
        if (!ev || typeof ev !== "object") return "trace";
        if (ev.type === "monolog") return "monolog";
        const name = typeof ev.name === "string" ? ev.name : undefined;
        const deckPath = typeof ev.deckPath === "string" ? ev.deckPath : undefined;
        const isHandlerDeck = deckPath && deckPath.includes("/handlers/");
        if (
          isHandlerDeck ||
          name === "gambit_respond" ||
          name === "gambit_complete"
        ) {
          return "handler";
        }
        return "trace";
      }

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

      function formatTraceEvent(ev) {
        const hook = typeof window.gambitFormatTrace === "function"
          ? window.gambitFormatTrace(ev)
          : undefined;
        if (hook) {
          if (typeof hook === "string") {
            return { role: "trace", summary: hook, details: formatPayload(ev) };
          }
          return {
            role: hook.role || hook.type || "trace",
            summary: hook.summary || hook.text || "trace",
            details: hook.details || (hook.includeRaw ? formatPayload(ev) : undefined) || formatPayload(ev),
            depth: typeof hook.depth === "number" ? hook.depth : traceDepth(ev),
          };
        }
        return {
          role: traceRole(ev),
          summary: summarizeTrace(ev),
          details: formatPayload(ev),
          depth: traceDepth(ev),
        };
      }

      function cloneValue(value) {
        try { return structuredClone(value); } catch { try { return JSON.parse(JSON.stringify(value)); } catch { return value; } }
      }

      function deriveInitialFromSchema(schema, defaults) {
        if (defaults !== undefined) return cloneValue(defaults);
        if (!schema) return undefined;
        if (schema.defaultValue !== undefined) return cloneValue(schema.defaultValue);
        if (schema.example !== undefined) return cloneValue(schema.example);
        if (schema.kind === "object") {
          const obj = {};
          for (const [key, child] of Object.entries(schema.fields || {})) {
            const val = deriveInitialFromSchema(child);
            if (val !== undefined) obj[key] = val;
          }
          return Object.keys(obj).length ? obj : {};
        }
        if (schema.kind === "array" && schema.items) {
          const item = deriveInitialFromSchema(schema.items);
          return item !== undefined ? [item] : [];
        }
        return undefined;
      }

      function getPathValue(path) {
        let node = formState;
        for (const key of path) {
          if (node === undefined || node === null) return undefined;
          if (typeof node !== "object") return undefined;
          node = node[key];
        }
        return node;
      }

      function setPathValue(path, value, optional) {
        if (path.length === 0) {
          formState = value;
          return;
        }
        if (!formState || typeof formState !== "object") {
          formState = {};
        }
        let target = formState;
        for (let i = 0; i < path.length - 1; i++) {
          const key = path[i];
          if (typeof target[key] !== "object" || target[key] === null) {
            target[key] = {};
          }
          target = target[key];
        }
        const last = path[path.length - 1];
        if (optional && (value === undefined || value === "")) {
          delete target[last];
        } else {
          target[last] = value;
        }
      }

      function renderSchemaForm() {
        formContainer.innerHTML = "";
        if (!schemaShape) {
          const placeholder = document.createElement("div");
          placeholder.className = "hint";
          placeholder.textContent = "Waiting for schema... you can still paste JSON.";
          formContainer.appendChild(placeholder);
          return;
        }
        const root = renderField("Input", schemaShape, [], formState);
        formContainer.appendChild(root);
      }

      function renderField(labelText, schema, path, value) {
        if (schema.kind === "object" && schema.fields) {
          const wrapper = document.createElement("div");
          wrapper.className = "field";
          const labelRow = document.createElement("div");
          labelRow.className = "label-row";
          const lbl = document.createElement("label");
          lbl.textContent = labelText;
          labelRow.appendChild(lbl);
          const badge = document.createElement("span");
          badge.className = "badge";
          badge.textContent = schema.optional ? "optional" : "required";
          labelRow.appendChild(badge);
          wrapper.appendChild(labelRow);
          if (schema.description) {
            const desc = document.createElement("small");
            desc.textContent = schema.description;
            wrapper.appendChild(desc);
          }
          const grid = document.createElement("div");
          grid.className = "field-grid";
          for (const [key, child] of Object.entries(schema.fields)) {
            const childValue = value && typeof value === "object" ? value[key] : undefined;
            const childNode = renderField(key, child, [...path, key], childValue);
            grid.appendChild(childNode);
          }
          wrapper.appendChild(grid);
          return wrapper;
        }

        const field = document.createElement("div");
        field.className = "field";
        const labelRow = document.createElement("div");
        labelRow.className = "label-row";
        const lbl = document.createElement("label");
        lbl.textContent = labelText;
        labelRow.appendChild(lbl);
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = schema.optional ? "optional" : "required";
        labelRow.appendChild(badge);
        field.appendChild(labelRow);
        if (schema.description) {
          const desc = document.createElement("small");
          desc.textContent = schema.description;
          field.appendChild(desc);
        }
        const initial = value !== undefined ? value : deriveInitialFromSchema(schema);
        const setDirty = () => { formTouched = true; if (!jsonDirty) jsonInput.value = safeStringify(formState); };

        if (schema.kind === "string" || schema.kind === "unknown") {
          const input = document.createElement("input");
          input.className = "input-box";
          input.type = "text";
          if (initial !== undefined) input.value = String(initial);
          if (!schema.optional && !initial) input.placeholder = "required";
          input.addEventListener("input", () => {
            const val = input.value;
            setPathValue(path, val === "" && schema.optional ? undefined : val, schema.optional);
            setDirty();
          });
          field.appendChild(input);
        } else if (schema.kind === "number") {
          const input = document.createElement("input");
          input.className = "input-box";
          input.type = "number";
          if (typeof initial === "number") input.value = String(initial);
          input.addEventListener("input", () => {
            const raw = input.value;
            if (raw === "" && schema.optional) {
              setPathValue(path, undefined, true);
            } else {
              const parsed = Number(raw);
              if (!Number.isNaN(parsed)) {
                setPathValue(path, parsed, schema.optional);
              }
            }
            setDirty();
          });
          field.appendChild(input);
        } else if (schema.kind === "boolean") {
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = Boolean(initial);
          checkbox.addEventListener("change", () => {
            setPathValue(path, checkbox.checked, schema.optional);
            setDirty();
          });
          const row = document.createElement("div");
          row.className = "input-row";
          row.appendChild(checkbox);
          const txt = document.createElement("span");
          txt.textContent = "True / False";
          row.appendChild(txt);
          field.appendChild(row);
        } else if (schema.kind === "enum" && Array.isArray(schema.enumValues)) {
          const select = document.createElement("select");
          select.className = "input-box";
          const placeholder = document.createElement("option");
          placeholder.value = "";
          placeholder.textContent = schema.optional ? "— optional —" : "Select a value";
          select.appendChild(placeholder);
          for (const val of schema.enumValues) {
            const opt = document.createElement("option");
            opt.value = String(val);
            opt.textContent = String(val);
            select.appendChild(opt);
          }
          if (initial !== undefined) select.value = String(initial);
          select.addEventListener("change", () => {
            const raw = select.value;
            const chosen = raw === "" && schema.optional ? undefined : raw;
            setPathValue(path, chosen, schema.optional);
            setDirty();
          });
          field.appendChild(select);
        } else {
          const area = document.createElement("textarea");
          area.className = "input-box";
          area.placeholder = "Enter JSON";
          area.value = initial !== undefined ? safeStringify(initial) : "";
          area.addEventListener("input", () => {
            try {
              const parsed = JSON.parse(area.value);
              setPathValue(path, parsed, schema.optional);
            } catch {
              // keep last good value
            }
            setDirty();
          });
          field.appendChild(area);
        }
        return field;
      }

      function safeStringify(value) {
        try { return JSON.stringify(value, null, 2); } catch { return String(value); }
      }

      function applySchemaPayload(payload) {
        if (payload.schemaError) {
          addEvent("error", "Schema error: " + payload.schemaError);
        }
        if (payload.schema) {
          schemaShape = payload.schema;
        }
        initPanel.hidden = !schemaShape;
        if (!schemaShape) return;
        if (!formTouched || formState === undefined) {
          formState = deriveInitialFromSchema(schemaShape, payload.defaults);
          jsonDirty = false;
        }
        renderSchemaForm();
        if (!jsonDirty) {
          jsonInput.value = safeStringify(formState ?? {});
        }
        // First time we load schema, keep form pristine.
        formTouched = false;
        updateModeHint();
      }

      async function fetchSchema() {
        try {
          const res = await fetch("/schema");
          if (!res.ok) throw new Error(res.status + " " + res.statusText);
          const body = await res.json();
          applySchemaPayload(body);
        } catch (err) {
          addEvent("error", "Failed to fetch schema: " + err);
        }
      }

      function updateModeHint() {
        if (initPanel.hidden) {
          modeHint.textContent = "Deck has no input schema; only user messages will be sent.";
          return;
        }
        if (latestState) {
          modeHint.textContent = "State loaded; init payloads are treated as user messages unless you start a new run.";
        } else {
          modeHint.textContent = "Send runs init first (from schema), then your message in the same run.";
        }
      }

      function handleMessage(msg) {
        switch (msg.type) {
          case "ready": {
            status.textContent = "ready";
            addEvent("system", "Server ready.");
            updateDownloadState(null);
            applySchemaPayload(msg);
            break;
          }
          case "pong":
            status.textContent = "pong";
            break;
          case "stream": {
            const chunk = msg.chunk ?? "";
            const target = streamMode === "status" || streamMode === "handler"
              ? "status"
              : "assistant";
            if (waitingForAssistant) stopWaitTimer("first token");
            if (waitingForNextAssistant) stopNextAssistantWait("next reply");
            if (target === "status") {
              if (!statusBubble) statusBubble = addBubble(transcript, "status", "");
              statusBubble.textContent += chunk;
              if (!logStatus) logStatus = addEvent("status", "");
              logStatus.textContent += chunk;
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
            statusBubble = null;
            streamMode = "assistant";
            logAssistant = null;
            logStatus = null;
            status.textContent = "connected";
            break;
          }
          case "error":
            if (waitingForAssistant) stopWaitTimer("error");
            if (waitingForNextAssistant) stopNextAssistantWait("error");
            addBubble(events, "error", "Error: " + (msg.message ?? "unknown"));
            currentAssistant = null;
            statusBubble = null;
            logStatus = null;
            streamMode = "assistant";
            status.textContent = "error";
            break;
          case "state": {
            updateDownloadState(msg.state);
            break;
          }
          case "trace": {
            const ev = msg.event || {};
            if (ev.type === "model.call") {
              currentAssistant = null;
              logAssistant = null;
              statusBubble = null;
              logStatus = null;
              streamMode = "assistant";
            }
            recordTraceParent(ev);
            const formatted = formatTraceEvent(ev);
            if (formatted.role === "handler" && ev.type === "deck.start") {
              streamMode = "status";
              statusBubble = null;
              logStatus = null;
            } else if (formatted.role === "handler" && ev.type === "deck.end") {
              streamMode = "assistant";
              statusBubble = null;
            } else if (ev.type === "deck.start" || ev.type === "deck.end") {
              streamMode = "assistant";
            }
            addEvent(formatted.role, formatted.summary, {
              collapsible: true,
              details: formatted.details,
              depth: formatted.depth,
            });
            if (ev.type === "model.result" && ev.finishReason === "tool_calls") {
              startNextAssistantWait();
            }
            break;
          }
          default:
            addEvent("system", JSON.stringify(msg));
        }
      }

      function connect(reason = "connect") {
        connectionAttempt += 1;
        if (ws) {
          ws.close();
        }
        status.textContent = "connecting...";
        traceParents.clear();
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          status.textContent = "connected";
          addEvent("system", reason === "reconnect" ? "Reconnected." : "Connected.");
        };
        ws.onclose = () => {
          status.textContent = "closed";
          currentAssistant = null;
          statusBubble = null;
          logStatus = null;
          streamMode = "assistant";
          clearWaitTimer();
          clearNextAssistantWait();
          updateDownloadState(null);
        };
        ws.onerror = () => {
          status.textContent = "error";
          clearWaitTimer();
          clearNextAssistantWait();
          updateDownloadState(null);
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            handleMessage(msg);
          } catch {
            addEvent("system", String(ev.data));
          }
        };
      }

      updateModeHint();
      connect();
      fetchSchema();

      function switchTab(tab) {
        activeTab = tab;
        tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
        formTab.hidden = tab !== "form";
        jsonTab.hidden = tab !== "json";
        if (tab === "form" && jsonDirty) {
          try {
            const parsed = JSON.parse(jsonInput.value);
            formState = parsed;
            formTouched = false;
            jsonDirty = false;
            renderSchemaForm();
          } catch (err) {
            addEvent("error", "Invalid JSON: " + err);
          }
        }
      }

      tabButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          switchTab(btn.dataset.tab || "form");
        });
      });

      jsonInput.addEventListener("input", () => {
        jsonDirty = true;
      });

      reconnectBtn.addEventListener("click", () => {
        connect("reconnect");
      });

      composer.addEventListener("submit", (e) => {
        e.preventDefault();
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          addEvent("system", "Socket not connected.");
          return;
        }
        const shouldResetState = resetState.checked;
        const payload = {
          type: "run",
          stream: streamToggle.checked,
          trace: traceToggle.checked,
          resetState: shouldResetState,
        };

        const text = messageInput.value.trim();
        const hasMessage = text.length > 0;
        if (hasMessage) {
          payload.message = text;
        }

        const hasState = Boolean(latestState) && !shouldResetState;
        const includeInit = !hasState || formTouched || jsonDirty;
        let inputValue = undefined;
        if (!initPanel.hidden && includeInit) {
          try {
            inputValue = activeTab === "json"
              ? JSON.parse(jsonInput.value || "null")
              : formState;
          } catch (err) {
            addEvent("error", "JSON parse error: " + err);
            return;
          }
          payload.input = inputValue === undefined ? {} : inputValue;
        }

        if (hasMessage) {
          addBubble(transcript, "user", text);
          addEvent("user", text);
        } else if (payload.input === undefined) {
          addEvent("error", "Nothing to send. Provide init input or a message.");
          return;
        }

        if (payload.input !== undefined) {
          const display = formatPayload(payload.input);
          const role = hasState ? "user" : "system";
          const label = hasState ? display : "gambit_init " + display;
          addBubble(transcript, role, label);
          addEvent(role, label);
        }

        currentAssistant = null;
        statusBubble = null;
        logAssistant = null;
        logStatus = null;
        streamMode = "assistant";
        clearNextAssistantWait();
        ws.send(JSON.stringify(payload));
        if (shouldResetState) {
          updateDownloadState(null);
        }
        messageInput.value = "";
        startWaitTimer();
      });

      messageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          btn.click();
        }
      });
    })();
  </script>
</body>
</html>`;
}
