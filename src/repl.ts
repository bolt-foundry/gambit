/**
 * Gambit REPL TUI powered by a minimal ANSI renderer.
 */
import {
  isGambitEndSignal,
  runDeck,
} from "@bolt-foundry/gambit-core/internal/runtime";
import type { SavedState } from "@bolt-foundry/gambit-core/internal/state";
import type { TraceEvent } from "@bolt-foundry/gambit-core/internal/types";

type MessageRole = "user" | "assistant" | "status";

type Message = {
  id: string;
  role: MessageRole;
  content: string;
};

type ReplOptions = {
  deckPath: string;
  model: string | undefined;
  modelForce: string | undefined;
  modelProvider:
    import("@bolt-foundry/gambit-core/internal/types").ModelProvider;
  trace?: (event: TraceEvent) => void;
  verbose?: boolean;
  initialInit?: unknown;
  initialMessage?: unknown;
  initProvided?: boolean;
};

type ToolSummary = {
  count: number;
  totalDurationMs: number;
  pending: Map<string, number>;
};

export async function startRepl(opts: ReplOptions) {
  if (!isTty()) {
    write(
      "REPL requires a TTY. Use `gambit run` for non-interactive sessions.\n",
    );
    return;
  }
  const repl = new ReplSession(opts);
  await repl.run();
}

class ReplSession {
  private input = "";
  private messages: Array<Message> = [{
    id: crypto.randomUUID(),
    role: "status",
    content: "Gambit REPL TUI",
  }];
  private isRunning = false;
  private stateRef: SavedState | undefined = undefined;
  private shouldExit = false;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private escapePending = false;
  private csiPending = false;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(private opts: ReplOptions) {}

  async run() {
    this.writeAnsi("\x1b[?25l");
    try {
      this.render();
      await this.runInitialTurn();
      if (this.shouldExit) return;
      await this.readInputLoop();
    } finally {
      this.writeAnsi("\x1b[?25h");
    }
  }

  private async runInitialTurn() {
    if (this.opts.initialMessage !== undefined) {
      await this.runTurn({
        deckInput: this.opts.initialInit,
        inputProvided: Boolean(this.opts.initProvided),
        userMessage: this.opts.initialMessage,
        showUserMessage: true,
      });
      return;
    }
    await this.runTurn({
      deckInput: this.opts.initialInit,
      inputProvided: Boolean(this.opts.initProvided),
      userMessage: undefined,
      showUserMessage: false,
    });
  }

