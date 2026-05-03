import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import * as path from "@std/path";
import type { ModelProvider, ResponseItem } from "@bolt-foundry/gambit-core";
import { loadRuntimeTools, startLocalChatServer } from "./chat.ts";
import { saveCanonicalWorkspaceState } from "../workspace_sqlite.ts";

async function writeTempFile(
  dir: string,
  relative: string,
  contents: string,
): Promise<string> {
  const target = path.join(dir, relative);
  await Deno.mkdir(path.dirname(target), { recursive: true });
  await Deno.writeTextFile(target, contents);
  return target;
}

function modImportPath(): string {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  return path.toFileUrl(path.resolve(here, "..", "..", "mod.ts")).href;
}

function modelResponse(output: Array<ResponseItem>) {
  return Promise.resolve({
    id: crypto.randomUUID(),
    object: "response" as const,
    status: "completed" as const,
    output,
  });
}

function assistantText(text: string): ResponseItem {
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

type ChatSessionTestPayload = {
  runId?: string;
  firstUserMessage?: string;
  lastUserMessage?: string;
  transcript: Array<{ role: string; content: string }>;
  runtimeTools?: Array<{ name: string }>;
  traceEvents?: Array<{ type: string; name?: string; ts?: number }>;
  metrics?: {
    turnStartedAt?: string;
    modelCalledAt?: string;
    firstTokenAt?: string;
    ttftMs?: number;
    modelTtftMs?: number;
  };
  errors?: Array<string>;
  running?: boolean;
};

async function waitForSession(
  port: number,
  predicate: (session: ChatSessionTestPayload) => boolean,
) {
  let lastSession: ChatSessionTestPayload | undefined;
  for (let i = 0; i < 100; i++) {
    const session = await (await fetch(`http://localhost:${port}/api/session`))
      .json() as ChatSessionTestPayload;
    lastSession = session;
    if (predicate(session)) return session;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `timed out waiting for chat session; last session: ${
      JSON.stringify(lastSession, null, 2)
    }`,
  );
}

Deno.test("chat server rejects worker sandbox execution while stop requires cancellation", () => {
  assertThrows(
    () =>
      startLocalChatServer({
        deckPath: "root.deck.md",
        modelProvider: {} as ModelProvider,
        workerSandbox: true,
      }),
    Error,
    "gambit chat does not support worker sandbox execution yet",
  );
});

Deno.test({
  name:
    "chat server runs a deck turn, persists state, and exposes trace/tool details",
  permissions: { read: true, write: true, net: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir({ prefix: "gambit-chat-test-" });
  const deckPath = await writeTempFile(
    dir,
    "root.deck.md",
    `+++
label = "chat test"

[modelParams]
model = "test/model"
+++

Call runtime_echo once, then summarize the tool result.`,
  );
  const runtimeToolsPath = await writeTempFile(
    dir,
    "runtime-tools.md",
    `+++
[[tools]]
name = "runtime_echo"
description = "Echo a value supplied by the runtime."
action = "./actions/runtime_echo.mock.deck.ts"
+++

Runtime tools for chat test.`,
  );
  await writeTempFile(
    dir,
    "actions/runtime_echo.mock.deck.ts",
    `import { defineDeck } from "${modImportPath()}";
import { z } from "npm:zod";

export default defineDeck({
  label: "runtime_echo_mock",
  contextSchema: z.object({ value: z.string() }),
  responseSchema: z.object({
    status: z.number(),
    mocked: z.boolean(),
    applied: z.boolean(),
    value: z.string(),
  }),
  run(ctx) {
    return {
      status: 200,
      mocked: true,
      applied: false,
      value: ctx.input.value,
    };
  },
});
`,
  );
  const runtimeTools = await loadRuntimeTools([runtimeToolsPath]);
  const tracePath = path.join(dir, "trace.jsonl");
  const statePath = path.join(dir, "workspace.sqlite");
  let callCount = 0;
  const provider: ModelProvider = {
    responses(input) {
      callCount++;
      if (callCount === 1) {
        assertEquals(
          input.request.tools?.some((tool) =>
            tool.type === "function" && tool.function.name === "runtime_echo"
          ),
          true,
        );
        return modelResponse([{
          type: "function_call",
          call_id: "call-runtime-echo",
          name: "runtime_echo",
          arguments: '{"value":"hello"}',
        } as ResponseItem]);
      }
      assertEquals(
        input.request.input.some((item) =>
          item.type === "function_call_output" &&
          item.call_id === "call-runtime-echo" &&
          String(item.output).includes("mocked")
        ),
        true,
      );
      return modelResponse([assistantText("tool result was visible")]);
    },
  };
  const abort = new AbortController();
  const port = 19000 + Math.floor(Math.random() * 1000);
  const server = startLocalChatServer({
    deckPath,
    modelProvider: provider,
    port,
    statePath,
    tracePath,
    runtimeTools,
    responsesMode: true,
    signal: abort.signal,
  });

  try {
    const response = await fetch(`http://localhost:${port}/api/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "please use the runtime tool" }),
    });
    assertEquals(response.status, 202);
    await response.text();
    const session = await waitForSession(
      port,
      (value) =>
        value.transcript.some((row) =>
          row.role === "assistant" && row.content.includes("tool result")
        ),
    ) as {
      transcript: Array<{ role: string; content: string }>;
      runtimeTools: Array<{ name: string }>;
      traceEvents: Array<{ type: string; name?: string }>;
    };
    assertEquals(session.runtimeTools[0]?.name, "runtime_echo");
    assertEquals(
      session.transcript.some((row) =>
        row.role === "assistant" && row.content.includes("tool result")
      ),
      true,
    );
    assertEquals(
      session.transcript.some((row) =>
        row.role === "tool" &&
        row.content.includes("Tool result: runtime_echo") &&
        row.content.includes("mocked")
      ),
      true,
    );
    assertEquals(
      session.traceEvents.some((event) =>
        event.type === "tool.call" && event.name === "runtime_echo"
      ),
      true,
    );
    const traceText = await Deno.readTextFile(tracePath);
    assertStringIncludes(traceText, "runtime_echo");
    const stateInfo = await Deno.stat(statePath);
    assert(stateInfo.isFile);
  } finally {
    abort.abort();
    await server.finished.catch(() => {});
  }
});

Deno.test({
  name:
    "chat runtime tools preserve JSON object payloads without truthy status",
  permissions: { read: true, write: true, net: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir({
    prefix: "gambit-chat-tool-json-test-",
  });
  const deckPath = await writeTempFile(
    dir,
    "root.deck.md",
    `+++
label = "chat runtime tool json test"

[modelParams]
model = "test/model"
+++

Call both supplied runtime tools.`,
  );
  const runtimeToolsPath = await writeTempFile(
    dir,
    "runtime-tools.md",
    `+++
[[tools]]
name = "runtime_zero"
description = "Return structured JSON with status 0."
action = "./actions/runtime_zero.mock.deck.ts"

[[tools]]
name = "runtime_plain"
description = "Return structured JSON without status."
action = "./actions/runtime_plain.mock.deck.ts"
+++

Runtime tools for JSON payload preservation.`,
  );
  await writeTempFile(
    dir,
    "actions/runtime_zero.mock.deck.ts",
    `import { defineDeck } from "${modImportPath()}";

export default defineDeck({
  label: "runtime_zero_mock",
  run() {
    return {
      status: 0,
      ok: true,
      value: "zero",
    };
  },
});
`,
  );
  await writeTempFile(
    dir,
    "actions/runtime_plain.mock.deck.ts",
    `import { defineDeck } from "${modImportPath()}";

export default defineDeck({
  label: "runtime_plain_mock",
  run() {
    return {
      ok: true,
      value: "plain",
    };
  },
});
`,
  );
  const runtimeTools = await loadRuntimeTools([runtimeToolsPath]);
  let callCount = 0;
  const provider: ModelProvider = {
    responses(input) {
      callCount++;
      if (callCount === 1) {
        return modelResponse([
          {
            type: "function_call",
            call_id: "call-runtime-zero",
            name: "runtime_zero",
            arguments: "{}",
          } as ResponseItem,
          {
            type: "function_call",
            call_id: "call-runtime-plain",
            name: "runtime_plain",
            arguments: "{}",
          } as ResponseItem,
        ]);
      }
      const outputByCallId = new Map<string, string>();
      for (const item of input.request.input) {
        if (item.type === "function_call_output") {
          outputByCallId.set(item.call_id, String(item.output));
        }
      }
      const zero = JSON.parse(outputByCallId.get("call-runtime-zero") ?? "{}");
      const plain = JSON.parse(
        outputByCallId.get("call-runtime-plain") ?? "{}",
      );
      assertEquals(zero.status, 0);
      assertEquals(zero.payload?.value, "zero");
      assertEquals(plain.payload?.value, "plain");
      return modelResponse([assistantText("structured tool payloads visible")]);
    },
  };
  const abort = new AbortController();
  const port = 19000 + Math.floor(Math.random() * 1000);
  const server = startLocalChatServer({
    deckPath,
    modelProvider: provider,
    port,
    runtimeTools,
    responsesMode: true,
    signal: abort.signal,
  });

  try {
    const response = await fetch(`http://localhost:${port}/api/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "please use the runtime tools" }),
    });
    assertEquals(response.status, 202);
    await response.text();
    await waitForSession(
      port,
      (value) =>
        value.transcript.some((row) =>
          row.role === "assistant" &&
          row.content.includes("structured tool payloads visible")
        ),
    );
  } finally {
    abort.abort();
    await server.finished.catch(() => {});
  }
});

Deno.test({
  name: "chat server exposes repro message and shell affordances",
  permissions: { read: true, write: true, net: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir({ prefix: "gambit-chat-shell-test-" });
  const deckPath = await writeTempFile(
    dir,
    "root.deck.md",
    `+++
label = "chat shell test"
+++

Echo the user.`,
  );
  const provider: ModelProvider = {
    responses() {
      return modelResponse([assistantText("ok")]);
    },
  };
  const abort = new AbortController();
  const port = 20000 + Math.floor(Math.random() * 1000);
  const reproMessage = "original user ask";
  const server = startLocalChatServer({
    deckPath,
    modelProvider: provider,
    port,
    reproMessage,
    signal: abort.signal,
  });

  try {
    const html = await (await fetch(`http://localhost:${port}/`)).text();
    assertStringIncludes(html, "Deck Chat Repro");
    assertStringIncludes(html, 'data-tab="run"');
    assertStringIncludes(html, "New run");
    assertStringIncludes(html, "Run again");
    assertStringIncludes(html, "Stop");
    assertStringIncludes(html, "/api/session/stop");
    assertStringIncludes(html, "requestSubmit");
    assertStringIncludes(html, "EventSource");
    assertStringIncludes(html, "/api/session/events");
    assertStringIncludes(html, "liveTurnRows");
    assertStringIncludes(html, "Tool call:");
    assertStringIncludes(html, "Tool result:");
    assertStringIncludes(html, "response.output_text.delta");
    assertStringIncludes(html, "formatMs");
    assertStringIncludes(html, "Model TTFT");
    assertStringIncludes(html, "curatedEvents");
    assertStringIncludes(html, "messageText(event.message)");
    assertStringIncludes(html, "shouldShowTimelineEvent");
    assertStringIncludes(html, "pendingTranscript");
    assertStringIncludes(html, " - sending");
    assertStringIncludes(html, ".transcript::before");
    assertStringIncludes(html, "margin-top: auto");
    assertStringIncludes(html, 'class="gds-panel chat"');
    assertEquals(html.includes("[...data.transcript].reverse()"), false);
    assertStringIncludes(
      html,
      "$('transcript').scrollTop = $('transcript').scrollHeight",
    );
    assertEquals(html.includes("Use repro message"), false);
    const session = await (await fetch(`http://localhost:${port}/api/session`))
      .json() as { reproMessage?: string };
    assertEquals(session.reproMessage, reproMessage);
  } finally {
    abort.abort();
    await server.finished.catch(() => {});
  }
});

Deno.test({
  name: "chat server hydrates transcript from persisted workspace state",
  permissions: { read: true, write: true, net: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir({
    prefix: "gambit-chat-hydrate-test-",
  });
  const deckPath = await writeTempFile(
    dir,
    "root.deck.md",
    `+++
label = "chat hydrate test"

[modelParams]
model = "test/model"
+++

Continue the conversation.`,
  );
  const statePath = path.join(dir, "workspace.sqlite");
  saveCanonicalWorkspaceState(statePath, {
    runId: "persisted-run",
    messages: [
      { role: "user", content: "visible previous ask" },
      { role: "assistant", content: "visible previous answer" },
    ],
  });
  let callCount = 0;
  const provider: ModelProvider = {
    responses(input) {
      callCount++;
      assertEquals(
        input.request.input.some((item) =>
          item.type === "message" &&
          item.role === "user" &&
          item.content.some((content) =>
            content.type === "input_text" &&
            content.text.includes("visible previous ask")
          )
        ),
        true,
      );
      return modelResponse([
        assistantText(callCount === 1 ? "continued answer" : "rerun answer"),
      ]);
    },
  };
  const abort = new AbortController();
  const port = 20450 + Math.floor(Math.random() * 1000);
  const server = startLocalChatServer({
    deckPath,
    modelProvider: provider,
    port,
    statePath,
    responsesMode: true,
    signal: abort.signal,
  });

  try {
    const initial = await (await fetch(`http://localhost:${port}/api/session`))
      .json() as ChatSessionTestPayload;
    assertEquals(initial.runId, "persisted-run");
    assertEquals(initial.firstUserMessage, "visible previous ask");
    assertEquals(initial.lastUserMessage, "visible previous ask");
    assertEquals(
      initial.transcript.map((row) => `${row.role}:${row.content}`),
      [
        "user:visible previous ask",
        "assistant:visible previous answer",
      ],
    );

    const response = await fetch(`http://localhost:${port}/api/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "continue" }),
    });
    assertEquals(response.status, 202);
    await response.text();
    const session = await waitForSession(
      port,
      (value) =>
        value.transcript.some((row) => row.content === "continued answer"),
    );
    assertEquals(
      session.transcript.map((row) => `${row.role}:${row.content}`),
      [
        "user:visible previous ask",
        "assistant:visible previous answer",
        "user:continue",
        "assistant:continued answer",
      ],
    );

    const reset = await fetch(`http://localhost:${port}/api/session/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rerun: true }),
    });
    assertEquals(reset.status, 202);
    await reset.text();
    const rerun = await waitForSession(
      port,
      (value) => value.transcript.some((row) => row.content === "rerun answer"),
    );
    assertEquals(
      rerun.transcript.map((row) => `${row.role}:${row.content}`),
      [
        "user:visible previous ask",
        "assistant:rerun answer",
      ],
    );
  } finally {
    abort.abort();
    await server.finished.catch(() => {});
  }
});

Deno.test({
  name: "chat server can stop a running deck turn",
  permissions: { read: true, write: true, net: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir({ prefix: "gambit-chat-stop-test-" });
  const deckPath = await writeTempFile(
    dir,
    "root.deck.md",
    `+++
label = "chat stop test"

[modelParams]
model = "test/model"
+++

Echo the user slowly.`,
  );
  let seenSignal: AbortSignal | undefined;
  const provider: ModelProvider = {
    responses(input) {
      seenSignal = input.signal;
      return new Promise((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => {
          reject(new DOMException("stopped", "AbortError"));
        }, { once: true });
      });
    },
  };
  const abort = new AbortController();
  const port = 20350 + Math.floor(Math.random() * 1000);
  const server = startLocalChatServer({
    deckPath,
    modelProvider: provider,
    port,
    signal: abort.signal,
  });

  try {
    const response = await fetch(`http://localhost:${port}/api/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "slow prompt" }),
    });
    assertEquals(response.status, 202);
    await response.text();
    await waitForSession(port, (value) => value.running === true);
    assert(seenSignal);
    const stop = await fetch(`http://localhost:${port}/api/session/stop`, {
      method: "POST",
    });
    assertEquals(stop.status, 202);
    await stop.text();
    const session = await waitForSession(
      port,
      (value) =>
        value.running === false &&
        value.transcript.some((row) => row.content === "Stopped."),
    );
    assertEquals(seenSignal.aborted, true);
    assertEquals(session.errors ?? [], []);
    assertEquals(
      session.transcript.map((row) => `${row.role}:${row.content}`),
      ["user:slow prompt", "system:Stopped."],
    );
  } finally {
    abort.abort();
    await server.finished.catch(() => {});
  }
});

Deno.test({
  name: "chat server preserves separate assistant message items",
  permissions: { read: true, write: true, net: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir({ prefix: "gambit-chat-items-test-" });
  const deckPath = await writeTempFile(
    dir,
    "root.deck.md",
    `+++
label = "chat message items test"

[modelParams]
model = "test/model"
+++

Return two assistant messages.`,
  );
  const provider: ModelProvider = {
    responses() {
      return modelResponse([
        assistantText("first assistant item"),
        assistantText("second assistant item"),
      ]);
    },
  };
  const abort = new AbortController();
  const port = 20250 + Math.floor(Math.random() * 1000);
  const server = startLocalChatServer({
    deckPath,
    modelProvider: provider,
    port,
    signal: abort.signal,
  });

  try {
    const response = await fetch(`http://localhost:${port}/api/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "split please" }),
    });
    assertEquals(response.status, 202);
    await response.text();
    const session = await waitForSession(
      port,
      (value) =>
        value.transcript.some((row) =>
          row.role === "assistant" && row.content === "second assistant item"
        ),
    );
    assertEquals(
      session.transcript.map((row) => `${row.role}:${row.content}`),
      [
        "user:split please",
        "assistant:first assistant item",
        "assistant:second assistant item",
      ],
    );
  } finally {
    abort.abort();
    await server.finished.catch(() => {});
  }
});

Deno.test({
  name: "chat server streams session updates while a deck turn runs",
  permissions: { read: true, write: true, net: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir({ prefix: "gambit-chat-sse-test-" });
  const deckPath = await writeTempFile(
    dir,
    "root.deck.md",
    `+++
label = "chat sse test"

[modelParams]
model = "test/model"
+++

Echo the user.`,
  );
  let releaseResponse: (() => void) | undefined;
  const provider: ModelProvider = {
    responses(input) {
      input.onStreamEvent?.({
        type: "response.output_text.delta",
        output_index: 0,
        item_id: "msg_stream",
        delta: "slow ",
      });
      return new Promise((resolve) => {
        releaseResponse = () =>
          resolve(modelResponse([assistantText("slow ok")]));
      });
    },
  };
  const abort = new AbortController();
  const port = 20500 + Math.floor(Math.random() * 1000);
  const server = startLocalChatServer({
    deckPath,
    modelProvider: provider,
    port,
    signal: abort.signal,
  });

  try {
    const events = await fetch(`http://localhost:${port}/api/session/events`);
    assertEquals(events.status, 200);
    assertStringIncludes(
      events.headers.get("content-type") ?? "",
      "text/event-stream",
    );
    const reader = events.body?.getReader();
    assert(reader);
    const initial = await reader.read();
    assertEquals(initial.done, false);
    assertStringIncludes(new TextDecoder().decode(initial.value), "session");

    const response = await fetch(`http://localhost:${port}/api/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "slow prompt" }),
    });
    assertEquals(response.status, 202);
    await response.text();
    const running = await (await fetch(`http://localhost:${port}/api/session`))
      .json() as ChatSessionTestPayload;
    assertEquals(running.running, true);
    assertEquals(
      running.transcript.map((row) => `${row.role}:${row.content}`),
      ["user:slow prompt"],
    );

    const update = await reader.read();
    assertEquals(update.done, false);
    assertStringIncludes(new TextDecoder().decode(update.value), "slow prompt");

    releaseResponse?.();
    const completed = await waitForSession(
      port,
      (value) =>
        value.running === false &&
        value.transcript.some((row) => row.content.includes("slow ok")),
    );
    assertEquals(completed.running, false);
    assert(typeof completed.metrics?.ttftMs === "number");
    assert(completed.metrics.ttftMs >= 0);
    assert(typeof completed.metrics?.modelTtftMs === "number");
    assert(completed.metrics.modelTtftMs >= 0);
    assert(completed.metrics.firstTokenAt);
    assert(
      completed.traceEvents?.some((event) =>
        event.type === "response.output_text.delta" &&
        typeof event.ts === "number"
      ),
    );
    assertEquals(
      completed.transcript.map((row) => row.role),
      ["user", "assistant"],
    );
    await reader.cancel();
  } finally {
    abort.abort();
    await server.finished.catch(() => {});
  }
});

Deno.test({
  name: "chat server can start a fresh run and replay the first prompt",
  permissions: { read: true, write: true, net: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir({ prefix: "gambit-chat-rerun-test-" });
  const deckPath = await writeTempFile(
    dir,
    "root.deck.md",
    `+++
label = "chat rerun test"

[modelParams]
model = "test/model"
+++

Echo the user.`,
  );
  let callCount = 0;
  const provider: ModelProvider = {
    responses() {
      callCount++;
      return modelResponse([assistantText(`reply ${callCount}`)]);
    },
  };
  const abort = new AbortController();
  const port = 21000 + Math.floor(Math.random() * 1000);
  const statePath = path.join(dir, "workspace.sqlite");
  const server = startLocalChatServer({
    deckPath,
    modelProvider: provider,
    port,
    statePath,
    signal: abort.signal,
  });

  try {
    const initial = await (await fetch(`http://localhost:${port}/api/session`))
      .json() as { runId: string };
    const first = await fetch(`http://localhost:${port}/api/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "same prompt" }),
    });
    assertEquals(first.status, 202);
    await first.text();
    await waitForSession(
      port,
      (value) =>
        value.transcript.some((row) => row.content.includes("reply 1")) &&
        value.running === false,
    );
    const followUp = await fetch(`http://localhost:${port}/api/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "follow-up prompt" }),
    });
    assertEquals(followUp.status, 202);
    await followUp.text();
    await waitForSession(
      port,
      (value) =>
        value.transcript.some((row) => row.content.includes("reply 2")) &&
        value.running === false,
    );
    const reset = await fetch(`http://localhost:${port}/api/session/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rerun: true }),
    });
    assertEquals(reset.status, 202);
    await reset.text();
    const session = await waitForSession(
      port,
      (value) =>
        value.transcript.some((row) => row.content.includes("reply 3")) &&
        value.running === false,
    ) as {
      runId: string;
      firstUserMessage?: string;
      lastUserMessage?: string;
      transcript: Array<{ role: string; content: string }>;
    };
    assertNotEquals(session.runId, initial.runId);
    assertEquals(session.firstUserMessage, "same prompt");
    assertEquals(session.lastUserMessage, "same prompt");
    assertEquals(callCount, 3);
    assertEquals(
      session.transcript.filter((row) => row.role === "user").map((row) =>
        row.content
      ),
      ["same prompt"],
    );
    assertEquals(
      session.transcript.some((row) => row.content.includes("reply 3")),
      true,
    );
  } finally {
    abort.abort();
    await server.finished.catch(() => {});
  }
});

Deno.test({
  name: "runtime tool loader rejects duplicate tool names",
  permissions: { read: true, write: true },
}, async () => {
  const dir = await Deno.makeTempDir({ prefix: "gambit-chat-tools-test-" });
  const one = await writeTempFile(
    dir,
    "one.md",
    `+++
[[tools]]
name = "same"
+++
`,
  );
  const two = await writeTempFile(
    dir,
    "two.md",
    `+++
[[tools]]
name = "same"
+++
`,
  );

  try {
    await loadRuntimeTools([one, two]);
    throw new Error("expected duplicate tool rejection");
  } catch (err) {
    assertStringIncludes(String(err), "Duplicate runtime tool");
  }
});
