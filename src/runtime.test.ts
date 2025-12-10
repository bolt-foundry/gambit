import { assert, assertEquals, assertRejects } from "@std/assert";
import * as path from "@std/path";
import { loadDeck } from "./loader.ts";
import { runDeck } from "./runtime.ts";
import type { ModelMessage, ModelProvider, TraceEvent } from "./types.ts";

const dummyProvider: ModelProvider = {
  chat() {
    return Promise.resolve({
      message: { role: "assistant", content: "dummy" },
      finishReason: "stop",
    });
  },
};

function modImportPath() {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const modPath = path.resolve(here, "..", "mod.ts");
  return path.toFileUrl(modPath).href;
}

async function writeTempDeck(dir: string, filename: string, contents: string) {
  const target = path.join(dir, filename);
  await Deno.writeTextFile(target, contents);
  return target;
}

Deno.test("compute deck returns validated output", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "compute.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      label: "compute_test",
      run(ctx: { input: string }) {
        return "ok:" + ctx.input;
      }
    });
    `,
  );

  const result = await runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: dummyProvider,
    isRoot: true,
  });

  assertEquals(result, "ok:hello");
});

Deno.test("compute deck can define run inline", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "inline.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      label: "inline_run",
      run(ctx: { input: string }) {
        return "inline:" + ctx.input;
      }
    });
    `,
  );

  const result = await runDeck({
    path: deckPath,
    input: "hi",
    modelProvider: dummyProvider,
    isRoot: true,
  });

  assertEquals(result, "inline:hi");
});

Deno.test("compute deck can emit ctx.log trace events", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "log.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      label: "log_example",
      run(ctx) {
        ctx.log({ message: "child log", level: "debug", meta: { step: 1 } });
        return "ok";
      }
    });
    `,
  );

  const traces: TraceEvent[] = [];
  const result = await runDeck({
    path: deckPath,
    input: "hi",
    modelProvider: dummyProvider,
    isRoot: true,
    trace: (ev) => traces.push(ev),
  });

  assertEquals(result, "ok");
  const logEvent = traces.find((t): t is Extract<TraceEvent, { type: "log" }> =>
    t.type === "log"
  );
  assert(logEvent, "expected log event");
  assertEquals(logEvent.message, "child log");
  assertEquals(logEvent.level, "debug");
  assertEquals(logEvent.title, "child log");
  assertEquals(logEvent.body, "child log");
  assertEquals(logEvent.deckPath, deckPath);
});

Deno.test("compute deck log supports title/body", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "log_body.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      label: "log_body",
      run(ctx) {
        ctx.log({ title: "summary", message: "details", body: { ok: true } });
        return "ok";
      }
    });
    `,
  );

  const traces: TraceEvent[] = [];
  await runDeck({
    path: deckPath,
    input: "hi",
    modelProvider: dummyProvider,
    isRoot: true,
    trace: (ev) => traces.push(ev),
  });

  const logEvent = traces.find((t): t is Extract<TraceEvent, { type: "log" }> =>
    t.type === "log"
  );
  assert(logEvent, "expected log event");
  assertEquals(logEvent.title, "summary");
  assertEquals(logEvent.message, "details");
  assertEquals(logEvent.body, { ok: true });
});

