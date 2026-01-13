/**
 * Gambit REPL TUI powered by Ink.
 */
import {
  isGambitEndSignal,
  runDeck,
} from "@bolt-foundry/gambit-core/internal/runtime";
import type { SavedState } from "@bolt-foundry/gambit-core/internal/state";
import type { TraceEvent } from "@bolt-foundry/gambit-core/internal/types";
import { Box, render, Text, useApp, useInput } from "npm:ink@6.6.0";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

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
  const app = render(<ReplApp opts={opts} />);
  await app.waitUntilExit();
}

function ReplApp({ opts }: { opts: ReplOptions }) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Array<Message>>([{
    id: crypto.randomUUID(),
    role: "status",
    content: "Gambit REPL TUI",
  }]);
  const [isRunning, setIsRunning] = useState(false);
  const stateRef = useRef<SavedState | undefined>(undefined);
  const startedRef = useRef(false);

  const appendMessage = useCallback((message: Message) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const updateMessage = useCallback((id: string, content: string) => {
    setMessages((prev) =>
      prev.map((msg) => (msg.id === id ? { ...msg, content } : msg))
    );
  }, []);

  const runTurn = useCallback(
    async (args: {
      deckInput: unknown;
      inputProvided: boolean;
      userMessage?: unknown;
      showUserMessage: boolean;
    }) => {
      if (isRunning) return;
      const { deckInput, inputProvided, userMessage, showUserMessage } = args;
      const userContent = userMessage === undefined
        ? undefined
        : formatResult(userMessage);
      if (showUserMessage && userContent !== undefined) {
        appendMessage({
          id: crypto.randomUUID(),
          role: "user",
          content: userContent,
        });
      }
      const assistantId = crypto.randomUUID();
      appendMessage({ id: assistantId, role: "assistant", content: "" });
      setIsRunning(true);
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
            insertStatusMessage(setMessages, assistantId, {
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
          updateMessage(toolStatusId, formatToolStatus(toolSummary, false));
        }
        opts.trace?.(event);
      };
      try {
        const effectiveInput = deckInput === undefined && !inputProvided
          ? ""
          : deckInput;
        const result = await runDeck({
          path: opts.deckPath,
          input: effectiveInput,
          inputProvided,
          initialUserMessage: userMessage,
          modelProvider: opts.modelProvider,
          isRoot: true,
          allowRootStringInput: true,
          defaultModel: opts.model,
          modelOverride: opts.modelForce,
          trace,
          stream: true,
          state: stateRef.current,
          onStateUpdate: (s) => {
            stateRef.current = s;
          },
          onStreamText: (chunk) => {
            if (!chunk) return;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, content: msg.content + chunk }
                  : msg
              )
            );
          },
        });
        if (!isGambitEndSignal(result) && !result) {
          updateMessage(assistantId, "(no response)");
          return;
        }
        if (isGambitEndSignal(result)) {
          const endMessage = result.message ??
            (typeof result.payload === "string"
              ? result.payload
              : formatResult(result));
          updateMessage(assistantId, endMessage);
          exit();
          return;
        }
        if (typeof result === "string") {
          updateMessage(assistantId, result);
        } else if (result !== undefined) {
          updateMessage(assistantId, formatResult(result));
        }
      } catch (err) {
        updateMessage(
          assistantId,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (toolStatusId) {
          updateMessage(toolStatusId, formatToolStatus(toolSummary, true));
        }
        setIsRunning(false);
      }
    },
    [appendMessage, exit, isRunning, opts, updateMessage],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (opts.initialMessage !== undefined) {
      void runTurn({
        deckInput: opts.initialInit,
        inputProvided: Boolean(opts.initProvided),
        userMessage: opts.initialMessage,
        showUserMessage: true,
      });
      return;
    }
    void runTurn({
      deckInput: opts.initialInit,
      inputProvided: Boolean(opts.initProvided),
      userMessage: undefined,
      showUserMessage: false,
    });
  }, [
    opts.initialInit,
    opts.initialMessage,
    opts.initProvided,
    runTurn,
  ]);

  useInput((inputChunk, key) => {
    if (key.ctrl && (inputChunk === "c" || inputChunk === "d")) {
      exit();
      return;
    }
    if (key.return) {
      const trimmed = input.trim();
      if (!trimmed) return;
      setInput("");
      void runTurn({
        deckInput: undefined,
        inputProvided: false,
        userMessage: trimmed,
        showUserMessage: true,
      });
      return;
    }
    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }
    if (key.escape) {
      setInput("");
      return;
    }
    if (inputChunk) {
      setInput((prev) => prev + inputChunk);
    }
  });

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {messages.map((msg) => (
          <Text key={msg.id}>
            {formatRole(msg.role)} {msg.content}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text>{`> ${input}`}</Text>
        <Text dimColor>
          {isRunning ? "Running..." : "Enter to send. Ctrl+C/D to exit."}
        </Text>
      </Box>
    </Box>
  );
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

function insertStatusMessage(
  setMessages: Dispatch<SetStateAction<Array<Message>>>,
  assistantId: string,
  statusMessage: Message,
) {
  setMessages((prev) => {
    const idx = prev.findIndex((msg) => msg.id === assistantId);
    if (idx === -1) return [...prev, statusMessage];
    return [
      ...prev.slice(0, idx),
      statusMessage,
      ...prev.slice(idx),
    ];
  });
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
