import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  codexConfigArgsForTest,
  codexInstructionsForMessagesForTest,
  createCodexProvider,
  normalizeCodexModelForTest,
  promptForCodexTurnForTest,
} from "./codex.ts";
import type {
  JSONValue,
  ProviderTraceEvent,
  SavedState,
} from "@bolt-foundry/gambit-core";

const MCP_ROOT_DECK_ARG_PREFIX =
  "mcp_servers.gambit.env.GAMBIT_MCP_ROOT_DECK_PATH=";

function extractMcpRootDeckPath(args: ReadonlyArray<string>): string | null {
  const raw = args.find((entry) => entry.startsWith(MCP_ROOT_DECK_ARG_PREFIX));
  if (!raw) {
    return null;
  }
  const quoted = raw.slice(MCP_ROOT_DECK_ARG_PREFIX.length);
  return quoted.startsWith('"') && quoted.endsWith('"')
    ? quoted.slice(1, -1)
    : quoted;
}

Deno.test("codex provider can use app-server transport and resume saved thread ids", async () => {
  const calls: Array<{ prompt: string; priorThreadId?: string }> = [];
  const provider = createCodexProvider({
    runAppServerTurn: (input) => {
      calls.push({
        prompt: input.prompt,
        priorThreadId: input.priorThreadId,
      });
      input.onStreamEvent?.({
        type: "item.delta",
        item: { id: "msg_app", type: "agent_message", text: "hello " },
      });
      input.onStreamEvent?.({
        type: "item.completed",
        item: {
          id: "msg_app",
          type: "agent_message",
          text: "hello world",
        },
      });
      return Promise.resolve({
        threadId: input.priorThreadId ?? "thread-app-server",
        assistantMessages: [{
          itemId: "msg_app",
          text: "hello world",
        }],
        usage: {
          promptTokens: 5,
          completionTokens: 2,
          totalTokens: 7,
        },
      });
    },
  });

  const chunks: Array<string> = [];
  const first = await provider.chat({
    model: "codex-cli/default",
    stream: true,
    messages: [{ role: "user", content: "hello" }],
    onStreamText: (chunk) => chunks.push(chunk),
  });
  assertEquals(first.message.content, "hello world");
  assertEquals(
    first.updatedState?.meta?.["codex.threadId"],
    "thread-app-server",
  );
  assertEquals(chunks, ["hello "]);
  assertEquals(calls[0], { prompt: "hello", priorThreadId: undefined });

  const second = await provider.chat({
    model: "codex-cli/default",
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hello world" },
      { role: "user", content: "follow up" },
    ],
    state: first.updatedState as SavedState,
  });
  assertEquals(second.message.content, "hello world");
  assertEquals(calls[1], {
    prompt: "follow up",
    priorThreadId: "thread-app-server",
  });
});

Deno.test("codex provider resume does not replay transcript when no new user message", () => {
  const prompt = promptForCodexTurnForTest({
    messages: [
      { role: "system", content: "system text" },
      { role: "assistant", content: "assistant text" },
    ],
    priorThreadId: "thread-123",
  });
  assertEquals(prompt, "");
});

Deno.test("codex provider uses codex developer instructions config for fresh system prompts", () => {
  const messages = [
    { role: "system" as const, content: "deck system prompt" },
    { role: "user" as const, content: "hello" },
  ];
  const instructions = codexInstructionsForMessagesForTest(messages);
  const prompt = promptForCodexTurnForTest({ messages });
  const joined = codexConfigArgsForTest({
    cwd: "/tmp/test-cwd",
    instructions,
  }).join(" ");
  assertEquals(
    joined.includes('developer_instructions="deck system prompt"'),
    true,
  );
  assertEquals(joined.includes('-c instructions="deck system prompt"'), false);
  assertEquals(joined.includes("SYSTEM:\\n"), false);
  assertEquals(prompt, "hello");
});

Deno.test("codex provider fresh prompt keeps non-system continuation payloads only", () => {
  const messages = [
    { role: "system" as const, content: "deck system prompt" },
    { role: "user" as const, content: "hello" },
    { role: "assistant" as const, content: "hi there" },
    { role: "user" as const, content: "follow up" },
  ];
  const instructions = codexInstructionsForMessagesForTest(messages);
  const prompt = promptForCodexTurnForTest({ messages });
  const joined = codexConfigArgsForTest({
    cwd: "/tmp/test-cwd",
    instructions,
  }).join(" ");
  assertEquals(
    joined.includes('developer_instructions="deck system prompt"'),
    true,
  );
  assertEquals(joined.includes('-c instructions="deck system prompt"'), false);
  assertEquals(joined.includes("SYSTEM:\\n"), false);
  assertEquals(
    prompt,
    "USER:\nhello\n\nASSISTANT:\nhi there\n\nUSER:\nfollow up",
  );
});

Deno.test("codex provider preserves external tools in synthesized mcp root deck", async () => {
  const root = await Deno.makeTempDir({
    prefix: "codex-provider-mcp-root-tools-",
  });
  const deckPath = join(root, "MANAGER.md");
  await Deno.writeTextFile(
    deckPath,
    `+++
label = "root"

[[actions]]
name = "draft_assistant_task"
path = "./draft_assistant_task.deck.ts"
description = "Draft task."

[[tools]]
name = "external_lookup"
description = "External lookup."
+++
Root deck.
`,
  );
  await Deno.writeTextFile(
    join(root, "draft_assistant_task.deck.ts"),
    `import { defineDeck } from "@bolt-foundry/gambit-core";
import { z } from "zod";
export default defineDeck({
  contextSchema: z.object({ title: z.string().optional() }),
  responseSchema: z.object({ status: z.number() }),
  run: () => ({ status: 200 }),
});
`,
  );

  let synthesizedDeckPath: string | null = null;
  let synthesizedDeckContent = "";
  const provider = createCodexProvider({
    runAppServerTurn: (input) => {
      const args = codexConfigArgsForTest({
        cwd: input.cwd,
        deckPath: input.deckPath,
        params: input.params,
        instructions: input.instructions,
      });
      synthesizedDeckPath = extractMcpRootDeckPath(args);
      assert(synthesizedDeckPath);
      synthesizedDeckContent = Deno.readTextFileSync(synthesizedDeckPath);
      return Promise.resolve({
        threadId: "thread-mcp-root-tools",
        assistantMessages: [{ itemId: "msg_1", text: "ok" }],
      });
    },
  });

  try {
    await provider.chat({
      model: "codex-cli/default",
      deckPath,
      messages: [{ role: "user", content: "hello" }],
    });

    assert(synthesizedDeckPath);
    assertEquals(synthesizedDeckPath === deckPath, false);
    assertEquals(synthesizedDeckContent.includes("[[actions]]"), true);
    assertEquals(
      synthesizedDeckContent.includes('name = "draft_assistant_task"'),
      true,
    );
    assertEquals(synthesizedDeckContent.includes("[[tools]]"), true);
    assertEquals(
      synthesizedDeckContent.includes('name = "external_lookup"'),
      true,
    );
    assertEquals(
      synthesizedDeckContent.includes('description = "External lookup."'),
      true,
    );
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex provider app-server keeps developer instructions when deckPath enables MCP root wiring", async () => {
  const priorTransport = Deno.env.get("GAMBIT_CODEX_TRANSPORT");
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const root = await Deno.makeTempDir({
    prefix: "codex-app-server-mcp-developer-instructions-",
  });
  const fakeCodexPath = join(root, "fake-codex");
  const deckPath = join(root, "MANAGER.md");

  await Deno.writeTextFile(
    deckPath,
    `+++
label = "root"

[[actions]]
name = "draft_assistant_task"
path = "./draft_assistant_task.deck.ts"
description = "Draft task."
+++
Root deck.
`,
  );
  await Deno.writeTextFile(
    join(root, "draft_assistant_task.deck.ts"),
    `import { defineDeck } from "@bolt-foundry/gambit-core";
import { z } from "zod";
export default defineDeck({
  contextSchema: z.object({ title: z.string().optional() }),
  responseSchema: z.object({ status: z.number() }),
  run: () => ({ status: 200 }),
});
`,
  );
  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

mode=""
saw_developer_instructions="0"
saw_gambit_mcp="0"
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
  case "$arg" in
    *'developer_instructions="deck system prompt"'*)
      saw_developer_instructions="1"
      ;;
    *'mcp_servers.gambit.enabled=true'*)
      saw_gambit_mcp="1"
      ;;
  esac
done

[ "$mode" = "app-server" ] || exit 64
[ "$saw_developer_instructions" = "1" ] || {
  printf 'spawn args missing deck system prompt developer instructions\\n' >&2
  exit 41
}
[ "$saw_gambit_mcp" = "1" ] || {
  printf 'spawn args missing gambit mcp wiring\\n' >&2
  exit 42
}

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"thread/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"thread":{"id":"thread-app-server-mcp-developer-instructions"}}}\\n' "$id"
      ;;
    *'"method":"turn/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"turn":{"id":"turn-app-server-mcp-developer-instructions","status":"inProgress","items":[],"error":null}}}\\n' "$id"
      printf '{"method":"item/completed","params":{"threadId":"thread-app-server-mcp-developer-instructions","turnId":"turn-app-server-mcp-developer-instructions","item":{"type":"agentMessage","id":"msg-app-server-mcp-developer-instructions","text":"hello world","phase":null,"memoryCitation":null}}}\\n'
      printf '{"method":"turn/completed","params":{"threadId":"thread-app-server-mcp-developer-instructions","turn":{"id":"turn-app-server-mcp-developer-instructions","status":"completed","items":[],"error":null,"startedAt":0,"completedAt":0,"durationMs":1}}}\\n'
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_TRANSPORT", "app-server");
  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  try {
    const provider = createCodexProvider();
    const result = await provider.chat({
      model: "codex-cli/default",
      deckPath,
      messages: [
        { role: "system", content: "deck system prompt" },
        { role: "user", content: "hello" },
      ],
    });
    assertEquals(result.message.content, "hello world");
  } finally {
    if (priorTransport === undefined) {
      Deno.env.delete("GAMBIT_CODEX_TRANSPORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_TRANSPORT", priorTransport);
    }
    if (priorBin === undefined) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex provider responses returns updatedState with thread metadata", async () => {
  const provider = createCodexProvider({
    runAppServerTurn: () =>
      Promise.resolve({
        threadId: "thread-rsp",
        assistantMessages: [{
          itemId: "msg_1",
          text: "response mode reply",
        }],
      }),
  });

  const result = await provider.responses?.({
    request: {
      model: "codex-cli/default",
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      }],
    },
  });

  assertEquals(Boolean(result), true);
  assertEquals(result?.updatedState?.meta?.["codex.threadId"], "thread-rsp");
});

