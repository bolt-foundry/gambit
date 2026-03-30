#!/usr/bin/env -S deno run -A

import { startWebSocketSimulator } from "../../src/server.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core";

function parseArgs(args: Array<string>): { deckPath: string; port: number } {
  let deckPath = "";
  let port = 8000;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--port") {
      const raw = args[index + 1] ?? "";
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --port value: ${raw}`);
      }
      port = parsed;
      index += 1;
      continue;
    }
    if (!deckPath) {
      deckPath = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!deckPath) {
    throw new Error(
      "Usage: serve-test-tab-demo.ts <deck-path> [--port <port>]",
    );
  }
  return { deckPath, port };
}

const provider: ModelProvider = {
  chat(input) {
    const lastUser = [...input.messages].reverse().find((message) =>
      message?.role === "user"
    );
    const prompt = typeof lastUser?.content === "string"
      ? lastUser.content.trim().toLowerCase()
      : "";
    return Promise.resolve({
      message: {
        role: "assistant",
        content: prompt === "how are you"
          ? "Fine. What do you need?"
          : prompt.length === 0
          ? "Ready."
          : "",
      },
      finishReason: "stop",
    });
  },
};

if (import.meta.main) {
  const { deckPath, port } = parseArgs(Deno.args);
  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port,
    sessionDir: `${Deno.cwd()}/.gambit/workspaces`,
    autoBundle: true,
    forceBundle: true,
    sourceMap: true,
  });
  await server.finished;
}
