import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { DatabaseSync } from "node:sqlite";
import { startWebSocketSimulator } from "./server.ts";
import type {
  JSONValue,
  ModelProvider,
  SavedState,
} from "@bolt-foundry/gambit-core";
import {
  createBuildRun,
  createWorkspace,
  gql,
  modImportPath,
  readDurableStreamEvents,
  runSimulator,
  sendScenarioSession,
  startScenarioSession,
} from "./server_test_utils.ts";
async function listScenarioDecks(port: number, workspaceId: string) {
  const response = await gql<{
    workspace?: {
      scenarioDecks?: Array<{
        id?: string;
        path?: string;
        maxTurns?: number | null;
      }>;
    };
  }>(
    port,
    `
      query ScenarioDecks($id: ID!) {
        workspace(id: $id) {
          scenarioDecks {
            id
            path
            maxTurns
          }
        }
      }
    `,
    { id: workspaceId },
  );
  assertEquals(Array.isArray(response.errors), false);
  return response.data?.workspace?.scenarioDecks ?? [];
}

async function stopScenarioSession(args: {
  port: number;
  workspaceId: string;
  sessionId: string;
}): Promise<void> {
  const response = await gql<{
    workspaceConversationSessionStop?: {
      session?: { sessionId?: string };
    };
  }>(
    args.port,
    `
      mutation StopScenario($input: WorkspaceConversationSessionStopInput!) {
        workspaceConversationSessionStop(input: $input) {
          session {
            sessionId
          }
        }
      }
    `,
    {
      input: {
        workspaceId: args.workspaceId,
        kind: "scenario",
        sessionId: args.sessionId,
      },
    },
  );
  assertEquals(Array.isArray(response.errors), false);
  assertEquals(
    response.data?.workspaceConversationSessionStop?.session?.sessionId,
    args.sessionId,
  );
}

async function resetWorkspaceBuild(
  port: number,
  workspaceId: string,
): Promise<void> {
  const response = await gql<{
    simulatorResetWorkspace?: {
      workspace?: { id?: string };
      build?: { runStatus?: string };
    };
  }>(
    port,
    `
      mutation ResetWorkspace($input: SimulatorResetWorkspaceInput!) {
        simulatorResetWorkspace(input: $input) {
          workspace { id }
          build { runStatus }
        }
      }
    `,
    {
      input: { workspaceId },
    },
  );
  assertEquals(Array.isArray(response.errors), false);
}

async function stopBuildRun(args: {
  port: number;
  workspaceId: string;
  runId: string;
}): Promise<void> {
  const response = await gql<{
    simulatorStopRun?: {
      workspace?: { id?: string };
      run?: { id?: string; status?: string };
    };
  }>(
    args.port,
    `
      mutation StopBuild($input: SimulatorStopRunInput!) {
        simulatorStopRun(input: $input) {
          workspace { id }
          run { id status }
        }
      }
    `,
    {
      input: {
        workspaceId: args.workspaceId,
        runId: args.runId,
      },
    },
  );
  assertEquals(Array.isArray(response.errors), false);
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for predicate");
}

async function waitForAbortCount(
  getAbortCount: () => number,
  expectedCount: number,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getAbortCount() >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assertEquals(getAbortCount(), expectedCount);
}

async function waitForWorkspaceStatus(
  port: number,
  workspaceId: string,
  expectedStatus: string,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/${
        encodeURIComponent(workspaceId)
      }`,
    );
    const body = await response.json().catch(() => ({})) as {
      build?: { run?: { status?: string } };
    };
    if (body.build?.run?.status === expectedStatus) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Timed out waiting for workspace ${workspaceId} status=${expectedStatus}`,
  );
}

async function waitForTestRunTerminalStatus(
  port: number,
  workspaceId: string,
  runId: string,
  timeoutMs = 3000,
): Promise<{ status?: string; error?: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: string | undefined;
  let lastError: string | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/${
        encodeURIComponent(workspaceId)
      }/test/${encodeURIComponent(runId)}`,
    );
    const body = await response.json().catch(() => ({})) as {
      test?: { run?: { status?: string; error?: string } };
    };
    const status = body.test?.run?.status;
    const error = body.test?.run?.error;
    lastStatus = status;
    lastError = error;
    if (status && status !== "idle" && status !== "running") {
      return { status, error };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for test run ${runId} terminal status (last status=${
      lastStatus ?? "unknown"
    } error=${lastError ?? "none"})`,
  );
}

const leakTolerantTest = (name: string, fn: () => Promise<void> | void) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