Deno.test("codex provider updatedState does not carry prior traces", async () => {
  const provider = createCodexProvider({
    runAppServerTurn: () =>
      Promise.resolve({
        threadId: "thread-rsp",
        assistantMessages: [{
          itemId: "msg_1",
          text: "response mode reply",
        }],
      }),
  });

  const result = await provider.chat({
    model: "codex-cli/default",
    messages: [{ role: "user", content: "hello" }],
    state: {
      runId: "run-1",
      messages: [],
      traces: [{
        type: "response.completed",
        response: { id: "resp-1", object: "response", status: "completed" },
      }] as unknown as SavedState["traces"],
    } as SavedState,
  });

  assertEquals(result.updatedState?.traces, undefined);
});

Deno.test("codex provider responses forwards request.params to app-server turn", async () => {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const provider = createCodexProvider({
    runAppServerTurn: ({ params }) => {
      calls.push(params);
      return Promise.resolve({
        threadId: "thread-rsp",
        assistantMessages: [{
          itemId: "msg_1",
          text: "response mode reply",
        }],
      });
    },
  });

  await provider.responses?.({
    request: {
      model: "codex-cli/default",
      params: { verbosity: "high" },
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      }],
    },
  });

  assertEquals(calls.length, 1);
  assertEquals(calls[0], { verbosity: "high" });
});

Deno.test("codex provider responses forwards abort signal to app-server turn", async () => {
  let seenSignal: AbortSignal | undefined;
  const provider = createCodexProvider({
    runAppServerTurn: ({ signal }) => {
      seenSignal = signal;
      return Promise.resolve({
        threadId: "thread-rsp",
        assistantMessages: [{
          itemId: "msg_1",
          text: "response mode reply",
        }],
      });
    },
  });
  const controller = new AbortController();

  await provider.responses?.({
    request: {
      model: "codex-cli/default",
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      }],
    },
    signal: controller.signal,
  });

  assertEquals(seenSignal, controller.signal);
});

Deno.test("codex provider streams assistant text deltas from agent_message events", async () => {
  const streamEvents: Array<{ type?: string; delta?: string; text?: string }> =
    [];
  const streamedText: Array<string> = [];
  const provider = createCodexProvider({
    runAppServerTurn: (input) => {
      const events: Array<Record<string, JSONValue>> = [
        {
          type: "item.delta",
          item: { id: "msg_1", type: "agent_message", text: "hello " },
        },
        {
          type: "item.delta",
          item: { id: "msg_1", type: "agent_message", text: "world" },
        },
        {
          type: "item.completed",
          item: { id: "msg_1", type: "agent_message", text: "hello world" },
        },
      ];
      events.forEach((event) => input.onStreamEvent?.(event));
      return Promise.resolve({
        threadId: "thread-rsp",
        assistantMessages: [{ itemId: "msg_1", text: "hello world" }],
      });
    },
  });

  const result = await provider.responses?.({
    request: {
      model: "codex-cli/default",
      stream: true,
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      }],
    },
    onStreamEvent: (event) => {
      streamEvents.push(
        event as { type?: string; delta?: string; text?: string },
      );
    },
  });

  assertEquals(result?.output[0]?.type, "message");
  const firstOutput = result?.output[0];
  assertEquals(
    firstOutput && firstOutput.type === "message"
      ? firstOutput.content[0]?.text
      : undefined,
    "hello world",
  );
  assertEquals(
    streamEvents.filter((event) => event.type === "response.output_text.delta")
      .map((event) => event.delta),
    ["hello ", "world"],
  );
  assertEquals(
    streamEvents.filter((event) => event.type === "response.output_text.done")
      .map((event) => event.text),
    ["hello world"],
  );

  await provider.chat({
    model: "codex-cli/default",
    stream: true,
    messages: [{ role: "user", content: "hi" }],
    onStreamText: (text) => streamedText.push(text),
  });

  assertEquals(streamedText, ["hello ", "world"]);
});

Deno.test("codex provider responses streams via app-server transport", async () => {
  const priorTransport = Deno.env.get("GAMBIT_CODEX_TRANSPORT");
  Deno.env.set("GAMBIT_CODEX_TRANSPORT", "app-server");
  try {
    const streamEvents: Array<
      { type?: string; delta?: string; text?: string }
    > = [];
    const provider = createCodexProvider({
      runAppServerTurn: (input) => {
        input.onStreamEvent?.({
          type: "item.delta",
          item: { id: "msg_rsp", type: "agent_message", text: "one " },
        });
        input.onStreamEvent?.({
          type: "item.delta",
          item: { id: "msg_rsp", type: "agent_message", text: "two" },
        });
        input.onStreamEvent?.({
          type: "item.completed",
          item: {
            id: "msg_rsp",
            type: "agent_message",
            text: "one two",
          },
        });
        return Promise.resolve({
          threadId: "thread-rsp-app",
          assistantMessages: [{ itemId: "msg_rsp", text: "one two" }],
          usage: {
            promptTokens: 4,
            completionTokens: 2,
            totalTokens: 6,
          },
        });
      },
    });

    const result = await provider.responses?.({
      request: {
        model: "codex-cli/default",
        stream: true,
        input: [{
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hi" }],
        }],
      },
      onStreamEvent: (event) => {
        streamEvents.push(
          event as { type?: string; delta?: string; text?: string },
        );
      },
    });

    assertEquals(
      result?.updatedState?.meta?.["codex.threadId"],
      "thread-rsp-app",
    );
    assertEquals(
      streamEvents.filter((event) =>
        event.type === "response.output_text.delta"
      )
        .map((event) => event.delta),
      ["one ", "two"],
    );
    assertEquals(
      streamEvents.filter((event) => event.type === "response.output_text.done")
        .map((event) => event.text),
      ["one two"],
    );
  } finally {
    if (priorTransport === undefined) {
      Deno.env.delete("GAMBIT_CODEX_TRANSPORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_TRANSPORT", priorTransport);
    }
  }
});

