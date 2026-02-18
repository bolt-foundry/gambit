import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { startWebSocketSimulator } from "./server.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import {
  modImportPath,
  readJsonLines,
  runSimulator,
} from "./server_test_utils.ts";

Deno.test("simulator persists snapshot + events and hydrates traces", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "persist.deck.ts");
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
        usage: {
          promptTokens: 5,
          completionTokens: 3,
          totalTokens: 8,
          reasoningTokens: 2,
        },
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
    sessionDir: sessionsDir,
  });

  const port = (server.addr as Deno.NetAddr).port;
  const result = await runSimulator(port, { input: "hello", stream: false });
  assert(result.workspaceId, "missing workspaceId");

  const sessionDir = path.join(sessionsDir, result.workspaceId!);
  const statePath = path.join(sessionDir, "state.json");
  const eventsPath = path.join(sessionDir, "events.jsonl");

  const state = JSON.parse(await Deno.readTextFile(statePath)) as Record<
    string,
    unknown
  >;
  assert(!("traces" in state), "state.json should exclude traces");
  const meta = state.meta as Record<string, unknown>;
  assertEquals(meta.sessionEventsPath, eventsPath);
  assertEquals(
    meta.sessionBuildStatePath,
    path.join(sessionDir, "build_state.json"),
  );

  const events = await readJsonLines(eventsPath);
  assert(events.length > 0, "events.jsonl should have entries");
  assert(
    events.some((event) =>
      (event as { type?: string }).type ===
        "gambit.session.start"
    ),
  );
  assert(
    events.some((event) => (event as { kind?: string }).kind === "trace"),
  );

  const sessionRes = await fetch(
    `http://127.0.0.1:${port}/api/workspaces/${
      encodeURIComponent(result.workspaceId ?? "")
    }`,
  );
  const sessionPayload = await sessionRes.json() as {
    session?: { traces?: Array<unknown> };
  };
  assert(Array.isArray(sessionPayload.session?.traces));
  assert(
    (sessionPayload.session?.traces?.length ?? 0) > 0,
    "traces should hydrate from events",
  );
  const modelResult = sessionPayload.session?.traces?.find((entry) =>
    (entry as { type?: string }).type === "model.result"
  ) as { usage?: { reasoningTokens?: number } } | undefined;
  assert(modelResult, "expected model.result trace");
  assertEquals(modelResult.usage?.reasoningTokens, 2);

  await server.shutdown();
  await server.finished;
});

