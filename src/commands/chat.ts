import * as path from "@std/path";
import {
  runDeckResponses,
  stringifyResponseOutput,
} from "@bolt-foundry/gambit-core";
import type {
  ModelMessage,
  ModelProvider,
  PermissionDeclarationInput,
  ResponseItem,
  SavedState,
  TraceEvent,
} from "@bolt-foundry/gambit-core";
import { parseContext } from "../cli_utils.ts";
import { makeJsonlTracer } from "../trace.ts";
import { enrichStateMeta } from "../cli_utils.ts";
import {
  loadCanonicalWorkspaceState,
  saveCanonicalWorkspaceState,
} from "../workspace_sqlite.ts";
import {
  loadRuntimeTools,
  type RuntimeToolBinding,
} from "./chat_runtime_tools.ts";

export { loadRuntimeTools };

const logger = console;
const DEFAULT_CHAT_PORT = 8787;
const CHAT_WORKER_SANDBOX_UNSUPPORTED_MESSAGE =
  "gambit chat does not support worker sandbox execution yet because the Stop control requires root run cancellation; use --no-worker-sandbox or remove the worker sandbox setting for chat.";

type ChatTranscriptEntry = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  at: string;
};

type ChatMetrics = {
  turnStartedAt?: string;
  modelCalledAt?: string;
  firstTokenAt?: string;
  ttftMs?: number;
  modelTtftMs?: number;
};

type ChatTimingState = {
  turnStartedMs?: number;
  modelCallMs?: number;
  firstTokenMs?: number;
};

