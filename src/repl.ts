import { runDeck } from "./runtime.ts";
import type { SavedState } from "./state.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const write = (text: string) => Deno.stdout.writeSync(encoder.encode(text));

export async function startRepl(opts: {
  deckPath: string;
  model: string | undefined;
  modelForce: string | undefined;
  modelProvider: import("./types.ts").ModelProvider;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  verbose?: boolean;
  userFirst?: boolean;
  initialInput?: unknown;
}) {
  const lineReader = createLineReader();
  let state: SavedState | undefined;
  let closed = false;

  const handleSigint = () => {
    closed = true;
    write("\n");
    lineReader.cancel();
  };
  Deno.addSignalListener("SIGINT", handleSigint);

  write("REPL started. Type 'exit' to quit.\n");

  const runOnce = async (line: unknown, assistantFirst = false) => {
    const userFirstFlag = assistantFirst ? false : true;
    try {
      let streamed = false;
      let prefixPrinted = false;
      const result = await runDeck({
        path: opts.deckPath,
        input: line,
        modelProvider: opts.modelProvider,
        isRoot: true,
        defaultModel: opts.model,
        modelOverride: opts.modelForce,
        trace: opts.trace,
        stream: true,
        state,
        onStateUpdate: (s) => {
          state = s;
        },
        onStreamText: (chunk) => {
          if (!chunk) return;
          if (opts.verbose && !prefixPrinted) {
            write("[assistant] ");
            prefixPrinted = true;
          }
          streamed = true;
          write(chunk);
        },
        userFirst: userFirstFlag,
      });
      const formatted = formatResult(result);
      if (streamed) {
        if (!formatted.endsWith("\n")) write("\n");
      } else {
        const prefix = opts.verbose ? "[assistant] " : "";
        write(`${prefix}${formatted}\n`);
      }
    } catch (err) {
      write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  };

  const skipAssistantLead = opts.userFirst || opts.initialInput !== undefined;

  if (!skipAssistantLead) {
    await runOnce("", true);
  }

  if (opts.initialInput !== undefined) {
    await runOnce(opts.initialInput);
  }

  while (!closed) {
    write("> ");
    const line = await lineReader.readLine();
    if (line === null) break;
    if (line.trim().toLowerCase() === "exit") break;
    await runOnce(line);
  }

  closed = true;
  await lineReader.close();
  Deno.removeSignalListener("SIGINT", handleSigint);
}

function formatResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function createLineReader() {
  const reader = Deno.stdin.readable.getReader();
  let buffer = "";
  let cancelled = false;

  const readLine = async (): Promise<string | null> => {
    while (true) {
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, "");
        buffer = buffer.slice(newlineIdx + 1);
        return line;
      }
      if (cancelled) return null;
      const { value, done } = await reader.read().catch((err) => {
        if (cancelled) return { value: undefined, done: true };
        throw err;
      });
      if (done || value === undefined) {
        if (buffer.length > 0) {
          const trailing = buffer.replace(/\r$/, "");
          buffer = "";
          return trailing;
        }
        return null;
      }
      buffer += decoder.decode(value, { stream: true });
    }
  };

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    reader.cancel().catch(() => {});
  };

  const close = () => {
    cancel();
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  };

  return { readLine, cancel, close };
}