Deno.test("codex provider app-server fails fast when the child exits before turn completion", async () => {
  const priorTransport = Deno.env.get("GAMBIT_CODEX_TRANSPORT");
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const root = await Deno.makeTempDir({
    prefix: "codex-app-server-exit-",
  });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

mode=""
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
done

[ "$mode" = "app-server" ] || exit 64

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"thread/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"thread":{"id":"thread-app-server-exit"}}}\\n' "$id"
      ;;
    *'"method":"turn/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"turn":{"id":"turn-app-server-exit","status":"inProgress","items":[],"error":null}}}\\n' "$id"
      printf 'protocol failure\\n' >&2
      exit 17
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_TRANSPORT", "app-server");
  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  try {
    const provider = createCodexProvider();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      provider.chat({
        model: "codex-cli/default",
        messages: [{ role: "user", content: "hello" }],
      }).then(
        () => ({ kind: "resolved" as const }),
        (error) => ({ kind: "rejected" as const, error }),
      ),
      new Promise<{ kind: "timeout" }>((resolve) =>
        timeoutId = setTimeout(() => resolve({ kind: "timeout" }), 500)
      ),
    ]);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    assert(result.kind !== "timeout", "provider hung after app-server exit");
    if (result.kind !== "rejected") {
      throw new Error("provider unexpectedly resolved after app-server exit");
    }
    const error = result.error;
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "codex app-server failed: protocol failure",
    );
  } finally {
    if (priorTransport === undefined) {
      Deno.env.delete("GAMBIT_CODEX_TRANSPORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_TRANSPORT", priorTransport);
    }
    if (priorBin === undefined) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex provider app-server fails fast when the child exits before initialize completes", async () => {
  const priorTransport = Deno.env.get("GAMBIT_CODEX_TRANSPORT");
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const root = await Deno.makeTempDir({
    prefix: "codex-app-server-init-exit-",
  });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu
printf 'startup failure\\n' >&2
exit 23
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_TRANSPORT", "app-server");
  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  try {
    const provider = createCodexProvider();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      provider.chat({
        model: "codex-cli/default",
        messages: [{ role: "user", content: "hello" }],
      }).then(
        () => ({ kind: "resolved" as const }),
        (error) => ({ kind: "rejected" as const, error }),
      ),
      new Promise<{ kind: "timeout" }>((resolve) =>
        timeoutId = setTimeout(() => resolve({ kind: "timeout" }), 500)
      ),
    ]);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    assert(
      result.kind !== "timeout",
      "provider hung after app-server init exit",
    );
    if (result.kind !== "rejected") {
      throw new Error(
        "provider unexpectedly resolved after app-server init exit",
      );
    }
    const error = result.error;
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "codex app-server failed: startup failure",
    );
  } finally {
    if (priorTransport === undefined) {
      Deno.env.delete("GAMBIT_CODEX_TRANSPORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_TRANSPORT", priorTransport);
    }
    if (priorBin === undefined) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex provider app-server sends initialized with empty params", async () => {
  const priorTransport = Deno.env.get("GAMBIT_CODEX_TRANSPORT");
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const root = await Deno.makeTempDir({
    prefix: "codex-app-server-initialized-",
  });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

mode=""
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
done

[ "$mode" = "app-server" ] || exit 64

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      printf '%s\\n' "$line" | grep '"params":{}' >/dev/null 2>&1 || {
        printf 'initialized missing params\\n' >&2
        exit 31
      }
      ;;
    *'"method":"thread/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"thread":{"id":"thread-app-server-init-ok"}}}\\n' "$id"
      ;;
    *'"method":"turn/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"turn":{"id":"turn-app-server-init-ok","status":"inProgress","items":[],"error":null}}}\\n' "$id"
      printf '{"method":"item/completed","params":{"threadId":"thread-app-server-init-ok","turnId":"turn-app-server-init-ok","item":{"type":"agentMessage","id":"msg-init-ok","text":"hello world","phase":null,"memoryCitation":null}}}\\n'
      printf '{"method":"turn/completed","params":{"threadId":"thread-app-server-init-ok","turn":{"id":"turn-app-server-init-ok","status":"completed","items":[],"error":null,"startedAt":0,"completedAt":0,"durationMs":1}}}\\n'
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_TRANSPORT", "app-server");
  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  try {
    const provider = createCodexProvider();
    const result = await provider.chat({
      model: "codex-cli/default",
      messages: [{ role: "user", content: "hello" }],
    });
    assertEquals(result.message.content, "hello world");
  } finally {
    if (priorTransport === undefined) {
      Deno.env.delete("GAMBIT_CODEX_TRANSPORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_TRANSPORT", priorTransport);
    }
    if (priorBin === undefined) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex provider app-server surfaces server requests in stream events", async () => {
  const priorTransport = Deno.env.get("GAMBIT_CODEX_TRANSPORT");
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const root = await Deno.makeTempDir({
    prefix: "codex-app-server-request-trace-",
  });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

mode=""
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
done

[ "$mode" = "app-server" ] || exit 64

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"thread/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"thread":{"id":"thread-app-server-request-trace"}}}\\n' "$id"
      ;;
    *'"method":"turn/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"turn":{"id":"turn-app-server-request-trace","status":"inProgress","items":[],"error":null}}}\\n' "$id"
      printf '{"id":"req-app-server-request-trace","method":"mcpToolCall/approval","params":{"toolName":"draft_assistant_task"}}\\n'
      printf '{"method":"item/completed","params":{"threadId":"thread-app-server-request-trace","turnId":"turn-app-server-request-trace","item":{"type":"agentMessage","id":"msg-app-server-request-trace","text":"hello world","phase":null,"memoryCitation":null}}}\\n'
      printf '{"method":"turn/completed","params":{"threadId":"thread-app-server-request-trace","turn":{"id":"turn-app-server-request-trace","status":"completed","items":[],"error":null,"startedAt":0,"completedAt":0,"durationMs":1}}}\\n'
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_TRANSPORT", "app-server");
  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  try {
    const provider = createCodexProvider();
    const events: Array<Record<string, unknown>> = [];
    const result = await provider.chat({
      model: "codex-cli/default",
      messages: [{ role: "user", content: "hello" }],
      onStreamEvent: (event) => {
        events.push(event as unknown as Record<string, unknown>);
      },
    });
    assertEquals(result.message.content, "hello world");
    assertEquals(
      events.some((event) =>
        event.type === "app_server.request" &&
        event.method === "mcpToolCall/approval"
      ),
      true,
    );
  } finally {
    if (priorTransport === undefined) {
      Deno.env.delete("GAMBIT_CODEX_TRANSPORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_TRANSPORT", priorTransport);
    }
    if (priorBin === undefined) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex provider app-server auto-accepts empty MCP elicitation forms", async () => {
  const priorTransport = Deno.env.get("GAMBIT_CODEX_TRANSPORT");
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const root = await Deno.makeTempDir({
    prefix: "codex-app-server-mcp-elicitation-",
  });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

require_substring() {
  line="$1"
  needle="$2"
  if ! printf '%s' "$line" | grep -F -- "$needle" >/dev/null 2>&1; then
    printf 'missing substring: %s\\nline: %s\\n' "$needle" "$line" >&2
    exit 46
  fi
}

mode=""
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
done

[ "$mode" = "app-server" ] || exit 64

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"thread/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"thread":{"id":"thread-app-server-mcp-elicitation"}}}\\n' "$id"
      ;;
    *'"method":"turn/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"turn":{"id":"turn-app-server-mcp-elicitation","status":"inProgress","items":[],"error":null}}}\\n' "$id"
      printf '{"id":0,"method":"mcpServer/elicitation/request","params":{"serverName":"gambit","threadId":"thread-app-server-mcp-elicitation","turnId":"turn-app-server-mcp-elicitation","mode":"form","message":"Allow tool?","requestedSchema":{"type":"object","properties":{}}}}\\n'
      IFS= read -r response
      require_substring "$response" '"id":0'
      require_substring "$response" '"result":{"action":"accept","content":{}}'
      printf '{"method":"item/completed","params":{"threadId":"thread-app-server-mcp-elicitation","turnId":"turn-app-server-mcp-elicitation","item":{"type":"agentMessage","id":"msg-app-server-mcp-elicitation","text":"hello world","phase":null,"memoryCitation":null}}}\\n'
      printf '{"method":"turn/completed","params":{"threadId":"thread-app-server-mcp-elicitation","turn":{"id":"turn-app-server-mcp-elicitation","status":"completed","items":[],"error":null,"startedAt":0,"completedAt":0,"durationMs":1}}}\\n'
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_TRANSPORT", "app-server");
  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  try {
    const provider = createCodexProvider();
    const result = await provider.chat({
      model: "codex-cli/default",
      messages: [{ role: "user", content: "hello" }],
    });
    assertEquals(result.message.content, "hello world");
  } finally {
    if (priorTransport === undefined) {
      Deno.env.delete("GAMBIT_CODEX_TRANSPORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_TRANSPORT", priorTransport);
    }
    if (priorBin === undefined) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex provider app-server forwards fresh system prompt as spawn-time developer instructions", async () => {
  const priorTransport = Deno.env.get("GAMBIT_CODEX_TRANSPORT");
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const root = await Deno.makeTempDir({
    prefix: "codex-app-server-developer-instructions-",
  });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

mode=""
saw_developer_instructions="0"
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
  case "$arg" in
    *'developer_instructions="deck system prompt"'*)
      saw_developer_instructions="1"
      ;;
  esac
done

[ "$mode" = "app-server" ] || exit 64
[ "$saw_developer_instructions" = "1" ] || {
  printf 'spawn args missing deck system prompt developer instructions\\n' >&2
  exit 41
}

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"thread/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"thread":{"id":"thread-app-server-developer-instructions"}}}\\n' "$id"
      ;;
    *'"method":"turn/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"turn":{"id":"turn-app-server-developer-instructions","status":"inProgress","items":[],"error":null}}}\\n' "$id"
      printf '{"method":"item/completed","params":{"threadId":"thread-app-server-developer-instructions","turnId":"turn-app-server-developer-instructions","item":{"type":"agentMessage","id":"msg-developer-instructions","text":"hello world","phase":null,"memoryCitation":null}}}\\n'
      printf '{"method":"turn/completed","params":{"threadId":"thread-app-server-developer-instructions","turn":{"id":"turn-app-server-developer-instructions","status":"completed","items":[],"error":null,"startedAt":0,"completedAt":0,"durationMs":1}}}\\n'
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_TRANSPORT", "app-server");
  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  try {
    const provider = createCodexProvider();
    const result = await provider.chat({
      model: "codex-cli/default",
      messages: [
        { role: "system", content: "deck system prompt" },
        { role: "user", content: "hello" },
      ],
    });
    assertEquals(result.message.content, "hello world");
  } finally {
    if (priorTransport === undefined) {
      Deno.env.delete("GAMBIT_CODEX_TRANSPORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_TRANSPORT", priorTransport);
    }
    if (priorBin === undefined) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex provider preserves multiple assistant message items in order", async () => {
  const streamEvents: Array<
    {
      type?: string;
      item_id?: string;
      output_index?: number;
      item?: { id?: string; type?: string };
    }
  > = [];
  const provider = createCodexProvider({
    runAppServerTurn: (input) => {
      const events: Array<Record<string, JSONValue>> = [
        {
          type: "item.delta",
          item: { id: "msg_1", type: "agent_message", text: "first " },
        },
        {
          type: "item.completed",
          item: { id: "msg_1", type: "agent_message", text: "first reply" },
        },
        {
          type: "item.delta",
          item: { id: "msg_2", type: "agent_message", text: "second " },
        },
        {
          type: "item.completed",
          item: { id: "msg_2", type: "agent_message", text: "second reply" },
        },
      ];
      events.forEach((event) => input.onStreamEvent?.(event));
      return Promise.resolve({
        threadId: "thread-multi",
        assistantMessages: [
          { itemId: "msg_1", text: "first reply" },
          { itemId: "msg_2", text: "second reply" },
        ],
      });
    },
  });

  const result = await provider.responses?.({
    request: {
      model: "codex-cli/default",
      stream: true,
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      }],
    },
    onStreamEvent: (event) => {
      streamEvents.push(
        event as {
          type?: string;
          item_id?: string;
          output_index?: number;
          item?: { id?: string; type?: string };
        },
      );
    },
  });

  assertEquals(
    result?.output
      .filter((item) => item.type === "message")
      .map((item) =>
        item.type === "message"
          ? {
            id: item.id,
            text: item.content.map((part) => part.text).join(""),
          }
          : null
      ),
    [
      { id: "msg_1", text: "first reply" },
      { id: "msg_2", text: "second reply" },
    ],
  );
  assertEquals(
    streamEvents
      .filter((event) => event.type === "response.output_text.delta")
      .map((event) => ({
        item_id: event.item_id,
        output_index: event.output_index,
      })),
    [
      { item_id: "msg_1", output_index: 0 },
      { item_id: "msg_2", output_index: 1 },
    ],
  );
  assertEquals(
    streamEvents
      .filter((event) => event.type === "response.output_item.done")
      .map((event) => event.item?.id),
    ["msg_1", "msg_2"],
  );
});