Deno.test("simulator run fails when provided workspace state has unsupported schema", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "schema-mismatch.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
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

  const port = (server.addr as Deno.NetAddr).port;

  const legacyWorkspaceId = "legacy-workspace";
  const legacyWorkspaceDir = path.join(sessionsDir, legacyWorkspaceId);
  await Deno.mkdir(legacyWorkspaceDir, { recursive: true });
  await Deno.writeTextFile(
    path.join(legacyWorkspaceDir, "state.json"),
    JSON.stringify({
      runId: legacyWorkspaceId,
      messages: [],
      meta: {
        workspaceSchemaVersion: "workspace-state.v0",
      },
    }),
  );

  const res = await fetch(`http://127.0.0.1:${port}/api/simulator/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: "hello",
      stream: false,
      workspaceId: legacyWorkspaceId,
    }),
  });
  assertEquals(res.status, 400);
  const body = await res.json() as { error?: string };
  assertEquals(
    body.error?.includes("Unsupported workspace state schema"),
    true,
  );

  await server.shutdown();
  await server.finished;
});

Deno.test("session delete requires explicit workspaceId when active workspace exists", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();
  const activeWorkspaceId = "active-workspace";

  const deckPath = path.join(dir, "delete-explicit.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const activeWorkspaceDir = path.join(sessionsDir, activeWorkspaceId);
  await Deno.mkdir(activeWorkspaceDir, { recursive: true });
  await Deno.writeTextFile(path.join(activeWorkspaceDir, "state.json"), "{}");

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
    workspace: {
      id: activeWorkspaceId,
      rootDeckPath: deckPath,
      rootDir: dir,
    },
  });
  const port = (server.addr as Deno.NetAddr).port;

  const missingWorkspaceRes = await fetch(
    `http://127.0.0.1:${port}/api/session/delete`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  assertEquals(missingWorkspaceRes.status, 400);
  const missingWorkspaceBody = await missingWorkspaceRes.json() as {
    error?: string;
  };
  assertEquals(missingWorkspaceBody.error, "Missing workspaceId");
  assertEquals(await Deno.stat(activeWorkspaceDir).then(() => true), true);

  const deleteRes = await fetch(`http://127.0.0.1:${port}/api/session/delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: activeWorkspaceId }),
  });
  assertEquals(deleteRes.status, 200);
  const deleteBody = await deleteRes.json() as {
    workspaceId?: string;
    deleted?: boolean;
  };
  assertEquals(deleteBody.workspaceId, activeWorkspaceId);
  assertEquals(deleteBody.deleted, true);
  assertEquals(
    await Deno.stat(activeWorkspaceDir).then(() => true).catch(() => false),
    false,
  );

  await server.shutdown();
  await server.finished;
});

Deno.test("session events are monotonic and snapshot replay boundary matches highest offset", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "event-seq.deck.ts");
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
  const port = (server.addr as Deno.NetAddr).port;

  const first = await runSimulator(port, { input: "one", stream: false });
  await runSimulator(port, {
    input: "two",
    stream: false,
    workspaceId: first.workspaceId,
  });

  const workspaceId = first.workspaceId!;
  const statePath = path.join(sessionsDir, workspaceId, "state.json");
  const eventsPath = path.join(sessionsDir, workspaceId, "events.jsonl");
  const events = await readJsonLines(eventsPath) as Array<
    { offset?: number }
  >;
  const offsets = events.map((event) => event.offset).filter((
    value,
  ): value is number => typeof value === "number");
  assert(offsets.length > 0, "expected sequenced events");
  for (let i = 1; i < offsets.length; i += 1) {
    assertEquals(offsets[i], offsets[i - 1] + 1);
  }
  const maxOffset = Math.max(...offsets);
  const state = JSON.parse(await Deno.readTextFile(statePath)) as {
    meta?: { lastAppliedOffset?: number };
  };
  assertEquals(state.meta?.lastAppliedOffset, maxOffset);

  await server.shutdown();
  await server.finished;
});

Deno.test("session read rejects corrupted event offset gaps", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "event-gap.deck.ts");
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
  const port = (server.addr as Deno.NetAddr).port;

  const first = await runSimulator(port, { input: "one", stream: false });
  const workspaceId = first.workspaceId!;
  const eventsPath = path.join(sessionsDir, workspaceId, "events.jsonl");
  const rows = await readJsonLines(eventsPath) as Array<
    Record<string, unknown>
  >;
  assert(rows.length >= 2, "expected at least two events");
  const secondOffset = rows[1].offset;
  assert(typeof secondOffset === "number");
  rows[1].offset = secondOffset + 1;
  await Deno.writeTextFile(
    eventsPath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );

  const sessionRes = await fetch(
    `http://127.0.0.1:${port}/api/workspaces/${
      encodeURIComponent(workspaceId)
    }`,
  );
  assertEquals(sessionRes.status, 400);
  const body = await sessionRes.json() as { error?: string };
  assert(
    typeof body.error === "string" &&
      body.error.includes("Non-monotonic offset"),
  );

  await server.shutdown();
  await server.finished;
});

Deno.test("session offsets remain monotonic when snapshot state write fails", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "snapshot-write-fail.deck.ts");
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
  const port = (server.addr as Deno.NetAddr).port;

  const first = await runSimulator(port, { input: "one", stream: false });
  const workspaceId = first.workspaceId!;
  const workspaceDir = path.join(sessionsDir, workspaceId);
  const statePath = path.join(workspaceDir, "state.json");
  const eventsPath = path.join(workspaceDir, "events.jsonl");

  const state = JSON.parse(await Deno.readTextFile(statePath)) as {
    meta?: Record<string, unknown>;
  };
  state.meta = { ...(state.meta ?? {}), sessionStatePath: workspaceDir };
  await Deno.writeTextFile(statePath, JSON.stringify(state, null, 2) + "\n");

  await runSimulator(port, {
    input: "two",
    stream: false,
    workspaceId,
  });
  await runSimulator(port, {
    input: "three",
    stream: false,
    workspaceId,
  });

  const events = await readJsonLines(eventsPath) as Array<{ offset?: number }>;
  const offsets = events.map((event) => event.offset).filter((
    value,
  ): value is number => typeof value === "number");
  assert(offsets.length >= 3, "expected multiple persisted events");
  for (let i = 1; i < offsets.length; i += 1) {
    assertEquals(offsets[i], offsets[i - 1] + 1);
  }

  await server.shutdown();
  await server.finished;
});

Deno.test("test status selects canonical scenario run summary deterministically", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "scenario-summary.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
      testDecks: [{ id: "test-a", label: "Test A", path: "${
      deckPath.replaceAll("\\", "\\\\")
    }" }],
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

  const workspaceId = "workspace-summary";
  const workspaceDir = path.join(sessionsDir, workspaceId);
  await Deno.mkdir(workspaceDir, { recursive: true });
  await Deno.writeTextFile(
    path.join(workspaceDir, "state.json"),
    JSON.stringify({
      runId: "legacy-run",
      messages: [{ role: "assistant", content: "hi" }],
      messageRefs: [{ id: "msg-1", role: "assistant" }],
      meta: {
        workspaceSchemaVersion: "workspace-state.v1",
        sessionId: workspaceId,
        workspaceId,
        scenarioRunSummaries: [
          {
            scenarioRunId: "run-c",
            lastEventSeq: 17,
            updatedAt: "2025-01-01T00:00:00.000Z",
            selectedScenarioDeckId: "deck-c",
            scenarioConfigPath: deckPath,
          },
          {
            scenarioRunId: "run-a",
            lastEventSeq: 17,
            updatedAt: "2025-01-01T00:00:00.000Z",
            selectedScenarioDeckId: "deck-a",
            scenarioConfigPath: deckPath,
          },
        ],
      },
    }),
  );

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
    sessionDir: sessionsDir,
  });
  const port = (server.addr as Deno.NetAddr).port;

  const res = await fetch(
    `http://127.0.0.1:${port}/api/workspaces/${
      encodeURIComponent(workspaceId)
    }`,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as {
    test?: { run?: { id?: string } };
  };
  assertEquals(body.test?.run?.id, "run-a");

  await server.shutdown();
  await server.finished;
});

Deno.test("workspace endpoint returns projection-backed build + session payload and writes build_state.json", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "workspace-read-model.deck.ts");
  await Deno.writeTextFile(
    deckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const provider: ModelProvider = {
    chat(input) {
      input.onStreamText?.("o");
      input.onStreamText?.("k");
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
  const port = (server.addr as Deno.NetAddr).port;

  const createWorkspaceRes = await fetch(
    `http://127.0.0.1:${port}/api/workspace/new`,
    { method: "POST" },
  );
  const createWorkspaceBody = await createWorkspaceRes.json() as {
    workspaceId?: string;
  };
  const workspaceId = createWorkspaceBody.workspaceId ?? "";
  assert(workspaceId.length > 0, "workspace id required");

  const buildRes = await fetch(`http://127.0.0.1:${port}/api/build/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, message: "hello" }),
  });
  assertEquals(buildRes.ok, true);
  await buildRes.text();

  // Wait for build projection write.
  for (let i = 0; i < 30; i += 1) {
    const exists = await Deno.stat(
      path.join(sessionsDir, workspaceId, "build_state.json"),
    )
      .then(() => true)
      .catch(() => false);
    if (exists) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const workspaceRes = await fetch(
    `http://127.0.0.1:${port}/api/workspaces/${
      encodeURIComponent(workspaceId)
    }`,
  );
  assertEquals(workspaceRes.status, 200);
  const workspacePayload = await workspaceRes.json() as {
    workspaceId?: string;
    build?: { run?: { id?: string } };
    session?: { workspaceId?: string; messages?: Array<unknown> };
  };
  assertEquals(workspacePayload.workspaceId, workspaceId);
  assertEquals(workspacePayload.build?.run?.id, workspaceId);
  assertEquals(workspacePayload.session?.workspaceId, workspaceId);
  assert(Array.isArray(workspacePayload.session?.messages));

  await server.shutdown();
  await server.finished;
});
