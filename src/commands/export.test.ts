import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { UntarStream } from "@std/tar";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import {
  modImportPath,
  runSimulator,
} from "@bolt-foundry/gambit-simulator/src/server_test_utils.ts";
import { startWebSocketSimulator } from "@bolt-foundry/gambit-simulator";
import { exportBundle } from "./export.ts";

async function readTarGzEntries(
  archivePath: string,
): Promise<Map<string, string>> {
  const bytes = await Deno.readFile(archivePath);
  const entries = new Map<string, string>();
  const stream = ReadableStream.from([bytes])
    .pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(new UntarStream());
  for await (const entry of stream) {
    const reader = entry.readable?.getReader();
    if (!reader) continue;
    const chunks: Array<Uint8Array> = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
    const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    entries.set(entry.path, new TextDecoder().decode(merged));
  }
  return entries;
}

Deno.test({
  name:
    "exportBundle derives session artifacts from sqlite-authoritative workspace state",
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const dir = await Deno.makeTempDir({ prefix: "gambit-export-" });
  const sessionsDir = path.join(dir, "sessions");
  const outPath = path.join(dir, "bundle.tar.gz");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "export.deck.ts");
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
    chat() {
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
    sessionDir: sessionsDir,
  });

  try {
    const port = (server.addr as Deno.NetAddr).port;
    const result = await runSimulator(port, {
      input: "hello",
      message: "hello",
      stream: false,
    });
    assert(result.workspaceId, "missing workspaceId");

    const workspaceDir = path.join(sessionsDir, result.workspaceId);
    const sqlitePath = path.join(workspaceDir, "workspace.sqlite");
    assertEquals(
      await Deno.stat(path.join(workspaceDir, "state.json")).catch(() => null),
      null,
    );
    assertEquals(
      await Deno.stat(path.join(workspaceDir, "events.jsonl")).catch(() =>
        null
      ),
      null,
    );

    await exportBundle({
      statePath: sqlitePath,
      outPath,
      deckPath,
    });

    const entries = await readTarGzEntries(outPath);
    assert(entries.has("manifest.json"));
    assert(entries.has("session/workspace.sqlite"));
    assert(entries.has("session/workspace.events.jsonl"));

    const eventLines = (entries.get("session/workspace.events.jsonl") ?? "")
      .trim()
      .split("\n")
      .filter(Boolean);
    assert(eventLines.length > 0, "expected exported session events");
    assert(eventLines.some((line) => line.includes("gambit.session.start")));
    assertEquals(await Deno.stat(sqlitePath).then(() => true), true);
  } finally {
    await server.shutdown();
    await server.finished;
    await Deno.remove(dir, { recursive: true });
  }
});