Deno.test("codex provider requires assistant item ids from codex", async () => {
  const provider = createCodexProvider({
    runAppServerTurn: () =>
      Promise.reject(
        new Error(
          "Codex item.delta agent_message is missing required item.id.",
        ),
      ),
  });

  await assertRejects(
    async () => {
      await provider.responses?.({
        request: {
          model: "codex-cli/default",
          stream: true,
          input: [{
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hi" }],
          }],
        },
      });
    },
    Error,
    "missing required item.id",
  );
});

Deno.test("codex provider streams completed-only assistant text once", async () => {
  const streamedText: Array<string> = [];
  const provider = createCodexProvider({
    runAppServerTurn: (input) => {
      const events: Array<Record<string, JSONValue>> = [
        {
          type: "item.completed",
          item: { id: "msg_1", type: "agent_message", text: "hello world" },
        },
      ];
      events.forEach((event) => input.onStreamEvent?.(event));
      return Promise.resolve({
        threadId: "thread-completed-only",
        assistantMessages: [{ itemId: "msg_1", text: "hello world" }],
      });
    },
  });

  await provider.chat({
    model: "codex-cli/default",
    stream: true,
    messages: [{ role: "user", content: "hi" }],
    onStreamText: (text) => streamedText.push(text),
  });

  assertEquals(streamedText, ["hello world"]);
});

Deno.test("codex provider emits tool traces for mcp tool events", async () => {
  const traces: Array<ProviderTraceEvent> = [];
  const provider = createCodexProvider({
    runAppServerTurn: (input) => {
      const events: Array<Record<string, JSONValue>> = [
        {
          type: "item.started",
          item: {
            id: "tool_1",
            type: "mcp_tool_call",
            server: "gambit",
            tool: "bot_list",
            arguments: { path: ".", recursive: false },
            status: "in_progress",
            result: null,
            error: null,
          },
        },
        {
          type: "item.completed",
          item: {
            id: "tool_1",
            type: "mcp_tool_call",
            server: "gambit",
            tool: "bot_list",
            arguments: { path: ".", recursive: false },
            status: "completed",
            result: { content: [{ type: "text", text: "ok" }] },
            error: null,
          },
        },
        {
          type: "item.completed",
          item: { id: "msg_done", type: "agent_message", text: "done" },
        },
      ];
      events.forEach((event) => input.onStreamEvent?.(event));
      return Promise.resolve({
        threadId: "thread-tool-events",
        assistantMessages: [{ itemId: "msg_done", text: "done" }],
      });
    },
  });

  const result = await provider.chat({
    model: "codex-cli/default",
    messages: [{ role: "user", content: "hello" }],
    onTraceEvent: (event) => traces.push(event),
  });

  assertEquals(result.message.content, "done");
  const toolCalls = traces.filter((event) =>
    event.type === "tool.call"
  ) as Array<Extract<ProviderTraceEvent, { type: "tool.call" }>>;
  const toolResults = traces.filter((event) =>
    event.type === "tool.result"
  ) as Array<Extract<ProviderTraceEvent, { type: "tool.result" }>>;
  assertEquals(toolCalls.length, 1);
  assertEquals(toolResults.length, 1);
  assertEquals(toolCalls[0].actionCallId, "tool_1");
  assertEquals(toolResults[0].actionCallId, "tool_1");
  assertEquals(toolCalls[0].toolKind, "mcp_bridge");
  assertEquals(toolResults[0].toolKind, "mcp_bridge");
  assertEquals(toolCalls[0].args, { path: ".", recursive: false });
  assertEquals(
    toolResults[0].result,
    {
      server: "gambit",
      status: "completed",
      result: { content: [{ type: "text", text: "ok" }] },
      error: null,
    },
  );
});