  private async readInputLoop() {
    Deno.stdin.setRaw(true);
    const reader = Deno.stdin.readable.getReader();
    this.reader = reader;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done || this.shouldExit) break;
        if (value) {
          this.handleInputChunk(value);
          this.render();
        }
        if (this.shouldExit) break;
      }
    } finally {
      this.flushDecoder();
      this.reader?.releaseLock();
      this.reader = null;
      Deno.stdin.setRaw(false);
    }
  }

  private handleInputChunk(chunk: Uint8Array) {
    const text = this.decoder.decode(chunk, { stream: true });
    this.handleInputText(text);
  }

  private handleInputText(text: string) {
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const code = ch.charCodeAt(0);
      if (this.csiPending) {
        if (code >= 0x40 && code <= 0x7e) {
          this.csiPending = false;
        }
        continue;
      }
      if (this.escapePending) {
        if (ch === "[") {
          // Start swallowing CSI sequences (arrow keys, etc.).
          this.escapePending = false;
          this.csiPending = true;
          continue;
        }
        if (code === 0x7f) {
          this.escapePending = false;
          this.deleteLastWord();
          continue;
        }
        // Treat a standalone ESC as "clear input" and reprocess this char.
        this.escapePending = false;
        this.input = "";
        i -= 1;
        continue;
      }
      if (code === 0x1b) {
        // Delay escape handling to see if it's a sequence.
        this.escapePending = true;
        continue;
      }
      if (code === 0x03 || code === 0x04) {
        this.requestExit();
        return;
      }
      if (code === 0x0d || code === 0x0a) {
        const trimmed = this.input.trim();
        if (trimmed) {
          this.input = "";
          void this.runTurn({
            deckInput: undefined,
            inputProvided: false,
            userMessage: trimmed,
            showUserMessage: true,
          });
        }
        continue;
      }
      if (code === 0x15) {
        this.input = "";
        continue;
      }
      if (code === 0x17) {
        this.deleteLastWord();
        continue;
      }
      if (code === 0x7f || code === 0x08) {
        this.input = this.input.slice(0, -1);
        continue;
      }
      if (code >= 0x20) {
        this.input += ch;
      }
    }
  }

  private appendMessage(message: Message) {
    this.messages.push(message);
    this.render();
  }

  private updateMessage(id: string, content: string) {
    this.messages = this.messages.map((msg) =>
      msg.id === id ? { ...msg, content } : msg
    );
    this.render();
  }

  private async runTurn(
    args: {
      deckInput: unknown;
      inputProvided: boolean;
      userMessage?: unknown;
      showUserMessage: boolean;
    },
  ) {
    if (this.isRunning || this.shouldExit) return;
    const { deckInput, inputProvided, userMessage, showUserMessage } = args;
    const userContent = userMessage === undefined
      ? undefined
      : formatResult(userMessage);
    if (showUserMessage && userContent !== undefined) {
      this.appendMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: userContent,
      });
    }
    const assistantId = crypto.randomUUID();
    this.appendMessage({ id: assistantId, role: "assistant", content: "" });
    this.isRunning = true;
    let toolStatusId: string | null = null;
    const toolSummary: ToolSummary = {
      count: 0,
      totalDurationMs: 0,
      pending: new Map<string, number>(),
    };
    const trace = (event: TraceEvent) => {
      if (event.type === "tool.call") {
        toolSummary.count += 1;
        toolSummary.pending.set(toolKey(event), performance.now());
        if (!toolStatusId) {
          toolStatusId = crypto.randomUUID();
          this.insertStatusMessage(assistantId, {
            id: toolStatusId,
            role: "status",
            content: formatToolStatus(toolSummary, false),
          });
        }
      } else if (event.type === "tool.result") {
        const key = toolKey(event);
        const start = toolSummary.pending.get(key);
        if (start !== undefined) {
          toolSummary.totalDurationMs += performance.now() - start;
          toolSummary.pending.delete(key);
        }
      }
      if (toolStatusId) {
        this.updateMessage(toolStatusId, formatToolStatus(toolSummary, false));
      }
      this.opts.trace?.(event);
    };
    try {
      const effectiveInput = deckInput === undefined && !inputProvided
        ? ""
        : deckInput;
      const result = await runDeck({
        path: this.opts.deckPath,
        input: effectiveInput,
        inputProvided,
        initialUserMessage: userMessage,
        modelProvider: this.opts.modelProvider,
        isRoot: true,
        allowRootStringInput: true,
        defaultModel: this.opts.model,
        modelOverride: this.opts.modelForce,
        trace,
        stream: true,
        state: this.stateRef,
        onStateUpdate: (s) => {
          this.stateRef = s;
        },
        onStreamText: (chunk) => {
          if (!chunk) return;
          this.messages = this.messages.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: msg.content + chunk }
              : msg
          );
          this.render();
        },
      });
      if (!isGambitEndSignal(result) && !result) {
        this.updateMessage(assistantId, "(no response)");
        return;
      }
      if (isGambitEndSignal(result)) {
        const endMessage = result.message ??
          (typeof result.payload === "string"
            ? result.payload
            : formatResult(result));
        this.updateMessage(assistantId, endMessage);
        this.requestExit();
        return;
      }
      if (typeof result === "string") {
        this.updateMessage(assistantId, result);
      } else if (result !== undefined) {
        this.updateMessage(assistantId, formatResult(result));
      }
    } catch (err) {
      this.updateMessage(
        assistantId,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (toolStatusId) {
        this.updateMessage(toolStatusId, formatToolStatus(toolSummary, true));
      }
      this.isRunning = false;
      this.render();
    }
  }

  private insertStatusMessage(assistantId: string, statusMessage: Message) {
    const idx = this.messages.findIndex((msg) => msg.id === assistantId);
    if (idx === -1) {
      this.messages.push(statusMessage);
      this.render();
      return;
    }
    this.messages = [
      ...this.messages.slice(0, idx),
      statusMessage,
      ...this.messages.slice(idx),
    ];
    this.render();
  }

  private requestExit() {
    this.shouldExit = true;
    if (this.reader) {
      try {
        void this.reader.cancel();
      } catch {
        // Ignore cancellation errors while exiting.
      }
    }
  }

  private render() {
    const output: Array<string> = [];
    output.push("\x1b[2J\x1b[H");
    for (const msg of this.messages) {
      output.push(`${formatRole(msg.role)} ${msg.content}`);
    }
    output.push("");
    output.push(`> ${this.input}${this.renderCursor()}`);
    output.push(
      this.isRunning ? "Running..." : "Enter to send. Ctrl+C/D to exit.",
    );
    Deno.stdout.writeSync(this.encoder.encode(output.join("\n")));
  }

  private flushDecoder() {
    const text = this.decoder.decode(new Uint8Array(), { stream: false });
    if (text) {
      this.handleInputText(text);
    }
  }

  private deleteLastWord() {
    const withoutTrailing = this.input.replace(/\s+$/, "");
    this.input = withoutTrailing.replace(/\S+$/, "");
  }

  private renderCursor() {
    return "\x1b[7m \x1b[0m";
  }

  private writeAnsi(sequence: string) {
    Deno.stdout.writeSync(this.encoder.encode(sequence));
  }
}

function formatRole(role: MessageRole) {
  if (role === "user") return "[user]";
  if (role === "assistant") return "[assistant]";
  return "[status]";
}

function formatResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function isTty(): boolean {
  try {
    const stdinTerminal = typeof Deno.stdin.isTerminal === "function"
      ? Deno.stdin.isTerminal()
      : false;
    const stdoutTerminal = typeof Deno.stdout.isTerminal === "function"
      ? Deno.stdout.isTerminal()
      : false;
    return stdinTerminal && stdoutTerminal;
  } catch {
    return false;
  }
}

function write(text: string) {
  Deno.stdout.writeSync(new TextEncoder().encode(text));
}

function toolKey(event: TraceEvent & { actionCallId?: string; name?: string }) {
  return `${event.actionCallId ?? "unknown"}:${event.name ?? "unknown"}`;
}

function formatToolStatus(summary: ToolSummary, done: boolean): string {
  if (summary.count === 0) return "";
  const duration = Math.round(summary.totalDurationMs);
  if (done) {
    return `Tools: ${summary.count} call${
      summary.count === 1 ? "" : "s"
    } in ${duration}ms`;
  }
  const running = summary.pending.size;
  const completed = Math.max(summary.count - running, 0);
  return `Tools: ${summary.count} call${
    summary.count === 1 ? "" : "s"
  } (${running} running, ${completed} done, ${duration}ms)`;
}
