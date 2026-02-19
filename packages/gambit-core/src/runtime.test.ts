import { assert, assertEquals, assertRejects } from "@std/assert";
import * as path from "@std/path";
import { loadDeck } from "./loader.ts";
import { loadState } from "./state.ts";
import { isRunCanceledError, runDeck } from "./runtime.ts";
import type {
  JSONValue,
  ModelMessage,
  ModelProvider,
  ResponseItem,
  TraceEvent,
} from "./types.ts";

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

Deno.test("deck loads contextSchema/responseSchema aliases", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "context-alias.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      contextSchema: z.object({ message: z.string() }),
      responseSchema: z.string(),
      label: "context_alias",
      run(ctx: { input: { message: string } }) {
        return ctx.input.message;
      }
    });
    `,
  );

  const deck = await loadDeck(deckPath);
  assert(deck.contextSchema, "expected contextSchema to be set");
  assert(deck.responseSchema, "expected responseSchema to be set");
  assert(deck.inputSchema, "expected legacy inputSchema alias to be set");
  assert(deck.outputSchema, "expected legacy outputSchema alias to be set");
});

Deno.test("compute deck supports canonical schema module imports", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "canonical-schema-import.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import contextSchema from "@bolt-foundry/gambit-core/schemas/scenarios/plain_chat_input_optional.zod.ts";
    import responseSchema from "@bolt-foundry/gambit-core/schemas/scenarios/plain_chat_output.zod.ts";
    export default defineDeck({
      contextSchema,
      responseSchema,
      run: () => "ok",
    });
    `,
  );

  const result = await runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: dummyProvider,
    isRoot: true,
  });

  assertEquals(result, "ok");
});

Deno.test("workspace import map cannot remap trusted schema namespaces", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    path.join(dir, "deno.json"),
    JSON.stringify({
      imports: {
        "@bolt-foundry/gambit-core/schemas/": "./shadow/",
      },
    }),
  );
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "trusted-schema-remap.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      run: () => "ok",
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
      }),
    Error,
    "trust-boundary violation",
  );
});

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

  const traces: Array<TraceEvent> = [];
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

  const traces: Array<TraceEvent> = [];
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
      respond: true,
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

Deno.test("root deck with object inputSchema accepts --message without --context", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "object-input.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({ query: z.string().optional() }),
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

  const result = await runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "pipeline recap",
    modelProvider: provider,
    isRoot: true,
  });

  assertEquals(result, "ok");
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
      respond: true,
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

  const traces: Array<import("./types.ts").TraceEvent> = [];
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
  const stream: Array<string> = [];
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

  const stream: Array<string> = [];
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

Deno.test("child deck timeout override tightens inherited deadline", async () => {
  const origNow = performance.now;
  let now = 0;
  (performance as { now: () => number }).now = () => now;

  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "child-timeout.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.any(),
      outputSchema: z.string(),
      guardrails: { timeoutMs: 5 },
      run() {
        (globalThis).__advanceNow?.(20);
        return "late";
      }
    });
    `,
  );

  try {
    (globalThis as { __advanceNow?: (delta: number) => void }).__advanceNow = (
      delta,
    ) => {
      now += delta;
    };
    await assertRejects(
      () =>
        runDeck({
          path: deckPath,
          input: {},
          modelProvider: dummyProvider,
          isRoot: true,
          guardrails: { timeoutMs: 1_000 },
          runDeadlineMs: 1_000,
        }),
      Error,
      "Timeout exceeded",
    );
  } finally {
    delete (globalThis as { __advanceNow?: (delta: number) => void })
      .__advanceNow;
    (performance as { now: () => number }).now = origNow;
  }
});

Deno.test("worker sandbox flag defaults false when env access is denied", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "env-perm.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      run(ctx) { return ctx.input; }
    });
    `,
  );

  const origGet = Deno.env.get;
  try {
    Deno.env.get = (() => {
      throw new Deno.errors.PermissionDenied("env access denied");
    }) as typeof Deno.env.get;
    const result = await runDeck({
      path: deckPath,
      input: "ok",
      modelProvider: dummyProvider,
      isRoot: true,
    });
    assertEquals(result, "ok");
  } finally {
    Deno.env.get = origGet;
  }
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

  const chunks: Array<string> = [];
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

  let lastMessages: Array<ModelMessage> = [];
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

  let lastMessages: Array<ModelMessage> = [];
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
    m.role === "tool" && m.name === "gambit_context"
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

Deno.test("responses mode stores response items and calls responses()", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "responses_state.deck.ts",
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

  let lastItems: Array<ResponseItem> = [];
  let updatedState: import("./state.ts").SavedState | undefined;
  const provider: ModelProvider = {
    responses({ request }) {
      lastItems = request.input;
      return Promise.resolve({
        id: "resp_1",
        object: "response",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "ok" }],
        }],
      });
    },
    chat() {
      throw new Error("chat should not be called in responses mode");
    },
  };

  await runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "hello",
    modelProvider: provider,
    isRoot: true,
    responsesMode: true,
    onStateUpdate: (state) => {
      updatedState = state;
    },
  });

  const hasUser = lastItems.some((item) =>
    item.type === "message" && item.role === "user"
  );
  assertEquals(hasUser, true);
  assertEquals(updatedState?.format, "responses");
  assert((updatedState?.items?.length ?? 0) > 0);
  assert((updatedState?.messages?.length ?? 0) > 0);
});

Deno.test("responses mode projects tool stream events into tool traces", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "responses_tool_stream_events.deck.ts",
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

  const traces: Array<TraceEvent> = [];
  const provider: ModelProvider = {
    responses({ onStreamEvent }) {
      onStreamEvent?.({
        type: "response.created",
        response: {
          id: "resp_stream",
          object: "response",
          status: "in_progress",
          output: [],
        },
      });
      onStreamEvent?.(
        {
          type: "tool.call",
          actionCallId: "tool_1",
          name: "external_lookup",
          args: { query: "hello" },
        } as unknown as import("./types.ts").ResponseEvent,
      );
      onStreamEvent?.(
        {
          type: "tool.result",
          actionCallId: "tool_1",
          name: "external_lookup",
          result: { ok: true },
        } as unknown as import("./types.ts").ResponseEvent,
      );
      return Promise.resolve({
        id: "resp_1",
        object: "response",
        output: [{
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "done" }],
        }],
      });
    },
    chat() {
      throw new Error("chat should not be called in responses mode");
    },
  };

  const result = await runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "hello",
    modelProvider: provider,
    isRoot: true,
    responsesMode: true,
    stream: true,
    trace: (event) => traces.push(event),
  });

  assertEquals(result, "done");
  const modelCall = traces.find((event) => event.type === "model.call") as
    | Extract<TraceEvent, { type: "model.call" }>
    | undefined;
  const responseCreated = traces.find((event) =>
    event.type === "response.created"
  ) as
    | (TraceEvent & {
      type: "response.created";
      _gambit?: {
        run_id?: string;
        action_call_id?: string;
        deck_path?: string;
        model?: string;
      };
    })
    | undefined;
  const toolCalls = traces.filter((event) =>
    event.type === "tool.call" && event.name === "external_lookup"
  ) as Array<Extract<TraceEvent, { type: "tool.call" }>>;
  const toolResults = traces.filter((event) =>
    event.type === "tool.result" && event.name === "external_lookup"
  ) as Array<Extract<TraceEvent, { type: "tool.result" }>>;

  assert(modelCall);
  assert(responseCreated);
  assertEquals(responseCreated._gambit?.run_id, modelCall.runId);
  assertEquals(responseCreated._gambit?.action_call_id, modelCall.actionCallId);
  assertEquals(responseCreated._gambit?.deck_path, deckPath);
  assertEquals(responseCreated._gambit?.model, "dummy-model");
  assertEquals(toolCalls.length, 1);
  assertEquals(toolResults.length, 1);
  assertEquals(toolCalls[0].actionCallId, "tool_1");
  assertEquals(toolResults[0].actionCallId, "tool_1");
  assertEquals(toolCalls[0].args, { query: "hello" });
  assertEquals(toolCalls[0].parentActionCallId, modelCall.actionCallId);
  assertEquals(toolResults[0].parentActionCallId, modelCall.actionCallId);
  assertEquals(toolResults[0].result, { ok: true });
});

Deno.test("responses mode treats empty output as empty string", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "responses-empty.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      responseSchema: z.string(),
      modelParams: { model: "dummy-model" },
      guardrails: { maxPasses: 1 },
    });
    `,
  );

  let callCount = 0;
  const provider: ModelProvider = {
    responses() {
      callCount += 1;
      return Promise.resolve({
        id: "resp_empty",
        object: "response",
        output: [],
      });
    },
    chat() {
      throw new Error("chat should not be called in responses mode");
    },
  };

  const result = await runDeck({
    path: deckPath,
    input: undefined,
    inputProvided: false,
    initialUserMessage: "hi",
    modelProvider: provider,
    isRoot: true,
    responsesMode: true,
  });

  assertEquals(callCount, 1);
  assertEquals(result, "");
});

Deno.test("loadState derives messages when only response items are stored", async () => {
  const dir = await Deno.makeTempDir();
  const statePath = path.join(dir, "responses-only.json");

  const state = {
    runId: "run_1",
    format: "responses",
    items: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "hello" }],
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "gambit_context",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: '{"topic":"saved"}',
      },
    ],
  };

  await Deno.writeTextFile(statePath, JSON.stringify(state));
  const loaded = loadState(statePath);

  assert(loaded);
  assertEquals(loaded.format, "responses");
  assertEquals(loaded.items?.length, 3);
  assertEquals(loaded.messages?.length, 3);
  assertEquals(loaded.messages?.[0]?.role, "assistant");
  assertEquals(loaded.messages?.[0]?.content, "hello");
  assertEquals(loaded.messages?.[2]?.role, "tool");
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

  const traceEvents: Array<TraceEvent> = [];
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

Deno.test("run.start traces input and gambit_context payload", async () => {
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
      permissions: {
        read: ["./docs"],
      },
    });
    `,
  );

  const traces: Array<TraceEvent> = [];
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
  assert(start.permissions, "expected permissions trace on run.start");
  assertEquals(start.permissions.layers.map((layer) => layer.name), [
    "host",
    "declaration",
  ]);
  assertEquals(start.permissions.effective.read, [path.resolve(dir, "docs")]);

  const initCall = traces.find((t) =>
    t.type === "tool.call" && t.name === "gambit_context"
  ) as Extract<TraceEvent, { type: "tool.call" }>;
  assertEquals(initCall.args, {});

  const initResult = traces.find((t) =>
    t.type === "tool.result" && t.name === "gambit_context"
  ) as Extract<TraceEvent, { type: "tool.result" }>;
  const payload = initResult.result as unknown;
  assertEquals(payload, input);
});

