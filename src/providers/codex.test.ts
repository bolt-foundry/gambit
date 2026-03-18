import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { createCodexProvider, parseCodexArgsForTest } from "./codex.ts";
import type { ProviderTraceEvent, SavedState } from "@bolt-foundry/gambit-core";

const enc = new TextEncoder();

Deno.test("codex provider starts thread and resumes with saved thread id", async () => {
  const calls: Array<Array<string>> = [];
  const provider = createCodexProvider({
    runCommand: ({ args }) => {
      calls.push(args);
      const isResume = args[1] === "resume";
      const threadId = "thread-123";
      const stdout = isResume
        ? [
          JSON.stringify({
            type: "item.completed",
            item: { id: "msg_2", type: "agent_message", text: "second reply" },
          }),
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
          }),
        ].join("\n")
        : [
          JSON.stringify({ type: "thread.started", thread_id: threadId }),
          JSON.stringify({
            type: "item.completed",
            item: { id: "msg_1", type: "agent_message", text: "first reply" },
          }),
          JSON.stringify({
            type: "turn.completed",
            usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
          }),
        ].join("\n");
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(stdout),
        stderr: new Uint8Array(),
      });
    },
  });

  const first = await provider.chat({
    model: "codex-cli/default",
    messages: [{ role: "user", content: "hello" }],
  });
  assertEquals(first.message.content, "first reply");
  assertEquals(first.updatedState?.meta?.["codex.threadId"], "thread-123");
  assertEquals(calls.length, 1);
  assertEquals(calls[0][0], "exec");
  assertEquals(calls[0][1], "--skip-git-repo-check");

  const second = await provider.chat({
    model: "codex-cli/default",
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "first reply" },
      { role: "user", content: "follow up" },
    ],
    state: first.updatedState as SavedState,
  });

  assertEquals(second.message.content, "second reply");
  assertEquals(calls.length, 2);
  assertEquals(calls[1][0], "exec");
  assertEquals(calls[1][1], "resume");
  assertEquals(calls[1].includes("thread-123"), true);
  assertEquals(calls[1][calls[1].length - 1], "follow up");
});

Deno.test("codex provider resume does not replay transcript when no new user message", () => {
  const args = parseCodexArgsForTest({
    model: "codex-cli/default",
    state: {
      runId: "run-1",
      messages: [],
      meta: { "codex.threadId": "thread-123" },
    } as SavedState,
    messages: [
      { role: "system", content: "system text" },
      { role: "assistant", content: "assistant text" },
    ],
  });
  assertEquals(args[0], "exec");
  assertEquals(args[1], "resume");
  assertEquals(args.includes("thread-123"), true);
  // Resume prompt is the newest user message only; none present => empty prompt.
  assertEquals(args[args.length - 1], "");
});

Deno.test("codex provider uses codex instructions config for fresh system prompts", () => {
  const args = parseCodexArgsForTest({
    model: "codex-cli/default",
    messages: [
      { role: "system", content: "deck system prompt" },
      { role: "user", content: "hello" },
    ],
  });
  const joined = args.join(" ");
  assertEquals(joined.includes('instructions="deck system prompt"'), true);
  assertEquals(joined.includes("SYSTEM:\\n"), false);
  assertEquals(args[args.length - 1], "hello");
});

Deno.test("codex provider fresh prompt keeps non-system continuation payloads only", () => {
  const args = parseCodexArgsForTest({
    model: "codex-cli/default",
    messages: [
      { role: "system", content: "deck system prompt" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "follow up" },
    ],
  });
  const joined = args.join(" ");
  assertEquals(joined.includes('instructions="deck system prompt"'), true);
  assertEquals(joined.includes("SYSTEM:\\n"), false);
  assertEquals(
    args[args.length - 1],
    "USER:\nhello\n\nASSISTANT:\nhi there\n\nUSER:\nfollow up",
  );
});