type ChatSession = {
  deckPath: string;
  statePath?: string;
  tracePath?: string;
  reproMessage?: string;
  runId: string;
  runStartedAt: string;
  firstUserMessage?: string;
  lastUserMessage?: string;
  runtimeTools: Array<RuntimeToolBinding>;
  state?: SavedState;
  transcript: Array<ChatTranscriptEntry>;
  traceEvents: Array<TraceEvent>;
  metrics: ChatMetrics;
  timing: ChatTimingState;
  errors: Array<string>;
  running: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

function createChatRunState(): SavedState {
  return { runId: crypto.randomUUID(), messages: [] };
}

function transcriptContentFromMessage(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  if (message.tool_calls?.length) return compactJson(message.tool_calls);
  return "";
}

function transcriptFromSavedState(
  state: SavedState,
  at: string,
): Array<ChatTranscriptEntry> {
  return (state.messages ?? [])
    .map((message): ChatTranscriptEntry | undefined => {
      const content = transcriptContentFromMessage(message);
      if (!content) return undefined;
      return {
        id: crypto.randomUUID(),
        role: message.role,
        content,
        at,
      };
    })
    .filter((entry): entry is ChatTranscriptEntry => entry !== undefined);
}

function userMessagesFromTranscript(
  transcript: Array<ChatTranscriptEntry>,
): Array<string> {
  return transcript
    .filter((entry) => entry.role === "user" && entry.content.trim())
    .map((entry) => entry.content);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function safeJsonParseObject(
  text: string,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    if (typeof parsed === "string") {
      return safeJsonParseObject(parsed);
    }
  } catch {
    // fall through
  }
  return undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function structuredToolResult(value: unknown): unknown {
  if (isPlainRecord(value)) return value;
  if (typeof value === "string") {
    return safeJsonParseObject(value) ?? value;
  }
  return value;
}

function responseItemsText(output: Array<ResponseItem>): string {
  const text = stringifyResponseOutput(output);
  if (text) return text;
  return JSON.stringify(output, null, 2);
}

function compactJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function traceToolCallKey(event: TraceEvent, fallback: number): string {
  if (event.type !== "tool.call" && event.type !== "tool.result") {
    return String(fallback);
  }
  return event.actionCallId || event.name || String(fallback);
}

function traceToolActivityContent(input: {
  call?: Extract<TraceEvent, { type: "tool.call" }>;
  result?: Extract<TraceEvent, { type: "tool.result" }>;
}): string {
  const name = input.call?.name || input.result?.name || "tool";
  const resultValue = input.result?.result;
  const status = resultValue && typeof resultValue === "object" &&
      "status" in resultValue
    ? String(resultValue.status)
    : undefined;
  const lines = [
    input.result ? `Tool result: ${name}` : `Tool call: ${name}`,
  ];
  if (status) lines.push(`status: ${status}`);
  if (input.call && !input.result) lines.push(compactJson(input.call.args));
  if (input.result) lines.push(compactJson(resultValue));
  return lines.filter(Boolean).join("\n");
}

function toolTranscriptEntriesFromTrace(
  traceEvents: Array<TraceEvent>,
  startedAt: string,
): Array<ChatTranscriptEntry> {
  const rows: Array<ChatTranscriptEntry> = [];
  const rowIndexesByKey = new Map<string, number>();

  for (const event of traceEvents) {
    if (event.type === "tool.call") {
      const key = traceToolCallKey(event, rowIndexesByKey.size);
      rowIndexesByKey.set(key, rows.length);
      rows.push({
        id: crypto.randomUUID(),
        role: "tool",
        content: traceToolActivityContent({ call: event }),
        at: startedAt,
      });
    }
    if (event.type === "tool.result") {
      const key = traceToolCallKey(event, rowIndexesByKey.size);
      const existingIndex = rowIndexesByKey.get(key);
      if (existingIndex === undefined) {
        rowIndexesByKey.set(key, rows.length);
        rows.push({
          id: crypto.randomUUID(),
          role: "tool",
          content: traceToolActivityContent({ result: event }),
          at: startedAt,
        });
        continue;
      }
      rows[existingIndex] = {
        ...rows[existingIndex],
        content: traceToolActivityContent({ result: event }),
      };
    }
  }

  return rows;
}

function assistantResponseTexts(output: Array<ResponseItem>): Array<string> {
  const texts: Array<string> = [];
  for (const item of output) {
    if (item.type !== "message" || item.role !== "assistant") continue;
    const text = item.content
      .filter((content) => content.type === "output_text")
      .map((content) => content.text)
      .join("");
    if (text) texts.push(text);
  }
  return texts;
}

function stampTraceEvent(event: TraceEvent): TraceEvent {
  if (event.ts !== undefined) return event;
  return { ...event, ts: Date.now() } as TraceEvent;
}

function beginTurnTiming(session: ChatSession): void {
  const startedMs = Date.now();
  session.timing = { turnStartedMs: startedMs };
  session.metrics = { turnStartedAt: isoFromMs(startedMs) };
}

function recordTraceTiming(session: ChatSession, event: TraceEvent): void {
  const eventMs = event.ts ?? Date.now();
  if (event.type === "model.call" && session.timing.modelCallMs === undefined) {
    session.timing.modelCallMs = eventMs;
    session.metrics.modelCalledAt = isoFromMs(eventMs);
  }
  if (
    event.type === "response.output_text.delta" &&
    session.timing.firstTokenMs === undefined
  ) {
    session.timing.firstTokenMs = eventMs;
    session.metrics.firstTokenAt = isoFromMs(eventMs);
    if (session.timing.turnStartedMs !== undefined) {
      session.metrics.ttftMs = eventMs - session.timing.turnStartedMs;
    }
    if (session.timing.modelCallMs !== undefined) {
      session.metrics.modelTtftMs = eventMs - session.timing.modelCallMs;
    }
  }
}

function createTraceCollector(
  session: ChatSession,
  tracePath?: string,
  onTrace?: (event: TraceEvent) => void,
): (event: TraceEvent) => void {
  const jsonlTracer = tracePath ? makeJsonlTracer(tracePath) : undefined;
  return (event) => {
    const stamped = stampTraceEvent(event);
    recordTraceTiming(session, stamped);
    session.traceEvents.push(stamped);
    jsonlTracer?.(stamped);
    onTrace?.(stamped);
  };
}

function runtimeToolSummary(
  binding: RuntimeToolBinding,
): Record<string, unknown> {
  return {
    name: binding.name,
    description: binding.description,
    sourcePath: binding.sourcePath,
    inputSchemaPath: binding.inputSchemaPath,
    actionPath: binding.actionPath,
  };
}

async function runRuntimeToolAction(input: {
  binding: RuntimeToolBinding;
  args: Record<string, unknown>;
  modelProvider: ModelProvider;
  model?: string;
  modelForce?: string;
  responsesMode?: boolean;
  trace: (event: TraceEvent) => void;
  signal?: AbortSignal;
  workerSandbox?: boolean;
  workspacePermissions?: PermissionDeclarationInput;
  workspacePermissionsBaseDir?: string;
  sessionPermissions?: PermissionDeclarationInput;
  sessionPermissionsBaseDir?: string;
}): Promise<unknown> {
  if (!input.binding.actionPath) {
    return {
      status: 501,
      code: "missing_runtime_tool_action",
      message: `Runtime tool ${input.binding.name} has no action binding.`,
      tool: input.binding.name,
    };
  }
  const result = await runDeckResponses({
    path: input.binding.actionPath,
    input: input.args,
    inputProvided: true,
    initialUserMessage: undefined,
    modelProvider: input.modelProvider,
    isRoot: true,
    defaultModel: input.model,
    modelOverride: input.modelForce,
    responsesMode: input.responsesMode,
    trace: input.trace,
    signal: input.signal,
    workerSandbox: input.workerSandbox,
    workspacePermissions: input.workspacePermissions,
    workspacePermissionsBaseDir: input.workspacePermissionsBaseDir,
    sessionPermissions: input.sessionPermissions,
    sessionPermissionsBaseDir: input.sessionPermissionsBaseDir,
  });
  if (result.output.length === 0 && result.legacyResult !== undefined) {
    return structuredToolResult(result.legacyResult);
  }
  const text = responseItemsText(result.output);
  const parsed = safeJsonParseObject(text);
  if (parsed) return parsed;
  const legacyResult = structuredToolResult(result.legacyResult);
  if (isPlainRecord(legacyResult)) return legacyResult;
  return text;
}

function renderChatHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deck Chat Repro</title>
<style>
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f5; color: #171717; }
body { margin: 0; }
.gds-shell { height: 100vh; display: grid; grid-template-rows: auto 1fr; overflow: hidden; }
.gds-header { border-bottom: 1px solid #d8d8d2; background: #ffffff; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.gds-title { font-size: 18px; font-weight: 650; margin: 0; }
.gds-subtitle { color: #666; font-size: 12px; margin: 3px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: min(72vw, 920px); }
.run-actions { display: flex; gap: 8px; flex-shrink: 0; }
.gds-main { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; padding: 16px; min-height: 0; overflow: hidden; align-items: stretch; }
.gds-panel { border: 1px solid #d8d8d2; border-radius: 8px; background: #fff; min-height: 0; overflow: hidden; }
.chat { height: 100%; display: grid; grid-template-rows: minmax(0, 1fr) auto; }
.transcript { padding: 14px; overflow: auto; min-height: 0; display: flex; flex-direction: column; }
.transcript::before { content: ""; margin-top: auto; }
.empty { color: #666; padding: 18px 4px; }
.row { margin: 0 0 12px; display: grid; gap: 4px; }
.role { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #666; }
.bubble { border-radius: 8px; padding: 10px 12px; background: #f1f1ed; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; }
.user .bubble { background: #e7f0ec; }
.assistant .bubble { background: #f4f4fb; }
.system .bubble { background: #fff5dc; }
.tool .bubble { background: #eef3f7; border: 1px solid #d9e3ea; color: #24313a; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.pending { opacity: .72; }
.pending .role::after { content: " - sending"; text-transform: none; letter-spacing: 0; }
.side { height: 100%; display: grid; grid-template-rows: auto 1fr; }
.tabs { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid #e7e7e1; }
.tab { border: 0; border-right: 1px solid #e7e7e1; border-radius: 0; background: #fbfbf9; color: #333; height: 38px; padding: 0 8px; font-size: 12px; font-weight: 600; }
.tab:last-child { border-right: 0; }
.tab.active { background: #1f1f1f; color: white; }
.tab-panel { overflow: auto; padding: 12px; }
.kv { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 8px; margin: 0 0 10px; font-size: 12px; }
.kv dt { color: #666; }
.kv dd { margin: 0; overflow-wrap: anywhere; }
.card { border: 1px solid #e2e2dc; border-radius: 6px; padding: 10px; margin: 0 0 10px; background: #fbfbf9; }
.card-title { font-size: 12px; font-weight: 650; margin: 0 0 6px; }
.muted { color: #666; }
pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.35; }
form { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 10px; border-top: 1px solid #d8d8d2; background: #fff; }
textarea { min-height: 46px; max-height: 160px; resize: vertical; border: 1px solid #c9c9c2; border-radius: 8px; padding: 10px; font: inherit; }
button { border: 1px solid #1f1f1f; background: #1f1f1f; color: white; border-radius: 8px; padding: 0 18px; font: inherit; font-weight: 600; }
button.secondary { background: #fff; color: #1f1f1f; border-color: #c9c9c2; height: 34px; padding: 0 12px; font-size: 12px; }
button:disabled { opacity: .55; }
@media (max-width: 880px) { .gds-shell { height: auto; min-height: 100vh; overflow: visible; } .gds-header { align-items: flex-start; flex-direction: column; } .run-actions { width: 100%; } .gds-main { grid-template-columns: 1fr; overflow: visible; } .chat, .side { height: 72vh; min-height: 420px; } }
</style>
</head>
<body>
<div class="gds-shell">
  <header class="gds-header">
    <div>
      <h1 class="gds-title">Deck Chat Repro</h1>
      <p class="gds-subtitle" id="deck-title"></p>
    </div>
    <div class="run-actions">
      <button class="secondary" id="new-run" type="button">New run</button>
      <button class="secondary" id="run-again" type="button" disabled>Run again</button>
      <button class="secondary" id="stop-run" type="button" disabled>Stop</button>
    </div>
  </header>
  <main class="gds-main">
    <section class="gds-panel chat">
      <div class="transcript" id="transcript"></div>
      <form id="composer">
        <textarea id="message" placeholder="Message the deck"></textarea>
        <button id="send" type="submit">Send</button>
      </form>
    </section>
    <aside class="gds-panel side">
      <nav class="tabs" aria-label="Chat details">
        <button class="tab active" type="button" data-tab="run">Run</button>
        <button class="tab" type="button" data-tab="tools">Tools</button>
        <button class="tab" type="button" data-tab="events">Events</button>
        <button class="tab" type="button" data-tab="raw">Raw</button>
      </nav>
      <section class="tab-panel" id="details"></section>
    </aside>
  </main>
</div>
<script>
const $ = (id) => document.getElementById(id);
let busy = false;
let currentTab = 'run';
let currentData = null;
let pendingTranscript = [];
let pendingBaseTranscriptLength = 0;
function esc(text) {
  return String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function shortPath(value) {
  if (!value) return '(memory)';
  const text = String(value);
  const parts = text.split('/');
  return parts.length > 4 ? '.../' + parts.slice(-4).join('/') : text;
}
function traceSummary(event) {
  const kind = event?.type || 'event';
  const name = event?.name ? ' ' + event.name : '';
  const status = event?.status ? ' (' + event.status + ')' : '';
  return kind + name + status;
}
function shouldShowTimelineEvent(event) {
  if (!event) return false;
  if (event.type === 'model.stream.event') return false;
  if (event.type === 'response.output_text.delta') return false;
  if (event.type === 'response.reasoning.delta') return false;
  if (event.type === 'response.output_item.done') {
    return event.item?.type !== 'message';
  }
  return [
    'run.start',
    'run.end',
    'message.user',
    'deck.start',
    'deck.end',
    'model.call',
    'model.result',
    'tool.call',
    'tool.result',
    'response.output_text.done',
    'response.reasoning.done',
  ].includes(event.type);
}
function curatedEvents(data) {
  return (data.traceEvents || []).filter(shouldShowTimelineEvent);
}
function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
  }
  return '';
}
function eventPreview(event) {
  if (event.type === 'message.user') return event.content || messageText(event.message);
  if (event.type === 'model.call') return 'model: ' + (event.model || '(unknown)') + ', messages: ' + (event.messageCount ?? '?') + ', tools: ' + (event.toolCount ?? 0);
  if (event.type === 'model.result') return 'finish: ' + (event.finishReason || 'stop') + ', tokens: ' + (event.usage?.totalTokens ?? '?');
  if (event.type === 'tool.call') return event.name + '\\n' + compactJson(event.args);
  if (event.type === 'tool.result') return event.name + '\\n' + compactJson(event.result);
  if (event.type === 'response.output_text.done') return event.text || '';
  if (event.type === 'response.reasoning.done') return 'reasoning completed';
  if (event.type === 'response.output_item.done') return compactJson(event.item);
  if (event.type === 'deck.start' || event.type === 'deck.end') return shortPath(event.deckPath);
  if (event.type === 'run.start' || event.type === 'run.end') return event.runId || '';
  return compactJson(event);
}
function renderEventCard(event) {
  return '<div class="card"><p class="card-title">' + esc(traceSummary(event)) + '</p><pre>' + esc(eventPreview(event)) + '</pre></div>';
}
function toolCallKey(event, fallback) {
  return event?.actionCallId || event?.call_id || event?.callId || event?.id || event?.name || String(fallback);
}
function toolCalls(data) {
  const calls = new Map();
  for (const event of data.traceEvents || []) {
    if (event.type === 'tool.call') {
      calls.set(toolCallKey(event, calls.size), { call: event, result: null });
    }
    if (event.type === 'tool.result') {
      const key = toolCallKey(event, calls.size);
      const current = calls.get(key) || { call: null, result: null };
      current.result = event;
      calls.set(key, current);
    }
  }
  return Array.from(calls.values());
}
function compactJson(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}
function formatMs(value) {
  return typeof value === 'number' ? Math.round(value) + 'ms' : '(pending)';
}
function toolActivityContent(call, result) {
  const name = call?.name || result?.name || 'tool';
  const args = compactJson(call?.args);
  const value = result?.result ?? result?.output;
  const status = value && typeof value === 'object' && 'status' in value ? value.status : undefined;
  const lines = [result ? 'Tool result: ' + name : 'Tool call: ' + name];
  if (status) lines.push('status: ' + status);
  if (args && !result) lines.push(args);
  if (result) lines.push(compactJson(value));
  return lines.filter(Boolean).join('\\n');
}
function latestTurnEvents(data) {
  const events = data.traceEvents || [];
  let start = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === 'message.user') {
      start = i;
      break;
    }
  }
  return events.slice(start);
}
function liveTurnRows(data) {
  if (!data.running) return [];
  const rows = [];
  const assistantRows = new Map();
  const toolRows = new Map();
  for (const event of latestTurnEvents(data)) {
    if (event.type === 'response.output_text.delta' || event.type === 'response.output_text.done') {
      const key = 'assistant-' + String(event.output_index ?? assistantRows.size);
      let row = assistantRows.get(key);
      if (!row) {
        row = { role: 'assistant', content: '', pending: true };
        assistantRows.set(key, row);
        rows.push(row);
      }
      if (event.type === 'response.output_text.done' && typeof event.text === 'string') {
        row.content = event.text;
      } else if (typeof event.delta === 'string') {
        row.content += event.delta;
      }
    }
    if (event.type === 'tool.call') {
      const key = toolCallKey(event, toolRows.size);
      const row = { role: 'tool', content: toolActivityContent(event, null), pending: true, call: event, result: null };
      toolRows.set(key, row);
      rows.push(row);
    }
    if (event.type === 'tool.result') {
      const key = toolCallKey(event, toolRows.size);
      let row = toolRows.get(key);
      if (!row) {
        row = { role: 'tool', content: '', pending: true, call: null, result: null };
        toolRows.set(key, row);
        rows.push(row);
      }
      row.result = event;
      row.content = toolActivityContent(row.call, event);
    }
  }
  return rows.filter(row => row.content);
}
function renderRun(data) {
  const status = data.running ? 'running' : data.errors.length ? data.errors[data.errors.length - 1] : 'ready';
  const metrics = data.metrics || {};
  return '<dl class="kv">' +
    '<dt>Run</dt><dd>' + esc(data.runId) + '</dd>' +
    '<dt>Started</dt><dd>' + esc(data.runStartedAt) + '</dd>' +
    '<dt>Deck</dt><dd>' + esc(data.deckPath) + '</dd>' +
    '<dt>State</dt><dd>' + esc(data.statePath || '(memory)') + '</dd>' +
    '<dt>Trace</dt><dd>' + esc(data.tracePath || '(memory)') + '</dd>' +
    '<dt>Status</dt><dd>' + esc(status) + '</dd>' +
    '<dt>TTFT</dt><dd>' + esc(formatMs(metrics.ttftMs)) + '</dd>' +
    '<dt>Model TTFT</dt><dd>' + esc(formatMs(metrics.modelTtftMs)) + '</dd>' +
    '<dt>Tools</dt><dd>' + esc(String(data.runtimeTools.length)) + ' supplied</dd>' +
    '<dt>Turns</dt><dd>' + esc(String(data.transcript.filter(row => row.role === 'user').length)) + '</dd>' +
    '<dt>Rerun prompt</dt><dd>' + esc(data.firstUserMessage || '(none)') + '</dd>' +
    '<dt>Last prompt</dt><dd>' + esc(data.lastUserMessage || '(none)') + '</dd>' +
  '</dl>';
}
function renderTools(data) {
  const supplied = data.runtimeTools.length
    ? data.runtimeTools.map(tool => '<div class="card"><p class="card-title">' + esc(tool.name) + '</p><div class="muted">' + esc(tool.description || 'No description') + '</div><pre>' + esc(JSON.stringify(tool, null, 2)) + '</pre></div>').join('')
    : '<p class="muted">No runtime tools supplied.</p>';
  const calls = toolCalls(data);
  const called = calls.length
    ? calls.map(row => '<div class="card"><p class="card-title">' + esc(row.call?.name || row.result?.name || 'tool') + '</p><pre>' + esc(JSON.stringify(row, null, 2)) + '</pre></div>').join('')
    : '<p class="muted">No tool calls yet.</p>';
  return '<p class="card-title">Supplied</p>' + supplied + '<p class="card-title">Called</p>' + called;
}
function renderEvents(data) {
  const events = curatedEvents(data).slice(-80);
  if (!events.length) return '<p class="muted">No trace events yet.</p>';
  return events.map(renderEventCard).join('');
}
function renderDetails(data) {
  const views = {
    run: renderRun,
    tools: renderTools,
    events: renderEvents,
    raw: (value) => '<pre>' + esc(JSON.stringify(value, null, 2)) + '</pre>',
  };
  $('details').innerHTML = views[currentTab](data);
  document.querySelectorAll('.tab').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === currentTab);
  });
}
function render(data) {
  currentData = data;
  if (pendingTranscript.length && data.transcript.slice(pendingBaseTranscriptLength).some(row => row.role === 'user' && row.content === pendingTranscript[0]?.content)) {
    pendingTranscript = [];
    pendingBaseTranscriptLength = 0;
  }
  const transcript = [...data.transcript, ...pendingTranscript];
  const liveRows = liveTurnRows(data);
  if (liveRows.length) transcript.push(...liveRows);
  else if (data.running) transcript.push({ role: 'assistant', content: 'Running deck...', pending: true });
  const blocked = busy || data.running;
  $('deck-title').textContent = shortPath(data.deckPath);
  $('send').disabled = blocked;
  $('new-run').disabled = blocked;
  $('run-again').disabled = blocked || !(data.firstUserMessage || pendingTranscript[0]?.content);
  $('stop-run').disabled = !data.running;
  $('transcript').innerHTML = transcript.length ? transcript.map(row =>
    '<div class="row ' + esc(row.role) + (row.pending ? ' pending' : '') + '"><div class="role">' + esc(row.role) + '</div><div class="bubble">' + esc(row.content) + '</div></div>'
  ).join('') : '<div class="empty">Start by sending a message to the deck.</div>';
  $('transcript').scrollTop = $('transcript').scrollHeight;
  renderDetails(data);
}
async function refresh() {
  const res = await fetch('/api/session');
  render(await res.json());
}
document.querySelectorAll('.tab').forEach(button => {
  button.addEventListener('click', () => {
    currentTab = button.dataset.tab;
    if (currentData) renderDetails(currentData);
  });
});
function setBusy(value) {
  busy = value;
  const blocked = busy || Boolean(currentData?.running);
  $('send').disabled = blocked;
  $('new-run').disabled = blocked;
  $('run-again').disabled = blocked || !currentData?.firstUserMessage;
  $('stop-run').disabled = !currentData?.running;
}
async function resetRun(rerun) {
  if (busy) return;
  if (!rerun && currentData?.transcript?.length) {
    const ok = confirm('Start a new run and clear the current transcript?');
    if (!ok) return;
  }
  setBusy(true);
  pendingTranscript = [];
  pendingBaseTranscriptLength = 0;
  try {
    await fetch('/api/session/reset', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ rerun }) });
    await refresh();
  } finally {
    setBusy(false);
    $('message').focus();
  }
}
$('new-run').addEventListener('click', () => resetRun(false));
$('run-again').addEventListener('click', () => resetRun(true));
$('stop-run').addEventListener('click', async () => {
  if (!currentData?.running) return;
  $('stop-run').disabled = true;
  await fetch('/api/session/stop', { method: 'POST' });
});
$('message').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    $('composer').requestSubmit();
  }
});
$('composer').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  const message = $('message').value.trim();
  if (!message) return;
  setBusy(true);
  $('message').value = '';
  pendingBaseTranscriptLength = currentData?.transcript?.length || 0;
  pendingTranscript = [{ role: 'user', content: message, pending: true }];
  if (currentData) {
    render({
      ...currentData,
      firstUserMessage: currentData.firstUserMessage || message,
      lastUserMessage: message,
      running: true,
    });
  }
  try {
    const response = await fetch('/api/message', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ message }) });
    if (!response.ok) {
      throw new Error(await response.text());
    }
  } catch (error) {
    pendingTranscript = [];
    pendingBaseTranscriptLength = 0;
    await refresh();
    throw error;
  } finally {
    setBusy(false);
    $('message').focus();
  }
});
if ('EventSource' in window) {
  const events = new EventSource('/api/session/events');
  events.addEventListener('session', (event) => render(JSON.parse(event.data)));
  events.onerror = () => {
    if (!currentData) refresh();
  };
} else {
  refresh();
}
</script>
</body>
</html>`;
}

export function startLocalChatServer(opts: {
  deckPath: string;
  context?: unknown;
  contextProvided?: boolean;
  modelProvider: ModelProvider;
  model?: string;
  modelForce?: string;
  port?: number;
  statePath?: string;
  tracePath?: string;
  reproMessage?: string;
  runtimeTools?: Array<RuntimeToolBinding>;
  responsesMode?: boolean;
  workerSandbox?: boolean;
  workspacePermissions?: PermissionDeclarationInput;
  workspacePermissionsBaseDir?: string;
  sessionPermissions?: PermissionDeclarationInput;
  sessionPermissionsBaseDir?: string;
  signal?: AbortSignal;
}): ReturnType<typeof Deno.serve> {
  if (opts.workerSandbox === true) {
    throw new Error(CHAT_WORKER_SANDBOX_UNSUPPORTED_MESSAGE);
  }
  const chatWorkerSandbox = opts.workerSandbox ?? false;
  const state = (() => {
    if (!opts.statePath) return undefined;
    try {
      return loadCanonicalWorkspaceState(opts.statePath).state;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("Workspace sqlite not found") ||
        message.includes("Workspace state not found")
      ) {
        return createChatRunState();
      }
      throw err;
    }
  })();
  const initialState = state ?? createChatRunState();
  const runStartedAt = nowIso();
  const initialTranscript = transcriptFromSavedState(
    initialState,
    runStartedAt,
  );
  const restoredUserMessages = userMessagesFromTranscript(initialTranscript);
  const session: ChatSession = {
    deckPath: path.resolve(opts.deckPath),
    statePath: opts.statePath ? path.resolve(opts.statePath) : undefined,
    tracePath: opts.tracePath ? path.resolve(opts.tracePath) : undefined,
    reproMessage: opts.reproMessage,
    runId: initialState.runId,
    runStartedAt,
    firstUserMessage: restoredUserMessages[0],
    lastUserMessage: restoredUserMessages.at(-1),
    runtimeTools: opts.runtimeTools ?? [],
    state: initialState,
    transcript: initialTranscript,
    traceEvents: [],
    metrics: {},
    timing: {},
    errors: [],
    running: false,
  };
  const port = opts.port ?? DEFAULT_CHAT_PORT;
  const encoder = new TextEncoder();
  const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let currentRunAbortController: AbortController | undefined;
  const sessionPayload = () => ({
    deckPath: session.deckPath,
    statePath: session.statePath,
    tracePath: session.tracePath,
    reproMessage: session.reproMessage,
    runId: session.runId,
    runStartedAt: session.runStartedAt,
    firstUserMessage: session.firstUserMessage,
    lastUserMessage: session.lastUserMessage,
    runtimeTools: session.runtimeTools.map(runtimeToolSummary),
    transcript: session.transcript,
    traceEvents: session.traceEvents,
    metrics: session.metrics,
    errors: session.errors,
    running: session.running,
  });
  const encodeSse = (value: unknown) =>
    encoder.encode(`event: session\ndata: ${JSON.stringify(value)}\n\n`);
  const broadcastSession = () => {
    const message = encodeSse(sessionPayload());
    for (const client of sseClients) {
      try {
        client.enqueue(message);
      } catch {
        sseClients.delete(client);
      }
    }
  };
  const trace = createTraceCollector(session, opts.tracePath, broadcastSession);
  const resetSessionRun = () => {
    const freshState = createChatRunState();
    session.runId = freshState.runId;
    session.runStartedAt = nowIso();
    session.state = freshState;
    session.transcript = [];
    session.traceEvents = [];
    session.metrics = {};
    session.timing = {};
    session.errors = [];
    session.firstUserMessage = undefined;
    session.lastUserMessage = undefined;
    session.running = false;
    if (opts.statePath) {
      saveCanonicalWorkspaceState(
        opts.statePath,
        enrichStateMeta(freshState, opts.deckPath),
      );
    }
    broadcastSession();
  };

  const runTurn = async (message: string) => {
    const turnAbortController = new AbortController();
    currentRunAbortController = turnAbortController;
    const turnTraceStartIndex = session.traceEvents.length;
    beginTurnTiming(session);
    session.running = true;
    session.firstUserMessage ??= message;
    session.lastUserMessage = message;
    session.transcript.push({
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      at: nowIso(),
    });
    broadcastSession();
    const appendToolActivity = () => {
      const rows = toolTranscriptEntriesFromTrace(
        session.traceEvents.slice(turnTraceStartIndex),
        nowIso(),
      );
      session.transcript.push(...rows);
    };
    try {
      const bindingsByName = new Map(
        session.runtimeTools.map((binding) => [binding.name, binding]),
      );
      const result = await runDeckResponses({
        path: opts.deckPath,
        input: opts.context,
        inputProvided: Boolean(opts.contextProvided),
        initialUserMessage: message,
        modelProvider: opts.modelProvider,
        isRoot: true,
        defaultModel: opts.model,
        modelOverride: opts.modelForce,
        trace,
        stream: false,
        signal: turnAbortController.signal,
        state: session.state,
        onStateUpdate: (s) => {
          session.state = s;
          if (opts.statePath) {
            saveCanonicalWorkspaceState(
              opts.statePath,
              enrichStateMeta(s, opts.deckPath),
            );
          }
          broadcastSession();
        },
        responsesMode: opts.responsesMode,
        runtimeTools: session.runtimeTools.map((binding) => binding.tool),
        onTool: async (toolInput) => {
          const binding = bindingsByName.get(toolInput.name);
          if (!binding) {
            return {
              status: 404,
              code: "missing_runtime_tool",
              message: `Runtime tool ${toolInput.name} was not supplied.`,
            };
          }
          return await runRuntimeToolAction({
            binding,
            args: toolInput.args,
            modelProvider: opts.modelProvider,
            model: opts.model,
            modelForce: opts.modelForce,
            responsesMode: opts.responsesMode,
            trace,
            signal: turnAbortController.signal,
            workerSandbox: chatWorkerSandbox,
            workspacePermissions: opts.workspacePermissions,
            workspacePermissionsBaseDir: opts.workspacePermissionsBaseDir,
            sessionPermissions: opts.sessionPermissions,
            sessionPermissionsBaseDir: opts.sessionPermissionsBaseDir,
          });
        },
        workerSandbox: chatWorkerSandbox,
        workspacePermissions: opts.workspacePermissions,
        workspacePermissionsBaseDir: opts.workspacePermissionsBaseDir,
        sessionPermissions: opts.sessionPermissions,
        sessionPermissionsBaseDir: opts.sessionPermissionsBaseDir,
      });
      if (turnAbortController.signal.aborted) {
        appendToolActivity();
        session.transcript.push({
          id: crypto.randomUUID(),
          role: "system",
          content: "Stopped.",
          at: nowIso(),
        });
        return;
      }
      if (result.state) {
        session.state = result.state;
        session.runId = result.state.runId;
        if (opts.statePath) {
          saveCanonicalWorkspaceState(
            opts.statePath,
            enrichStateMeta(result.state, opts.deckPath),
          );
        }
      }
      appendToolActivity();
      const assistantTexts = assistantResponseTexts(result.output);
      if (assistantTexts.length > 0) {
        for (const content of assistantTexts) {
          session.transcript.push({
            id: crypto.randomUUID(),
            role: "assistant",
            content,
            at: nowIso(),
          });
        }
      } else {
        session.transcript.push({
          id: crypto.randomUUID(),
          role: "assistant",
          content: responseItemsText(result.output),
          at: nowIso(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (turnAbortController.signal.aborted) {
        appendToolActivity();
        session.transcript.push({
          id: crypto.randomUUID(),
          role: "system",
          content: "Stopped.",
          at: nowIso(),
        });
        return;
      }
      session.errors.push(message);
      session.transcript.push({
        id: crypto.randomUUID(),
        role: "system",
        content: `Error: ${message}`,
        at: nowIso(),
      });
    } finally {
      if (currentRunAbortController === turnAbortController) {
        currentRunAbortController = undefined;
      }
      session.running = false;
      broadcastSession();
    }
  };

  return Deno.serve({
    hostname: "127.0.0.1",
    port,
    signal: opts.signal,
  }, async (request) => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(renderChatHtml(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (request.method === "GET" && url.pathname === "/api/session") {
      return jsonResponse(sessionPayload());
    }
    if (request.method === "GET" && url.pathname === "/api/session/events") {
      let keepAlive: number | undefined;
      let streamController:
        | ReadableStreamDefaultController<
          Uint8Array
        >
        | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          sseClients.add(controller);
          controller.enqueue(encoder.encode(": connected\n\n"));
          controller.enqueue(encodeSse(sessionPayload()));
          keepAlive = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
            } catch {
              sseClients.delete(controller);
              if (keepAlive !== undefined) clearInterval(keepAlive);
            }
          }, 15_000);
        },
        cancel() {
          if (streamController) sseClients.delete(streamController);
          if (keepAlive !== undefined) clearInterval(keepAlive);
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          "connection": "keep-alive",
        },
      });
    }
    if (request.method === "POST" && url.pathname === "/api/session/reset") {
      if (session.running) {
        return jsonResponse({ error: "run already in progress" }, 409);
      }
      const body = await request.json().catch(() => ({})) as {
        rerun?: unknown;
        message?: unknown;
      };
      const message = typeof body.message === "string" && body.message.trim()
        ? body.message
        : session.firstUserMessage;
      if (body.rerun === true && !message) {
        return jsonResponse({ error: "no message available to rerun" }, 400);
      }
      resetSessionRun();
      if (body.rerun === true && message) {
        void runTurn(message);
        return jsonResponse({ ok: true, session: sessionPayload() }, 202);
      }
      return jsonResponse({ ok: true, session: sessionPayload() });
    }
    if (request.method === "POST" && url.pathname === "/api/session/stop") {
      if (!session.running || !currentRunAbortController) {
        return jsonResponse({
          ok: true,
          stopped: false,
          session: sessionPayload(),
        });
      }
      currentRunAbortController.abort();
      broadcastSession();
      return jsonResponse({
        ok: true,
        stopped: true,
        session: sessionPayload(),
      }, 202);
    }
    if (request.method === "POST" && url.pathname === "/api/message") {
      if (session.running) {
        return jsonResponse({ error: "run already in progress" }, 409);
      }
      const body = await request.json().catch(() => ({})) as {
        message?: unknown;
      };
      if (typeof body.message !== "string" || !body.message.trim()) {
        return jsonResponse({ error: "message is required" }, 400);
      }
      void runTurn(body.message);
      return jsonResponse({ ok: true, session: sessionPayload() }, 202);
    }
    return new Response("Not found", { status: 404 });
  });
}

async function maybeOpenBrowser(url: string): Promise<void> {
  const command = Deno.build.os === "darwin"
    ? new Deno.Command("open", { args: [url] })
    : Deno.build.os === "windows"
    ? new Deno.Command("cmd", { args: ["/c", "start", url] })
    : new Deno.Command("xdg-open", { args: [url] });
  await command.output().catch((err) => {
    logger.warn(
      `[chat] unable to open browser: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });
}

export async function handleChatCommand(opts: {
  deckPath: string;
  context?: string;
  contextProvided?: boolean;
  modelProvider: ModelProvider;
  model?: string;
  modelForce?: string;
  port?: number;
  statePath?: string;
  tracePath?: string;
  reproMessage?: string;
  runtimeToolsPaths?: Array<string>;
  responsesMode?: boolean;
  open?: boolean;
  workerSandbox?: boolean;
  workspacePermissions?: PermissionDeclarationInput;
  workspacePermissionsBaseDir?: string;
  sessionPermissions?: PermissionDeclarationInput;
  sessionPermissionsBaseDir?: string;
}) {
  const runtimeTools = await loadRuntimeTools(opts.runtimeToolsPaths ?? []);
  const port = opts.port ?? DEFAULT_CHAT_PORT;
  const url = `http://localhost:${port}/`;
  const server = startLocalChatServer({
    deckPath: opts.deckPath,
    context: opts.context !== undefined
      ? parseContext(opts.context)
      : undefined,
    contextProvided: opts.contextProvided,
    modelProvider: opts.modelProvider,
    model: opts.model,
    modelForce: opts.modelForce,
    port,
    statePath: opts.statePath,
    tracePath: opts.tracePath,
    reproMessage: opts.reproMessage,
    runtimeTools,
    responsesMode: opts.responsesMode,
    workerSandbox: opts.workerSandbox,
    workspacePermissions: opts.workspacePermissions,
    workspacePermissionsBaseDir: opts.workspacePermissionsBaseDir,
    sessionPermissions: opts.sessionPermissions,
    sessionPermissionsBaseDir: opts.sessionPermissionsBaseDir,
  });
  logger.log(`[chat] ${url}`);
  if (opts.open) {
    await maybeOpenBrowser(url);
  }
  await server.finished;
}