Deno.test("gambit_context does not run when input is not provided", async () => {
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
        m.tool_calls?.some((t) => t.function.name === "gambit_context")
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

  const traces: Array<TraceEvent> = [];
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

Deno.test("model.result trace includes model usage fields", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "usage-trace.deck.md",
    `
+++
modelParams = { model = "dummy-model" }
+++

Deck.
`.trim(),
  );

  const traces: Array<TraceEvent> = [];
  const provider: ModelProvider = {
    chat() {
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
        usage: {
          promptTokens: 11,
          completionTokens: 7,
          totalTokens: 18,
          reasoningTokens: 4,
        },
      });
    },
  };

  await runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: provider,
    isRoot: true,
    trace: (ev) => traces.push(ev),
  });

  const modelResult = traces.find((event): event is Extract<
    TraceEvent,
    { type: "model.result" }
  > => event.type === "model.result");
  assert(modelResult, "expected model.result trace");
  assertEquals(modelResult.usage?.promptTokens, 11);
  assertEquals(modelResult.usage?.completionTokens, 7);
  assertEquals(modelResult.usage?.totalTokens, 18);
  assertEquals(modelResult.usage?.reasoningTokens, 4);
});

Deno.test("non-root assistant text emits monolog trace", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const childPath = await writeTempDeck(
    dir,
    "monolog-child.deck.ts",
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
    "monolog-parent.deck.ts",
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

  let callCount = 0;
  const provider: ModelProvider = {
    chat() {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls" as const,
          toolCalls: [{ id: "call-child", name: "child", args: {} }],
        });
      }
      if (callCount === 2) {
        return Promise.resolve({
          message: { role: "assistant", content: "child-internal" },
          finishReason: "stop" as const,
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "parent-done" },
        finishReason: "stop" as const,
      });
    },
  };

  const traces: Array<TraceEvent> = [];
  const result = await runDeck({
    path: parentPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
    trace: (ev) => traces.push(ev),
    inputProvided: true,
  });

  assertEquals(result, "parent-done");

  const monolog = traces.find((
    t,
  ): t is Extract<TraceEvent, { type: "monolog" }> => t.type === "monolog");
  assert(monolog, "expected monolog trace");
  assertEquals(monolog.deckPath, childPath);
  assertEquals(monolog.parentActionCallId, "call-child");
  assertEquals(monolog.content, "child-internal");
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
    "must declare contextSchema and responseSchema",
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
actionDecks = [{ name = "nested_action", path = "./child.deck.ts" }]
+++

Nested card body.
`.trim(),
  );

  await Deno.writeTextFile(
    path.join(dir, "root.card.md"),
    `
+++
actionDecks = [{ name = "card_action", path = "./child.deck.ts" }]
+++

Root card body.

![Nested card](./nested.card.md)
`.trim(),
  );

  const deckPath = path.join(dir, "root.deck.md");
  await Deno.writeTextFile(
    deckPath,
    `
+++
actionDecks = [{ name = "deck_action", path = "./child.deck.ts" }]
+++

Deck body.

![Root card](./root.card.md)
`.trim(),
  );

  const deck = await loadDeck(deckPath);
  const actionNames = deck.actionDecks.map((a) => a.name).sort();

  assertEquals(actionNames, ["card_action", "deck_action", "nested_action"]);
  assertEquals(deck.cards.length, 2);
});

Deno.test("markdown action execute target runs compute module and returns envelope", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const inputSchemaPath = path.join(dir, "action_input.zod.ts");
  const outputSchemaPath = path.join(dir, "action_output.zod.ts");
  await Deno.writeTextFile(
    inputSchemaPath,
    `
    import { z } from "zod";
    export default z.object({ count: z.number() });
    `,
  );
  await Deno.writeTextFile(
    outputSchemaPath,
    `
    import { z } from "zod";
    export default z.object({ total: z.number() });
    `,
  );
  await Deno.writeTextFile(
    path.join(dir, "compute_rollup.deck.ts"),
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      contextSchema: z.object({ count: z.number() }),
      responseSchema: z.object({
        status: z.number().optional(),
        message: z.string().optional(),
        payload: z.object({ total: z.number() }),
      }),
      run(ctx) {
        return {
          status: 201,
          message: "computed",
          payload: { total: ctx.input.count + 1 },
        };
      },
    });
    `,
  );

  const rootPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"
[modelParams]
model = "dummy-model"

[[actions]]
name = "compute_rollup"
execute = "./compute_rollup.deck.ts"
description = "Compute totals."
contextSchema = "./action_input.zod.ts"
responseSchema = "./action_output.zod.ts"
+++

Root deck.
`,
  );

  let pass = 0;
  let seenToolParams: Record<string, unknown> | undefined;
  let seenToolContent = "";
  const provider: ModelProvider = {
    chat({ tools, messages }) {
      if (pass === 0) {
        pass += 1;
        const toolDef = tools?.find((entry) =>
          entry.function.name === "compute_rollup"
        );
        seenToolParams = toolDef?.function.parameters;
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{
            id: "call-1",
            name: "compute_rollup",
            args: { count: 2 },
          }],
        });
      }
      if (pass === 1) {
        pass += 1;
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i];
          if (message.role === "tool" && message.tool_call_id === "call-1") {
            seenToolContent = String(message.content ?? "");
            break;
          }
        }
        return Promise.resolve({
          message: { role: "assistant", content: "done" },
          finishReason: "stop",
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: rootPath,
    input: {},
    modelProvider: provider,
    isRoot: true,
    inputProvided: true,
  });

  assertEquals(result, "done");
  const params = seenToolParams as {
    required?: Array<string>;
    properties?: Record<string, { type?: string }>;
  };
  assertEquals(params.required, ["count"]);
  assertEquals(params.properties?.count?.type, "number");
  const toolEnvelope = JSON.parse(seenToolContent) as {
    status?: number;
    message?: string;
    payload?: { total?: number };
  };
  assertEquals(toolEnvelope.status, 201);
  assertEquals(toolEnvelope.message, "computed");
  assertEquals(toolEnvelope.payload?.total, 3);
});

Deno.test("markdown action execute target rejects invalid args with action schema", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  await Deno.writeTextFile(
    path.join(dir, "action_input.zod.ts"),
    `
    import { z } from "zod";
    export default z.object({ count: z.number() });
    `,
  );
  await Deno.writeTextFile(
    path.join(dir, "action_output.zod.ts"),
    `
    import { z } from "zod";
    export default z.object({ total: z.number() });
    `,
  );
  await Deno.writeTextFile(
    path.join(dir, "compute_rollup.deck.ts"),
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      contextSchema: z.object({ count: z.number() }),
      responseSchema: z.object({ total: z.number() }),
      run(ctx) {
        return { total: ctx.input.count + 1 };
      },
    });
    `,
  );
  const rootPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"
[modelParams]
model = "dummy-model"

[[actions]]
name = "compute_rollup"
execute = "./compute_rollup.deck.ts"
description = "Compute totals."
contextSchema = "./action_input.zod.ts"
responseSchema = "./action_output.zod.ts"
+++
Root deck.
`,
  );

  let pass = 0;
  let seenToolContent = "";
  const provider: ModelProvider = {
    chat({ messages }) {
      if (pass === 0) {
        pass += 1;
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{
            id: "call-1",
            name: "compute_rollup",
            args: { count: "bad" },
          }],
        });
      }
      if (pass === 1) {
        pass += 1;
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i];
          if (message.role === "tool" && message.tool_call_id === "call-1") {
            seenToolContent = String(message.content ?? "");
            break;
          }
        }
        return Promise.resolve({
          message: { role: "assistant", content: "done" },
          finishReason: "stop",
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: rootPath,
    input: {},
    modelProvider: provider,
    isRoot: true,
    inputProvided: true,
  });

  assertEquals(result, "done");
  const toolEnvelope = JSON.parse(seenToolContent) as {
    status?: number;
    code?: string;
  };
  assertEquals(toolEnvelope.status, 400);
  assertEquals(toolEnvelope.code, "invalid_input");
});

Deno.test("markdown external tools dispatch through onTool", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    path.join(dir, "tool_input.zod.ts"),
    `
    import { z } from "zod";
    export default z.object({ query: z.string() });
    `,
  );
  const rootPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"
[modelParams]
model = "dummy-model"

[[tools]]
name = "external_lookup"
description = "External lookup."
inputSchema = "./tool_input.zod.ts"
+++
Root deck.
`,
  );

  let pass = 0;
  let seenToolContent = "";
  let seenTools: Array<string> = [];
  let seenOnToolInput:
    | {
      name: string;
      args: Record<string, unknown>;
      runId: string;
      actionCallId: string;
      parentActionCallId?: string;
      deckPath: string;
    }
    | undefined;
  const provider: ModelProvider = {
    chat({ messages, tools }) {
      if (pass === 0) {
        pass += 1;
        seenTools = (tools ?? []).map((entry) => entry.function.name);
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{
            id: "call-1",
            name: "external_lookup",
            args: { query: "hello" },
          }],
        });
      }
      if (pass === 1) {
        pass += 1;
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i];
          if (message.role === "tool" && message.tool_call_id === "call-1") {
            seenToolContent = String(message.content ?? "");
            break;
          }
        }
        return Promise.resolve({
          message: { role: "assistant", content: "done" },
          finishReason: "stop",
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: rootPath,
    input: {},
    modelProvider: provider,
    isRoot: true,
    inputProvided: true,
    onTool: (input) => {
      seenOnToolInput = input;
      return {
        status: 207,
        message: "handled",
        payload: { echo: String(input.args.query ?? "") },
        meta: { source: "hook" },
      };
    },
  });

  assertEquals(result, "done");
  assert(
    seenTools.includes("external_lookup"),
    "expected external tool in defs",
  );
  assertEquals(seenOnToolInput?.name, "external_lookup");
  assertEquals(seenOnToolInput?.args, { query: "hello" });
  assertEquals(seenOnToolInput?.actionCallId, "call-1");
  assertEquals(seenOnToolInput?.deckPath, rootPath);
  assert(
    typeof seenOnToolInput?.runId === "string" &&
      seenOnToolInput.runId.length > 0,
    "expected onTool runId",
  );
  const parsed = JSON.parse(seenToolContent) as {
    status?: number;
    message?: string;
    payload?: { echo?: string };
    meta?: { source?: string };
  };
  assertEquals(parsed.status, 207);
  assertEquals(parsed.message, "handled");
  assertEquals(parsed.payload?.echo, "hello");
  assertEquals(parsed.meta?.source, "hook");
});

