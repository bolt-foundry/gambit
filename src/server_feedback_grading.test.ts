import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { startWebSocketSimulator } from "./server.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import {
  modImportPath,
  parseGraphqlEnvelope,
  readJsonLines,
  startScenarioConversation,
} from "./server_test_utils.ts";

async function saveWorkspaceFeedback(args: {
  port: number;
  workspaceId: string;
  messageRefId: string;
  score: number | null;
  reason?: string;
  runId?: string;
}): Promise<Response> {
  return await fetch(`http://127.0.0.1:${args.port}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `
        mutation SaveFeedback($input: WorkspaceFeedbackSaveInput!) {
          workspaceFeedbackSave(input: $input) {
            deleted
            feedback {
              messageRefId
              runId
              score
              reason
            }
          }
        }
      `,
      variables: {
        input: {
          workspaceId: args.workspaceId,
          messageRefId: args.messageRefId,
          score: args.score,
          reason: args.reason ?? null,
          runId: args.runId ?? null,
        },
      },
    }),
  });
}

async function readStateMessageRefs(args: {
  sessionsDir: string;
  workspaceId: string;
}): Promise<Array<{ id?: string; role?: string; source?: string }>> {
  const state = JSON.parse(
    await Deno.readTextFile(
      path.join(args.sessionsDir, args.workspaceId, "state.json"),
    ),
  ) as {
    messageRefs?: Array<{ id?: string; role?: string; source?: string }>;
  };
  return Array.isArray(state.messageRefs) ? state.messageRefs : [];
}

async function waitForMessageRef(args: {
  sessionsDir: string;
  workspaceId: string;
  role: "assistant" | "user";
}): Promise<string | undefined> {
  for (let i = 0; i < 20; i++) {
    const refs = await readStateMessageRefs({
      sessionsDir: args.sessionsDir,
      workspaceId: args.workspaceId,
    });
    const match = refs.find((entry) =>
      entry.role === args.role && typeof entry.id === "string"
    )?.id;
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

async function readWorkspaceState(args: {
  sessionsDir: string;
  workspaceId: string;
}): Promise<{
  feedback?: Array<
    { messageRefId?: string; runId?: string; score?: number; reason?: string }
  >;
}> {
  return JSON.parse(
    await Deno.readTextFile(
      path.join(args.sessionsDir, args.workspaceId, "state.json"),
    ),
  ) as {
    feedback?: Array<
      { messageRefId?: string; runId?: string; score?: number; reason?: string }
    >;
  };
}

const leakTolerantTest = (name: string, fn: () => Promise<void> | void) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

leakTolerantTest("simulator appends feedback log entries", async () => {
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
  const result = await startScenarioConversation({ port, message: "hello" });
  const sessionDir = path.join(sessionsDir, result.workspaceId);
  const messageRefId = await waitForMessageRef({
    sessionsDir,
    workspaceId: result.workspaceId,
    role: "assistant",
  });
  assert(messageRefId, "missing messageRefId");

  const res = await saveWorkspaceFeedback({
    port,
    workspaceId: result.workspaceId,
    messageRefId,
    score: 1,
    reason: "ok",
  });
  const body = await parseGraphqlEnvelope<{
    workspaceFeedbackSave?: { feedback?: { score?: number } };
  }>(res);
  assertEquals(body.data?.workspaceFeedbackSave?.feedback?.score, 1);

  const eventsPath = path.join(sessionDir, "events.jsonl");
  let hasFeedbackUpdate = false;
  for (let i = 0; i < 20; i++) {
    const entries = await readJsonLines(eventsPath);
    hasFeedbackUpdate = entries.some((entry) =>
      (entry as { type?: string }).type === "gambit.feedback.update"
    );
    if (hasFeedbackUpdate) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert(hasFeedbackUpdate);

  await server.shutdown();
  await server.finished;
});

leakTolerantTest(
  "session feedback rejects non-response message refs",
  async () => {
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

    const first = await startScenarioConversation({ port, message: "hello" });
    const workspaceId = first.workspaceId;
    const userRef = await waitForMessageRef({
      sessionsDir,
      workspaceId,
      role: "user",
    });
    assert(userRef, "expected user ref");

    const res = await saveWorkspaceFeedback({
      port,
      workspaceId,
      messageRefId: userRef,
      score: 1,
      reason: "should fail",
    });
    assertEquals(res.status, 200);
    const body = await parseGraphqlEnvelope<
      { workspaceFeedbackSave?: unknown }
    >(
      res,
    );
    assertEquals(body.data?.workspaceFeedbackSave ?? null, null);
    const nextState = await readWorkspaceState({ sessionsDir, workspaceId });
    assertEquals(
      (nextState.feedback ?? []).some((entry) =>
        entry.messageRefId === userRef
      ),
      false,
    );

    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest(
  "session feedback preserves existing reason when score changes without reason",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();

    const deckPath = path.join(dir, "feedback-preserve-reason.deck.ts");
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

    const first = await startScenarioConversation({ port, message: "hello" });
    const workspaceId = first.workspaceId;
    const assistantRef = await waitForMessageRef({
      sessionsDir,
      workspaceId,
      role: "assistant",
    });
    assert(assistantRef, "expected assistant ref");

    const saveWithReasonRes = await saveWorkspaceFeedback({
      port,
      workspaceId,
      messageRefId: assistantRef,
      score: 3,
      reason: "great response",
    });
    assertEquals(saveWithReasonRes.ok, true);
    await parseGraphqlEnvelope(saveWithReasonRes);

    const saveScoreOnlyRes = await saveWorkspaceFeedback({
      port,
      workspaceId,
      messageRefId: assistantRef,
      score: -2,
    });
    assertEquals(saveScoreOnlyRes.ok, true);
    const saveScoreOnlyBody = await parseGraphqlEnvelope<{
      workspaceFeedbackSave?: {
        feedback?: { score?: number; reason?: string };
      };
    }>(saveScoreOnlyRes);
    assertEquals(
      saveScoreOnlyBody.data?.workspaceFeedbackSave?.feedback?.score,
      -2,
    );
    assertEquals(
      saveScoreOnlyBody.data?.workspaceFeedbackSave?.feedback?.reason,
      "great response",
    );

    let saved:
      | {
        messageRefId?: string;
        score?: number;
        reason?: string;
        runId?: string;
      }
      | undefined;
    for (let i = 0; i < 20; i++) {
      const nextState = await readWorkspaceState({ sessionsDir, workspaceId });
      saved = (nextState.feedback ?? []).find((entry) =>
        entry.messageRefId === assistantRef
      );
      if (saved?.score === -2) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert(saved, "feedback should be persisted");
    assertEquals(saved?.score, -2);
    assertEquals(saved?.reason, "great response");

    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest(
  "session feedback accepts persisted run message refs when runId is provided",
  async () => {
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
          scenarioRunId: "testbot-older-run",
          testBotRunId: "testbot-older-run",
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

    const res = await saveWorkspaceFeedback({
      port,
      workspaceId,
      runId: "testbot-older-run",
      messageRefId: "msg-from-older-run",
      score: -3,
      reason: "old run message",
    });
    assertEquals(res.status, 200);
    const body = await parseGraphqlEnvelope<{
      workspaceFeedbackSave?: {
        feedback?: { runId?: string; messageRefId?: string; score?: number };
      };
    }>(res);
    assertEquals(
      body.data?.workspaceFeedbackSave?.feedback?.runId,
      "testbot-older-run",
    );
    assertEquals(
      body.data?.workspaceFeedbackSave?.feedback?.messageRefId,
      "msg-from-older-run",
    );
    assertEquals(body.data?.workspaceFeedbackSave?.feedback?.score, -3);

    let saved: { messageRefId?: string; runId?: string } | undefined;
    for (let i = 0; i < 20; i++) {
      const nextState = await readWorkspaceState({
        sessionsDir,
        workspaceId,
      });
      saved = (nextState.feedback ?? []).find((entry) =>
        entry.messageRefId === "msg-from-older-run"
      );
      if (saved) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert(saved);
    assertEquals(saved.runId, "testbot-older-run");

    const readModelRes = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/${
        encodeURIComponent(workspaceId)
      }/test/${encodeURIComponent("testbot-older-run")}`,
    );
    assertEquals(readModelRes.status, 200);
    const readModelBody = await readModelRes.json() as {
      test?: {
        run?: {
          messages?: Array<
            {
              messageRefId?: string;
              feedback?: { score?: number; reason?: string };
            }
          >;
        };
      };
    };
    const runMessage = (readModelBody.test?.run?.messages ?? []).find((entry) =>
      entry.messageRefId === "msg-from-older-run"
    );
    assert(runMessage);
    assertEquals(runMessage.feedback?.score, -3);
    assertEquals(runMessage.feedback?.reason, "old run message");

    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest(
  "session feedback accepts scenario user refs and rejects manual/artifact user refs",
  async () => {
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
        runId: "scenario-user-run",
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
          scenarioRunId: "scenario-user-run",
          testBotRunId: "scenario-user-run",
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

    const scenarioRes = await saveWorkspaceFeedback({
      port,
      workspaceId,
      runId: "scenario-user-run",
      messageRefId: "msg-scenario-user",
      score: -2,
      reason: "scenario input quality",
    });
    assertEquals(scenarioRes.status, 200);
    const scenarioBody = await parseGraphqlEnvelope<{
      workspaceFeedbackSave?: {
        feedback?: { messageRefId?: string; score?: number };
      };
    }>(scenarioRes);
    assertEquals(
      scenarioBody.data?.workspaceFeedbackSave?.feedback?.messageRefId,
      "msg-scenario-user",
    );
    assertEquals(
      scenarioBody.data?.workspaceFeedbackSave?.feedback?.score,
      -2,
    );

    const manualRes = await saveWorkspaceFeedback({
      port,
      workspaceId,
      runId: "scenario-user-run",
      messageRefId: "msg-manual-user",
      score: -1,
      reason: "manual input should reject",
    });
    assertEquals(manualRes.status, 200);
    const manualBody = await parseGraphqlEnvelope<{
      workspaceFeedbackSave?: unknown;
    }>(manualRes);
    assertEquals(manualBody.data?.workspaceFeedbackSave ?? null, null);

    const artifactRes = await saveWorkspaceFeedback({
      port,
      workspaceId,
      runId: "scenario-user-run",
      messageRefId: "msg-artifact-user",
      score: -1,
      reason: "artifact input should reject",
    });
    assertEquals(artifactRes.status, 200);
    const artifactBody = await parseGraphqlEnvelope<{
      workspaceFeedbackSave?: unknown;
    }>(artifactRes);
    assertEquals(artifactBody.data?.workspaceFeedbackSave ?? null, null);

    const nextState = await readWorkspaceState({ sessionsDir, workspaceId });
    assertEquals(
      (nextState.feedback ?? []).some((entry) =>
        entry.messageRefId === "msg-manual-user"
      ),
      false,
    );
    assertEquals(
      (nextState.feedback ?? []).some((entry) =>
        entry.messageRefId === "msg-artifact-user"
      ),
      false,
    );

    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest(
  "grading reference endpoint is currently unavailable",
  async () => {
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
    assertEquals(firstWrite.status, 404);

    await server.shutdown();
    await server.finished;
  },
);