leakTolerantTest("simulator streams responses", async () => {
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
    chat(input) {
      input.onStreamText?.("h");
      input.onStreamText?.("i");
      return Promise.resolve({
        message: { role: "assistant", content: "hi" },
        finishReason: "stop",
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });

  const port = (server.addr as Deno.NetAddr).port;

  const homepage = await fetch(`http://127.0.0.1:${port}/`);
  const html = await homepage.text();
  if (!html.includes('id="root"')) {
    throw new Error("Simulator HTML missing root mount");
  }

  await runSimulator(port, { input: "hello", message: "hello", stream: true });
  const events = await readDurableStreamEvents(port, "gambit-workspace", 0);
  const messages = events.map((event) =>
    event.data as { type?: string; chunk?: string; result?: unknown }
  );
  await server.shutdown();
  await server.finished;

  assertEquals(
    messages.some((m) =>
      m.type === "testBotStatus" || m.type === "gambit.test.status"
    ),
    true,
  );
});

leakTolerantTest("durable stream SSE emits typed event frames", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = path.join(dir, "durable-sse.deck.ts");
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
  });
  const port = (server.addr as Deno.NetAddr).port;

  const appendRes = await fetch(
    `http://127.0.0.1:${port}/graphql/streams/test-typed`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "gambit.test.event", value: "ok" }),
    },
  );
  assertEquals(appendRes.status, 204);

  const controller = new AbortController();
  const res = await fetch(
    `http://127.0.0.1:${port}/graphql/streams/test-typed?offset=0&live=sse`,
    { signal: controller.signal },
  );
  assertEquals(res.status, 200);
  const reader = res.body?.getReader();
  assert(reader, "expected SSE body reader");
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("event: gambit.test.event")) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
    if (text.length > 4096) break;
  }
  controller.abort();
  await reader.cancel().catch(() => {});

  assert(text.includes("id: 0"));
  assert(text.includes("event: gambit.test.event"));
  assert(text.includes('"type":"gambit.test.event"'));

  await server.shutdown();
  await server.finished;
});

