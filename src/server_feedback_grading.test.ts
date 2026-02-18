import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { startWebSocketSimulator } from "./server.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import {
  modImportPath,
  readJsonLines,
  runSimulator,
} from "./server_test_utils.ts";

Deno.test("simulator appends feedback log entries", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "feedback.deck.ts");
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
  const result = await runSimulator(port, { input: "hello", stream: false });
  assert(result.workspaceId, "missing workspaceId");

  const sessionDir = path.join(sessionsDir, result.workspaceId!);
  const state = JSON.parse(
    await Deno.readTextFile(path.join(sessionDir, "state.json")),
  ) as {
    messages?: Array<{ role?: string }>;
    messageRefs?: Array<{ id?: string }>;
  };
  const assistantRef = (state.messages ?? [])
    .map((message, index) => ({
      role: message.role,
      refId: state.messageRefs?.[index]?.id,
    }))
    .find((entry) => entry.role === "assistant" && entry.refId);
  const messageRefId = assistantRef?.refId;
  assert(messageRefId, "missing messageRefId");

  const res = await fetch(`http://127.0.0.1:${port}/api/simulator/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: result.workspaceId,
      messageRefId,
      score: 1,
      reason: "ok",
    }),
  });
  assert(res.ok);
  await res.json();

  const eventsPath = path.join(sessionDir, "events.jsonl");
  const entries = await readJsonLines(eventsPath);
  assert(entries.length > 0, "events.jsonl should have entries");
  assert(
    entries.some((entry) =>
      (entry as { type?: string }).type ===
        "gambit.feedback.update"
    ),
  );

  await server.shutdown();
  await server.finished;
});

Deno.test("session feedback rejects non-response message refs", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "feedback-eligibility.deck.ts");
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

  const first = await runSimulator(port, {
    input: "hello",
    message: "hello",
    stream: false,
  });
  const workspaceId = first.workspaceId!;
  const state = JSON.parse(
    await Deno.readTextFile(path.join(sessionsDir, workspaceId, "state.json")),
  ) as {
    messages?: Array<{ role?: string }>;
    messageRefs?: Array<{ id?: string }>;
  };
  const userRef = (state.messages ?? [])
    .map((message, index) => ({
      role: message.role,
      refId: state.messageRefs?.[index]?.id,
    }))
    .find((entry) => entry.role === "user" && entry.refId)?.refId;
  assert(userRef, "expected user ref");

  const res = await fetch(`http://127.0.0.1:${port}/api/session/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      messageRefId: userRef,
      score: 1,
      reason: "should fail",
    }),
  });
  assertEquals(res.status, 400);
  const body = await res.json() as { error?: string };
  assert(
    typeof body.error === "string" &&
      body.error.includes("not eligible"),
  );

  await server.shutdown();
  await server.finished;
});

Deno.test("session feedback accepts persisted run message refs when runId is provided", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "feedback-persisted-run.deck.ts");
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

  const workspaceId = "workspace-feedback-persisted";
  const workspaceDir = path.join(sessionsDir, workspaceId);
  await Deno.mkdir(workspaceDir, { recursive: true });
  await Deno.writeTextFile(
    path.join(workspaceDir, "state.json"),
    JSON.stringify({
      runId: "session-current",
      messages: [{ role: "assistant", content: "latest response" }],
      messageRefs: [{ id: "msg-current", role: "assistant" }],
      meta: {
        workspaceSchemaVersion: "workspace-state.v1",
        sessionId: workspaceId,
        workspaceId,
      },
    }),
  );
  await Deno.writeTextFile(
    path.join(workspaceDir, "events.jsonl"),
    JSON.stringify({
      type: "testBotStatus",
      offset: 0,
      createdAt: new Date().toISOString(),
      _gambit: {
        domain: "test",
        offset: 0,
      },
      run: {
        id: "testbot-older-run",
        status: "completed",
        workspaceId,
        sessionId: workspaceId,
        messages: [{
          role: "assistant",
          content: "older run response",
          messageRefId: "msg-from-older-run",
        }],
        traces: [],
        toolInserts: [],
      },
    }) + "\n",
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

  const res = await fetch(`http://127.0.0.1:${port}/api/session/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      runId: "testbot-older-run",
      messageRefId: "msg-from-older-run",
      score: -3,
      reason: "old run message",
    }),
  });
  assertEquals(res.status, 200);
  const body = await res.json() as {
    feedback?: { runId?: string; messageRefId?: string; score?: number };
  };
  assertEquals(body.feedback?.runId, "testbot-older-run");
  assertEquals(body.feedback?.messageRefId, "msg-from-older-run");
  assertEquals(body.feedback?.score, -3);

  const nextState = JSON.parse(
    await Deno.readTextFile(path.join(workspaceDir, "state.json")),
  ) as {
    feedback?: Array<{ messageRefId?: string; runId?: string }>;
  };
  const saved = (nextState.feedback ?? []).find((entry) =>
    entry.messageRefId === "msg-from-older-run"
  );
  assert(saved);
  assertEquals(saved.runId, "testbot-older-run");

  await server.shutdown();
  await server.finished;
});

Deno.test("session feedback accepts scenario user refs and rejects manual/artifact user refs", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "feedback-scenario-user.deck.ts");
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

  const workspaceId = "workspace-feedback-user-source";
  const workspaceDir = path.join(sessionsDir, workspaceId);
  await Deno.mkdir(workspaceDir, { recursive: true });
  await Deno.writeTextFile(
    path.join(workspaceDir, "state.json"),
    JSON.stringify({
      runId: "session-source",
      messages: [
        { role: "user", content: "scenario prompt" },
        { role: "user", content: "manual prompt" },
        { role: "user", content: "artifact prompt" },
      ],
      messageRefs: [
        { id: "msg-scenario-user", role: "user", source: "scenario" },
        { id: "msg-manual-user", role: "user", source: "manual" },
        { id: "msg-artifact-user", role: "user", source: "artifact" },
      ],
      meta: {
        workspaceSchemaVersion: "workspace-state.v1",
        sessionId: workspaceId,
        workspaceId,
      },
    }),
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

  const scenarioRes = await fetch(
    `http://127.0.0.1:${port}/api/session/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        messageRefId: "msg-scenario-user",
        score: -2,
        reason: "scenario input quality",
      }),
    },
  );
  assertEquals(scenarioRes.status, 200);
  const scenarioBody = await scenarioRes.json() as {
    feedback?: { messageRefId?: string; score?: number };
  };
  assertEquals(scenarioBody.feedback?.messageRefId, "msg-scenario-user");
  assertEquals(scenarioBody.feedback?.score, -2);

  const manualRes = await fetch(
    `http://127.0.0.1:${port}/api/session/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        messageRefId: "msg-manual-user",
        score: -1,
        reason: "manual input should reject",
      }),
    },
  );
  assertEquals(manualRes.status, 400);
  const manualBody = await manualRes.json() as { error?: string };
  assert(
    typeof manualBody.error === "string" &&
      manualBody.error.includes("not eligible"),
  );

  const artifactRes = await fetch(
    `http://127.0.0.1:${port}/api/session/feedback`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        messageRefId: "msg-artifact-user",
        score: -1,
        reason: "artifact input should reject",
      }),
    },
  );
  assertEquals(artifactRes.status, 400);
  const artifactBody = await artifactRes.json() as { error?: string };
  assert(
    typeof artifactBody.error === "string" &&
      artifactBody.error.includes("not eligible"),
  );

  await server.shutdown();
  await server.finished;
});

