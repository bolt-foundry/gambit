import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { startWebSocketSimulator } from "./server.ts";
import type { ModelProvider } from "@bolt-foundry/gambit-core";
import {
  modImportPath,
  readDurableStreamEvents,
  readStreamEvents,
  runSimulator,
} from "./server_test_utils.ts";

async function waitForAbortCount(
  getAbortCount: () => number,
  expectedCount: number,
  timeoutMs = 1000,
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

Deno.test("simulator streams responses", async () => {
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

  await runSimulator(port, { input: "hello", stream: true });
  const events = await readStreamEvents(port, 0);
  const messages = events.map((event) =>
    event.data as { type?: string; chunk?: string; result?: unknown }
  );
  await server.shutdown();
  await server.finished;

  const resultMsg = messages.find((m) => m.type === "result");
  assertEquals(resultMsg?.result, "hi");
  const streams = messages.filter((m) => m.type === "stream").map((m) =>
    m.chunk ?? ""
  )
    .join("");
  assertEquals(streams, "hi");
  assertEquals(messages.some((m) => m.type === "result"), true);
});

Deno.test("durable stream SSE emits typed event frames", async () => {
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
    `http://127.0.0.1:${port}/api/durable-streams/stream/test-typed`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "gambit.test.event", value: "ok" }),
    },
  );
  assertEquals(appendRes.status, 204);

  const controller = new AbortController();
  const res = await fetch(
    `http://127.0.0.1:${port}/api/durable-streams/stream/test-typed?offset=0&live=sse`,
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

Deno.test("durable stream SSE sanitizes injected event names", async () => {
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
    `http://127.0.0.1:${port}/api/durable-streams/stream/test-sanitize`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "good\nretry: 1\r\ndata: injected" }),
    },
  );
  assertEquals(appendRes.status, 204);

  const controller = new AbortController();
  const res = await fetch(
    `http://127.0.0.1:${port}/api/durable-streams/stream/test-sanitize?offset=0&live=sse`,
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
});

Deno.test("build bot endpoint streams status and runs", async () => {
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

  const runId = "test-build-run";
  const res = await fetch(`http://127.0.0.1:${port}/api/build/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, message: "" }),
  });
  const body = await res.json().catch(() => ({})) as {
    run?: { id?: string; status?: string };
    error?: string;
  };
  assertEquals(res.ok, true);
  assertEquals(body.run?.id, runId);

  let status: unknown = null;
  for (let i = 0; i < 20; i += 1) {
    const sres = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/${encodeURIComponent(runId)}`,
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

Deno.test("workspace durable stream carries build, test, and grade events", async () => {
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

  const buildRes = await fetch(`http://127.0.0.1:${port}/api/build/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  assertEquals(buildRes.ok, true);
  await buildRes.text();

  const gradeRes = await fetch(`http://127.0.0.1:${port}/api/calibrate/flag`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      refId: "gradingRun:test#turn:0",
      runId: "test",
      turnIndex: 0,
    }),
  });
  assertEquals(gradeRes.ok, true);
  await gradeRes.text();

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
  assert(payloads.some((event) => event.type === "buildBotStatus"));
  assert(payloads.some((event) => event.type === "calibrateSession"));
  await server.shutdown();
  await server.finished;
});

Deno.test("test stop aborts in-flight runtime execution", async () => {
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

  const startRes = await fetch(`http://127.0.0.1:${port}/api/test/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: "stop-run", message: "hello" }),
  });
  assertEquals(startRes.ok, true);
  const startBody = await startRes.json() as { run?: { id?: string } };
  const runId = startBody.run?.id ?? "";
  assert(runId.length > 0);

  const stopRes = await fetch(`http://127.0.0.1:${port}/api/test/stop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId }),
  });
  assertEquals(stopRes.ok, true);
  const stopBody = await stopRes.json() as {
    stopped?: boolean;
    run?: { status?: string };
  };
  assertEquals(stopBody.stopped, true);
  assertEquals(stopBody.run?.status, "canceled");

  await waitForAbortCount(() => abortCount, 1);

  await server.shutdown();
  await server.finished;
});

Deno.test("test assistant start hydrates schema defaults for empty workspace sessions", async () => {
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

  const workspaceRes = await fetch(
    `http://127.0.0.1:${port}/api/workspace/new`,
    { method: "POST" },
  );
  assertEquals(workspaceRes.ok, true);
  const workspaceBody = await workspaceRes.json() as { workspaceId?: string };
  const workspaceId = workspaceBody.workspaceId ?? "";
  assert(workspaceId.length > 0, "missing workspaceId");

  const startRes = await fetch(`http://127.0.0.1:${port}/api/test/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      message: "",
      stream: false,
    }),
  });
  assertEquals(startRes.ok, true);
  const startBody = await startRes.json() as { run?: { id?: string } };
  const runId = startBody.run?.id ?? "";
  assert(runId.length > 0, "missing runId");

  const deadline = Date.now() + 1500;
  let finalStatus: string | undefined;
  let finalError: string | undefined;
  while (Date.now() < deadline) {
    const statusRes = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/${
        encodeURIComponent(workspaceId)
      }/test/${encodeURIComponent(runId)}`,
    );
    const statusBody = await statusRes.json() as {
      test?: { run?: { status?: string; error?: string } };
    };
    const run = statusBody.test?.run;
    finalStatus = run?.status;
    finalError = run?.error;
    if (finalStatus && finalStatus !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assertEquals(finalStatus, "completed");
  assertEquals(finalError, undefined);

  await server.shutdown();
  await server.finished;
});

Deno.test("build reset aborts in-flight runtime execution", async () => {
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

  const startRes = await fetch(`http://127.0.0.1:${port}/api/build/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: "build-abort", message: "hello" }),
  });
  assertEquals(startRes.ok, true);
  await startRes.text();
  await waitForWorkspaceStatus(port, "build-abort", "running");

  const resetRes = await fetch(`http://127.0.0.1:${port}/api/build/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: "build-abort" }),
  });
  assertEquals(resetRes.ok, true);
  const resetBody = await resetRes.json() as { reset?: boolean };
  assertEquals(resetBody.reset, true);

  await waitForAbortCount(() => abortCount, 1);

  await server.shutdown();
  await server.finished;
});

Deno.test("build stop aborts in-flight runtime execution", async () => {
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

  const startRes = await fetch(`http://127.0.0.1:${port}/api/build/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: "build-stop", message: "hello" }),
  });
  assertEquals(startRes.ok, true);
  const startBody = await startRes.json() as { run?: { id?: string } };
  const runId = startBody.run?.id ?? "";
  assert(runId.length > 0);

  const stopRes = await fetch(`http://127.0.0.1:${port}/api/build/stop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: runId }),
  });
  assertEquals(stopRes.ok, true);
  const stopBody = await stopRes.json() as {
    stopped?: boolean;
    run?: { status?: string };
  };
  assertEquals(stopBody.stopped, true);
  assertEquals(stopBody.run?.status, "canceled");

  await waitForAbortCount(() => abortCount, 1);

  await server.shutdown();
  await server.finished;
});