leakTolerantTest(
  "durable stream SSE sanitizes injected event names",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = path.join(dir, "durable-sse-sanitize.deck.ts");
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
    });
    const port = (server.addr as Deno.NetAddr).port;

    const appendRes = await fetch(
      `http://127.0.0.1:${port}/graphql/streams/test-sanitize`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "good\nretry: 1\r\ndata: injected" }),
      },
    );
    assertEquals(appendRes.status, 204);

    const controller = new AbortController();
    const res = await fetch(
      `http://127.0.0.1:${port}/graphql/streams/test-sanitize?offset=0&live=sse`,
      { signal: controller.signal },
    );
    assertEquals(res.status, 200);
    const reader = res.body?.getReader();
    assert(reader, "expected SSE body reader");
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("event:")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > 4096) break;
    }
    controller.abort();
    await reader.cancel().catch(() => {});

    assert(text.includes("event: good_retry__1__data__injected"));
    assert(text.includes('"type":"good_retry__1__data__injected"'));
    assertEquals(text.includes("retry: 1"), false);

    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest(
  "test deck selection remains isolated across concurrent simulator instances",
  async () => {
    const dirA = await Deno.makeTempDir();
    const dirB = await Deno.makeTempDir();
    const modHref = modImportPath();

    const writeDeckSet = async (baseDir: string, name: string) => {
      const rootDeckPath = path.join(baseDir, `${name}-root.deck.ts`);
      const scenarioDeckPath = path.join(baseDir, `${name}-scenario.deck.ts`);
      const escapedScenarioPath = scenarioDeckPath.replaceAll("\\", "\\\\");
      await Deno.writeTextFile(
        scenarioDeckPath,
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
      await Deno.writeTextFile(
        rootDeckPath,
        `
      import { defineDeck } from "${modHref}";
      import { z } from "zod";
      export default defineDeck({
        inputSchema: z.string().optional(),
        outputSchema: z.string().optional(),
        modelParams: { model: "dummy-model" },
        testDecks: [{
          id: "${name}-scenario",
          label: "${name}",
          path: "${escapedScenarioPath}",
        }],
      });
      `,
      );
      return { rootDeckPath, scenarioDeckPath };
    };

    const a = await writeDeckSet(dirA, "a");
    const b = await writeDeckSet(dirB, "b");

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const serverA = startWebSocketSimulator({
      deckPath: a.rootDeckPath,
      modelProvider: provider,
      port: 0,
    });
    const serverB = startWebSocketSimulator({
      deckPath: b.rootDeckPath,
      modelProvider: provider,
      port: 0,
    });
    const portA = (serverA.addr as Deno.NetAddr).port;
    const portB = (serverB.addr as Deno.NetAddr).port;

    try {
      const workspaceId = await createWorkspace(portA);
      const warmupWorkspaceId = await createWorkspace(portB);
      const warmupDecks = await listScenarioDecks(portB, warmupWorkspaceId);
      assertEquals(warmupDecks.length, 1);
      assertEquals(warmupDecks[0]?.id, "b-scenario");
      assertEquals(warmupDecks[0]?.path, b.scenarioDeckPath);

      const started = await startScenarioSession({
        port: portA,
        workspaceId,
        scenarioDeckId: "a-scenario",
      });
      assert(started.runId.length > 0);
    } finally {
      await serverA.shutdown();
      await serverA.finished;
      await serverB.shutdown();
      await serverB.finished;
    }
  },
);

leakTolerantTest(
  "deck-level maxTurns is clamped and used by /api/test/run",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const rootDeckPath = path.join(dir, "max-turns-root.deck.ts");
    const lowDeckPath = path.join(dir, "max-turns-low.deck.ts");
    const highDeckPath = path.join(dir, "max-turns-high.deck.ts");
    const escapedLowPath = lowDeckPath.replaceAll("\\", "\\\\");
    const escapedHighPath = highDeckPath.replaceAll("\\", "\\\\");

    await Deno.writeTextFile(
      lowDeckPath,
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

    await Deno.writeTextFile(
      highDeckPath,
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

    await Deno.writeTextFile(
      rootDeckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
      testDecks: [{
        id: "low-max-turns",
        label: "Low maxTurns",
        path: "${escapedLowPath}",
        maxTurns: 0,
      }, {
        id: "high-max-turns",
        label: "High maxTurns",
        path: "${escapedHighPath}",
        maxTurns: 500,
      }],
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
      deckPath: rootDeckPath,
      modelProvider: provider,
      port: 0,
    });
    const port = (server.addr as Deno.NetAddr).port;

    try {
      const workspaceId = await createWorkspace(port);
      const listBody = await listScenarioDecks(port, workspaceId);
      const lowDeck = listBody.find((deck) => deck.id === "low-max-turns");
      const highDeck = listBody.find((deck) => deck.id === "high-max-turns");
      assertEquals(lowDeck?.maxTurns, 1);
      assertEquals(highDeck?.maxTurns, 200);

      const lowRun = await startScenarioSession({
        port,
        workspaceId,
        scenarioDeckId: "low-max-turns",
      });
      const lowStatusRes = await fetch(
        `http://127.0.0.1:${port}/api/workspaces/${
          encodeURIComponent(workspaceId)
        }/test/${encodeURIComponent(lowRun.runId)}`,
      );
      const lowRunBody = await lowStatusRes.json() as {
        test?: { run?: { maxTurns?: number } };
      };
      assertEquals(lowRunBody.test?.run?.maxTurns, 1);

      const highRun = await startScenarioSession({
        port,
        workspaceId,
        scenarioDeckId: "high-max-turns",
      });
      const highStatusRes = await fetch(
        `http://127.0.0.1:${port}/api/workspaces/${
          encodeURIComponent(workspaceId)
        }/test/${encodeURIComponent(highRun.runId)}`,
      );
      const highRunBody = await highStatusRes.json() as {
        test?: { run?: { maxTurns?: number } };
      };
      assertEquals(highRunBody.test?.run?.maxTurns, 200);
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "scenario run completes with workerSandbox enabled",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const rootDeckPath = path.join(dir, "scenario-worker-root.deck.ts");
    const scenarioDeckPath = path.join(dir, "scenario-worker-scenario.deck.ts");
    const escapedScenarioPath = scenarioDeckPath.replaceAll("\\", "\\\\");

    await Deno.writeTextFile(
      scenarioDeckPath,
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

    await Deno.writeTextFile(
      rootDeckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
      testDecks: [{
        id: "worker-scenario",
        label: "Worker Scenario",
        path: "${escapedScenarioPath}",
      }],
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
      deckPath: rootDeckPath,
      modelProvider: provider,
      port: 0,
      workerSandbox: true,
    });
    const port = (server.addr as Deno.NetAddr).port;

    try {
      const workspaceId = await createWorkspace(port);
      const started = await startScenarioSession({
        port,
        workspaceId,
        scenarioDeckId: "worker-scenario",
      });
      const runId = started.runId;
      assert(runId.length > 0);

      const terminal = await waitForTestRunTerminalStatus(
        port,
        workspaceId,
        runId,
      );
      assertEquals(terminal.status, "completed");
      assertEquals(terminal.error, undefined);
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest("build bot endpoint streams status and runs", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = path.join(dir, "build-primary.deck.ts");
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
      input.onStreamText?.("h");
      input.onStreamText?.("i");
      return Promise.resolve({
        message: { role: "assistant", content: "hi" },
        finishReason: "stop",
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });
  const port = (server.addr as Deno.NetAddr).port;

  const homepage = await fetch(`http://127.0.0.1:${port}/build`);
  const html = await homepage.text();
  assert(html.includes("__GAMBIT_BUILD_TAB_ENABLED__"));
  assert(html.includes("__GAMBIT_VERIFY_TAB_ENABLED__"));
  assert(/__GAMBIT_VERIFY_TAB_ENABLED__\s*=\s*true/.test(html));

  const workspaceId = await createWorkspace(port);
  await createBuildRun({
    port,
    workspaceId,
    message: "",
  });

  let status: unknown = null;
  for (let i = 0; i < 20; i += 1) {
    const sres = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/${
        encodeURIComponent(workspaceId)
      }`,
    );
    const sb = await sres.json().catch(() => ({})) as {
      build?: {
        run?: { status?: string; messages?: Array<{ content?: string }> };
      };
    };
    status = sb.build?.run?.status ?? null;
    if (sb.build?.run?.status === "completed") {
      assert((sb.build?.run?.messages?.[0]?.content ?? "").length > 0);
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assertEquals(status, "completed");

  await server.shutdown();
  await server.finished;
});

leakTolerantTest(
  "workspace durable stream carries build and test events",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();
    const deckPath = path.join(dir, "workspace-stream.deck.ts");
    const escapedDeckPath = deckPath.replaceAll("\\", "\\\\");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
      testDecks: [{ id: "self-test", label: "Self Test", path: "${escapedDeckPath}" }],
      graderDecks: [{ id: "self-grader", label: "Self Grader", path: "${escapedDeckPath}" }],
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

    const runResult = await runSimulator(port, {
      input: "seed",
      message: "seed",
      stream: false,
    });
    const workspaceId = runResult.workspaceId!;

    await resetWorkspaceBuild(port, workspaceId);

    let workspaceEvents = await readDurableStreamEvents(
      port,
      "gambit-workspace",
      0,
    );
    if (workspaceEvents.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      workspaceEvents = await readDurableStreamEvents(
        port,
        "gambit-workspace",
        0,
      );
    }
    const payloads = workspaceEvents.map((event) =>
      event.data as { type?: string }
    );
    assert(
      payloads.some((event) =>
        event.type === "buildBotStatus" || event.type === "gambit.build.status"
      ),
    );
    assert(
      payloads.some((event) =>
        event.type === "testBotStatus" || event.type === "gambit.test.status"
      ),
    );
    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest("calibrate run API endpoint is unavailable", async () => {
  const dir = await Deno.makeTempDir();
  const sessionsDir = path.join(dir, "sessions");
  const modHref = modImportPath();
  const rootDeckPath = path.join(dir, "turns-metadata-root.deck.ts");
  const scenarioDeckPath = path.join(dir, "turns-metadata-scenario.deck.ts");
  const graderDeckPath = path.join(dir, "turns-metadata-grader.deck.ts");
  const escapedScenarioPath = scenarioDeckPath.replaceAll("\\", "\\\\");
  const escapedGraderPath = graderDeckPath.replaceAll("\\", "\\\\");

  await Deno.writeTextFile(
    scenarioDeckPath,
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

  await Deno.writeTextFile(
    graderDeckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({
        session: z.any().optional(),
        messageToGrade: z.any(),
      }),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  await Deno.writeTextFile(
    rootDeckPath,
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
      testDecks: [{
        id: "turn-scenario",
        label: "Turn Scenario",
        path: "${escapedScenarioPath}",
      }],
      graderDecks: [{
        id: "turn-grader",
        label: "Turn Grader",
        path: "${escapedGraderPath}",
      }],
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
    deckPath: rootDeckPath,
    modelProvider: provider,
    port: 0,
    sessionDir: sessionsDir,
  });
  const port = (server.addr as Deno.NetAddr).port;

  const workspaceId = await createWorkspace(port);
  assert(workspaceId.length > 0);

  const started = await startScenarioSession({
    port,
    workspaceId,
    scenarioDeckId: "turn-scenario",
  });
  const scenarioRunId = started.runId;
  assert(scenarioRunId.length > 0);

  const gradeRes = await fetch(`http://127.0.0.1:${port}/api/calibrate/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      graderId: "turn-grader",
      scenarioRunId,
    }),
  });
  assertEquals(gradeRes.status, 404);

  await server.shutdown();
  await server.finished;
});

leakTolerantTest(
  "concurrent calibrate run API requests are unavailable",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();
    const rootDeckPath = path.join(dir, "concurrent-calibrate-root.deck.ts");
    const graderDeckPath = path.join(
      dir,
      "concurrent-calibrate-grader.deck.ts",
    );
    const escapedGraderPath = graderDeckPath.replaceAll("\\", "\\\\");

    await Deno.writeTextFile(
      graderDeckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({
        session: z.any().optional(),
      }),
      outputSchema: z.object({
        score: z.number(),
        reason: z.string(),
        pass: z.boolean(),
      }),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    await Deno.writeTextFile(
      rootDeckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
      graderDecks: [{
        id: "concurrency-grader",
        label: "Concurrency Grader",
        path: "${escapedGraderPath}",
      }],
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              message: {
                role: "assistant",
                content: JSON.stringify({
                  score: 1,
                  reason: "ok",
                  pass: true,
                }),
              },
              finishReason: "stop",
            });
          }, 30);
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath: rootDeckPath,
      modelProvider: provider,
      port: 0,
      sessionDir: sessionsDir,
    });
    const port = (server.addr as Deno.NetAddr).port;

    const workspaceId = await createWorkspace(port);
    assert(workspaceId.length > 0);

    const runRequests = Array.from(
      { length: 3 },
      () =>
        fetch(`http://127.0.0.1:${port}/api/calibrate/run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            graderId: "concurrency-grader",
          }),
        }),
    );
    const runResponses = await Promise.all(runRequests);
    for (const response of runResponses) {
      assertEquals(response.status, 404);
    }

    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest("test stop aborts in-flight runtime execution", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = path.join(dir, "test-stop.deck.ts");
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

  let abortCount = 0;
  const provider: ModelProvider = {
    chat(input) {
      return new Promise((_, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => {
            abortCount += 1;
            reject(new DOMException("Run canceled", "AbortError"));
          },
          { once: true },
        );
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });
  const port = (server.addr as Deno.NetAddr).port;

  const workspaceId = await createWorkspace(port);
  const started = await startScenarioSession({
    port,
    workspaceId,
    sessionId: "stop-run",
  });
  const runId = started.runId;
  assert(runId.length > 0);
  assert(workspaceId.length > 0);

  await sendScenarioSession({
    port,
    workspaceId,
    sessionId: runId,
    message: "hello",
  });
  await stopScenarioSession({ port, workspaceId, sessionId: runId });
  const terminal = await waitForTestRunTerminalStatus(port, workspaceId, runId);
  assertEquals(terminal.status, "canceled");

  await waitForAbortCount(() => abortCount, 1);

  await server.shutdown();
  await server.finished;
});

leakTolerantTest(
  "test assistant start keeps empty-message runs idle for manual chat",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = path.join(dir, "test-start-defaults.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      startMode: "assistant",
      inputSchema: z.object({
        a: z.number().default(0),
        b: z.number().default(1),
        operation: z.enum(["add", "subtract", "multiply", "divide"]).default("add"),
      }),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ready" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });
    const port = (server.addr as Deno.NetAddr).port;

    const workspaceId = await createWorkspace(port);
    assert(workspaceId.length > 0, "missing workspaceId");

    const started = await startScenarioSession({
      port,
      workspaceId,
      message: "",
    });
    const runId = started.runId;
    assert(runId.length > 0, "missing runId");

    const deadline = Date.now() + 1500;
    let finalStatus: string | undefined;
    let finalError: string | undefined;
    let finalMessages: Array<{ role?: string; content?: string }> = [];
    while (Date.now() < deadline) {
      const statusRes = await fetch(
        `http://127.0.0.1:${port}/api/workspaces/${
          encodeURIComponent(workspaceId)
        }/test/${encodeURIComponent(runId)}`,
      );
      const statusBody = await statusRes.json() as {
        test?: {
          run?: {
            status?: string;
            error?: string;
            messages?: Array<{ role?: string; content?: string }>;
          };
        };
      };
      const run = statusBody.test?.run;
      finalStatus = run?.status;
      finalError = run?.error;
      finalMessages = run?.messages ?? [];
      if (finalStatus && finalStatus !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assertEquals(finalStatus, "idle");
    assertEquals(finalError, undefined);
    assertEquals(finalMessages.length, 0);

    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest(
  "test run chat does not ingest workbench chat messages for same workspace",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = path.join(dir, "test-run-workbench-isolation.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      startMode: "assistant",
      inputSchema: z.object({
        seed: z.string().default("ready"),
      }),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat(input) {
        const lastUser = [...input.messages].reverse().find((message) =>
          message?.role === "user"
        );
        const prompt = typeof lastUser?.content === "string"
          ? lastUser.content
          : JSON.stringify(lastUser?.content ?? "");
        return Promise.resolve({
          message: { role: "assistant", content: `assistant:${prompt}` },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });
    const port = (server.addr as Deno.NetAddr).port;

    const workspaceId = await createWorkspace(port);
    assert(workspaceId.length > 0);

    const started = await startScenarioSession({
      port,
      workspaceId,
      message: "",
    });
    const runId = started.runId;
    assert(runId.length > 0);

    await sendScenarioSession({
      port,
      workspaceId,
      sessionId: runId,
      message: "scenario one",
    });
    await waitForTestRunTerminalStatus(port, workspaceId, runId);

    const buildSendRes = await fetch(`http://127.0.0.1:${port}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `
        mutation Build($workspaceId: ID!, $message: String!) {
          workspaceBuildRunCreate(input: {
            workspaceId: $workspaceId
            inputItems: [{ role: "user", content: $message }]
          }) {
            run { id status }
          }
        }
      `,
        variables: {
          workspaceId,
          message: "workbench ping",
        },
      }),
    });
    assertEquals(buildSendRes.ok, true);
    const buildSendBody = await buildSendRes.json() as {
      data?: {
        workspaceBuildRunCreate?: {
          run?: { id?: string; status?: string };
        };
      };
      errors?: Array<{ message?: string }>;
    };
    assertEquals(Array.isArray(buildSendBody.errors), false);
    assert(
      (buildSendBody.data?.workspaceBuildRunCreate?.run?.id ?? "").length > 0,
    );
    await waitForWorkspaceStatus(port, workspaceId, "completed", 3000);

    await sendScenarioSession({
      port,
      workspaceId,
      sessionId: runId,
      message: "scenario two",
    });
    await waitForTestRunTerminalStatus(port, workspaceId, runId);

    const runRes = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/${
        encodeURIComponent(workspaceId)
      }/test/${encodeURIComponent(runId)}`,
    );
    assertEquals(runRes.ok, true);
    const runBody = await runRes.json() as {
      test?: {
        run?: {
          messages?: Array<{ role?: string; content?: string }>;
        };
      };
    };
    const userMessages = (runBody.test?.run?.messages ?? [])
      .filter((message) => message.role === "user")
      .map((message) => message.content ?? "");
    const assistantMessages = (runBody.test?.run?.messages ?? [])
      .filter((message) => message.role === "assistant")
      .map((message) => message.content ?? "");

    assertEquals(userMessages.includes("scenario one"), true);
    assertEquals(userMessages.includes("scenario two"), true);
    assertEquals(userMessages.includes("workbench ping"), false);
    assertEquals(
      assistantMessages.some((message) => message.includes("workbench ping")),
      false,
    );

    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest(
  "test assistant start with a new runId in the same workspace starts fresh",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = path.join(dir, "test-start-fresh-run.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      startMode: "assistant",
      inputSchema: z.object({
        seed: z.string().default("ready"),
      }),
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
    });
    const port = (server.addr as Deno.NetAddr).port;

    const workspaceId = await createWorkspace(port);
    assert(workspaceId.length > 0, "missing workspaceId");

    await startScenarioSession({
      port,
      workspaceId,
      sessionId: "run-old",
      message: "hello",
    });

    const firstDeadline = Date.now() + 1500;
    while (Date.now() < firstDeadline) {
      const statusRes = await fetch(
        `http://127.0.0.1:${port}/api/workspaces/${
          encodeURIComponent(workspaceId)
        }/test/${encodeURIComponent("run-old")}`,
      );
      const statusBody = await statusRes.json().catch(() => ({})) as {
        test?: { run?: { status?: string } };
      };
      const status = statusBody.test?.run?.status;
      if (status && status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const secondStarted = await startScenarioSession({
      port,
      workspaceId,
      sessionId: "run-new",
      message: "",
    });
    assertEquals(secondStarted.runId, "run-new");

    const secondDeadline = Date.now() + 1500;
    let secondRunMessages: Array<{ role?: string; content?: string }> = [];
    let secondRunStatus: string | undefined;
    while (Date.now() < secondDeadline) {
      const statusRes = await fetch(
        `http://127.0.0.1:${port}/api/workspaces/${
          encodeURIComponent(workspaceId)
        }/test/${encodeURIComponent("run-new")}`,
      );
      const statusBody = await statusRes.json().catch(() => ({})) as {
        test?: {
          run?: {
            status?: string;
            messages?: Array<{ role?: string; content?: string }>;
          };
        };
      };
      secondRunStatus = statusBody.test?.run?.status;
      secondRunMessages = statusBody.test?.run?.messages ?? [];
      if (secondRunStatus && secondRunStatus !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assertEquals(secondRunStatus, "idle");
    assertEquals(
      secondRunMessages.some((msg) =>
        msg.role === "user" && msg.content === "hello"
      ),
      false,
    );

    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest(
  "test assistant start does not hydrate same runId from a different workspace",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = path.join(dir, "test-start-cross-workspace-runid.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      startMode: "assistant",
      inputSchema: z.object({
        seed: z.string().default("ready"),
      }),
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
    });
    const port = (server.addr as Deno.NetAddr).port;

    const workspaceA = await createWorkspace(port);
    assert(workspaceA.length > 0, "missing workspaceA");

    const workspaceB = await createWorkspace(port);
    assert(workspaceB.length > 0, "missing workspaceB");

    const foreignRunId = "shared-run-id";
    await startScenarioSession({
      port,
      workspaceId: workspaceB,
      sessionId: foreignRunId,
      message: "hello from workspace B",
    });

    const foreignDeadline = Date.now() + 1500;
    while (Date.now() < foreignDeadline) {
      const statusRes = await fetch(
        `http://127.0.0.1:${port}/api/workspaces/${
          encodeURIComponent(workspaceB)
        }/test/${encodeURIComponent(foreignRunId)}`,
      );
      const statusBody = await statusRes.json().catch(() => ({})) as {
        test?: { run?: { status?: string } };
      };
      const status = statusBody.test?.run?.status;
      if (status && status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const localStarted = await startScenarioSession({
      port,
      workspaceId: workspaceA,
      sessionId: foreignRunId,
      message: "",
    });
    assertEquals(localStarted.runId, foreignRunId);

    const localDeadline = Date.now() + 1500;
    let localRunMessages: Array<{ role?: string; content?: string }> = [];
    let localRunStatus: string | undefined;
    while (Date.now() < localDeadline) {
      const statusRes = await fetch(
        `http://127.0.0.1:${port}/api/workspaces/${
          encodeURIComponent(workspaceA)
        }/test/${encodeURIComponent(foreignRunId)}`,
      );
      const statusBody = await statusRes.json().catch(() => ({})) as {
        test?: {
          run?: {
            status?: string;
            messages?: Array<{ role?: string; content?: string }>;
          };
        };
      };
      localRunStatus = statusBody.test?.run?.status;
      localRunMessages = statusBody.test?.run?.messages ?? [];
      if (localRunStatus && localRunStatus !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assertEquals(localRunStatus, "idle");
    assertEquals(
      localRunMessages.some((msg) =>
        msg.role === "user" && msg.content === "hello from workspace B"
      ),
      false,
    );

    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest("build reset aborts in-flight runtime execution", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = path.join(dir, "build-reset-abort.deck.ts");
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

  let abortCount = 0;
  const provider: ModelProvider = {
    chat(input) {
      return new Promise((_, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => {
            abortCount += 1;
            reject(new DOMException("Run canceled", "AbortError"));
          },
          { once: true },
        );
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });
  const port = (server.addr as Deno.NetAddr).port;

  const workspaceId = await createWorkspace(port);
  await createBuildRun({
    port,
    workspaceId,
    message: "hello",
  });
  await waitForWorkspaceStatus(port, workspaceId, "running");
  await resetWorkspaceBuild(port, workspaceId);

  await waitForAbortCount(() => abortCount, 1);

  await server.shutdown();
  await server.finished;
});

leakTolerantTest(
  "build uses build-owned run identity for canonical OpenResponses storage",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();
    const deckPath = path.join(dir, "build-authority.deck.ts");
    const scenarioDeckPath = path.join(dir, "scenarios", "default.deck.ts");
    await Deno.mkdir(path.dirname(scenarioDeckPath), { recursive: true });
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
      testDecks: [{
        id: "default-scenario",
        path: "./scenarios/default.deck.ts",
        label: "Default scenario",
        maxTurns: 2,
      }],
    });
    `,
    );
    await Deno.writeTextFile(
      scenarioDeckPath,
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
        const runId = input.state?.runId ?? "unknown-run";
        const latestUser = [...(input.state?.messages ?? [])]
          .reverse()
          .find((message) => message.role === "user")?.content ?? "";
        const assistantText = `assistant reply (${runId}) to ${latestUser}`;
        const updatedState: SavedState = {
          runId,
          messages: [
            ...(input.state?.messages ?? []),
            { role: "assistant", content: assistantText },
          ],
          traces: input.state?.traces ?? [],
          meta: input.state?.meta,
        };
        input.onStreamEvent?.({
          type: "response.created",
          response: {
            id: `resp-${updatedState.runId}`,
            object: "response",
            output: [],
            status: "in_progress",
          },
        });
        input.onStreamEvent?.({
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "message",
            role: "assistant",
            content: [{
              type: "output_text",
              text: assistantText,
            }],
          },
        });
        input.onStreamEvent?.({
          type: "response.completed",
          response: {
            id: `resp-${updatedState.runId}`,
            object: "response",
            output: [],
            status: "completed",
          },
        });
        return Promise.resolve({
          message: { role: "assistant", content: assistantText },
          finishReason: "stop",
          updatedState,
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
      const workspaceId = await createWorkspace(port);
      assert(workspaceId.length > 0);

      const scenarioRunId = "scenario-authority-run";
      await startScenarioSession({
        port,
        workspaceId,
        sessionId: scenarioRunId,
      });
      await sendScenarioSession({
        port,
        workspaceId,
        sessionId: scenarioRunId,
        message: "scenario seed",
      });
      const scenarioTerminal = await waitForTestRunTerminalStatus(
        port,
        workspaceId,
        scenarioRunId,
        5_000,
      );
      assertEquals(scenarioTerminal.status, "completed");

      const sqlitePath = path.join(
        sessionsDir,
        workspaceId,
        "workspace.sqlite",
      );
      await waitFor(
        () => Deno.stat(sqlitePath).then(() => true).catch(() => false),
        5_000,
      );

      const readSummary = (buildRunId: string) => {
        const db = new DatabaseSync(sqlitePath);
        try {
          const scenarioEvents = db.prepare(`
            SELECT COUNT(*) AS count
            FROM openresponses_run_events_v0
            WHERE workspace_id = ? AND run_id = ?
          `).get(workspaceId, scenarioRunId) as { count?: number };
          const scenarioOutputItems = db.prepare(`
            SELECT content
            FROM openresponses_output_items_v0
            WHERE workspace_id = ? AND run_id = ?
          `).all(workspaceId, scenarioRunId) as Array<
            { content: string | null }
          >;
          const buildEvents = db.prepare(`
            SELECT event_type
            FROM openresponses_run_events_v0
            WHERE workspace_id = ? AND run_id = ?
            ORDER BY sequence ASC
          `).all(workspaceId, buildRunId) as Array<{ event_type: string }>;
          const buildOutputItems = db.prepare(`
            SELECT role, content
            FROM openresponses_output_items_v0
            WHERE workspace_id = ? AND run_id = ?
            ORDER BY sequence ASC
          `).all(workspaceId, buildRunId) as Array<
            { role: string | null; content: string | null }
          >;
          return {
            scenarioEventCount: scenarioEvents.count ?? 0,
            scenarioOutputItemContents: scenarioOutputItems
              .map((item) => item.content ?? "")
              .filter((content) => content.length > 0),
            buildEventTypes: buildEvents.map((row) => row.event_type),
            buildOutputItems,
          };
        } finally {
          db.close();
        }
      };

      await waitFor(() => {
        const summary = readSummary("build-not-started");
        return summary.scenarioEventCount > 0 &&
          summary.scenarioOutputItemContents.length > 0;
      }, 5_000);
      const beforeBuild = readSummary("build-not-started");

      const buildBody = await createBuildRun({
        port,
        workspaceId,
        message: "build seed",
      });
      const buildRunId = buildBody.runId;
      assert(buildRunId.length > 0);

      await waitForWorkspaceStatus(port, workspaceId, "completed", 5_000);
      await waitFor(() => {
        const summary = readSummary(buildRunId);
        return summary.buildEventTypes.includes("input.item") &&
          summary.buildEventTypes.some((type) =>
            type.startsWith("response.")
          ) &&
          summary.buildOutputItems.some((item) =>
            item.role === "user" && item.content === "build seed"
          ) &&
          summary.buildOutputItems.some((item) =>
            item.role === "assistant" &&
            (item.content ?? "").includes(buildRunId)
          );
      }, 5_000);

      const afterBuild = readSummary(buildRunId);
      assert(afterBuild.scenarioEventCount >= beforeBuild.scenarioEventCount);
      assert(
        !afterBuild.scenarioOutputItemContents.some((content) =>
          content.includes("build seed")
        ),
      );
      assert(afterBuild.buildEventTypes.includes("input.item"));
      assert(
        afterBuild.buildEventTypes.some((type) => type.startsWith("response.")),
      );
      assert(
        afterBuild.buildOutputItems.some((item) =>
          item.role === "user" && item.content === "build seed"
        ),
      );
      assert(
        afterBuild.buildOutputItems.some((item) =>
          item.role === "assistant" &&
          (item.content ?? "").includes(buildRunId)
        ),
      );
    } finally {
      await server.shutdown();
      await server.finished;
    }
  },
);

leakTolerantTest(
  "workspace test run endpoint safely serializes circular trace payloads",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = path.join(dir, "workspace-circular-trace.deck.ts");
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
        const updatedState: SavedState = {
          runId: input.state?.runId ?? "run-circular",
          messages: [
            ...(input.state?.messages ?? []),
            { role: "assistant", content: "ok" },
          ],
        };
        const circularTrace = {
          type: "response.completed",
          response: {
            id: "resp-circular",
            object: "response",
            status: "completed",
            output: [],
            updatedState,
          },
        } as unknown as Record<string, JSONValue>;
        (updatedState as { traces?: unknown }).traces = [circularTrace];
        input.onStreamEvent?.(circularTrace);
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
          updatedState,
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
    });
    const port = (server.addr as Deno.NetAddr).port;

    const workspaceId = await createWorkspace(port);
    assert(workspaceId.length > 0, "workspace id required");

    const runId = "test-circular";
    const started = await startScenarioSession({
      port,
      workspaceId,
      sessionId: runId,
    });
    assertEquals(started.runId, runId);
    await sendScenarioSession({
      port,
      workspaceId,
      sessionId: runId,
      message: "hello",
    });

    const terminal = await waitForTestRunTerminalStatus(
      port,
      workspaceId,
      runId,
    );
    assertEquals(terminal.status, "completed");

    const readRes = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/${
        encodeURIComponent(workspaceId)
      }/test/${encodeURIComponent(runId)}`,
    );
    assertEquals(readRes.status, 200);
    const readText = await readRes.text();
    assertEquals(readText.includes('"[Circular]"'), true);
    const readPayload = JSON.parse(readText) as {
      test?: { run?: { id?: string } };
    };
    assertEquals(readPayload.test?.run?.id, runId);

    await server.shutdown();
    await server.finished;
  },
);

leakTolerantTest("build stop aborts in-flight runtime execution", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = path.join(dir, "build-stop-abort.deck.ts");
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

  let abortCount = 0;
  const provider: ModelProvider = {
    chat(input) {
      return new Promise((_, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => {
            abortCount += 1;
            reject(new DOMException("Run canceled", "AbortError"));
          },
          { once: true },
        );
      });
    },
  };

  const server = startWebSocketSimulator({
    deckPath,
    modelProvider: provider,
    port: 0,
  });
  const port = (server.addr as Deno.NetAddr).port;

  const workspaceId = await createWorkspace(port);
  const build = await createBuildRun({
    port,
    workspaceId,
    message: "hello",
  });
  const runId = build.runId;
  assert(runId.length > 0);
  await waitForWorkspaceStatus(port, workspaceId, "running");

  await stopBuildRun({ port, workspaceId, runId });
  await waitForWorkspaceStatus(port, workspaceId, "canceled", 3000);

  await waitForAbortCount(() => abortCount, 1);

  await server.shutdown();
  await server.finished;
});