Deno.test("codex provider responses returns updatedState with thread metadata", async () => {
  const provider = createCodexProvider({
    runCommand: () =>
      Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(
          [
            JSON.stringify({ type: "thread.started", thread_id: "thread-rsp" }),
            JSON.stringify({
              type: "item.completed",
              item: {
                id: "msg_1",
                type: "agent_message",
                text: "response mode reply",
              },
            }),
          ].join("\n"),
        ),
        stderr: new Uint8Array(),
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
    runCommand: () =>
      Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(
          [
            JSON.stringify({ type: "thread.started", thread_id: "thread-rsp" }),
            JSON.stringify({
              type: "item.completed",
              item: {
                id: "msg_1",
                type: "agent_message",
                text: "response mode reply",
              },
            }),
          ].join("\n"),
        ),
        stderr: new Uint8Array(),
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

Deno.test("codex provider responses forwards request.params to codex args", async () => {
  const calls: Array<Array<string>> = [];
  const provider = createCodexProvider({
    runCommand: ({ args }) => {
      calls.push(args);
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(
          [
            JSON.stringify({ type: "thread.started", thread_id: "thread-rsp" }),
            JSON.stringify({
              type: "item.completed",
              item: {
                id: "msg_1",
                type: "agent_message",
                text: "response mode reply",
              },
            }),
          ].join("\n"),
        ),
        stderr: new Uint8Array(),
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
  assertEquals(calls[0].join(" ").includes('model_verbosity="high"'), true);
});

Deno.test("codex provider responses forwards abort signal to command runner", async () => {
  let seenSignal: AbortSignal | undefined;
  const provider = createCodexProvider({
    runCommand: ({ signal }) => {
      seenSignal = signal;
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(
          [
            JSON.stringify({ type: "thread.started", thread_id: "thread-rsp" }),
            JSON.stringify({
              type: "item.completed",
              item: {
                id: "msg_1",
                type: "agent_message",
                text: "response mode reply",
              },
            }),
          ].join("\n"),
        ),
        stderr: new Uint8Array(),
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
    runCommand: ({ onStdoutLine }) => {
      const lines = [
        JSON.stringify({
          type: "item.delta",
          item: { id: "msg_1", type: "agent_message", text: "hello " },
        }),
        JSON.stringify({
          type: "item.delta",
          item: { id: "msg_1", type: "agent_message", text: "world" },
        }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "msg_1", type: "agent_message", text: "hello world" },
        }),
      ];
      lines.forEach((line) => onStdoutLine?.(line));
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(lines.join("\n")),
        stderr: new Uint8Array(),
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
    runCommand: ({ onStdoutLine }) => {
      const lines = [
        JSON.stringify({
          type: "item.delta",
          item: { id: "msg_1", type: "agent_message", text: "first " },
        }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "msg_1", type: "agent_message", text: "first reply" },
        }),
        JSON.stringify({
          type: "item.delta",
          item: { id: "msg_2", type: "agent_message", text: "second " },
        }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "msg_2", type: "agent_message", text: "second reply" },
        }),
      ];
      lines.forEach((line) => onStdoutLine?.(line));
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(lines.join("\n")),
        stderr: new Uint8Array(),
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
    runCommand: ({ onStdoutLine }) => {
      const lines = [
        JSON.stringify({
          type: "item.delta",
          item: { type: "agent_message", text: "draft " },
        }),
        JSON.stringify({
          type: "item.delta",
          item: { type: "agent_message", text: "reply" },
        }),
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "draft reply" },
        }),
      ];
      lines.forEach((line) => onStdoutLine?.(line));
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(lines.join("\n")),
        stderr: new Uint8Array(),
      });
    },
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
    runCommand: ({ onStdoutLine }) => {
      const lines = [
        JSON.stringify({
          type: "item.completed",
          item: { id: "msg_1", type: "agent_message", text: "hello world" },
        }),
      ];
      lines.forEach((line) => onStdoutLine?.(line));
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(lines.join("\n")),
        stderr: new Uint8Array(),
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
    runCommand: ({ onStdoutLine }) => {
      const lines = [
        JSON.stringify({
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
        }),
        JSON.stringify({
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
        }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "msg_done", type: "agent_message", text: "done" },
        }),
      ];
      lines.forEach((line) => onStdoutLine?.(line));
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(lines.join("\n")),
        stderr: new Uint8Array(),
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
    runCommand: ({ onStdoutLine }) => {
      const lines = [
        JSON.stringify({
          type: "item.started",
          item: {
            id: "item_1",
            type: "command_execution",
            command: "/bin/bash -lc ls",
            aggregated_output: "",
            exit_code: null,
            status: "in_progress",
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_1",
            type: "command_execution",
            command: "/bin/bash -lc ls",
            aggregated_output: "INTENT.md\nPROMPT.md\n",
            exit_code: 0,
            status: "completed",
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "msg_done", type: "agent_message", text: "done" },
        }),
      ];
      lines.forEach((line) => onStdoutLine?.(line));
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(lines.join("\n")),
        stderr: new Uint8Array(),
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
    runCommand: ({ onStdoutLine }) => {
      const lines = [
        JSON.stringify({
          type: "item.started",
          item: {
            id: "item_progress",
            type: "command_execution",
            command: "/bin/bash -lc ls",
            aggregated_output: "",
            exit_code: null,
            status: "in_progress",
          },
        }),
        JSON.stringify({
          type: "item.delta",
          item: {
            id: "item_progress",
            type: "command_execution",
            command: "/bin/bash -lc ls",
            aggregated_output: "apps\n",
            exit_code: null,
            status: "in_progress",
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_progress",
            type: "command_execution",
            command: "/bin/bash -lc ls",
            aggregated_output: "apps\npackages\n",
            exit_code: 0,
            status: "completed",
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "msg_done", type: "agent_message", text: "done" },
        }),
      ];
      lines.forEach((line) => onStdoutLine?.(line));
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(lines.join("\n")),
        stderr: new Uint8Array(),
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
    runCommand: ({ onStdoutLine }) => {
      const lines = [
        JSON.stringify({
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
        }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "msg_done", type: "agent_message", text: "done" },
        }),
      ];
      lines.forEach((line) => onStdoutLine?.(line));
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(lines.join("\n")),
        stderr: new Uint8Array(),
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
    const args = parseCodexArgsForTest({
      model: "codex-cli/default",
      messages: [{ role: "user", content: "hi" }],
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

Deno.test("codex provider configures workspace-write sandbox automatically", () => {
  const args = parseCodexArgsForTest({
    model: "codex-cli/default",
    messages: [{ role: "user", content: "hi" }],
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

Deno.test("codex provider forwards additionalParams.codex config entries", () => {
  const args = parseCodexArgsForTest({
    model: "codex-cli/default",
    messages: [{ role: "user", content: "hi" }],
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
    const args = parseCodexArgsForTest({
      model: "codex-cli/default",
      messages: [{ role: "user", content: "hi" }],
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

Deno.test("codex provider omits MCP root deck env when deck path is absent", () => {
  const args = parseCodexArgsForTest({
    model: "codex-cli/default",
    messages: [{ role: "user", content: "hi" }],
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
    const args = parseCodexArgsForTest({
      model: "codex-cli/default",
      messages: [{ role: "user", content: "hi" }],
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
  const args = parseCodexArgsForTest({
    model: "codex-cli/default",
    messages: [{ role: "user", content: "hi" }],
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
    const args = parseCodexArgsForTest({
      model: "codex-cli/default",
      messages: [{ role: "user", content: "hi" }],
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
    const args = parseCodexArgsForTest({
      model: "codex-cli/default",
      messages: [{ role: "user", content: "hi" }],
    });
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
  const bare = parseCodexArgsForTest({
    model: "codex-cli",
    messages: [{ role: "user", content: "hi" }],
  });
  const explicit = parseCodexArgsForTest({
    model: "codex-cli/default",
    messages: [{ role: "user", content: "hi" }],
  });
  assertEquals(bare.includes("-m"), false);
  assertEquals(explicit.includes("-m"), false);
  assertEquals(bare, explicit);
});

Deno.test("codex provider forwards codex-cli/<model> through -m", () => {
  const args = parseCodexArgsForTest({
    model: "codex-cli/gpt-5.2-codex",
    messages: [{ role: "user", content: "hi" }],
  });
  const modelArgIndex = args.findIndex((entry) => entry === "-m");
  assertEquals(modelArgIndex >= 0, true);
  assertEquals(args[modelArgIndex + 1], "gpt-5.2-codex");
});

Deno.test("codex provider keeps saved-state threads isolated across runs", async () => {
  const calls: Array<Array<string>> = [];
  const provider = createCodexProvider({
    runCommand: ({ args }) => {
      calls.push(args);
      const threadId = args.includes("thread-a")
        ? "thread-a"
        : args.includes("thread-b")
        ? "thread-b"
        : "thread-new";
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: enc.encode(
          [
            JSON.stringify({
              type: "item.completed",
              item: {
                id: `msg-${threadId}`,
                type: "agent_message",
                text: `reply-${threadId}`,
              },
            }),
          ].join("\n"),
        ),
        stderr: new Uint8Array(),
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
  assertEquals(calls[0].includes("thread-a"), true);
  assertEquals(calls[0].includes("thread-b"), false);
  assertEquals(calls[1].includes("thread-b"), true);
  assertEquals(calls[1].includes("thread-a"), false);
  assertEquals(calls[0].join(" ").includes('instructions="system-a"'), true);
  assertEquals(calls[0].join(" ").includes('instructions="system-b"'), false);
  assertEquals(calls[1].join(" ").includes('instructions="system-b"'), true);
  assertEquals(calls[1].join(" ").includes('instructions="system-a"'), false);
  assertEquals(calls[0][calls[0].length - 1], "follow up a");
  assertEquals(calls[1][calls[1].length - 1], "follow up b");
});

Deno.test("codex provider rejects legacy codex prefix", () => {
  const error = assertThrows(() =>
    parseCodexArgsForTest({
      model: "codex/default",
      messages: [{ role: "user", content: "hi" }],
    })
  );
  assertEquals(
    error instanceof Error &&
      error.message.includes('Legacy Codex model prefix "codex"'),
    true,
  );
});

Deno.test("codex provider rejects invalid call-time reasoning values", () => {
  const error = assertThrows(() =>
    parseCodexArgsForTest({
      model: "codex-cli/default",
      messages: [{ role: "user", content: "hi" }],
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
