import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { ModelMessage } from "./types.ts";
import { runDeck } from "./runtime.ts";

export async function startRepl(opts: {
  deckPath: string;
  model: string | undefined;
  modelForce: string | undefined;
  modelProvider: import("./types.ts").ModelProvider;
}) {
  const rl = createInterface({ input: stdin, output: stdout });
  const history: ModelMessage[] = [];

  stdout.write("REPL started. Type 'exit' to quit.\n");

  while (true) {
    const line = await rl.question("> ");
    if (line.trim().toLowerCase() === "exit") break;

    history.push({ role: "user", content: line });
    try {
      const result = await runDeck({
        path: opts.deckPath,
        input: line,
        modelProvider: opts.modelProvider,
        isRoot: true,
        defaultModel: opts.model,
        modelOverride: opts.modelForce,
      });
      stdout.write(`${formatResult(result)}\n`);
      history.push({ role: "assistant", content: formatResult(result) });
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