Deno.test("module-level run export is rejected", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "bad_run.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      label: "bad_run",
    });
    export function run(ctx: { input: string }) {
      return "nope:" + ctx.input;
    }
    `,
  );

  await assertRejects(() =>
    runDeck({
      path: deckPath,
      input: "hi",
      modelProvider: dummyProvider,
      isRoot: true,
    })
  );
});

Deno.test("LLM deck fails fast when finishReason=tool_calls with no calls", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "llm.deck.ts",
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
        message: { role: "assistant", content: null },
        finishReason: "tool_calls",
      });
    },
  };

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: "hi",
        modelProvider: provider,
        isRoot: true,
      }),
    Error,
    "tool_calls",
  );
});

Deno.test("LLM deck fails fast when finishReason=length with no content", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "llm-length.deck.ts",
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
        message: { role: "assistant", content: null },
        finishReason: "length",
      });
    },
  };

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: "hi",
        modelProvider: provider,
        isRoot: true,
      }),
    Error,
    "length",
  );
});

Deno.test("LLM deck completes via gambit_respond", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "respond.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
      syntheticTools: { respond: true },
    });
    `,
  );

  const provider: ModelProvider = {
    chat() {
      return Promise.resolve({
        message: { role: "assistant", content: null },
        finishReason: "tool_calls",
        toolCalls: [{
          id: "respond-1",
          name: "gambit_respond",
          args: { payload: "ok" },
        }],
      });
    },
  };

  const result = await runDeck({
    path: deckPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
  });

  assertEquals(result, { payload: "ok" });
});

Deno.test("LLM deck gambit_respond propagates status and message", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "respond.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
      syntheticTools: { respond: true },
    });
    `,
  );

  const provider: ModelProvider = {
    chat() {
      return Promise.resolve({
        message: { role: "assistant", content: null },
        finishReason: "tool_calls",
        toolCalls: [{
          id: "respond-1",
          name: "gambit_respond",
          args: { payload: "fail", status: 503, message: "nope", code: "X" },
        }],
      });
    },
  };

  const result = await runDeck({
    path: deckPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
  });

  assertEquals(result, {
    status: 503,
    payload: "fail",
    message: "nope",
    code: "X",
  });
});

Deno.test("busy handler uses action start time", async () => {
  const origNow = performance.now;
  let now = 0;
  // Simple controllable clock.
  (performance as { now: () => number }).now = () => now;

  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const handlerPath = await writeTempDeck(
    dir,
    "busy_handler.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.any(),
      outputSchema: z.string(),
      label: "interval_handler",
      run() { return "waiting"; }
    });
    `,
  );

  const childPath = await writeTempDeck(
    dir,
    "child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      label: "child",
      run() { return "done"; }
    });
    `,
  );

  const parentPath = await writeTempDeck(
    dir,
    "parent.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
      handlers: { onBusy: { path: "${handlerPath}", delayMs: 5 } },
      actions: [{ name: "child", path: "${childPath}" }]
    });
    `,
  );

  const traces: import("./types.ts").TraceEvent[] = [];
  let callCount = 0;
  const provider: ModelProvider = {
    chat() {
      callCount++;
      if (callCount === 1) {
        // Simulate the run having started long ago (run start at now=0), but the
        // action starts later at now=100.
        now = 100;
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{ id: "t1", name: "child", args: {} }],
        });
      }
      // Second pass returns final content.
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      });
    },
  };

  // Child completes immediately; advance slightly after action start.
  now = 101;

  await runDeck({
    path: parentPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
    trace: (ev) => traces.push(ev),
  });

  // restore clock
  (performance as { now: () => number }).now = origNow;
});

