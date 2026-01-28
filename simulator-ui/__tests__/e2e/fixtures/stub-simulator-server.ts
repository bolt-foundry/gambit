import { startWebSocketSimulator } from "../../../../src/server.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core";

function readArg(flag: string): string | undefined {
  const idx = Deno.args.indexOf(flag);
  if (idx === -1) return undefined;
  return Deno.args[idx + 1];
}

const portRaw = readArg("--port");
const deckPath = readArg("--deck");

if (!portRaw || !deckPath) {
  console.error("Usage: --port <port> --deck <deck path>");
  Deno.exit(1);
}

const port = Number(portRaw);
if (!Number.isFinite(port) || port <= 0) {
  console.error(`Invalid --port value: ${portRaw}`);
  Deno.exit(1);
}

const modelProvider: ModelProvider = {
  chat(input) {
    input.onStreamText?.("ok");
    return Promise.resolve({
      message: { role: "assistant", content: "ok" },
      finishReason: "stop",
    });
  },
};

startWebSocketSimulator({
  deckPath,
  modelProvider,
  port,
  autoBundle: true,
});
