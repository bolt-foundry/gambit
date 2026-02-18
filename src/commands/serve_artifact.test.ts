import { assertEquals, assertRejects } from "@std/assert";
import { TarStream } from "@std/tar";
import * as path from "@std/path";
import { restoreServeArtifactBundle } from "./serve_artifact.ts";
import { handleServeCommand } from "./serve.ts";

async function tarGzBytes(
  entries: Array<{ path: string; body: string }>,
): Promise<Uint8Array> {
  const tarEntries = entries.map((entry) => {
    const bytes = new TextEncoder().encode(entry.body);
    return {
      type: "file" as const,
      path: entry.path,
      size: bytes.length,
      readable: ReadableStream.from([bytes]),
    };
  });
  const tar = ReadableStream.from(tarEntries).pipeThrough(new TarStream());
  const gzip = tar.pipeThrough(
    new CompressionStream("gzip") as unknown as ReadableWritablePair<
      Uint8Array,
      Uint8Array
    >,
  );
  const chunks: Array<Uint8Array> = [];
  for await (const chunk of gzip) {
    chunks.push(chunk);
  }
  const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

Deno.test({
  name: "restoreServeArtifactBundle restores workspace and is idempotent",
  permissions: { read: true, write: true },
}, async () => {
  const projectRoot = await Deno.makeTempDir({ prefix: "serve-artifact-" });
  const artifactPath = path.join(projectRoot, "bundle.tar.gz");
  await Deno.writeTextFile(path.join(projectRoot, "deno.jsonc"), "{}\n");

  try {
    const bundle = await tarGzBytes([
      {
        path: "manifest.json",
        body: JSON.stringify({
          deck: { entry_file: "deck/apps/demo/root.deck.md" },
        }),
      },
      {
        path: "deck/apps/demo/root.deck.md",
        body: "# root deck\n",
      },
      {
        path: "session/state.json",
        body: JSON.stringify({
          runId: "run-1",
          format: "chat",
          messages: [],
          meta: { sessionId: "faq-session-001" },
        }),
      },
      {
        path: "session/events.jsonl",
        body: "",
      },
    ]);
    await Deno.writeFile(artifactPath, bundle);

    const first = await restoreServeArtifactBundle({
      artifactPath,
      projectRoot,
    });
    assertEquals(first.sessionId, "faq-session-001");
    assertEquals(first.restored, true);

    const restoredState = JSON.parse(
      await Deno.readTextFile(path.join(first.sessionDir, "state.json")),
    ) as { meta?: Record<string, unknown> };
    assertEquals(restoredState.meta?.sessionId, "faq-session-001");
    assertEquals(
      restoredState.meta?.workspaceRootDeckPath,
      first.rootDeckPath,
    );
    assertEquals(
      restoredState.meta?.workspaceRootDir,
      path.join(first.sessionDir, "deck"),
    );

    const second = await restoreServeArtifactBundle({
      artifactPath,
      projectRoot,
    });
    assertEquals(second.sessionId, "faq-session-001");
    assertEquals(second.restored, false);
  } finally {
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test({
  name: "restoreServeArtifactBundle rejects traversal paths in archive entries",
  permissions: { read: true, write: true },
}, async () => {
  const projectRoot = await Deno.makeTempDir({ prefix: "serve-artifact-bad-" });
  const artifactPath = path.join(projectRoot, "bad.tar.gz");
  await Deno.writeTextFile(path.join(projectRoot, "deno.jsonc"), "{}\n");

  try {
    const bundle = await tarGzBytes([
      {
        path: "../escape.txt",
        body: "nope",
      },
    ]);
    await Deno.writeFile(artifactPath, bundle);
    await assertRejects(
      () =>
        restoreServeArtifactBundle({
          artifactPath,
          projectRoot,
        }),
      Error,
      "contains traversal",
    );
  } finally {
    await Deno.remove(projectRoot, { recursive: true });
  }
});

Deno.test("handleServeCommand rejects deck path with --artifact", async () => {
  await assertRejects(
    () =>
      handleServeCommand({
        deckPath: "root.deck.md",
        artifactPath: "bundle.tar.gz",
        modelProvider: {} as never,
      }),
    Error,
    "either a deck path or --artifact",
  );
});
