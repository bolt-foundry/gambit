#!/usr/bin/env -S deno run -A

import * as path from "@std/path";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import { startWebSocketSimulator } from "@bolt-foundry/gambit-simulator/src/server.ts";

function parsePort(args: Array<string>): number | undefined {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--port" && i + 1 < args.length) {
      const value = Number(args[i + 1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

function resolveRepoRoot(): string {
  const moduleDir = path.dirname(path.fromFileUrl(import.meta.url));
  return path.resolve(moduleDir, "../../../../..");
}

function resolveHelloDeck(repoRoot: string): string {
  return path.join(
    repoRoot,
    "packages",
    "gambit",
    "scaffolds",
    "demo",
    "hello.deck.md",
  );
}

const provider: ModelProvider = {
  chat(input) {
    if (input.stream && typeof input.onStreamText === "function") {
      input.onStreamText("ok");
    }
    return Promise.resolve({
      message: { role: "assistant", content: "ok" },
      finishReason: "stop",
    });
  },
};

const repoRoot = resolveRepoRoot();
const deckPath = resolveHelloDeck(repoRoot);
const port = parsePort(Deno.args);

const server = startWebSocketSimulator({
  deckPath,
  modelProvider: provider,
  port,
  responsesMode: false,
  autoBundle: false,
  forceBundle: false,
  sourceMap: false,
});

const shutdown = async () => {
  try {
    await server.shutdown();
  } catch {
    // ignore
  }
};

Deno.addSignalListener("SIGTERM", () => {
  void shutdown();
});

Deno.addSignalListener("SIGINT", () => {
  void shutdown();
});

await server.finished;
