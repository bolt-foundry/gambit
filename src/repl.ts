import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { ModelMessage } from "./types.ts";
import { runDeck } from "./runtime.ts";

export async function startRepl(opts: {
  deckPath: string;
  model: string | undefined;
  modelForce: string | undefined;
  modelProvider: import("./types.ts").ModelProvider;
  trace?: (event: import("./types.ts").TraceEvent) => void;
  verbose?: boolean;
  userFirst?: boolean;
}) {
  const rl = createInterface({ input: stdin, output: stdout });
  const history: ModelMessage[] = [];

  stdout.write("REPL started. Type 'exit' to quit.\n");
  // Gracefully handle Ctrl+C to exit without blowing up top-level await.
  rl.on("SIGINT", () => {
    stdout.write("\n");
    rl.close();
  });

  // When the interface closes (Ctrl+C or EOF), stop the loop.
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });

  while (true) {
    if (closed) break;
    let line: string;
    try {
      line = await rl.question("> ");
    } catch (err) {
      // Gracefully exit on EOF/closed input rather than throwing.
      if (err instanceof Error && err.message.includes("closed")) break;
      throw err;
    }
    if (line.trim().toLowerCase() === "exit") break;

    history.push({ role: "user", content: line });
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
        onStreamText: (chunk) => {
          if (!chunk) return;
          if (opts.verbose && !prefixPrinted) {
            stdout.write("[assistant] ");
            prefixPrinted = true;
          }
          streamed = true;
          stdout.write(chunk);
        },
        userFirst: opts.userFirst,
      });
      const formatted = formatResult(result);
      if (streamed) {
        if (!formatted.endsWith("\n")) stdout.write("\n");
      } else {
        const prefix = opts.verbose ? "[assistant] " : "";
        stdout.write(`${prefix}${formatted}\n`);
      }
      history.push({ role: "assistant", content: formatted });
    } catch (err) {
      stdout.write(
        `Error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  rl.close();
}

function formatResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}