Deno.test("grading reference writes are append-only revisions and require messageRefId", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();

  const deckPath = path.join(dir, "grading-reference.deck.ts");
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

  const workspaceId = "workspace-grading";
  const workspaceDir = path.join(sessionsDir, workspaceId);
  await Deno.mkdir(workspaceDir, { recursive: true });
  await Deno.writeTextFile(
    path.join(workspaceDir, "state.json"),
    JSON.stringify({
      runId: workspaceId,
      messages: [{ role: "assistant", content: "assistant output" }],
      messageRefs: [{ id: "msg-1", role: "assistant" }],
      meta: {
        workspaceSchemaVersion: "workspace-state.v1",
        sessionId: workspaceId,
        workspaceId,
        gradingRuns: [{
          id: "cal-1",
          graderId: "grader-1",
          graderPath: deckPath,
          status: "completed",
          result: {
            mode: "turns",
            totalTurns: 2,
            turns: [
              { index: 0, messageRefId: "msg-1", result: { score: 1 } },
              { index: 1, result: { score: 1 } },
            ],
          },
        }],
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

  const writeReference = async () =>
    await fetch(`http://127.0.0.1:${port}/api/grading/reference`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        runId: "cal-1",
        turnIndex: 0,
        referenceSample: { score: 2, reason: "expected", evidence: ["x"] },
      }),
    });

  const firstWrite = await writeReference();
  assertEquals(firstWrite.status, 200);
  const firstBody = await firstWrite.json() as {
    run?: { result?: { turns?: Array<Record<string, unknown>> } };
  };
  const firstTurn = firstBody.run?.result?.turns?.find((turn) =>
    turn.index === 0
  );
  const firstRevisions = Array.isArray(firstTurn?.referenceSampleRevisions)
    ? firstTurn?.referenceSampleRevisions as Array<Record<string, unknown>>
    : [];
  assertEquals(firstRevisions.length, 1);
  const firstRevisionId = firstRevisions[0]?.artifactRevisionId;
  assert(typeof firstRevisionId === "string");

  const secondWrite = await writeReference();
  assertEquals(secondWrite.status, 200);
  const secondBody = await secondWrite.json() as {
    run?: { result?: { turns?: Array<Record<string, unknown>> } };
  };
  const secondTurn = secondBody.run?.result?.turns?.find((turn) =>
    turn.index === 0
  );
  const secondRevisions = Array.isArray(secondTurn?.referenceSampleRevisions)
    ? secondTurn?.referenceSampleRevisions as Array<Record<string, unknown>>
    : [];
  assertEquals(secondRevisions.length, 2);
  assertEquals(secondRevisions[0]?.artifactRevisionId, firstRevisionId);
  assert(
    secondTurn?.referenceSample &&
      typeof (secondTurn.referenceSample as { artifactRevisionId?: unknown })
          .artifactRevisionId === "string",
  );

  const missingRefRes = await fetch(
    `http://127.0.0.1:${port}/api/grading/reference`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        runId: "cal-1",
        turnIndex: 1,
        referenceSample: { score: 0, reason: "missing ref" },
      }),
    },
  );
  assertEquals(missingRefRes.status, 400);
  const missingRefBody = await missingRefRes.json() as { error?: string };
  assert(
    typeof missingRefBody.error === "string" &&
      missingRefBody.error.includes("Missing messageRefId"),
  );

  await server.shutdown();
  await server.finished;
});
