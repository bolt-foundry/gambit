import { isGambitEndSignal, runDeck } from "@bolt-foundry/gambit-core";
import type { SavedState } from "@bolt-foundry/gambit-core";
import type { PermissionDeclarationInput } from "@bolt-foundry/gambit-core";
import * as path from "@std/path";

const encoder = new TextEncoder();
const graphemeSegmenter = typeof Intl !== "undefined" &&
    typeof Intl.Segmenter !== "undefined"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

type Message = {
  role: "user" | "assistant" | "system";
  text: string;
};

type ConsoleSize = {
  columns: number;
  rows: number;
};

const ANSI = {
  altEnter: "\x1b[?1049h",
  altExit: "\x1b[?1049l",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clear: "\x1b[2J",
  home: "\x1b[H",
  faint: "\x1b[2m",
  reset: "\x1b[0m",
};

const write = (text: string) => Deno.stdout.writeSync(encoder.encode(text));

export async function startTui(opts: {
  deckPath: string;
  model: string | undefined;
  modelForce: string | undefined;
  modelProvider: import("@bolt-foundry/gambit-core").ModelProvider;
  trace?: (
    event: import("@bolt-foundry/gambit-core").TraceEvent,
  ) => void;
  toolResultMessage?: (
    event: import("@bolt-foundry/gambit-core").TraceEvent,
  ) => string | null;
  verbose?: boolean;
  initialSystemMessage?: string;
  initialContext?: unknown;
  initialMessage?: unknown;
  contextProvided?: boolean;
  responsesMode?: boolean;
  workspacePermissions?: PermissionDeclarationInput;
  workspacePermissionsBaseDir?: string;
  sessionPermissions?: PermissionDeclarationInput;
  sessionPermissionsBaseDir?: string;
  workerSandbox?: boolean;
}) {
  if (!Deno.stdin.isTerminal()) {
    throw new Error("tui requires an interactive TTY.");
  }

  const messages: Array<Message> = [];
  if (opts.initialSystemMessage) {
    messages.push({ role: "system", text: opts.initialSystemMessage });
  }
  let input = "";
  let state: SavedState | undefined;
  let closed = false;
  let running = false;
  let skipEscape = false;
  let escapePending = false;
  let renderPending = false;
  const deckLabel = path.basename(opts.deckPath);
  const activeTools = new Map<string, { name: string; startedAt: number }>();
  const toolMessageIndex = new Map<string, number>();
  let ttftStartAt: number | null = null;
  let ttftRecorded = false;
  let modelStreamedText = false;
  let currentModel: string | undefined;

  const scheduleRender = () => {
    if (renderPending || closed) return;
    renderPending = true;
    setTimeout(() => {
      renderPending = false;
      render();
    }, 16);
  };

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const handleSigint = () => {
    closed = true;
    reader?.cancel().catch(() => {});
    scheduleRender();
  };
  Deno.addSignalListener("SIGINT", handleSigint);

  const cleanup = () => {
    try {
      Deno.stdin.setRaw(false);
    } catch {
      // ignore
    }
    write(`${ANSI.showCursor}${ANSI.altExit}`);
    Deno.removeSignalListener("SIGINT", handleSigint);
  };

  const render = () => {
    if (closed) return;
    const { columns, rows } = getConsoleSize();
    const width = Math.max(20, columns);
    const height = Math.max(10, rows);
    const modelLabel = currentModel ? ` | model: ${currentModel}` : "";
    const header = clampLine(
      `Gambit TUI - ${deckLabel}${running ? " (running)" : ""}${modelLabel}`,
      width,
    );
    const tipText = "Tip: ctrl+c/d to exit • \\ + enter for newline";
    const tipLine = `${ANSI.faint}${clampLine(tipText, width)}${ANSI.reset}`;
    const maxInputLines = Math.max(1, height - 3);
    const inputLines = renderInputLines(input, width, maxInputLines);
    const bodyHeight = Math.max(1, height - 2 - inputLines.length);
    const messageLines = buildMessageLines(messages, width);
    const visible = messageLines.slice(-bodyHeight);
    const padding = Array(Math.max(0, bodyHeight - visible.length)).fill("");
    const lines = [header, ...padding, ...visible, tipLine, ...inputLines];
    const screen = lines.join("\n");
    write(
      `${ANSI.hideCursor}${ANSI.home}${ANSI.clear}${screen}${ANSI.showCursor}`,
    );
  };

  const addMessage = (role: Message["role"], text: string) => {
    messages.push({ role, text });
    scheduleRender();
  };

  const updateAssistant = (text: string, replace = false) => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") {
      messages.push({ role: "assistant", text });
    } else if (replace) {
      last.text = text;
    } else {
      last.text += text;
    }
    scheduleRender();
  };

  const traceEvent = (
    event: import("@bolt-foundry/gambit-core").TraceEvent,
  ) => {
    if (event.type === "tool.call") {
      const key = `${event.actionCallId}:${event.name}`;
      activeTools.set(key, { name: event.name, startedAt: Date.now() });
      if (!toolMessageIndex.has(key)) {
        messages.push({
          role: "system",
          text: `tool: ${event.name} (running)`,
        });
        toolMessageIndex.set(key, messages.length - 1);
      }
      scheduleRender();
    } else if (event.type === "model.call") {
      modelStreamedText = false;
      if (event.model) currentModel = event.model;
    } else if (event.type === "model.result") {
      if (event.finishReason === "tool_calls" && modelStreamedText) {
        ttftStartAt = Date.now();
        ttftRecorded = false;
      }
      if (event.model) currentModel = event.model;
    } else if (event.type === "tool.result") {
      const key = `${event.actionCallId}:${event.name}`;
      activeTools.delete(key);
      const idx = toolMessageIndex.get(key);
      if (idx !== undefined && messages[idx]) {
        messages[idx] = {
          role: "system",
          text: `tool: ${event.name} (done)`,
        };
      } else {
        messages.push({
          role: "system",
          text: `tool: ${event.name} (done)`,
        });
      }
      toolMessageIndex.delete(key);
      const toolMessage = opts.toolResultMessage?.(event);
      if (toolMessage) {
        messages.push({ role: "system", text: toolMessage });
      }
      scheduleRender();
    }
    opts.trace?.(event);
  };

  const runOnce = async (
    deckInput: unknown,
    userMessage: unknown,
    providedFlag: boolean,
  ) => {
    running = true;
    activeTools.clear();
    toolMessageIndex.clear();
    ttftStartAt = null;
    ttftRecorded = false;
    modelStreamedText = false;
    scheduleRender();

    if (userMessage !== undefined) {
      addMessage("user", formatDisplay(userMessage));
      ttftStartAt = Date.now();
      ttftRecorded = false;
    }

    let streamed = false;
    try {
      const effectiveInput = deckInput === undefined && !providedFlag
        ? ""
        : deckInput;
      const result = await runDeck({
        path: opts.deckPath,
        input: effectiveInput,
        inputProvided: providedFlag,
        initialUserMessage: userMessage,
        modelProvider: opts.modelProvider,
        isRoot: true,
        allowRootStringInput: true,
        defaultModel: opts.model,
        modelOverride: opts.modelForce,
        trace: traceEvent,
        stream: true,
        state,
        onStateUpdate: (s) => {
          state = s;
        },
        responsesMode: opts.responsesMode,
        workspacePermissions: opts.workspacePermissions,
        workspacePermissionsBaseDir: opts.workspacePermissionsBaseDir,
        sessionPermissions: opts.sessionPermissions,
        sessionPermissionsBaseDir: opts.sessionPermissionsBaseDir,
        workerSandbox: opts.workerSandbox,
        onStreamText: (chunk) => {
          if (!chunk) return;
          modelStreamedText = true;
          if (!ttftRecorded && ttftStartAt !== null) {
            const deltaMs = Date.now() - ttftStartAt;
            addMessage("system", `ttft: ${deltaMs}ms`);
            ttftRecorded = true;
          }
          streamed = true;
          updateAssistant(chunk);
        },
      });
      const formatted = formatDisplay(result);
      if (isGambitEndSignal(result)) {
        const endMessage = result.message ??
          (typeof result.payload === "string" ? result.payload : formatted);
        if (streamed) {
          updateAssistant(
            (messages[messages.length - 1]?.text.endsWith("\n") ? "" : "\n") +
              endMessage,
          );
        } else {
          updateAssistant(endMessage, true);
        }
        closed = true;
        return;
      }
      if (!streamed) {
        if (!ttftRecorded && ttftStartAt !== null) {
          const deltaMs = Date.now() - ttftStartAt;
          addMessage("system", `ttft: ${deltaMs}ms`);
          ttftRecorded = true;
        }
        updateAssistant(formatted, true);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      addMessage("system", `Error: ${errorMessage}`);
    } finally {
      running = false;
      activeTools.clear();
      toolMessageIndex.clear();
      modelStreamedText = false;
      scheduleRender();
    }
  };

  reader = Deno.stdin.readable.getReader();
  let textBuffer: Array<number> = [];
  const streamDecoder = new TextDecoder();
  try {
    Deno.stdin.setRaw(true);
    write(`${ANSI.altEnter}${ANSI.hideCursor}`);
    render();

    const skipAssistantLead = opts.initialMessage !== undefined;
    const initialContext = opts.initialContext;

    if (!skipAssistantLead) {
      await runOnce(
        initialContext,
        undefined,
        Boolean(opts.contextProvided),
      );
    }

    if (opts.initialMessage !== undefined) {
      await runOnce(
        initialContext,
        opts.initialMessage,
        Boolean(opts.contextProvided),
      );
    }

    let lastWasCR = false;
    while (!closed) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const flushText = () => {
        if (textBuffer.length === 0) return;
        input += streamDecoder.decode(new Uint8Array(textBuffer), {
          stream: true,
        });
        textBuffer = [];
        scheduleRender();
      };
      for (const byte of value) {
        const wasCR = lastWasCR;
        lastWasCR = false;
        if (escapePending) {
          escapePending = false;
          if (byte === 0x7f || byte === 0x08) {
            flushText();
            if (input.length > 0) {
              input = dropLastWord(input);
              scheduleRender();
            }
            continue;
          }
          if (byte === 0x5b) {
            skipEscape = true;
            continue;
          }
          continue;
        }
        if (skipEscape) {
          if (byte >= 64 && byte <= 126) skipEscape = false;
          continue;
        }
        if (byte === 0x1b) {
          flushText();
          escapePending = true;
          continue;
        }
        if (byte === 0x03) {
          flushText();
          closed = true;
          break;
        }
        if (byte === 0x04) {
          flushText();
          closed = true;
          break;
        }
        if (byte === 0x0d) {
          flushText();
          if (running) continue;
          const continuationMatch = input.match(/\\[ \t]*$/);
          if (continuationMatch) {
            input = input.slice(0, -continuationMatch[0].length) + "\n";
            scheduleRender();
            continue;
          }
          const toSend = input;
          input = "";
          scheduleRender();
          await runOnce(undefined, toSend, false);
          lastWasCR = true;
          continue;
        }
        if (byte === 0x0a) {
          if (wasCR) {
            continue;
          }
          flushText();
          if (running) continue;
          const continuationMatch = input.match(/\\[ \t]*$/);
          if (continuationMatch) {
            input = input.slice(0, -continuationMatch[0].length) + "\n";
            scheduleRender();
            continue;
          }
          const toSend = input;
          input = "";
          scheduleRender();
          await runOnce(undefined, toSend, false);
          continue;
        }
        if (byte === 0x7f || byte === 0x08) {
          flushText();
          if (input.length > 0) {
            input = dropLastGrapheme(input);
            scheduleRender();
          }
          continue;
        }
        if (byte === 0x17) {
          flushText();
          if (input.length > 0) {
            input = dropLastWord(input);
            scheduleRender();
          }
          continue;
        }
        if (byte === 0x15) {
          flushText();
          if (input.length > 0) {
            input = "";
            scheduleRender();
          }
          continue;
        }
        if (byte < 0x20) continue;
        textBuffer.push(byte);
      }
      flushText();
    }
    if (textBuffer.length > 0) {
      input += streamDecoder.decode(new Uint8Array(textBuffer));
    }
    input += streamDecoder.decode();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
    cleanup();
  }
}