Deno.test("markdown external tools return explicit error when onTool is missing", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    path.join(dir, "tool_input.zod.ts"),
    `
    import { z } from "zod";
    export default z.object({ query: z.string() });
    `,
  );
  const rootPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"
[modelParams]
model = "dummy-model"

[[tools]]
name = "external_lookup"
description = "External lookup."
inputSchema = "./tool_input.zod.ts"
+++
Root deck.
`,
  );

  let pass = 0;
  let seenToolContent = "";
  const provider: ModelProvider = {
    chat({ messages }) {
      if (pass === 0) {
        pass += 1;
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{
            id: "call-1",
            name: "external_lookup",
            args: { query: "hello" },
          }],
        });
      }
      if (pass === 1) {
        pass += 1;
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i];
          if (message.role === "tool" && message.tool_call_id === "call-1") {
            seenToolContent = String(message.content ?? "");
            break;
          }
        }
        return Promise.resolve({
          message: { role: "assistant", content: "done" },
          finishReason: "stop",
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: rootPath,
    input: {},
    modelProvider: provider,
    isRoot: true,
    inputProvided: true,
  });

  assertEquals(result, "done");
  const parsed = JSON.parse(seenToolContent) as {
    status?: number;
    code?: string;
  };
  assertEquals(parsed.status, 500);
  assertEquals(parsed.code, "missing_on_tool");
});

Deno.test("markdown external tools return explicit error when onTool throws", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    path.join(dir, "tool_input.zod.ts"),
    `
    import { z } from "zod";
    export default z.object({ query: z.string() });
    `,
  );
  const rootPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"
[modelParams]
model = "dummy-model"

[[tools]]
name = "external_lookup"
description = "External lookup."
inputSchema = "./tool_input.zod.ts"
+++
Root deck.
`,
  );

  let pass = 0;
  let seenToolContent = "";
  const provider: ModelProvider = {
    chat({ messages }) {
      if (pass === 0) {
        pass += 1;
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{
            id: "call-1",
            name: "external_lookup",
            args: { query: "hello" },
          }],
        });
      }
      if (pass === 1) {
        pass += 1;
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i];
          if (message.role === "tool" && message.tool_call_id === "call-1") {
            seenToolContent = String(message.content ?? "");
            break;
          }
        }
        return Promise.resolve({
          message: { role: "assistant", content: "done" },
          finishReason: "stop",
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: rootPath,
    input: {},
    modelProvider: provider,
    isRoot: true,
    inputProvided: true,
    onTool: () => {
      throw new Error("boom");
    },
  });

  assertEquals(result, "done");
  const parsed = JSON.parse(seenToolContent) as {
    status?: number;
    code?: string;
    message?: string;
  };
  assertEquals(parsed.status, 500);
  assertEquals(parsed.code, "tool_handler_error");
  assertEquals(parsed.message, "boom");
});

Deno.test("actions shadow external tools during runtime dispatch", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  await Deno.writeTextFile(
    path.join(dir, "action_input.zod.ts"),
    `
    import { z } from "zod";
    export default z.object({ query: z.string() });
    `,
  );
  await Deno.writeTextFile(
    path.join(dir, "action_output.zod.ts"),
    `
    import { z } from "zod";
    export default z.object({ value: z.string() });
    `,
  );
  await Deno.writeTextFile(
    path.join(dir, "lookup.deck.ts"),
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      contextSchema: z.object({ query: z.string() }),
      responseSchema: z.object({ value: z.string() }),
      run: () => ({ value: "action" }),
    });
    `,
  );
  const rootPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `+++
label = "root"
[modelParams]
model = "dummy-model"

[[actions]]
name = "lookup"
execute = "./lookup.deck.ts"
description = "Action lookup."
contextSchema = "./action_input.zod.ts"
responseSchema = "./action_output.zod.ts"

[[tools]]
name = "lookup"
description = "External lookup."
inputSchema = "./action_input.zod.ts"
+++
Root deck.
`,
  );

  let pass = 0;
  let seenToolContent = "";
  let onToolCalled = false;
  const provider: ModelProvider = {
    chat({ messages }) {
      if (pass === 0) {
        pass += 1;
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{ id: "call-1", name: "lookup", args: { query: "x" } }],
        });
      }
      if (pass === 1) {
        pass += 1;
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i];
          if (message.role === "tool" && message.tool_call_id === "call-1") {
            seenToolContent = String(message.content ?? "");
            break;
          }
        }
        return Promise.resolve({
          message: { role: "assistant", content: "done" },
          finishReason: "stop",
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: rootPath,
    input: {},
    modelProvider: provider,
    isRoot: true,
    inputProvided: true,
    onTool: () => {
      onToolCalled = true;
      return { value: "external" };
    },
  });

  assertEquals(result, "done");
  assertEquals(onToolCalled, false);
  const parsed = JSON.parse(seenToolContent) as {
    payload?: { value?: string };
  };
  assertEquals(parsed.payload?.value, "action");
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

  const seen: Array<Array<ModelMessage>> = [];
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
+++

A card body.

![B card](./b.card.md)
`.trim(),
  );

  await Deno.writeTextFile(
    path.join(dir, "b.card.md"),
    `
+++
+++

B card body.

![A card](./a.card.md)
`.trim(),
  );

  const deckPath = path.join(dir, "root.deck.md");
  await Deno.writeTextFile(
    deckPath,
    `
+++
modelParams = { model = "dummy-model" }
+++

Deck with cyclic cards.

![A card](./a.card.md)
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
+++

Deck body.

![Fragments card](./fragments.card.md)
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
    "root.deck.md",
    `
+++
modelParams = { model = "dummy-model" }
+++

Deck.

![Bad handlers](./bad_handlers.card.ts)
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
+++

Deck.

![Bad card](./bad.card.md)
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

Deno.test("runDeck resolves model arrays via modelProvider", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "root.deck.md",
    `
+++
modelParams = { model = ["ollama/llama3.1", "openrouter/openai/gpt-4o-mini"] }
+++

Deck.
`.trim(),
  );
  let resolvedInput: { model?: string | Array<string> } = {};
  const provider: ModelProvider = {
    resolveModel: (input) => {
      resolvedInput = { model: input.model };
      return Promise.resolve({
        model: "openrouter/openai/gpt-4o-mini",
        params: { temp: 1 },
      });
    },
    chat: (input) => {
      assertEquals(input.model, "openrouter/openai/gpt-4o-mini");
      assertEquals(input.params?.temp, 1);
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

  assert(Array.isArray(resolvedInput.model));
});

Deno.test("modelParams.reasoning passes through to provider params", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "root.deck.md",
    `
+++
modelParams = { model = "dummy-model", temperature = 0.2, reasoning = { effort = "high", summary = "detailed" } }
+++

Deck.
`.trim(),
  );

  let seenParams: Record<string, unknown> | undefined;
  const provider: ModelProvider = {
    chat: (input) => {
      seenParams = input.params;
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

  assertEquals(seenParams?.temperature, 0.2);
  assertEquals(seenParams?.reasoning, {
    effort: "high",
    summary: "detailed",
  });
});

Deno.test("modelParams.verbosity passes through to provider params", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "root.deck.md",
    `
+++
modelParams = { model = "dummy-model", verbosity = "high" }
+++

Deck.
`.trim(),
  );

  let seenParams: Record<string, unknown> | undefined;
  const provider: ModelProvider = {
    chat: (input) => {
      seenParams = input.params;
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

  assertEquals(seenParams?.verbosity, "high");
});

Deno.test("worker sandbox denies write when write permission is absent", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const targetPath = path.join(dir, "denied-write.txt");
  const deckPath = await writeTempDeck(
    dir,
    "write-denied.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      run: async () => {
        await Deno.writeTextFile(${JSON.stringify(targetPath)}, "nope");
        return "ok";
      }
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        workspacePermissions: { read: true, write: false, run: false },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "write",
  );
});

Deno.test("worker sandbox denies run when run permission is absent", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "run-denied.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      run: async () => {
        const cmd = new Deno.Command("sh", { args: ["-c", "echo hi"] });
        await cmd.output();
        return "ok";
      }
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        workspacePermissions: { read: true, write: false, run: false },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "run",
  );
});

Deno.test("worker sandbox denies writes outside allowed roots", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const allowedDir = path.join(dir, "allowed");
  const blockedPath = path.join(dir, "blocked.txt");
  await Deno.mkdir(allowedDir, { recursive: true });
  const deckPath = await writeTempDeck(
    dir,
    "write-outside.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      run: async () => {
        await Deno.writeTextFile(${JSON.stringify(blockedPath)}, "nope");
        return "ok";
      }
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        workspacePermissions: {
          read: true,
          write: [allowedDir],
          run: false,
        },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "write",
  );
});

Deno.test("worker sandbox restrictive profile still boots compute deck", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "restrictive-start.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      run: () => "ok"
    });
    `,
  );

  const result = await runDeck({
    path: deckPath,
    input: {},
    modelProvider: dummyProvider,
    isRoot: true,
    workerSandbox: true,
    workspacePermissions: {
      read: false,
      write: false,
      run: false,
      net: false,
      env: false,
    },
    workspacePermissionsBaseDir: dir,
  });
  assertEquals(result, "ok");
});

Deno.test("worker sandbox bootstrap does not grant package-root reads", async () => {
  const dir = await Deno.makeTempDir();
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const defineDeckHref = path.toFileUrl(path.resolve(here, "definitions.ts"))
    .href;
  const packageCardPath = path.resolve(
    here,
    "..",
    "cards",
    "generate-test-input.card.md",
  );
  const deckPath = await writeTempDeck(
    dir,
    "bootstrap-read-bypass.deck.ts",
    `
    import { defineDeck } from "${defineDeckHref}";
    export default defineDeck({
      run: async () => {
        await Deno.readTextFile(${JSON.stringify(packageCardPath)});
        return "ok";
      }
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        workspacePermissions: {
          read: false,
          write: false,
          run: false,
          net: false,
          env: false,
        },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "read",
  );
});