Deno.test("onInterval alias still triggers busy handler", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const handlerPath = await writeTempDeck(
    dir,
    "alias_busy.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({
        kind: z.union([z.literal("busy"), z.literal("suspense")]),
        trigger: z.object({ elapsedMs: z.number(), reason: z.string() })
      }),
      outputSchema: z.string(),
      label: "alias_busy",
      run() { return "alias busy fired"; }
    });
    `,
  );

  const childPath = await writeTempDeck(
    dir,
    "work.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      label: "work",
      run() { return "done"; }
    });
    `,
  );

  const parentPath = await writeTempDeck(
    dir,
    "parent.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
      handlers: { onInterval: { path: "${handlerPath}", delayMs: 0 } },
      actions: [{ name: "work", path: "${childPath}" }]
    });
    `,
  );

  let callCount = 0;
  const stream: string[] = [];
  const provider: ModelProvider = {
    chat() {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{ id: "t1", name: "work", args: {} }],
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: parentPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
    onStreamText: (chunk) => stream.push(chunk),
  });

  assertEquals(result, "ok");
  assert(stream.some((c) => c.includes("alias busy fired")));
});

Deno.test("idle handler fires after inactivity", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const handlerPath = await writeTempDeck(
    dir,
    "idle_handler.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({
        kind: z.literal("idle"),
        trigger: z.object({ elapsedMs: z.number(), reason: z.string() })
      }),
      outputSchema: z.string(),
      label: "idle_handler",
      run(ctx) { return "idle ping " + Math.round(ctx.input.trigger.elapsedMs); }
    });
    `,
  );

  const parentPath = await writeTempDeck(
    dir,
    "parent_idle.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
      handlers: { onIdle: { path: "${handlerPath}", delayMs: 5 } }
    });
    `,
  );

  const stream: string[] = [];
  const provider: ModelProvider = {
    chat() {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            message: { role: "assistant", content: "done" },
            finishReason: "stop",
          });
        }, 25);
      });
    },
  };

  const result = await runDeck({
    path: parentPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
    onStreamText: (chunk) => stream.push(chunk),
  });

  assertEquals(result, "done");
  assert(stream.some((c) => c.includes("idle ping")));
});

Deno.test("isRoot inferred when omitted", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const childPath = await writeTempDeck(
    dir,
    "child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      label: "child",
      run(ctx: { input: string }) {
        return "child:" + ctx.input;
      }
    });
    `,
  );

  // If caller omits isRoot and depth/parentActionCallId, we infer root and allow
  // the default assistant-first flow to seed the init tool.
  const result = await runDeck({
    path: childPath,
    input: "hi",
    modelProvider: dummyProvider,
  });

  assertEquals(result, "child:hi");
});

Deno.test("LLM deck streams via onStreamText", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "stream.deck.ts",
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

  const chunks: string[] = [];
  let sawStreamFlag = false;
  const streamingProvider: ModelProvider = {
    chat(input) {
      sawStreamFlag = Boolean(input.stream);
      input.onStreamText?.("a");
      input.onStreamText?.("b");
      return Promise.resolve({
        message: { role: "assistant", content: "ab" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: deckPath,
    input: "hi",
    modelProvider: streamingProvider,
    isRoot: true,
    stream: true,
    onStreamText: (chunk) => chunks.push(chunk),
  });

  assertEquals(result, "ab");
  assertEquals(chunks.join(""), "ab");
  assertEquals(sawStreamFlag, true);
});

Deno.test("LLM deck defaults to assistant-first and sends a user message when provided", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "assistant-first.deck.ts",
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

  let lastMessages: ModelMessage[] = [];
  const provider: ModelProvider = {
    chat(input) {
      lastMessages = input.messages;
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  await runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: provider,
    isRoot: true,
  });
  const hasUserDefault = lastMessages.some((m) => m.role === "user");
  assertEquals(hasUserDefault, false);

  await runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: provider,
    isRoot: true,
    initialUserMessage: "first turn",
  });
  const hasUserOptIn = lastMessages.some((m) => m.role === "user");
  assertEquals(hasUserOptIn, true);
  const lastUser = [...lastMessages].reverse().find((m) => m.role === "user");
  assertEquals(lastUser?.content, "first turn");
});