function buildMessageLines(
  messages: Array<Message>,
  width: number,
): Array<string> {
  const lines: Array<string> = [];
  for (const msg of messages) {
    const prefix = msg.role === "user"
      ? "you: "
      : msg.role === "assistant"
      ? "assistant: "
      : "system: ";
    const contentWidth = Math.max(1, width - prefix.length);
    const paragraphs = msg.text.split("\n");
    let firstParagraph = true;
    for (const paragraph of paragraphs) {
      const wrapped = wrapText(paragraph, contentWidth);
      if (wrapped.length === 0) {
        lines.push(prefix);
      } else {
        wrapped.forEach((line, idx) => {
          const leader = (firstParagraph && idx === 0) ? prefix : " ".repeat(
            prefix.length,
          );
          lines.push(`${leader}${line}`);
        });
      }
      firstParagraph = false;
    }
    lines.push("");
  }
  return lines;
}

function wrapText(text: string, width: number): Array<string> {
  if (width <= 0) return [text];
  if (text.length === 0) return [""];
  const segments = graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(text), (seg) => seg.segment)
    : Array.from(text);
  const lines: Array<string> = [];
  let line: Array<string> = [];
  let lastBreak = -1;
  const isWhitespace = (segment: string) => /\s/.test(segment);
  for (const segment of segments) {
    line.push(segment);
    if (isWhitespace(segment) && line.length <= width) {
      lastBreak = line.length - 1;
    }
    while (line.length > width) {
      if (lastBreak > 0) {
        const head = line.slice(0, lastBreak).join("");
        lines.push(head);
        line = line.slice(lastBreak);
        lastBreak = -1;
        for (let i = 0; i < line.length && i < width; i += 1) {
          if (isWhitespace(line[i])) lastBreak = i;
        }
      } else {
        lines.push(line.slice(0, width).join(""));
        line = line.slice(width);
        lastBreak = -1;
        for (let i = 0; i < line.length && i < width; i += 1) {
          if (isWhitespace(line[i])) lastBreak = i;
        }
      }
    }
  }
  if (line.length > 0) lines.push(line.join(""));
  return lines;
}