Deno.test("codex provider emits tool traces for command execution events", async () => {
  const traces: Array<ProviderTraceEvent> = [];
  const provider = createCodexProvider({
    runAppServerTurn: (input) => {
      const events: Array<Record<string, JSONValue>> = [
        {
          type: "item.started",
          item: {
            id: "item_1",
            type: "command_execution",
            command: "/bin/bash -lc ls",
            aggregated_output: "",
            exit_code: null,
            status: "in_progress",
          },
        },
        {
          type: "item.completed",
          item: {
            id: "item_1",
            type: "command_execution",
            command: "/bin/bash -lc ls",
            aggregated_output: "INTENT.md\nPROMPT.md\n",
            exit_code: 0,
            status: "completed",
          },
        },
        {
          type: "item.completed",
          item: { id: "msg_done", type: "agent_message", text: "done" },
        },
      ];
      events.forEach((event) => input.onStreamEvent?.(event));
      return Promise.resolve({
        threadId: "thread-command-events",
        assistantMessages: [{ itemId: "msg_done", text: "done" }],
      });
    },
  });

  const result = await provider.chat({
    model: "codex-cli/default",
    messages: [{ role: "user", content: "hello" }],
    onTraceEvent: (event) => traces.push(event),
  });

  assertEquals(result.message.content, "done");
  const toolCalls = traces.filter((event) =>
    event.type === "tool.call"
  ) as Array<Extract<ProviderTraceEvent, { type: "tool.call" }>>;
  const toolResults = traces.filter((event) =>
    event.type === "tool.result"
  ) as Array<Extract<ProviderTraceEvent, { type: "tool.result" }>>;
  assertEquals(toolCalls.length, 1);
  assertEquals(toolResults.length, 1);
  assertEquals(toolCalls[0].actionCallId, "item_1");
  assertEquals(toolResults[0].actionCallId, "item_1");
  assertEquals(toolCalls[0].name, "command_execution");
  assertEquals(toolResults[0].name, "command_execution");
  assertEquals(toolCalls[0].toolKind, "mcp_bridge");
  assertEquals(toolResults[0].toolKind, "mcp_bridge");
  assertEquals(toolCalls[0].args, { command: "/bin/bash -lc ls" });
  assertEquals(
    toolResults[0].result,
    {
      command: "/bin/bash -lc ls",
      status: "completed",
      output: "INTENT.md\nPROMPT.md\n",
      exit_code: 0,
    },
  );
});

Deno.test("codex provider emits in-progress tool results for command execution deltas", async () => {
  const traces: Array<ProviderTraceEvent> = [];
  const provider = createCodexProvider({
    runAppServerTurn: (input) => {
      const events: Array<Record<string, JSONValue>> = [
        {
          type: "item.started",
          item: {
            id: "item_progress",
            type: "command_execution",
            command: "/bin/bash -lc ls",
            aggregated_output: "",
            exit_code: null,
            status: "in_progress",
          },
        },
        {
          type: "item.delta",
          item: {
            id: "item_progress",
            type: "command_execution",
            command: "/bin/bash -lc ls",
            aggregated_output: "apps\n",
            exit_code: null,
            status: "in_progress",
          },
        },
        {
          type: "item.completed",
          item: {
            id: "item_progress",
            type: "command_execution",
            command: "/bin/bash -lc ls",
            aggregated_output: "apps\npackages\n",
            exit_code: 0,
            status: "completed",
          },
        },
        {
          type: "item.completed",
          item: { id: "msg_done", type: "agent_message", text: "done" },
        },
      ];
      events.forEach((event) => input.onStreamEvent?.(event));
      return Promise.resolve({
        threadId: "thread-command-progress",
        assistantMessages: [{ itemId: "msg_done", text: "done" }],
      });
    },
  });

  await provider.chat({
    model: "codex-cli/default",
    messages: [{ role: "user", content: "hello" }],
    onTraceEvent: (event) => traces.push(event),
  });

  const toolResults = traces.filter((event) =>
    event.type === "tool.result"
  ) as Array<Extract<ProviderTraceEvent, { type: "tool.result" }>>;
  assertEquals(toolResults.length, 2);
  assertEquals(toolResults[0]?.result, {
    command: "/bin/bash -lc ls",
    status: "in_progress",
    output: "apps\n",
    exit_code: null,
  });
  assertEquals(toolResults[1]?.result, {
    command: "/bin/bash -lc ls",
    status: "completed",
    output: "apps\npackages\n",
    exit_code: 0,
  });
});

Deno.test("codex provider emits tool traces for file change events", async () => {
  const traces: Array<ProviderTraceEvent> = [];
  const provider = createCodexProvider({
    runAppServerTurn: (input) => {
      const events: Array<Record<string, JSONValue>> = [
        {
          type: "item.completed",
          item: {
            id: "item_2",
            type: "file_change",
            changes: [{
              path: "/tmp/PROMPT.md",
              kind: "update",
            }],
            status: "completed",
          },
        },
        {
          type: "item.completed",
          item: { id: "msg_done", type: "agent_message", text: "done" },
        },
      ];
      events.forEach((event) => input.onStreamEvent?.(event));
      return Promise.resolve({
        threadId: "thread-file-change",
        assistantMessages: [{ itemId: "msg_done", text: "done" }],
      });
    },
  });

  const result = await provider.chat({
    model: "codex-cli/default",
    messages: [{ role: "user", content: "hello" }],
    onTraceEvent: (event) => traces.push(event),
  });

  assertEquals(result.message.content, "done");
  const toolCalls = traces.filter((event) =>
    event.type === "tool.call"
  ) as Array<Extract<ProviderTraceEvent, { type: "tool.call" }>>;
  const toolResults = traces.filter((event) =>
    event.type === "tool.result"
  ) as Array<Extract<ProviderTraceEvent, { type: "tool.result" }>>;
  assertEquals(toolCalls.length, 1);
  assertEquals(toolResults.length, 1);
  assertEquals(toolCalls[0].actionCallId, "item_2");
  assertEquals(toolResults[0].actionCallId, "item_2");
  assertEquals(toolCalls[0].name, "file_change");
  assertEquals(toolResults[0].name, "file_change");
  assertEquals(toolCalls[0].toolKind, "mcp_bridge");
  assertEquals(toolResults[0].toolKind, "mcp_bridge");
  assertEquals(toolCalls[0].args, {
    changes: [{ path: "/tmp/PROMPT.md", kind: "update" }],
  });
  assertEquals(toolResults[0].result, {
    status: "completed",
    changes: [{ path: "/tmp/PROMPT.md", kind: "update" }],
  });
});

Deno.test("codex provider adds mcp config args by default", () => {
  const previousEnable = Deno.env.get("GAMBIT_CODEX_ENABLE_MCP");
  const previousDisable = Deno.env.get("GAMBIT_CODEX_DISABLE_MCP");
  Deno.env.delete("GAMBIT_CODEX_ENABLE_MCP");
  Deno.env.delete("GAMBIT_CODEX_DISABLE_MCP");
  try {
    const args = codexConfigArgsForTest({
      cwd: "/tmp/test-cwd",
      deckPath: "/tmp/root/PROMPT.md",
    });
    const joined = args.join(" ");
    assertEquals(joined.includes("mcp_servers.gambit.command"), true);
    assertEquals(joined.includes("mcp_servers.gambit.args"), true);
    assertEquals(joined.includes("mcp_servers.gambit.cwd"), true);
    assertEquals(
      joined.includes("mcp_servers.gambit.env.GAMBIT_BOT_ROOT"),
      true,
    );
    assertEquals(
      joined.includes("mcp_servers.gambit.env.GAMBIT_MCP_ROOT_DECK_PATH"),
      true,
    );
  } finally {
    if (previousEnable === undefined) {
      Deno.env.delete("GAMBIT_CODEX_ENABLE_MCP");
    } else {
      Deno.env.set("GAMBIT_CODEX_ENABLE_MCP", previousEnable);
    }
    if (previousDisable === undefined) {
      Deno.env.delete("GAMBIT_CODEX_DISABLE_MCP");
    } else {
      Deno.env.set("GAMBIT_CODEX_DISABLE_MCP", previousDisable);
    }
  }
});