Deno.test("worker sandbox bootstrap ignores fake imports in comments", async () => {
  const dir = await Deno.makeTempDir();
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const defineDeckHref = path.toFileUrl(path.resolve(here, "definitions.ts"))
    .href;
  const secretPath = path.join(dir, "secret.txt");
  await Deno.writeTextFile(secretPath, "top-secret");
  const deckPath = await writeTempDeck(
    dir,
    "comment-import-escalation.deck.ts",
    `
    import { defineDeck } from "${defineDeckHref}";
    // import "${secretPath}"
    export default defineDeck({
      run: async () => {
        await Deno.readTextFile(${JSON.stringify(secretPath)});
        return "ok";
      }
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        workspacePermissions: {
          read: false,
          write: false,
          run: false,
          net: false,
          env: false,
        },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "read",
  );
});

Deno.test("worker sandbox bootstrap does not widen reads via imported modules", async () => {
  const dir = await Deno.makeTempDir();
  const decksDir = path.join(dir, "decks");
  const secretsDir = path.join(dir, "secrets");
  await Deno.mkdir(decksDir, { recursive: true });
  await Deno.mkdir(secretsDir, { recursive: true });
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const defineDeckHref = path.toFileUrl(path.resolve(here, "definitions.ts"))
    .href;
  const secretModulePath = path.join(secretsDir, "secret-module.ts");
  await Deno.writeTextFile(secretModulePath, 'export const secret = "nope";\n');
  const deckPath = await writeTempDeck(
    decksDir,
    "import-read-escalation.deck.ts",
    `
    import { defineDeck } from "${defineDeckHref}";
    import "../secrets/secret-module.ts";
    export default defineDeck({
      run: async () => {
        await Deno.readTextFile(${JSON.stringify(secretModulePath)});
        return "ok";
      }
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        workspacePermissions: {
          read: false,
          write: false,
          run: false,
          net: false,
          env: false,
        },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "read",
  );
});

Deno.test("worker sandbox inspect does not execute out-of-root imports", async () => {
  const dir = await Deno.makeTempDir();
  const decksDir = path.join(dir, "decks");
  const secretsDir = path.join(dir, "secrets");
  await Deno.mkdir(decksDir, { recursive: true });
  await Deno.mkdir(secretsDir, { recursive: true });
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const defineDeckHref = path.toFileUrl(path.resolve(here, "definitions.ts"))
    .href;
  const secretModulePath = path.join(secretsDir, "secret-module.ts");
  await Deno.writeTextFile(
    secretModulePath,
    'throw new Error("inspect-secret-module-loaded");\n',
  );
  const deckPath = await writeTempDeck(
    decksDir,
    "inspect-import-escalation.deck.ts",
    `
    import { defineDeck } from "${defineDeckHref}";
    import "../secrets/secret-module.ts";
    export default defineDeck({
      run: () => "ok",
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        workspacePermissions: {
          read: false,
          write: false,
          run: false,
          net: false,
          env: false,
        },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "read access",
  );
});

Deno.test("worker sandbox inspect enforces hard timeout", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "inspect-timeout.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    await new Promise(() => {});
    export default defineDeck({
      run: () => "ok",
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        workspacePermissions: {
          read: true,
          write: false,
          run: false,
          net: false,
          env: false,
        },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "Deck inspection timed out",
  );
});

Deno.test("worker sandbox blocks remote imports when net is false", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "remote-import-denied.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import "https://example.com/gambit-runtime-net-blocked.ts";
    export default defineDeck({
      run: () => "ok",
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        workspacePermissions: {
          read: true,
          write: false,
          run: false,
          net: false,
          env: false,
        },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "import access",
  );
});

Deno.test("worker sandbox restrictive profile loads local deck imports", async () => {
  const dir = await Deno.makeTempDir();
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const defineDeckHref = path.toFileUrl(path.resolve(here, "definitions.ts"))
    .href;

  await writeTempDeck(
    dir,
    "helper.ts",
    `
    export const helperValue = "ok-from-helper";
    `,
  );
  const deckPath = await writeTempDeck(
    dir,
    "restrictive-import.deck.ts",
    `
    import { defineDeck } from "${defineDeckHref}";
    import { helperValue } from "./helper.ts";
    export default defineDeck({
      run: () => helperValue,
    });
    `,
  );

  const result = await runDeck({
    path: deckPath,
    input: {},
    modelProvider: dummyProvider,
    isRoot: true,
    workerSandbox: true,
    workspacePermissions: {
      read: false,
      write: false,
      run: false,
      net: false,
      env: false,
    },
    workspacePermissionsBaseDir: dir,
  });
  assertEquals(result, "ok-from-helper");
});

Deno.test("worker sandbox restrictive profile loads markdown decks with builtin snippet embeds", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  await writeTempDeck(
    dir,
    "snippet-embed.card.md",
    `![respond](gambit://snippets/respond.md)
`,
  );
  const deckPath = await writeTempDeck(
    dir,
    "builtin-snippet.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      cards: ["./snippet-embed.card.md"],
      contextSchema: z.object({}),
      responseSchema: z.string(),
      run: () => "ok",
    });
    `,
  );

  const result = await runDeck({
    path: deckPath,
    input: {},
    modelProvider: dummyProvider,
    isRoot: true,
    workerSandbox: true,
    workspacePermissions: {
      read: false,
      write: false,
      run: false,
      net: false,
      env: false,
    },
    workspacePermissionsBaseDir: dir,
  });

  assertEquals(result, "ok");
});

Deno.test("worker sandbox restrictive profile loads markdown decks with local embeds", async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeTempDeck(
    dir,
    "PROMPT.md",
    `
+++
[modelParams]
model = "dummy-model"
+++

Ground answers using this FAQ:
![](./faq.md)
`.trim(),
  );
  await writeTempDeck(
    dir,
    "faq.md",
    `
# FAQ

- Q: Reset password?
- A: Use the reset flow.
`.trim(),
  );

  const result = await runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: {
      chat: () =>
        Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        }),
    },
    isRoot: true,
    workerSandbox: true,
  });

  assertEquals(result, "ok");
});

Deno.test("worker sandbox blocks top-level deck side effects", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const sideEffectPath = path.join(dir, "top-level-side-effect.txt");
  const deckPath = await writeTempDeck(
    dir,
    "top-level-side-effect.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    await Deno.writeTextFile(${JSON.stringify(sideEffectPath)}, "leak");
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      run: () => "ok",
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        workspacePermissions: {
          read: true,
          write: false,
          run: false,
          net: false,
          env: false,
        },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "write",
  );

  const leaked = await Deno.stat(sideEffectPath).then(
    () => true,
    () => false,
  );
  assertEquals(leaked, false);
});

Deno.test(
  "worker sandbox blocks top-level model deck side effects during host orchestration",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const sideEffectPath = path.join(dir, "llm-top-level-side-effect.txt");
    const deckPath = await writeTempDeck(
      dir,
      "llm-top-level-side-effect.deck.ts",
      `
      import { defineDeck } from "${modHref}";
      import { z } from "zod";
      try {
        await Deno.writeTextFile(${JSON.stringify(sideEffectPath)}, "leak");
      } catch {
        // no-op: sandboxed deck import should deny this write
      }
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

    const result = await runDeck({
      path: deckPath,
      input: "hi",
      modelProvider: provider,
      isRoot: true,
      workerSandbox: true,
      workspacePermissions: {
        read: true,
        write: false,
        run: false,
        net: false,
        env: false,
      },
      workspacePermissionsBaseDir: dir,
    });
    assertEquals(result, "ok");

    const leaked = await Deno.stat(sideEffectPath).then(
      () => true,
      () => false,
    );
    assertEquals(leaked, false);
  },
);

Deno.test("worker spawn bridge preserves parent permission ceiling for child", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const childWritePath = path.join(dir, "bridge-child-write.txt");

  const childPath = await writeTempDeck(
    dir,
    "bridge-child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      permissions: { write: true },
      run: async () => {
        await Deno.writeTextFile(${JSON.stringify(childWritePath)}, "nope");
        return "child-ok";
      }
    });
    `,
  );
  const parentPath = await writeTempDeck(
    dir,
    "bridge-parent.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      run: async (ctx) => {
        return await ctx.spawnAndWait({ path: ${
      JSON.stringify(childPath)
    }, input: {} });
      }
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: parentPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        workspacePermissions: { read: true, write: false, run: false },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "write",
  );
});