Deno.test("LLM deck defaults input to empty string for message-only runs", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "message_only.deck.ts",
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

  let lastMessages: ModelMessage[] = [];
  const provider: ModelProvider = {
    chat(input) {
      lastMessages = input.messages;
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  await runDeck({
    path: deckPath,
    input: undefined,
    modelProvider: provider,
    isRoot: true,
    initialUserMessage: "hello",
    inputProvided: false,
  });

  const hasInit = lastMessages.some((m) =>
    m.role === "tool" && m.name === "gambit_init"
  );
  assertEquals(hasInit, false);
  const lastUser = [...lastMessages].reverse().find((m) => m.role === "user");
  assertEquals(lastUser?.content, "hello");
});

Deno.test("LLM deck reuses saved input when follow-up messages arrive without input", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "reuse_state.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({ topic: z.string() }),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  let savedState: import("./state.ts").SavedState | undefined;
  let callCount = 0;
  const provider: ModelProvider = {
    chat() {
      callCount++;
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  await runDeck({
    path: deckPath,
    input: { topic: "first" },
    modelProvider: provider,
    isRoot: true,
    onStateUpdate: (s) => {
      savedState = s;
    },
  });

  assert(savedState);

  await runDeck({
    path: deckPath,
    modelProvider: provider,
    isRoot: true,
    state: savedState,
    initialUserMessage: "follow up",
    inputProvided: false,
    input: undefined,
  });

  assertEquals(callCount, 2);
});

Deno.test("onError handler result surfaces via gambit_complete when an action fails", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  // child action that always throws
  const childPath = await writeTempDeck(
    dir,
    "failing_action.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      label: "failing_action",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      run() {
        throw new Error("boom");
      }
    });
    `,
  );

  // onError handler that returns a friendly payload
  const handlerPath = await writeTempDeck(
    dir,
    "on_error_handler.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      label: "handler",
      inputSchema: z.object({
        kind: z.literal("error"),
        source: z.object({ deckPath: z.string(), actionName: z.string() }),
        error: z.object({ message: z.string() }),
      }),
      outputSchema: z.object({
        message: z.string().optional(),
        code: z.string().optional(),
        status: z.number().optional(),
        payload: z.any().optional(),
        meta: z.record(z.any()).optional(),
      }),
      run(ctx) {
        return {
          message: "Recovered gracefully",
          code: "HANDLED",
          status: 200,
          payload: { notice: "fallback" },
          meta: { fromHandler: true },
        };
      }
    });
    `,
  );

  // parent LLM deck
  const parentPath = await writeTempDeck(
    dir,
    "parent.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      label: "parent",
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
      actions: [{ name: "failing_action", path: "${childPath}" }],
      handlers: { onError: { path: "${handlerPath}" } },
    });
    `,
  );

  // provider that first issues a tool call to failing_action, then finishes
  let calls = 0;
  const provider: ModelProvider = {
    chat() {
      calls++;
      if (calls === 1) {
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls" as const,
          toolCalls: [{
            id: "call-1",
            name: "failing_action",
            args: {},
          }],
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop" as const,
      });
    },
  };

  const traceEvents: TraceEvent[] = [];
  await runDeck({
    path: parentPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
    trace: (ev) => traceEvents.push(ev),
    inputProvided: true,
  });

  const toolResult = traceEvents.find((ev) =>
    ev.type === "tool.result" && ev.name === "failing_action"
  ) as Extract<TraceEvent, { type: "tool.result" }> | undefined;
  if (!toolResult) {
    throw new Error("missing tool.result for failing_action");
  }
  const parsed = JSON.parse(String(toolResult.result));
  assertEquals(parsed.status, 200);
  assertEquals(parsed.code, "HANDLED");
  assertEquals(parsed.payload.notice, "fallback");
});

Deno.test("run.start traces input and gambit_init payload", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "trace-init.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({ question: z.string() }),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const traces: TraceEvent[] = [];
  const provider: ModelProvider = {
    chat() {
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  const input = { question: "hours?" };
  await runDeck({
    path: deckPath,
    input,
    modelProvider: provider,
    isRoot: true,
    trace: (ev) => traces.push(ev),
  });

  const start = traces.find((t) => t.type === "run.start") as Extract<
    TraceEvent,
    { type: "run.start" }
  >;
  assertEquals(start.deckPath, deckPath);
  assertEquals(start.input, input);

  const initCall = traces.find((t) =>
    t.type === "tool.call" && t.name === "gambit_init"
  ) as Extract<TraceEvent, { type: "tool.call" }>;
  assertEquals(initCall.args, {});

  const initResult = traces.find((t) =>
    t.type === "tool.result" && t.name === "gambit_init"
  ) as Extract<TraceEvent, { type: "tool.result" }>;
  const payload = initResult.result as unknown;
  assertEquals(payload, input);
});

Deno.test("gambit_init does not run when input is not provided", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "no-init.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  let sawInit = false;
  const provider: ModelProvider = {
    chat(input) {
      sawInit = input.messages.some((m) =>
        m.tool_calls?.some((t) => t.function.name === "gambit_init")
      );
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  await runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    modelProvider: provider,
    isRoot: true,
  });

  assertEquals(sawInit, false);
});

Deno.test("trace includes parentActionCallId hierarchy", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const childPath = await writeTempDeck(
    dir,
    "trace-child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
  );

  const parentPath = await writeTempDeck(
    dir,
    "trace-parent.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
      actions: [{ name: "child", path: "${childPath}" }],
    });
    `,
  );

  const traces: TraceEvent[] = [];
  let callCount = 0;
  const provider: ModelProvider = {
    chat() {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{ id: "call-child", name: "child", args: {} }],
        });
      }
      if (callCount === 2) {
        return Promise.resolve({
          message: { role: "assistant", content: "child-done" },
          finishReason: "stop",
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "parent-done" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: parentPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
    trace: (ev) => traces.push(ev),
  });

  assertEquals(result, "parent-done");

  const parentDeck = traces.find((t) =>
    t.type === "deck.start" && t.deckPath === parentPath
  ) as Extract<TraceEvent, { type: "deck.start" }>;
  const actionStart = traces.find((t) =>
    t.type === "action.start" && t.name === "child"
  ) as Extract<TraceEvent, { type: "action.start" }>;
  const childDeck = traces.find((t) =>
    t.type === "deck.start" && t.deckPath === childPath
  ) as Extract<TraceEvent, { type: "deck.start" }>;

  assertEquals(parentDeck.parentActionCallId, undefined);
  assertEquals(actionStart.parentActionCallId, parentDeck.actionCallId);
  assertEquals(childDeck.parentActionCallId, actionStart.actionCallId);
});