Deno.test("codex provider app-server adds --yolo when sandbox config is skipped", async () => {
  const priorTransport = Deno.env.get("GAMBIT_CODEX_TRANSPORT");
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const priorSkip = Deno.env.get("GAMBIT_CODEX_SKIP_SANDBOX_CONFIG");
  const root = await Deno.makeTempDir({
    prefix: "codex-app-server-yolo-",
  });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

require_substring() {
  line="$1"
  needle="$2"
  if ! printf '%s' "$line" | grep -F -- "$needle" >/dev/null 2>&1; then
    printf 'missing substring: %s\\nline: %s\\n' "$needle" "$line" >&2
    exit 44
  fi
}

mode=""
saw_yolo="0"
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
  if [ "$arg" = "--yolo" ]; then
    saw_yolo="1"
  fi
done

[ "$mode" = "app-server" ] || exit 64
[ "$saw_yolo" = "1" ] || {
  printf 'spawn args missing --yolo\\n' >&2
  exit 42
}

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"thread/start"'*)
      require_substring "$line" '"sandbox":"danger-full-access"'
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"thread":{"id":"thread-app-server-yolo"}}}\\n' "$id"
      ;;
    *'"method":"turn/start"'*)
      require_substring "$line" '"sandboxPolicy":{"type":"dangerFullAccess"}'
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"turn":{"id":"turn-app-server-yolo","status":"inProgress","items":[],"error":null}}}\\n' "$id"
      printf '{"method":"item/completed","params":{"threadId":"thread-app-server-yolo","turnId":"turn-app-server-yolo","item":{"type":"agentMessage","id":"msg-app-server-yolo","text":"hello world","phase":null,"memoryCitation":null}}}\\n'
      printf '{"method":"turn/completed","params":{"threadId":"thread-app-server-yolo","turn":{"id":"turn-app-server-yolo","status":"completed","items":[],"error":null,"startedAt":0,"completedAt":0,"durationMs":1}}}\\n'
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_TRANSPORT", "app-server");
  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  Deno.env.set("GAMBIT_CODEX_SKIP_SANDBOX_CONFIG", "1");
  try {
    const provider = createCodexProvider();
    const result = await provider.chat({
      model: "codex-cli/default",
      messages: [{ role: "user", content: "hello" }],
    });
    assertEquals(result.message.content, "hello world");
  } finally {
    if (priorTransport === undefined) {
      Deno.env.delete("GAMBIT_CODEX_TRANSPORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_TRANSPORT", priorTransport);
    }
    if (priorBin === undefined) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    if (priorSkip === undefined) {
      Deno.env.delete("GAMBIT_CODEX_SKIP_SANDBOX_CONFIG");
    } else {
      Deno.env.set("GAMBIT_CODEX_SKIP_SANDBOX_CONFIG", priorSkip);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex provider app-server adds dangerous bypass when configured", async () => {
  const priorTransport = Deno.env.get("GAMBIT_CODEX_TRANSPORT");
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const priorBypass = Deno.env.get(
    "GAMBIT_CODEX_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX",
  );
  const root = await Deno.makeTempDir({
    prefix: "codex-app-server-dangerous-bypass-",
  });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

require_substring() {
  line="$1"
  needle="$2"
  if ! printf '%s' "$line" | grep -F -- "$needle" >/dev/null 2>&1; then
    printf 'missing substring: %s\\nline: %s\\n' "$needle" "$line" >&2
    exit 45
  fi
}

mode=""
saw_bypass="0"
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
  if [ "$arg" = "--dangerously-bypass-approvals-and-sandbox" ]; then
    saw_bypass="1"
  fi
done

[ "$mode" = "app-server" ] || exit 64
[ "$saw_bypass" = "1" ] || {
  printf 'spawn args missing dangerous bypass flag\\n' >&2
  exit 43
}

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"thread/start"'*)
      require_substring "$line" '"sandbox":"danger-full-access"'
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"thread":{"id":"thread-app-server-dangerous-bypass"}}}\\n' "$id"
      ;;
    *'"method":"turn/start"'*)
      require_substring "$line" '"sandboxPolicy":{"type":"dangerFullAccess"}'
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"turn":{"id":"turn-app-server-dangerous-bypass","status":"inProgress","items":[],"error":null}}}\\n' "$id"
      printf '{"method":"item/completed","params":{"threadId":"thread-app-server-dangerous-bypass","turnId":"turn-app-server-dangerous-bypass","item":{"type":"agentMessage","id":"msg-app-server-dangerous-bypass","text":"hello world","phase":null,"memoryCitation":null}}}\\n'
      printf '{"method":"turn/completed","params":{"threadId":"thread-app-server-dangerous-bypass","turn":{"id":"turn-app-server-dangerous-bypass","status":"completed","items":[],"error":null,"startedAt":0,"completedAt":0,"durationMs":1}}}\\n'
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_TRANSPORT", "app-server");
  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  Deno.env.set(
    "GAMBIT_CODEX_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX",
    "1",
  );
  try {
    const provider = createCodexProvider();
    const result = await provider.chat({
      model: "codex-cli/default",
      messages: [{ role: "user", content: "hello" }],
    });
    assertEquals(result.message.content, "hello world");
  } finally {
    if (priorTransport === undefined) {
      Deno.env.delete("GAMBIT_CODEX_TRANSPORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_TRANSPORT", priorTransport);
    }
    if (priorBin === undefined) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    if (priorBypass === undefined) {
      Deno.env.delete("GAMBIT_CODEX_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX");
    } else {
      Deno.env.set(
        "GAMBIT_CODEX_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX",
        priorBypass,
      );
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex provider app-server requests workspace-write sandbox by default", async () => {
  const priorTransport = Deno.env.get("GAMBIT_CODEX_TRANSPORT");
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const priorBotRoot = Deno.env.get("GAMBIT_BOT_ROOT");
  const root = await Deno.makeTempDir({
    prefix: "codex-app-server-workspace-write-",
  });
  const workspaceRoot = join(root, "workspace");
  await Deno.mkdir(workspaceRoot, { recursive: true });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

require_substring() {
  line="$1"
  needle="$2"
  if ! printf '%s' "$line" | grep -F -- "$needle" >/dev/null 2>&1; then
    printf 'missing substring: %s\\nline: %s\\n' "$needle" "$line" >&2
    exit 46
  fi
}

mode=""
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
done

[ "$mode" = "app-server" ] || exit 64

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"thread/start"'*)
      require_substring "$line" '"sandbox":"workspace-write"'
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"thread":{"id":"thread-app-server-workspace-write"}}}\\n' "$id"
      ;;
    *'"method":"turn/start"'*)
      require_substring "$line" '"sandboxPolicy":{"type":"workspaceWrite","writableRoots":["${workspaceRoot}"]}'
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"turn":{"id":"turn-app-server-workspace-write","status":"inProgress","items":[],"error":null}}}\\n' "$id"
      printf '{"method":"item/completed","params":{"threadId":"thread-app-server-workspace-write","turnId":"turn-app-server-workspace-write","item":{"type":"agentMessage","id":"msg-app-server-workspace-write","text":"hello world","phase":null,"memoryCitation":null}}}\\n'
      printf '{"method":"turn/completed","params":{"threadId":"thread-app-server-workspace-write","turn":{"id":"turn-app-server-workspace-write","status":"completed","items":[],"error":null,"startedAt":0,"completedAt":0,"durationMs":1}}}\\n'
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_TRANSPORT", "app-server");
  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  Deno.env.set("GAMBIT_BOT_ROOT", workspaceRoot);
  try {
    const provider = createCodexProvider();
    const result = await provider.chat({
      model: "codex-cli/default",
      messages: [{ role: "user", content: "hello" }],
    });
    assertEquals(result.message.content, "hello world");
  } finally {
    if (priorTransport === undefined) {
      Deno.env.delete("GAMBIT_CODEX_TRANSPORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_TRANSPORT", priorTransport);
    }
    if (priorBin === undefined) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    if (priorBotRoot === undefined) {
      Deno.env.delete("GAMBIT_BOT_ROOT");
    } else {
      Deno.env.set("GAMBIT_BOT_ROOT", priorBotRoot);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex provider app-server uses deck directory as cwd when provided", async () => {
  const priorTransport = Deno.env.get("GAMBIT_CODEX_TRANSPORT");
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const priorBotRoot = Deno.env.get("GAMBIT_BOT_ROOT");
  const root = await Deno.makeTempDir({
    prefix: "codex-app-server-deck-cwd-",
  });
  const workspaceRoot = join(root, "workspace");
  const unrelatedRoot = join(root, "repo-root");
  const deckPath = join(workspaceRoot, "MANAGER.md");
  await Deno.mkdir(workspaceRoot, { recursive: true });
  await Deno.mkdir(unrelatedRoot, { recursive: true });
  await Deno.writeTextFile(deckPath, "Deck prompt");
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

require_substring() {
  line="$1"
  needle="$2"
  if ! printf '%s' "$line" | grep -F -- "$needle" >/dev/null 2>&1; then
    printf 'missing substring: %s\\nline: %s\\n' "$needle" "$line" >&2
    exit 46
  fi
}

joined="$*"
require_substring "$joined" 'mcp_servers.gambit.cwd="${workspaceRoot}"'
require_substring "$joined" 'mcp_servers.gambit.env.GAMBIT_BOT_ROOT="${workspaceRoot}"'
require_substring "$joined" 'sandbox_workspace_write.writable_roots=["${workspaceRoot}"]'

mode=""
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
done

[ "$mode" = "app-server" ] || exit 64

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"thread/start"'*)
      require_substring "$line" '"cwd":"${workspaceRoot}"'
      require_substring "$line" '"sandbox":"workspace-write"'
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"thread":{"id":"thread-app-server-deck-cwd"}}}\\n' "$id"
      ;;
    *'"method":"turn/start"'*)
      require_substring "$line" '"cwd":"${workspaceRoot}"'
      require_substring "$line" '"sandboxPolicy":{"type":"workspaceWrite","writableRoots":["${workspaceRoot}"]}'
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"turn":{"id":"turn-app-server-deck-cwd","status":"inProgress","items":[],"error":null}}}\\n' "$id"
      printf '{"method":"item/completed","params":{"threadId":"thread-app-server-deck-cwd","turnId":"turn-app-server-deck-cwd","item":{"type":"agentMessage","id":"msg-app-server-deck-cwd","text":"hello workspace","phase":null,"memoryCitation":null}}}\\n'
      printf '{"method":"turn/completed","params":{"threadId":"thread-app-server-deck-cwd","turn":{"id":"turn-app-server-deck-cwd","status":"completed","items":[],"error":null,"startedAt":0,"completedAt":0,"durationMs":1}}}\\n'
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_TRANSPORT", "app-server");
  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  Deno.env.set("GAMBIT_BOT_ROOT", unrelatedRoot);
  try {
    const provider = createCodexProvider();
    const result = await provider.chat({
      model: "codex-cli/default",
      deckPath,
      messages: [{ role: "user", content: "hello" }],
    });
    assertEquals(result.message.content, "hello workspace");
  } finally {
    if (priorTransport === undefined) {
      Deno.env.delete("GAMBIT_CODEX_TRANSPORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_TRANSPORT", priorTransport);
    }
    if (priorBin === undefined) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    if (priorBotRoot === undefined) {
      Deno.env.delete("GAMBIT_BOT_ROOT");
    } else {
      Deno.env.set("GAMBIT_BOT_ROOT", priorBotRoot);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex provider configures workspace-write sandbox automatically", () => {
  const args = codexConfigArgsForTest({
    cwd: "/tmp/test-cwd",
  });
  const joined = args.join(" ");
  assertEquals(joined.includes('approval_policy="never"'), true);
  assertEquals(joined.includes("project_doc_max_bytes="), false);
  assertEquals(joined.includes('sandbox_mode="workspace-write"'), true);
  assertEquals(
    joined.includes('sandbox_workspace_write.writable_roots=["/tmp/test-cwd"]'),
    true,
  );
});