Deno.test("worker timeout cancels spawned children before side effects", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const sideEffectPath = path.join(dir, "late-side-effect.txt");

  const childPath = await writeTempDeck(
    dir,
    "timeout-child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        await Deno.writeTextFile(${JSON.stringify(sideEffectPath)}, "late");
        return "late";
      }
    });
    `,
  );
  const parentPath = await writeTempDeck(
    dir,
    "timeout-parent.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      run: async (ctx) => {
        return await ctx.spawnAndWait({ path: ${
      JSON.stringify(childPath)
    }, input: {} });
      }
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: parentPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        guardrails: { timeoutMs: 80 },
        workspacePermissions: { read: true, write: [dir], run: false },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "Timeout exceeded",
  );

  await new Promise((resolve) => setTimeout(resolve, 350));
  let sideEffectExists = true;
  try {
    await Deno.stat(sideEffectPath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      sideEffectExists = false;
    } else {
      throw err;
    }
  }
  assertEquals(sideEffectExists, false);
});

Deno.test(
  "compute spawnAndWait inherits initialUserMessage by default",
  async () => {
    for (const workerSandbox of [false, true]) {
      const dir = await Deno.makeTempDir();
      const modHref = modImportPath();
      const childPath = await writeTempDeck(
        dir,
        `initial-user-child-${workerSandbox ? "worker" : "inproc"}.deck.ts`,
        `
        import { defineDeck } from "${modHref}";
        import { z } from "zod";
        export default defineDeck({
          contextSchema: z.object({}),
          responseSchema: z.string(),
          body: "echo latest user message",
          modelParams: { model: "dummy-model" },
        });
        `,
      );
      const parentPath = await writeTempDeck(
        dir,
        `initial-user-parent-${workerSandbox ? "worker" : "inproc"}.deck.ts`,
        `
        import { defineDeck } from "${modHref}";
        import { z } from "zod";
        export default defineDeck({
          contextSchema: z.object({}),
          responseSchema: z.string(),
          run: async (ctx) => {
            return await ctx.spawnAndWait({ path: ${
          JSON.stringify(childPath)
        }, input: {} });
          }
        });
        `,
      );

      const provider: ModelProvider = {
        chat({ messages }) {
          const userMessages = messages.filter((msg) =>
            msg.role === "user" && typeof msg.content === "string"
          );
          const latest = userMessages.length
            ? userMessages[userMessages.length - 1].content as string
            : "missing-user-message";
          return Promise.resolve({
            message: { role: "assistant", content: latest },
            finishReason: "stop",
          });
        },
      };

      const result = await runDeck({
        path: parentPath,
        input: {},
        modelProvider: provider,
        isRoot: true,
        initialUserMessage: "forward-this-message",
        workerSandbox,
        workspacePermissions: {
          read: true,
          write: false,
          run: false,
          net: false,
          env: false,
        },
        workspacePermissionsBaseDir: dir,
      });

      assertEquals(result, "forward-this-message");
    }
  },
);

Deno.test(
  "execute deck helpers persist session meta and transcript across turns",
  async () => {
    for (const workerSandbox of [false, true]) {
      const dir = await Deno.makeTempDir();
      const modHref = modImportPath();
      const deckPath = await writeTempDeck(
        dir,
        `execute-session-meta-${workerSandbox ? "worker" : "inproc"}.deck.ts`,
        `
        import { defineDeck } from "${modHref}";
        export default defineDeck({
          run: (ctx) => {
            const existing = ctx.getSessionMeta("codex.threadId");
            const threadId = typeof existing === "string" && existing
              ? existing
              : "thread-" + crypto.randomUUID();
            ctx.setSessionMeta("codex.threadId", threadId);
            if (typeof ctx.initialUserMessage === "string" && ctx.initialUserMessage.trim()) {
              ctx.appendMessage({ role: "user", content: ctx.initialUserMessage.trim() });
            }
            const assistant = "thread=" + threadId;
            ctx.appendMessage({ role: "assistant", content: assistant });
            return assistant;
          },
        });
        `,
      );

      let savedState: import("./state.ts").SavedState | undefined;
      const onStateUpdate = (state: import("./state.ts").SavedState) => {
        savedState = state;
      };

      const first = await runDeck({
        path: deckPath,
        input: "",
        modelProvider: dummyProvider,
        isRoot: true,
        initialUserMessage: "first turn",
        state: savedState,
        onStateUpdate,
        workerSandbox,
        workspacePermissions: {
          read: true,
          write: false,
          run: false,
          net: false,
          env: false,
        },
        workspacePermissionsBaseDir: dir,
      });

      const firstThread = String(first).replace(/^thread=/, "");
      assert(firstThread.length > 0);
      assertEquals(savedState?.meta?.["codex.threadId"], firstThread);
      assertEquals(savedState?.messages?.length, 2);
      assertEquals(savedState?.messages?.[0]?.role, "user");
      assertEquals(savedState?.messages?.[1]?.role, "assistant");

      const second = await runDeck({
        path: deckPath,
        input: "",
        modelProvider: dummyProvider,
        isRoot: true,
        initialUserMessage: "second turn",
        state: savedState,
        onStateUpdate,
        workerSandbox,
        workspacePermissions: {
          read: true,
          write: false,
          run: false,
          net: false,
          env: false,
        },
        workspacePermissionsBaseDir: dir,
      });

      const secondThread = String(second).replace(/^thread=/, "");
      assertEquals(secondThread, firstThread);
      assertEquals(savedState?.meta?.["codex.threadId"], firstThread);
      assertEquals(savedState?.messages?.length, 4);
      assertEquals(savedState?.messages?.[2]?.role, "user");
      assertEquals(savedState?.messages?.[3]?.role, "assistant");
    }
  },
);

Deno.test("orchestration worker preserves serial LLM trace ordering and correlation ids", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const childPath = await writeTempDeck(
    dir,
    "serial-child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.string(),
      run: (ctx) => "child:" + ctx.input.value,
    });
    `,
  );
  const parentPath = await writeTempDeck(
    dir,
    "serial-parent.deck.ts",
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

  const makeProvider = (): ModelProvider => {
    let pass = 0;
    return {
      chat() {
        pass += 1;
        if (pass === 1) {
          return Promise.resolve({
            message: { role: "assistant", content: null },
            finishReason: "tool_calls",
            toolCalls: [{
              id: "call-child",
              name: "child",
              args: { value: "x" },
            }],
          });
        }
        return Promise.resolve({
          message: { role: "assistant", content: "done" },
          finishReason: "stop",
        });
      },
    };
  };

  const legacyTraces: Array<TraceEvent> = [];
  const workerTraces: Array<TraceEvent> = [];
  const legacy = await runDeck({
    path: parentPath,
    input: "hi",
    modelProvider: makeProvider(),
    isRoot: true,
    workerSandbox: false,
    trace: (ev) => legacyTraces.push(ev),
  });
  const worker = await runDeck({
    path: parentPath,
    input: "hi",
    modelProvider: makeProvider(),
    isRoot: true,
    workerSandbox: true,
    trace: (ev) => workerTraces.push(ev),
    workspacePermissions: { read: true, write: false, run: false },
    workspacePermissionsBaseDir: dir,
  });

  assertEquals(legacy, "done");
  assertEquals(worker, legacy);

  const workerActionStart = workerTraces.find((event) =>
    event.type === "action.start" && event.name === "child"
  ) as Extract<TraceEvent, { type: "action.start" }> | undefined;
  const workerToolCall = workerTraces.find((event) =>
    event.type === "tool.call" && event.name === "child"
  ) as Extract<TraceEvent, { type: "tool.call" }> | undefined;
  const workerToolResult = workerTraces.find((event) =>
    event.type === "tool.result" && event.name === "child"
  ) as Extract<TraceEvent, { type: "tool.result" }> | undefined;
  const workerActionEnd = workerTraces.find((event) =>
    event.type === "action.end" && event.name === "child"
  ) as Extract<TraceEvent, { type: "action.end" }> | undefined;

  assert(workerActionStart);
  assert(workerToolCall);
  assert(workerToolResult);
  assert(workerActionEnd);
  assertEquals(workerActionStart.actionCallId, "call-child");
  assertEquals(workerToolCall.actionCallId, "call-child");
  assertEquals(workerToolResult.actionCallId, "call-child");
  assertEquals(workerActionEnd.actionCallId, "call-child");

  const startIdx = workerTraces.findIndex((event) =>
    event.type === "action.start" && event.name === "child"
  );
  const callIdx = workerTraces.findIndex((event) =>
    event.type === "tool.call" && event.name === "child"
  );
  const resultIdx = workerTraces.findIndex((event) =>
    event.type === "tool.result" && event.name === "child"
  );
  const endIdx = workerTraces.findIndex((event) =>
    event.type === "action.end" && event.name === "child"
  );
  assert(
    startIdx >= 0 && callIdx > startIdx && resultIdx > callIdx &&
      endIdx > resultIdx,
  );
});

Deno.test("runDeck rejects workerSandbox requests in unsupported hosts", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "unsupported-worker-host.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      run: () => "ok",
    });
    `,
  );

  const originalWorker = globalThis.Worker;
  Object.defineProperty(globalThis, "Worker", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  try {
    const err = await assertRejects(
      () =>
        runDeck({
          path: deckPath,
          input: {},
          modelProvider: dummyProvider,
          isRoot: true,
          workerSandbox: true,
        }),
      Error,
      "workerSandbox is unsupported in this host",
    );
    assertEquals(
      (err as { code?: unknown }).code,
      "worker_sandbox_unsupported_host",
    );
  } finally {
    Object.defineProperty(globalThis, "Worker", {
      value: originalWorker,
      configurable: true,
      writable: true,
    });
  }
});

Deno.test("orchestration worker enforces parent permission ceiling for LLM child actions", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deniedPath = path.join(dir, "llm-child-denied.txt");
  const childPath = await writeTempDeck(
    dir,
    "llm-child-write.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({ path: z.string() }),
      outputSchema: z.string(),
      permissions: { write: true },
      run: async (ctx) => {
        await Deno.writeTextFile(ctx.input.path, "nope");
        return "ok";
      },
    });
    `,
  );
  const parentPath = await writeTempDeck(
    dir,
    "llm-parent-write.deck.ts",
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

  let pass = 0;
  const provider: ModelProvider = {
    chat() {
      pass += 1;
      if (pass === 1) {
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{
            id: "call-write",
            name: "child",
            args: { path: deniedPath },
          }],
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      });
    },
  };

  await assertRejects(
    () =>
      runDeck({
        path: parentPath,
        input: "hi",
        modelProvider: provider,
        isRoot: true,
        workerSandbox: true,
        workspacePermissions: { read: true, write: false, run: false },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "write",
  );
});

Deno.test("orchestration worker enforces action reference narrowing for child compute deck writes", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const writePath = path.join(dir, "child-write-should-be-denied.txt");
  const childPath = await writeTempDeck(
    dir,
    "llm-child-reference-deny.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({ path: z.string() }),
      outputSchema: z.string(),
      run: async (ctx) => {
        await Deno.writeTextFile(ctx.input.path, "should-fail");
        return "ok";
      },
    });
    `,
  );
  const parentPath = await writeTempDeck(
    dir,
    "llm-parent-reference-deny.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
      actions: [{
        name: "child",
        path: "${childPath}",
        permissions: { write: false },
      }],
    });
    `,
  );

  let pass = 0;
  const provider: ModelProvider = {
    chat() {
      pass += 1;
      if (pass === 1) {
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{
            id: "call-ref-deny",
            name: "child",
            args: { path: writePath },
          }],
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      });
    },
  };

  await assertRejects(
    () =>
      runDeck({
        path: parentPath,
        input: "hi",
        modelProvider: provider,
        isRoot: true,
        workerSandbox: true,
        // Root allows writes; action reference must still narrow child writes.
        workspacePermissions: { read: true, write: [dir], run: false },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "write",
  );
});