Deno.test("non-root missing schemas fails load", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "bad.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({});
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: "data",
        modelProvider: dummyProvider,
        isRoot: false,
      }),
    Error,
    "must declare inputSchema and outputSchema",
  );
});

Deno.test("deck.actions merge overrides card actions", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  await writeTempDeck(
    dir,
    "card.card.ts",
    `
    import { defineCard } from "${modHref}";
    export default defineCard({
      actions: [{ name: "from_card", path: "./child.deck.ts", description: "card" }]
    });
    `,
  );

  const rootPath = await writeTempDeck(
    dir,
    "root.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      actions: [
        { name: "from_card", path: "./child.deck.ts", description: "deck override" },
        { name: "from_deck", path: "./child.deck.ts", description: "deck only" }
      ],
      modelParams: { model: "test-model" },
      embeds: ["./card.card.ts"]
    });
    `,
  );

  // child deck for schema validation
  await writeTempDeck(
    dir,
    "child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.string(),
      run(ctx: { input: { text: string } }) {
        return ctx.input.text;
      }
    });
    `,
  );

  const loaded = await runDeck({
    path: rootPath,
    input: "hello",
    modelProvider: dummyProvider,
    isRoot: true,
  });

  // dummy provider returns "dummy" so root output will be validated as string
  assertEquals(typeof loaded, "string");
});