Deno.test("codex provider derives sandbox and MCP roots from deck path when cwd is absent", () => {
  const priorBotRoot = Deno.env.get("GAMBIT_BOT_ROOT");
  Deno.env.set("GAMBIT_BOT_ROOT", "/tmp/repo-root");
  try {
    const args = codexConfigArgsForTest({
      cwd: "/tmp/workspace",
      deckPath: "/tmp/workspace/MANAGER.md",
    });
    const joined = args.join(" ");
    assertEquals(
      joined.includes(
        'sandbox_workspace_write.writable_roots=["/tmp/workspace"]',
      ),
      true,
    );
    assertEquals(
      joined.includes('mcp_servers.gambit.cwd="/tmp/workspace"'),
      true,
    );
    assertEquals(
      joined.includes(
        'mcp_servers.gambit.env.GAMBIT_BOT_ROOT="/tmp/workspace"',
      ),
      true,
    );
  } finally {
    if (priorBotRoot === undefined) {
      Deno.env.delete("GAMBIT_BOT_ROOT");
    } else {
      Deno.env.set("GAMBIT_BOT_ROOT", priorBotRoot);
    }
  }
});

Deno.test("codex provider uses dangerous bypass instead of yolo when configured", () => {
  const previous = Deno.env.get(
    "GAMBIT_CODEX_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX",
  );
  Deno.env.set(
    "GAMBIT_CODEX_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX",
    "1",
  );
  try {
    const args = codexConfigArgsForTest({
      cwd: "/tmp/test-cwd",
    });
    const joined = args.join(" ");
    assertEquals(joined.includes('approval_policy="never"'), true);
    assertEquals(joined.includes('sandbox_mode="workspace-write"'), false);
    assertEquals(
      joined.includes("sandbox_workspace_write.writable_roots"),
      false,
    );
  } finally {
    if (previous === undefined) {
      Deno.env.delete("GAMBIT_CODEX_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX");
    } else {
      Deno.env.set(
        "GAMBIT_CODEX_DANGEROUSLY_BYPASS_APPROVALS_AND_SANDBOX",
        previous,
      );
    }
  }
});

Deno.test("codex provider forwards additionalParams.codex config entries", () => {
  const args = codexConfigArgsForTest({
    cwd: "/tmp/test-cwd",
    params: {
      codex: {
        project_doc_max_bytes: 0,
        profile: { name: "gambit" },
        project_root_markers: [".git", ".hg"],
      },
    },
  });
  const joined = args.join(" ");
  assertEquals(joined.includes("project_doc_max_bytes=0"), true);
  assertEquals(joined.includes('profile.name="gambit"'), true);
  assertEquals(joined.includes('project_root_markers=[".git", ".hg"]'), true);
});

Deno.test("codex provider skips sandbox config when yolo env is enabled", () => {
  const previous = Deno.env.get("GAMBIT_CODEX_SKIP_SANDBOX_CONFIG");
  Deno.env.set("GAMBIT_CODEX_SKIP_SANDBOX_CONFIG", "1");
  try {
    const args = codexConfigArgsForTest({
      cwd: "/tmp/test-cwd",
    });
    const joined = args.join(" ");
    assertEquals(joined.includes('approval_policy="never"'), true);
    assertEquals(joined.includes('sandbox_mode="workspace-write"'), false);
    assertEquals(
      joined.includes("sandbox_workspace_write.writable_roots"),
      false,
    );
  } finally {
    if (previous === undefined) {
      Deno.env.delete("GAMBIT_CODEX_SKIP_SANDBOX_CONFIG");
    } else {
      Deno.env.set("GAMBIT_CODEX_SKIP_SANDBOX_CONFIG", previous);
    }
  }
});