Deno.test("orchestration worker timeout cancels nested LLM child actions before side effects", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const sideEffectPath = path.join(dir, "llm-late-side-effect.txt");
  const childPath = await writeTempDeck(
    dir,
    "llm-timeout-child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        await Deno.writeTextFile(${JSON.stringify(sideEffectPath)}, "late");
        return "late";
      },
    });
    `,
  );
  const parentPath = await writeTempDeck(
    dir,
    "llm-timeout-parent.deck.ts",
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

  let pass = 0;
  const provider: ModelProvider = {
    chat() {
      pass += 1;
      if (pass === 1) {
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{ id: "call-timeout", name: "child", args: {} }],
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      });
    },
  };

  await assertRejects(
    () =>
      runDeck({
        path: parentPath,
        input: "hi",
        modelProvider: provider,
        isRoot: true,
        workerSandbox: true,
        guardrails: { timeoutMs: 80 },
        workspacePermissions: { read: true, write: [dir], run: false },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "Timeout exceeded",
  );

  await new Promise((resolve) => setTimeout(resolve, 350));
  let sideEffectExists = true;
  try {
    await Deno.stat(sideEffectPath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      sideEffectExists = false;
    } else {
      throw err;
    }
  }
  assertEquals(sideEffectExists, false);
});

Deno.test("orchestration worker clamps forged child deadlines to parent timeout", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const sideEffectPath = path.join(dir, "forged-deadline-side-effect.txt");
  const childPath = await writeTempDeck(
    dir,
    "forged-deadline-child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        await Deno.writeTextFile(${JSON.stringify(sideEffectPath)}, "late");
        return "late";
      },
    });
    `,
  );
  const parentPath = await writeTempDeck(
    dir,
    "forged-deadline-parent.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      run: async () => {
        globalThis.postMessage({
          type: "spawn.request",
          requestId: "forged-request",
          payload: {
            path: ${JSON.stringify(childPath)},
            input: {},
            parentActionCallId: "forged-action",
            parentPermissionsBaseDir: ${JSON.stringify(dir)},
            parentPermissions: {
              baseDir: ${JSON.stringify(dir)},
              read: true,
              write: true,
              run: false,
              net: false,
              env: false,
            },
            workspacePermissions: {
              read: true,
              write: [${JSON.stringify(dir)}],
              run: false,
              net: false,
              env: false,
            },
            workspacePermissionsBaseDir: ${JSON.stringify(dir)},
            runDeadlineMs: performance.now() + 10_000,
          },
        });
        await new Promise(() => {});
      },
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: parentPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        guardrails: { timeoutMs: 80 },
        workspacePermissions: { read: true, write: [dir], run: false },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "Timeout exceeded",
  );

  await new Promise((resolve) => setTimeout(resolve, 260));
  let sideEffectExists = true;
  try {
    await Deno.stat(sideEffectPath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      sideEffectExists = false;
    } else {
      throw err;
    }
  }
  assertEquals(sideEffectExists, false);
});

Deno.test("compute worker rejects forged run.result messages", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "forged-run-result.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      run: async () => {
        globalThis.postMessage({ type: "run.result", result: "forged" });
        await new Promise(() => {});
      },
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        guardrails: { timeoutMs: 80 },
        workspacePermissions: {
          read: true,
          write: false,
          run: false,
          net: false,
          env: false,
        },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "Timeout exceeded",
  );
});

Deno.test(
  "compute worker does not leak bridge session back to untrusted deck messages",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const childPath = await writeTempDeck(
      dir,
      "bridge-leak-child.deck.ts",
      `
      import { defineDeck } from "${modHref}";
      import { z } from "zod";
      export default defineDeck({
        inputSchema: z.object({}),
        outputSchema: z.string(),
        run: () => "child-ok",
      });
      `,
    );
    const parentPath = await writeTempDeck(
      dir,
      "bridge-leak-parent.deck.ts",
      `
      import { defineDeck } from "${modHref}";
      import { z } from "zod";
      export default defineDeck({
        inputSchema: z.object({}),
        outputSchema: z.string(),
        run: async (ctx) => {
          globalThis.addEventListener("message", (event) => {
            const data = event.data;
            if (data?.type !== "spawn.result") return;
            if (typeof data?.bridgeSession !== "string") return;
            globalThis.postMessage({
              type: "run.result",
              bridgeSession: data.bridgeSession,
              completionNonce: data.completionNonce,
              result: "forged",
            });
          });
          await ctx.spawnAndWait({ path: ${
        JSON.stringify(childPath)
      }, input: {} });
          await new Promise(() => {});
        },
      });
      `,
    );

    await assertRejects(
      () =>
        runDeck({
          path: parentPath,
          input: {},
          modelProvider: dummyProvider,
          isRoot: true,
          workerSandbox: true,
          guardrails: { timeoutMs: 80 },
          workspacePermissions: {
            read: true,
            write: false,
            run: false,
            net: false,
            env: false,
          },
          workspacePermissionsBaseDir: dir,
        }),
      Error,
      "Timeout exceeded",
    );
  },
);

Deno.test("compute worker rejects forged spawn.request messages", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const sideEffectPath = path.join(dir, "forged-spawn-side-effect.txt");
  const childPath = await writeTempDeck(
    dir,
    "forged-spawn-child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      run: async () => {
        await Deno.writeTextFile(${JSON.stringify(sideEffectPath)}, "forged");
        return "ok";
      },
    });
    `,
  );
  const parentPath = await writeTempDeck(
    dir,
    "forged-spawn-parent.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      run: async () => {
        globalThis.postMessage({
          type: "spawn.request",
          requestId: "forged-request",
          payload: {
            path: ${JSON.stringify(childPath)},
            input: {},
            parentActionCallId: "forged-action",
            parentPermissionsBaseDir: ${JSON.stringify(dir)},
            parentPermissions: {
              baseDir: ${JSON.stringify(dir)},
              read: true,
              write: true,
              run: false,
              net: false,
              env: false,
            },
            workspacePermissions: {
              read: true,
              write: [${JSON.stringify(dir)}],
              run: false,
              net: false,
              env: false,
            },
            workspacePermissionsBaseDir: ${JSON.stringify(dir)},
            runDeadlineMs: performance.now() + 10_000,
          },
        });
        await new Promise(() => {});
      },
    });
    `,
  );

  await assertRejects(
    () =>
      runDeck({
        path: parentPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        guardrails: { timeoutMs: 80 },
        workspacePermissions: { read: true, write: [dir], run: false },
        workspacePermissionsBaseDir: dir,
      }),
    Error,
    "Timeout exceeded",
  );

  await new Promise((resolve) => setTimeout(resolve, 120));
  let sideEffectExists = true;
  try {
    await Deno.stat(sideEffectPath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      sideEffectExists = false;
    } else {
      throw err;
    }
  }
  assertEquals(sideEffectExists, false);
});