function renderInputLines(
  input: string,
  width: number,
  maxLines: number,
): Array<string> {
  const prompt = "> ";
  const indent = "  ";
  const firstWidth = Math.max(1, width - prompt.length);
  const nextWidth = Math.max(1, width - indent.length);
  const lines: Array<string> = [];
  const segments = input.split("\n");
  for (const segment of segments) {
    const isFirst = lines.length === 0;
    const available = isFirst ? firstWidth : nextWidth;
    const wrapped = wrapText(segment, available);
    const chunks = wrapped.length > 0 ? wrapped : [""];
    for (const chunk of chunks) {
      const leader = lines.length === 0 ? prompt : indent;
      lines.push(`${leader}${chunk}`);
    }
  }
  if (lines.length === 0) {
    lines.push(prompt);
  }
  const clamped = lines.map((line) => clampLine(line, width));
  if (clamped.length <= maxLines) return clamped;
  const trimmed = clamped.slice(clamped.length - maxLines);
  const first = trimmed[0];
  if (first.startsWith(prompt)) {
    trimmed[0] = clampLine(
      `${prompt}...${first.slice(prompt.length)}`,
      width,
    );
  } else {
    trimmed[0] = clampLine(
      `${indent}...${first.slice(indent.length)}`,
      width,
    );
  }
  return trimmed;
}