Deno.test("codex provider skips sandbox config when additionalParams.codex.skip_sandbox_config is true", () => {
  const args = codexConfigArgsForTest({
    cwd: "/tmp/test-cwd",
    params: {
      codex: {
        skip_sandbox_config: true,
      },
    },
  });
  const joined = args.join(" ");
  assertEquals(joined.includes('approval_policy="never"'), true);
  assertEquals(joined.includes('sandbox_mode="workspace-write"'), false);
  assertEquals(
    joined.includes("sandbox_workspace_write.writable_roots"),
    false,
  );
});

Deno.test("codex provider omits MCP root deck env when deck path is absent", () => {
  const args = codexConfigArgsForTest({
    cwd: "/tmp/test-cwd",
  });
  const joined = args.join(" ");
  assertEquals(
    joined.includes("mcp_servers.gambit.env.GAMBIT_MCP_ROOT_DECK_PATH"),
    false,
  );
});

Deno.test("codex provider omits mcp args when disable env is set", () => {
  const previousEnable = Deno.env.get("GAMBIT_CODEX_ENABLE_MCP");
  const previousDisable = Deno.env.get("GAMBIT_CODEX_DISABLE_MCP");
  Deno.env.set("GAMBIT_CODEX_ENABLE_MCP", "1");
  Deno.env.set("GAMBIT_CODEX_DISABLE_MCP", "1");
  try {
    const args = codexConfigArgsForTest({
      cwd: "/tmp/test-cwd",
    });
    const joined = args.join(" ");
    assertEquals(joined.includes("mcp_servers.gambit.command"), false);
  } finally {
    if (previousEnable === undefined) {
      Deno.env.delete("GAMBIT_CODEX_ENABLE_MCP");
    } else {
      Deno.env.set("GAMBIT_CODEX_ENABLE_MCP", previousEnable);
    }
    if (previousDisable === undefined) {
      Deno.env.delete("GAMBIT_CODEX_DISABLE_MCP");
    } else {
      Deno.env.set("GAMBIT_CODEX_DISABLE_MCP", previousDisable);
    }
  }
});

Deno.test("codex provider maps reasoning settings into codex config args", () => {
  const args = codexConfigArgsForTest({
    cwd: "/tmp/test-cwd",
    params: {
      reasoning: { effort: "high", summary: "detailed" },
      verbosity: "low",
    },
  });
  const joined = args.join(" ");
  assertEquals(joined.includes("model_reasoning_effort"), true);
  assertEquals(joined.includes("model_reasoning_summary"), true);
  assertEquals(joined.includes("model_verbosity"), true);
});

Deno.test("codex provider prefers call-time reasoning params over env vars", () => {
  const previousEffort = Deno.env.get("GAMBIT_CODEX_REASONING_EFFORT");
  const previousSummary = Deno.env.get("GAMBIT_CODEX_REASONING_SUMMARY");
  const previousVerbosity = Deno.env.get("GAMBIT_CODEX_VERBOSITY");
  Deno.env.set("GAMBIT_CODEX_REASONING_EFFORT", "low");
  Deno.env.set("GAMBIT_CODEX_REASONING_SUMMARY", "auto");
  Deno.env.set("GAMBIT_CODEX_VERBOSITY", "medium");
  try {
    const args = codexConfigArgsForTest({
      cwd: "/tmp/test-cwd",
      params: {
        reasoning: { effort: "high", summary: "detailed" },
        verbosity: "low",
      },
    });
    const joined = args.join(" ");
    assertEquals(joined.includes('model_reasoning_effort="high"'), true);
    assertEquals(joined.includes('model_reasoning_summary="detailed"'), true);
    assertEquals(joined.includes('model_verbosity="low"'), true);
    assertEquals(joined.includes('model_reasoning_effort="low"'), false);
    assertEquals(joined.includes('model_reasoning_summary="auto"'), false);
    assertEquals(joined.includes('model_verbosity="medium"'), false);
  } finally {
    if (previousEffort === undefined) {
      Deno.env.delete("GAMBIT_CODEX_REASONING_EFFORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_REASONING_EFFORT", previousEffort);
    }
    if (previousSummary === undefined) {
      Deno.env.delete("GAMBIT_CODEX_REASONING_SUMMARY");
    } else {
      Deno.env.set("GAMBIT_CODEX_REASONING_SUMMARY", previousSummary);
    }
    if (previousVerbosity === undefined) {
      Deno.env.delete("GAMBIT_CODEX_VERBOSITY");
    } else {
      Deno.env.set("GAMBIT_CODEX_VERBOSITY", previousVerbosity);
    }
  }
});

Deno.test("codex provider allows unvalidated reasoning env fallback values", () => {
  const previousEffort = Deno.env.get("GAMBIT_CODEX_REASONING_EFFORT");
  Deno.env.set("GAMBIT_CODEX_REASONING_EFFORT", "ultra-custom");
  try {
    const args = codexConfigArgsForTest({ cwd: "/tmp/test-cwd" });
    const joined = args.join(" ");
    assertEquals(
      joined.includes('model_reasoning_effort="ultra-custom"'),
      true,
    );
  } finally {
    if (previousEffort === undefined) {
      Deno.env.delete("GAMBIT_CODEX_REASONING_EFFORT");
    } else {
      Deno.env.set("GAMBIT_CODEX_REASONING_EFFORT", previousEffort);
    }
  }
});

Deno.test("codex provider treats bare codex-cli as codex-cli/default", () => {
  assertEquals(normalizeCodexModelForTest("codex-cli"), "default");
  assertEquals(normalizeCodexModelForTest("codex-cli/default"), "default");
});

Deno.test("codex provider normalizes codex-cli/<model> for app-server", () => {
  assertEquals(
    normalizeCodexModelForTest("codex-cli/gpt-5.2-codex"),
    "gpt-5.2-codex",
  );
});

Deno.test("codex provider keeps saved-state threads isolated across runs", async () => {
  const calls: Array<{
    priorThreadId?: string;
    instructions?: string;
    prompt: string;
  }> = [];
  const provider = createCodexProvider({
    runAppServerTurn: (input) => {
      calls.push({
        priorThreadId: input.priorThreadId,
        instructions: input.instructions,
        prompt: input.prompt,
      });
      const threadId = input.priorThreadId ?? "thread-new";
      return Promise.resolve({
        threadId,
        assistantMessages: [{
          itemId: `msg-${threadId}`,
          text: `reply-${threadId}`,
        }],
      });
    },
  });

  const [a, b] = await Promise.all([
    provider.chat({
      model: "codex-cli/default",
      messages: [
        { role: "system", content: "system-a" },
        { role: "user", content: "follow up a" },
      ],
      state: {
        runId: "run-a",
        messages: [],
        meta: { "codex.threadId": "thread-a" },
      } as SavedState,
    }),
    provider.chat({
      model: "codex-cli/default",
      messages: [
        { role: "system", content: "system-b" },
        { role: "user", content: "follow up b" },
      ],
      state: {
        runId: "run-b",
        messages: [],
        meta: { "codex.threadId": "thread-b" },
      } as SavedState,
    }),
  ]);

  assertEquals(a.updatedState?.meta?.["codex.threadId"], "thread-a");
  assertEquals(b.updatedState?.meta?.["codex.threadId"], "thread-b");
  assertEquals(calls.length, 2);
  assertEquals(calls[0], {
    priorThreadId: "thread-a",
    instructions: "system-a",
    prompt: "follow up a",
  });
  assertEquals(calls[1], {
    priorThreadId: "thread-b",
    instructions: "system-b",
    prompt: "follow up b",
  });
});

Deno.test("codex provider rejects legacy codex prefix", () => {
  const error = assertThrows(() => normalizeCodexModelForTest("codex/default"));
  assertEquals(
    error instanceof Error &&
      error.message.includes('Legacy Codex model prefix "codex"'),
    true,
  );
});

Deno.test("codex provider rejects invalid call-time reasoning values", () => {
  const error = assertThrows(() =>
    codexConfigArgsForTest({
      cwd: "/tmp/test-cwd",
      params: {
        reasoning: { effort: "ultra" },
      },
    })
  );
  assertEquals(
    error instanceof Error &&
      error.message.includes("Invalid Codex call-time reasoning.effort"),
    true,
  );
});