Deno.test("orchestration worker serial scheduler runs one child tool invocation at a time", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const orderPath = path.join(dir, "serial-order.txt");
  await Deno.writeTextFile(orderPath, "");
  const childPath = await writeTempDeck(
    dir,
    "serial-child-work.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({ id: z.number(), path: z.string() }),
      outputSchema: z.string(),
      run: async (ctx) => {
        await Deno.writeTextFile(ctx.input.path, "start" + ctx.input.id + "\\n", { append: true });
        await new Promise((resolve) => setTimeout(resolve, 60));
        await Deno.writeTextFile(ctx.input.path, "end" + ctx.input.id + "\\n", { append: true });
        return "ok-" + ctx.input.id;
      },
    });
    `,
  );
  const parentPath = await writeTempDeck(
    dir,
    "serial-parent-llm.deck.ts",
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

  let pass = 0;
  const provider: ModelProvider = {
    chat() {
      pass += 1;
      if (pass === 1) {
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [
            { id: "call-1", name: "child", args: { id: 1, path: orderPath } },
            { id: "call-2", name: "child", args: { id: 2, path: orderPath } },
          ],
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: parentPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
    workerSandbox: true,
    workspacePermissions: { read: true, write: [dir], run: false },
    workspacePermissionsBaseDir: dir,
  });
  assertEquals(result, "done");

  const order = (await Deno.readTextFile(orderPath))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  assertEquals(order, ["start1", "end1", "start2", "end2"]);
});

Deno.test("LLM built-in tools are gated by effective permissions", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "tool-gating.deck.ts",
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

  let toolNames: Array<string> = [];
  const provider: ModelProvider = {
    chat(input) {
      toolNames = (input.tools ?? []).map((tool) => tool.function.name);
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: deckPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
    workspacePermissions: {
      read: true,
      write: false,
      run: false,
      net: false,
      env: false,
    },
    workspacePermissionsBaseDir: dir,
  });

  assertEquals(result, "ok");
  assert(toolNames.includes("read_file"));
  assert(toolNames.includes("list_dir"));
  assert(toolNames.includes("grep_files"));
  assertEquals(toolNames.includes("apply_patch"), false);
  assertEquals(toolNames.includes("exec"), false);
});

Deno.test("LLM built-in tools include exec when run permissions are granted", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "tool-gating-run.deck.ts",
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

  let toolNames: Array<string> = [];
  const provider: ModelProvider = {
    chat(input) {
      toolNames = (input.tools ?? []).map((tool) => tool.function.name);
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: deckPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
    workspacePermissions: {
      read: false,
      write: false,
      run: { commands: ["echo"] },
      net: false,
      env: false,
    },
    workspacePermissionsBaseDir: dir,
  });

  assertEquals(result, "ok");
  assert(toolNames.includes("exec"));
  assertEquals(toolNames.includes("read_file"), false);
  assertEquals(toolNames.includes("list_dir"), false);
  assertEquals(toolNames.includes("grep_files"), false);
  assertEquals(toolNames.includes("apply_patch"), false);
});

Deno.test(
  "LLM file tools enforce directory-scoped read permissions",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = await writeTempDeck(
      dir,
      "file-tools.deck.ts",
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

    const allowedDir = path.join(dir, "allowed");
    const nestedDir = path.join(allowedDir, "nested");
    await Deno.mkdir(nestedDir, { recursive: true });
    const allowedFile = path.join(nestedDir, "note.txt");
    await Deno.writeTextFile(allowedFile, "line-one\\nline-two\\nmatch-line");

    const otherDir = path.join(dir, "other");
    await Deno.mkdir(otherDir, { recursive: true });
    const deniedFile = path.join(otherDir, "secret.txt");
    await Deno.writeTextFile(deniedFile, "top-secret");
    const allowedPatchPath = path.join(allowedDir, "editable.txt");
    await Deno.writeTextFile(allowedPatchPath, "before-allowed");
    const deniedPatchPath = path.join(otherDir, "blocked.txt");
    await Deno.writeTextFile(deniedPatchPath, "before-denied");

    type ToolPlanEntry = {
      id: string;
      name: "read_file" | "list_dir" | "grep_files" | "apply_patch";
      args: Record<string, JSONValue>;
      expectStatus: 200 | 403;
    };
    const toolPlan: Array<ToolPlanEntry> = [
      {
        id: "call-1",
        name: "read_file",
        args: { path: allowedFile },
        expectStatus: 200,
      },
      {
        id: "call-2",
        name: "read_file",
        args: { path: deniedFile },
        expectStatus: 403,
      },
      {
        id: "call-3",
        name: "list_dir",
        args: { path: allowedDir, recursive: true },
        expectStatus: 200,
      },
      {
        id: "call-4",
        name: "list_dir",
        args: { path: otherDir, recursive: true },
        expectStatus: 403,
      },
      {
        id: "call-5",
        name: "grep_files",
        args: { path: allowedDir, query: "match" },
        expectStatus: 200,
      },
      {
        id: "call-6",
        name: "grep_files",
        args: { path: otherDir, query: "match" },
        expectStatus: 403,
      },
      {
        id: "call-7",
        name: "apply_patch",
        args: {
          path: allowedPatchPath,
          edits: [{
            old_text: "before-allowed",
            new_text: "after-allowed",
          }],
        },
        expectStatus: 200,
      },
      {
        id: "call-8",
        name: "apply_patch",
        args: {
          path: deniedPatchPath,
          edits: [{
            old_text: "before-denied",
            new_text: "after-denied",
          }],
        },
        expectStatus: 403,
      },
    ];

    type ToolResponseBody = {
      status?: number;
      code?: string;
      message?: string;
      payload?: Record<string, unknown>;
    };
    const toolResults: Array<{ plan: ToolPlanEntry; body: ToolResponseBody }> =
      [];
    const seenToolIds = new Set<string>();
    const captureToolMessages = (input: { messages: Array<ModelMessage> }) => {
      for (const message of input.messages) {
        if (message.role !== "tool" || !message.tool_call_id) continue;
        if (seenToolIds.has(message.tool_call_id)) continue;
        seenToolIds.add(message.tool_call_id);
        if (message.content === null) continue;
        const plan = toolPlan.find((entry) =>
          entry.id === message.tool_call_id
        );
        if (!plan) continue;
        const body = JSON.parse(String(message.content)) as ToolResponseBody;
        toolResults.push({ plan, body });
      }
    };

    let pass = 0;
    const provider: ModelProvider = {
      chat(input) {
        captureToolMessages(input);
        const plan = toolPlan[pass];
        pass += 1;
        if (!plan) {
          return Promise.resolve({
            message: { role: "assistant", content: "done" },
            finishReason: "stop",
          });
        }
        return Promise.resolve({
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: plan.id,
              type: "function",
              function: {
                name: plan.name,
                arguments: JSON.stringify(plan.args),
              },
            }],
          },
          finishReason: "tool_calls",
          toolCalls: [{
            id: plan.id,
            name: plan.name,
            args: plan.args,
          }],
        });
      },
    };

    const result = await runDeck({
      path: deckPath,
      input: "hi",
      modelProvider: provider,
      isRoot: true,
      workspacePermissions: {
        read: ["./allowed"],
        write: ["./allowed"],
        run: false,
        net: false,
        env: false,
      },
      workspacePermissionsBaseDir: dir,
    });

    assertEquals(result, "done");
    assertEquals(toolResults.length, toolPlan.length);

    const listDirEntries = (payload: Record<string, unknown> | undefined) => {
      return Array.isArray(payload?.entries)
        ? payload.entries as Array<Record<string, string>>
        : [];
    };

    for (const { plan, body } of toolResults) {
      assertEquals(body.status, plan.expectStatus);
      if (plan.expectStatus === 200) {
        assertEquals(body.code ?? null, null);
        if (plan.name === "read_file") {
          const payload = body.payload as Record<string, unknown>;
          assert(payload, "expected read_file payload");
          assertEquals(payload.path, plan.args.path);
          assert(
            typeof payload.content === "string" &&
              payload.content.includes("match-line"),
          );
        }
        if (plan.name === "list_dir") {
          const payload = body.payload as Record<string, unknown>;
          assert(payload, "expected list_dir payload");
          const entries = listDirEntries(payload);
          assert(
            entries.some((entry) => entry.path === allowedFile),
            "expected list_dir entries to include allowed file",
          );
        }
        if (plan.name === "grep_files") {
          const payload = body.payload as Record<string, unknown>;
          assert(payload, "expected grep_files payload");
          const matches = Array.isArray(payload.matches)
            ? payload.matches as Array<Record<string, unknown>>
            : [];
          assert(
            matches.some((match) => match.path === allowedFile),
            "expected grep_files to return match from allowed file",
          );
        }
        if (plan.name === "apply_patch") {
          const payload = body.payload as Record<string, unknown>;
          assert(payload, "expected apply_patch payload");
          assertEquals(payload.path, plan.args.path);
          assertEquals(payload.applied, 1);
        }
      } else {
        assertEquals(body.code, "permission_denied");
        assert(
          typeof body.message === "string" &&
            body.message.includes(plan.name),
          "expected permission denial message to mention the tool",
        );
      }
    }

    assertEquals(
      await Deno.readTextFile(allowedPatchPath),
      "after-allowed",
      "apply_patch should modify files in allowed directories",
    );
    assertEquals(
      await Deno.readTextFile(deniedPatchPath),
      "before-denied",
      "apply_patch must not modify files outside allowed directories",
    );
  },
);

Deno.test("LLM file tools deny symlink escapes outside granted roots", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "file-tools-symlink.deck.ts",
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

  const allowedDir = path.join(dir, "allowed");
  const outsideDir = path.join(dir, "outside");
  await Deno.mkdir(allowedDir, { recursive: true });
  await Deno.mkdir(outsideDir, { recursive: true });

  const outsideReadTarget = path.join(outsideDir, "secret.txt");
  await Deno.writeTextFile(outsideReadTarget, "secret");
  const outsideWriteTarget = path.join(outsideDir, "edit.txt");
  await Deno.writeTextFile(outsideWriteTarget, "before");

  const readSymlink = path.join(allowedDir, "secret-link.txt");
  await Deno.symlink(outsideReadTarget, readSymlink);
  const writeSymlinkDir = path.join(allowedDir, "linked");
  await Deno.symlink(outsideDir, writeSymlinkDir);

  type ToolResponseBody = {
    status?: number;
    code?: string;
    message?: string;
  };
  const toolResults: Array<ToolResponseBody> = [];
  const seenToolIds = new Set<string>();

  let pass = 0;
  const provider: ModelProvider = {
    chat(input) {
      if (pass > 0) {
        const toolMessages = input.messages.filter((message) =>
          message.role === "tool" &&
          (message.name === "read_file" || message.name === "apply_patch")
        );
        for (const message of toolMessages) {
          if (!message.tool_call_id || seenToolIds.has(message.tool_call_id)) {
            continue;
          }
          seenToolIds.add(message.tool_call_id);
          toolResults.push(
            JSON.parse(String(message.content)) as ToolResponseBody,
          );
        }
      }
      pass += 1;
      if (pass === 1) {
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{
            id: "tool-read",
            name: "read_file",
            args: { path: readSymlink },
          }],
        });
      }
      if (pass === 2) {
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{
            id: "tool-write",
            name: "apply_patch",
            args: {
              path: path.join(writeSymlinkDir, "edit.txt"),
              edits: [{ old_text: "before", new_text: "after" }],
            },
          }],
        });
      }
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: deckPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
    workspacePermissions: {
      read: ["./allowed"],
      write: ["./allowed"],
      run: false,
      net: false,
      env: false,
    },
    workspacePermissionsBaseDir: dir,
  });

  assertEquals(result, "done");
  assertEquals(toolResults.length, 2);
  assertEquals(toolResults[0].status, 403);
  assertEquals(toolResults[0].code, "permission_denied");
  assertEquals(toolResults[1].status, 403);
  assertEquals(toolResults[1].code, "permission_denied");
  assertEquals(await Deno.readTextFile(outsideWriteTarget), "before");
});

Deno.test(
  "LLM built-in exec denies symlink targets outside allowed run.paths",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = await writeTempDeck(
      dir,
      "exec-symlink-path-deny.deck.ts",
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
    const allowedDir = path.join(dir, "allowed");
    await Deno.mkdir(allowedDir, { recursive: true });
    const symlinkCommand = path.join(allowedDir, "tool");
    await Deno.symlink("/bin/sh", symlinkCommand);
    const sideEffectPath = path.join(dir, "exec-symlink-side-effect.txt");

    let pass = 0;
    let toolPayload = "";
    const provider: ModelProvider = {
      chat(input) {
        pass++;
        if (pass === 1) {
          return Promise.resolve({
            message: { role: "assistant", content: null },
            finishReason: "tool_calls",
            toolCalls: [{
              id: "tool-exec",
              name: "exec",
              args: {
                command: symlinkCommand,
                args: ["-c", `echo escaped > ${sideEffectPath}`],
              },
            }],
          });
        }
        toolPayload = String(
          input.messages.find((message) =>
            message.role === "tool" && message.name === "exec"
          )?.content ?? "",
        );
        return Promise.resolve({
          message: { role: "assistant", content: "done" },
          finishReason: "stop",
        });
      },
    };

    const result = await runDeck({
      path: deckPath,
      input: "hi",
      modelProvider: provider,
      isRoot: true,
      workerSandbox: true,
      workspacePermissions: {
        read: true,
        write: false,
        run: { paths: ["./allowed/tool"] },
        net: false,
        env: false,
      },
      workspacePermissionsBaseDir: dir,
    });
    assertEquals(result, "done");

    const parsed = JSON.parse(toolPayload) as {
      status?: number;
      code?: string;
      message?: string;
    };
    assertEquals(parsed.status, 403);
    assertEquals(parsed.code, "permission_denied");
    assert(
      typeof parsed.message === "string" && parsed.message.includes("exec"),
      "expected permission denial to mention exec",
    );

    const leaked = await Deno.stat(sideEffectPath).then(
      () => true,
      () => false,
    );
    assertEquals(leaked, false);
  },
);

Deno.test(
  "LLM built-in exec returns unsupported host response when command API is unavailable",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = await writeTempDeck(
      dir,
      "exec-unsupported-host.deck.ts",
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

    let pass = 0;
    let toolPayload = "";
    const provider: ModelProvider = {
      chat(input) {
        pass++;
        if (pass === 1) {
          return Promise.resolve({
            message: { role: "assistant", content: null },
            finishReason: "tool_calls",
            toolCalls: [{
              id: "tool-exec",
              name: "exec",
              args: { command: "echo", args: ["hello"] },
            }],
          });
        }
        toolPayload = String(
          input.messages.find((message) =>
            message.role === "tool" && message.name === "exec"
          )?.content ?? "",
        );
        return Promise.resolve({
          message: { role: "assistant", content: "done" },
          finishReason: "stop",
        });
      },
    };

    const denoNs = Deno as unknown as { Command?: unknown };
    const originalCommand = denoNs.Command;
    Object.defineProperty(denoNs, "Command", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const result = await runDeck({
        path: deckPath,
        input: "hi",
        modelProvider: provider,
        isRoot: true,
        workspacePermissions: {
          read: false,
          write: false,
          run: { commands: ["echo"] },
          net: false,
          env: false,
        },
        workspacePermissionsBaseDir: dir,
      });
      assertEquals(result, "done");
    } finally {
      Object.defineProperty(denoNs, "Command", {
        value: originalCommand,
        configurable: true,
        writable: true,
      });
    }

    const parsed = JSON.parse(toolPayload) as {
      status?: number;
      code?: string;
      message?: string;
    };
    assertEquals(parsed.status, 501);
    assertEquals(parsed.code, "exec_unsupported_host");
    assert(
      typeof parsed.message === "string" &&
        parsed.message.includes("unsupported"),
      "expected unsupported host message",
    );
  },
);

Deno.test("LLM built-in apply_patch returns stable permission denial", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const targetPath = path.join(dir, "target.txt");
  await Deno.writeTextFile(targetPath, "before");
  const deckPath = await writeTempDeck(
    dir,
    "tool-deny.deck.ts",
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

  let pass = 0;
  let toolPayload = "";
  const provider: ModelProvider = {
    chat(input) {
      pass++;
      if (pass === 1) {
        return Promise.resolve({
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "tool-1",
              type: "function",
              function: {
                name: "apply_patch",
                arguments: JSON.stringify({
                  path: targetPath,
                  edits: [{ old_text: "before", new_text: "after" }],
                }),
              },
            }],
          },
          finishReason: "tool_calls",
          toolCalls: [{
            id: "tool-1",
            name: "apply_patch",
            args: {
              path: targetPath,
              edits: [{ old_text: "before", new_text: "after" }],
            },
          }],
        });
      }
      toolPayload = String(
        input.messages.find((message) =>
          message.role === "tool" && message.name === "apply_patch"
        )?.content ?? "",
      );
      return Promise.resolve({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      });
    },
  };

  const result = await runDeck({
    path: deckPath,
    input: "hi",
    modelProvider: provider,
    isRoot: true,
    workspacePermissions: {
      read: true,
      write: false,
      run: false,
      net: false,
      env: false,
    },
    workspacePermissionsBaseDir: dir,
  });

  assertEquals(result, "done");
  assert(toolPayload.includes('"code":"permission_denied"'));
  assert(toolPayload.includes("apply_patch denied"));
  assertEquals(await Deno.readTextFile(targetPath), "before");
});

Deno.test(
  "LLM built-in apply_patch create_if_missing creates nested parent directories",
  async () => {
    const dir = await Deno.makeTempDir();
    const modHref = modImportPath();
    const deckPath = await writeTempDeck(
      dir,
      "tool-create-missing.deck.ts",
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

    const nestedTarget = path.join(dir, "faq", "faq.txt");
    let pass = 0;
    let toolPayload = "";
    const provider: ModelProvider = {
      chat(input) {
        pass += 1;
        if (pass === 1) {
          return Promise.resolve({
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "tool-create",
                type: "function",
                function: {
                  name: "apply_patch",
                  arguments: JSON.stringify({
                    path: nestedTarget,
                    create_if_missing: true,
                    edits: [{ old_text: "placeholder", new_text: "hello faq" }],
                  }),
                },
              }],
            },
            finishReason: "tool_calls",
            toolCalls: [{
              id: "tool-create",
              name: "apply_patch",
              args: {
                path: nestedTarget,
                create_if_missing: true,
                edits: [{ old_text: "placeholder", new_text: "hello faq" }],
              },
            }],
          });
        }
        toolPayload = String(
          input.messages.find((message) =>
            message.role === "tool" && message.name === "apply_patch"
          )?.content ?? "",
        );
        return Promise.resolve({
          message: { role: "assistant", content: "done" },
          finishReason: "stop",
        });
      },
    };

    const result = await runDeck({
      path: deckPath,
      input: "hi",
      modelProvider: provider,
      isRoot: true,
      workspacePermissions: {
        read: true,
        write: true,
        run: false,
        net: false,
        env: false,
      },
      workspacePermissionsBaseDir: dir,
    });

    assertEquals(result, "done");
    assert(toolPayload.includes('"status":200'));
    assert(toolPayload.includes('"created":true'));
    assertEquals(await Deno.readTextFile(nestedTarget), "");
  },
);

Deno.test("runDeck rejects workerSandbox requests when signal is provided", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "worker-sandbox-signal.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      run: () => "ok",
    });
    `,
  );

  const controller = new AbortController();
  const err = await assertRejects(
    () =>
      runDeck({
        path: deckPath,
        input: {},
        modelProvider: dummyProvider,
        isRoot: true,
        workerSandbox: true,
        signal: controller.signal,
      }),
    Error,
    "workerSandbox is unsupported when `signal` is provided",
  );
  assertEquals(
    (err as { code?: unknown }).code,
    "worker_sandbox_signal_unsupported",
  );
});