Deno.test("card schema fragments merge into deck schemas", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  await writeTempDeck(
    dir,
    "card.card.ts",
    `
    import { defineCard } from "${modHref}";
    import { z } from "zod";
    export default defineCard({
      inputFragment: z.object({ extra: z.string() }),
      outputFragment: z.object({ note: z.string() })
    });
    `,
  );

  const rootPath = await writeTempDeck(
    dir,
    "root.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ result: z.string() }),
      actions: [],
      embeds: ["./card.card.ts"],
      run(ctx: { input: { text: string, extra: string } }) {
        return { result: ctx.input.text, note: ctx.input.extra };
      }
    });
    `,
  );

  const result = await runDeck({
    path: rootPath,
    input: { text: "hi", extra: "more" },
    modelProvider: dummyProvider,
    isRoot: true,
  });

  assertEquals(typeof result, "object");
});

Deno.test("card embed cycles are rejected", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  await writeTempDeck(
    dir,
    "a.card.ts",
    `
    import { defineCard } from "${modHref}";
    export default defineCard({
      embeds: ["./b.card.ts"]
    });
    `,
  );

  await writeTempDeck(
    dir,
    "b.card.ts",
    `
    import { defineCard } from "${modHref}";
    export default defineCard({
      embeds: ["./a.card.ts"]
    });
    `,
  );

  const rootPath = await writeTempDeck(
    dir,
    "root.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      embeds: ["./a.card.ts"],
      modelParams: { model: "test-model" },
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: rootPath,
        input: "hello",
        modelProvider: dummyProvider,
        isRoot: true,
      }),
    Error,
    "cycle",
  );
});

Deno.test("markdown deck merges actions from embedded cards", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  await writeTempDeck(
    dir,
    "child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.string(),
      run(ctx: { input: { message: string } }) {
        return ctx.input.message;
      }
    });
    `,
  );

  await Deno.writeTextFile(
    path.join(dir, "nested.card.md"),
    `
+++
actions = [{ name = "nested_action", path = "./child.deck.ts" }]
+++

Nested card body.
`.trim(),
  );

  await Deno.writeTextFile(
    path.join(dir, "root.card.md"),
    `
+++
embeds = ["./nested.card.md"]
actions = [{ name = "card_action", path = "./child.deck.ts" }]
+++

Root card body.
`.trim(),
  );

  const deckPath = path.join(dir, "root.deck.md");
  await Deno.writeTextFile(
    deckPath,
    `
+++
embeds = ["./root.card.md"]
actions = [{ name = "deck_action", path = "./child.deck.ts" }]
+++

Deck body.
`.trim(),
  );

  const deck = await loadDeck(deckPath);
  const actionNames = deck.actions.map((a) => a.name).sort();

  assertEquals(actionNames, ["card_action", "deck_action", "nested_action"]);
  assertEquals(deck.cards.length, 2);
});

Deno.test("markdown deck strips inline embed markers from system prompt", async () => {
  const dir = await Deno.makeTempDir();

  await Deno.writeTextFile(
    path.join(dir, "persona.card.md"),
    `
+++
+++

Persona content.
`.trim(),
  );

  const deckPath = path.join(dir, "root.deck.md");
  await Deno.writeTextFile(
    deckPath,
    `
+++
modelParams = { model = "dummy-model" }
+++

Deck intro before embed.

![Persona](./persona.card.md)

Deck outro after embed.
`.trim(),
  );

  const seen: ModelMessage[][] = [];
  const provider: ModelProvider = {
    chat({ messages }) {
      seen.push(messages);
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  await runDeck({
    path: deckPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
  });

  const last = seen.at(-1);
  const system = last?.find((m) => m.role === "system");
  if (!system || typeof system.content !== "string") {
    throw new Error("missing system message");
  }

  const content = system.content;
  assertEquals(content.includes("![Persona](./persona.card.md)"), false);
  assertEquals(content.includes("Deck intro before embed."), true);
  assertEquals(content.includes("Deck outro after embed."), true);
  assertEquals(content.includes("Persona content."), true);
});

Deno.test("markdown card embed cycles are rejected", async () => {
  const dir = await Deno.makeTempDir();

  await Deno.writeTextFile(
    path.join(dir, "a.card.md"),
    `
+++
embeds = ["./b.card.md"]
+++

A card body.
`.trim(),
  );

  await Deno.writeTextFile(
    path.join(dir, "b.card.md"),
    `
+++
embeds = ["./a.card.md"]
+++

B card body.
`.trim(),
  );

  const deckPath = path.join(dir, "root.deck.md");
  await Deno.writeTextFile(
    deckPath,
    `
+++
modelParams = { model = "dummy-model" }
embeds = ["./a.card.md"]
+++

Deck with cyclic cards.
`.trim(),
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: "hi",
        modelProvider: dummyProvider,
        isRoot: true,
      }),
    Error,
    "cycle",
  );
});

