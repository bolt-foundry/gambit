import { assertEquals } from "@std/assert";
import * as path from "@std/path";
import { startWebSocketSimulator } from "./server.ts";
import type { ModelProvider } from "./types.ts";

function modImportPath() {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const modPath = path.resolve(here, "..", "mod.ts");
  return path.toFileUrl(modPath).href;
}

Deno.test("websocket simulator streams responses", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = path.join(dir, "ws.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const provider: ModelProvider = {
    async chat(input) {
      input.onStreamText?.("h");
      input.onStreamText?.("i");
      return {
        message: { role: "assistant", content: "hi" },
        finishReason: "stop",
      };
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });

  const port = (server.addr as Deno.NetAddr).port;
  const messages: Array<{ type?: string; chunk?: string; result?: unknown }> = [];

  const homepage = await fetch(`http://127.0.0.1:${port}/`);
  const html = await homepage.text();
  if (!html.includes("Gambit WebSocket Simulator")) {
    throw new Error("Simulator page missing expected content");
  }

  const resultPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 2000);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/websocket`);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as {
        type?: string;
        chunk?: string;
        result?: unknown;
      };
      messages.push(msg);
      if (msg.type === "result") {
        clearTimeout(timer);
        ws.close();
        resolve(msg as Record<string, unknown>);
      }
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "run", input: "hello" }));
    };
  });

  const resultMsg = await resultPromise;
  await server.shutdown();
  await server.finished;

  assertEquals(resultMsg.result, "hi");
  const streams = messages.filter((m) => m.type === "stream").map((m) => m.chunk ?? "")
    .join("");
  assertEquals(streams, "hi");

  const types = messages.map((m) => m.type);
  assertEquals(types.includes("ready"), true);
  assertEquals(types.includes("result"), true);
});