Deno.test("runDeck abort signal cancels in-flight model call and fires onCancel once", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "abort.deck.ts",
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

  const controller = new AbortController();
  let onCancelCalls = 0;
  let providerSawSignal = false;
  const provider: ModelProvider = {
    chat(input) {
      providerSawSignal = Boolean(input.signal);
      if (input.signal && !controller.signal.aborted) {
        setTimeout(() => controller.abort("stop"), 0);
      }
      return new Promise((_, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Run canceled", "AbortError")),
          { once: true },
        );
      });
    },
  };

  const runPromise = runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: provider,
    isRoot: true,
    signal: controller.signal,
    onCancel: () => {
      onCancelCalls += 1;
    },
  });

  await assertRejects(() => runPromise);
  await runPromise.catch((err) => {
    assert(isRunCanceledError(err));
  });
  assertEquals(providerSawSignal, true);
  assertEquals(onCancelCalls, 1);
});

Deno.test("runDeck ignores post-abort stream chunks", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "abort-stream.deck.ts",
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

  const controller = new AbortController();
  const chunks: Array<string> = [];
  const provider: ModelProvider = {
    chat(input) {
      input.onStreamText?.("a");
      return new Promise((_, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => {
            input.onStreamText?.("b");
            reject(new DOMException("Run canceled", "AbortError"));
          },
          { once: true },
        );
      });
    },
  };

  const runPromise = runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: provider,
    isRoot: true,
    stream: true,
    signal: controller.signal,
    onStreamText: (chunk) => chunks.push(chunk),
  });
  setTimeout(() => controller.abort(), 0);
  await assertRejects(() => runPromise);
  assertEquals(chunks.includes("b"), false);
});

Deno.test("runDeck propagates cancellation through nested action runs", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const childPath = await writeTempDeck(
    dir,
    "abort-child.deck.ts",
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
    "abort-parent.deck.ts",
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

  let parentCalls = 0;
  let childCalls = 0;
  const controller = new AbortController();
  const provider: ModelProvider = {
    chat(input) {
      if (input.deckPath?.endsWith("abort-parent.deck.ts")) {
        parentCalls += 1;
        return Promise.resolve({
          message: { role: "assistant", content: null },
          finishReason: "tool_calls",
          toolCalls: [{ id: "child-1", name: "child", args: {} }],
        });
      }
      childCalls += 1;
      if (!controller.signal.aborted) {
        controller.abort("stop-child");
      }
      return Promise.reject(new DOMException("Run canceled", "AbortError"));
    },
  };

  const runPromise = runDeck({
    path: parentPath,
    input: "start",
    modelProvider: provider,
    isRoot: true,
    signal: controller.signal,
  });
  await assertRejects(() => runPromise);
  assertEquals(parentCalls, 1);
  assertEquals(childCalls, 1);
});

Deno.test("runDeck keeps cancellation distinct from normal errors", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "cancel-vs-error.deck.ts",
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

  const canceledProvider: ModelProvider = {
    chat(input) {
      return new Promise((_, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Run canceled", "AbortError")),
          { once: true },
        );
      });
    },
  };
  const canceledController = new AbortController();
  const canceled = runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: canceledProvider,
    isRoot: true,
    signal: canceledController.signal,
  }).catch((err) => err);
  canceledController.abort();
  const canceledErr = await canceled;
  assert(isRunCanceledError(canceledErr));

  const failingProvider: ModelProvider = {
    chat() {
      throw new Error("normal failure");
    },
  };
  const failingErr = await runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: failingProvider,
    isRoot: true,
  }).catch((err) => err);
  assertEquals(isRunCanceledError(failingErr), false);
});

Deno.test("runDeck rejects as canceled when signal aborts before final output without onStateUpdate", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();
  const deckPath = await writeTempDeck(
    dir,
    "abort-before-final-output.deck.ts",
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

  const controller = new AbortController();
  const provider: ModelProvider = {
    chat() {
      controller.abort("stop-before-final");
      return Promise.resolve({
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      });
    },
  };

  const err = await runDeck({
    path: deckPath,
    input: "hello",
    modelProvider: provider,
    isRoot: true,
    signal: controller.signal,
  }).catch((caught) => caught);

  assert(isRunCanceledError(err));
});