Deno.test("markdown card schema fragments merge into deck schemas", async () => {
  const dir = await Deno.makeTempDir();

  await Deno.writeTextFile(
    path.join(dir, "fragments.card.md"),
    `
+++
inputSchema = "./input_fragment.zod.ts"
outputSchema = "./output_fragment.zod.ts"
+++

Fragments card body.
`.trim(),
  );

  await Deno.writeTextFile(
    path.join(dir, "input_fragment.zod.ts"),
    `
    import { z } from "zod";
    export default z.object({ extra: z.string() });
    `.trim(),
  );

  await Deno.writeTextFile(
    path.join(dir, "output_fragment.zod.ts"),
    `
    import { z } from "zod";
    export default z.object({ note: z.number() });
    `.trim(),
  );

  const deckPath = path.join(dir, "root.deck.md");
  await Deno.writeTextFile(
    deckPath,
    `
+++
inputSchema = "./base_input.zod.ts"
outputSchema = "./base_output.zod.ts"
embeds = ["./fragments.card.md"]
+++

Deck body.
`.trim(),
  );

  await Deno.writeTextFile(
    path.join(dir, "base_input.zod.ts"),
    `
    import { z } from "zod";
    export default z.object({ text: z.string() });
    `.trim(),
  );

  await Deno.writeTextFile(
    path.join(dir, "base_output.zod.ts"),
    `
    import { z } from "zod";
    export default z.object({ result: z.string() });
    `.trim(),
  );

  const deck = await loadDeck(deckPath);
  const inputShape = (deck.inputSchema as unknown as {
    shape: Record<string, unknown>;
  }).shape;
  const outputShape = (deck.outputSchema as unknown as {
    shape: Record<string, unknown>;
  }).shape;

  assertEquals(Object.keys(inputShape).sort(), ["extra", "text"]);
  assertEquals(Object.keys(outputShape).sort(), ["note", "result"]);
});

Deno.test("cards cannot declare handlers (ts card)", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  await writeTempDeck(
    dir,
    "bad_handlers.card.ts",
    `
    import { defineCard } from "${modHref}";
    export default defineCard({
      handlers: { onBusy: { path: "./noop.deck.ts" } }
    });
    `,
  );

  const deckPath = await writeTempDeck(
    dir,
    "root.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      embeds: ["./bad_handlers.card.ts"],
      modelParams: { model: "dummy-model" }
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: "hi",
        modelProvider: dummyProvider,
        isRoot: true,
      }),
    Error,
    "handlers",
  );
});

Deno.test("cards cannot declare handlers (markdown card)", async () => {
  const dir = await Deno.makeTempDir();

  await Deno.writeTextFile(
    path.join(dir, "bad.card.md"),
    `
+++
handlers = { onBusy = { path = "./noop.deck.ts" } }
+++

Body.
`.trim(),
  );

  const deckPath = path.join(dir, "root.deck.md");
  await Deno.writeTextFile(
    deckPath,
    `
+++
modelParams = { model = "dummy-model" }
embeds = ["./bad.card.md"]
+++

Deck.
`.trim(),
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: "hi",
        modelProvider: dummyProvider,
        isRoot: true,
      }),
    Error,
    "handlers",
  );
});