function clampLine(line: string, width: number): string {
  if (line.length <= width) return line;
  return line.slice(0, width);
}

function getConsoleSize(): ConsoleSize {
  try {
    const { columns, rows } = Deno.consoleSize();
    return {
      columns: columns ?? 80,
      rows: rows ?? 24,
    };
  } catch {
    return { columns: 80, rows: 24 };
  }
}

function formatDisplay(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function dropLastGrapheme(value: string): string {
  if (!graphemeSegmenter) {
    const chars = Array.from(value);
    chars.pop();
    return chars.join("");
  }
  let lastStart = 0;
  let hasSegment = false;
  for (const segment of graphemeSegmenter.segment(value)) {
    hasSegment = true;
    lastStart = segment.index;
  }
  if (!hasSegment) return "";
  return value.slice(0, lastStart);
}

function dropLastWord(value: string): string {
  const segments = graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(value), (seg) => ({
      text: seg.segment,
      index: seg.index,
    }))
    : Array.from(value).map((text, idx) => ({ text, index: idx }));
  if (segments.length === 0) return "";
  let end = segments.length;
  while (end > 0 && /\s/.test(segments[end - 1].text)) {
    end -= 1;
  }
  if (end === 0) return "";
  let start = end;
  while (start > 0 && !/\s/.test(segments[start - 1].text)) {
    start -= 1;
  }
  const cutIndex = segments[start].index;
  return value.slice(0, cutIndex);
}
