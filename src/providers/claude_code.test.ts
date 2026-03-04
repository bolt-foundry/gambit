import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  createClaudeCodeProvider,
  parseClaudeCodeArgsForTest,
  parseClaudeCodeStdoutForTest,
} from "./claude_code.ts";

Deno.test({
  name: "claude provider args include model and prompt",
  permissions: { env: true },
}, () => {
  const args = parseClaudeCodeArgsForTest({
    model: "claude-code-cli/sonnet",
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
    ],
  });
  assertEquals(args.includes("--print"), true);
  assertEquals(args.includes("--include-partial-messages"), true);
  assertEquals(args.includes("--model"), true);
  assertEquals(args.includes("sonnet"), true);
  const outputFormatIndex = args.indexOf("--output-format");
  assertEquals(args[outputFormatIndex + 1], "stream-json");
  assertEquals(args.at(-1), "USER:\nfirst\n\nASSISTANT:\nsecond");
});

Deno.test({
  name: "claude provider args map bare alias to default model",
  permissions: { env: true },
}, () => {
  const args = parseClaudeCodeArgsForTest({
    model: "claude-code-cli",
    messages: [{ role: "user", content: "hi" }],
  });
  assertEquals(args.includes("--model"), false);
});

Deno.test({
  name: "claude provider parses json output",
}, () => {
  const parsed = parseClaudeCodeStdoutForTest(
    JSON.stringify({
      session_id: "session-1",
      result: "done",
      usage: {
        input_tokens: 11,
        output_tokens: 7,
        total_tokens: 18,
      },
    }),
  );
  assertEquals(parsed.assistantText, "done");
  assertEquals(parsed.sessionId, "session-1");
  assertEquals(parsed.usage?.totalTokens, 18);
});

Deno.test({
  name: "claude provider parses single stream-json line with non-json noise",
}, () => {
  const parsed = parseClaudeCodeStdoutForTest(
    [
      "verbose: running...",
      JSON.stringify({
        type: "result",
        session_id: "session-2",
        result: "done once",
        usage: {
          input_tokens: 3,
          output_tokens: 2,
          total_tokens: 5,
        },
      }),
      "verbose: complete",
    ].join("\n"),
  );
  assertEquals(parsed.assistantText, "done once");
  assertEquals(parsed.sessionId, "session-2");
  assertEquals(parsed.usage?.totalTokens, 5);
});

Deno.test({
  name: "claude provider keeps text output when not json",
}, () => {
  const parsed = parseClaudeCodeStdoutForTest("plain text");
  assertEquals(parsed.assistantText, "plain text");
});

Deno.test({
  name: "claude provider throws with stderr details on failure",
  permissions: { env: true },
}, async () => {
  const provider = createClaudeCodeProvider({
    runCommand: () =>
      Promise.resolve({
        success: false,
        code: 2,
        stdout: new TextEncoder().encode(""),
        stderr: new TextEncoder().encode("no auth"),
      }),
  });

  let captured: unknown;
  try {
    await provider.chat({
      model: "claude-code-cli/default",
      messages: [{ role: "user", content: "hello" }],
    });
  } catch (err) {
    captured = err;
  }
  assertEquals(captured instanceof Error, true);
  assertStringIncludes((captured as Error).message, "claude --print failed");
  assertStringIncludes((captured as Error).message, "no auth");
});

Deno.test({
  name: "claude provider rejects empty model segment",
}, () => {
  const error = assertThrows(() =>
    parseClaudeCodeArgsForTest({
      model: "claude-code-cli/",
      messages: [{ role: "user", content: "hello" }],
    })
  );
  assertStringIncludes(
    (error as Error).message,
    "requires a model segment",
  );
});

Deno.test({
  name:
    "claude provider emits normalized tool and reasoning events from stream-json",
  permissions: { env: true },
}, async () => {
  const streamLines = [
    JSON.stringify({
      type: "assistant",
      message: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        content: [
          { type: "thinking", id: "think-1", thinking: "Working through it." },
          {
            type: "tool_use",
            id: "call-1",
            name: "list_files",
            input: { path: "." },
          },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      message: {
        id: "msg-2",
        type: "message",
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "call-1",
          content: [{ type: "text", text: "README.md" }],
        }],
      },
    }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      session_id: "session-42",
      result: "Done.",
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }),
  ];
  const provider = createClaudeCodeProvider({
    runCommand: ({ onStdoutLine }) => {
      for (const line of streamLines) onStdoutLine?.(line);
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new TextEncoder().encode(streamLines.join("\n")),
        stderr: new TextEncoder().encode(""),
      });
    },
  });

  const streamEvents: Array<Record<string, unknown>> = [];
  const traceEvents: Array<Record<string, unknown>> = [];
  const result = await provider.chat({
    model: "claude-code-cli/default",
    messages: [{ role: "user", content: "Inspect the repo" }],
    onStreamEvent: (event) =>
      streamEvents.push(event as unknown as Record<string, unknown>),
    onTraceEvent: (event) =>
      traceEvents.push(event as unknown as Record<string, unknown>),
  });

  assertEquals(result.message.content, "Done.");
  assertEquals(
    result.updatedState?.meta?.["claudeCode.sessionId"],
    "session-42",
  );
  assertEquals(result.usage?.totalTokens, 15);

  const reasoningDone = streamEvents.find((event) =>
    event.type === "response.reasoning.done"
  );
  assertEquals(reasoningDone?.item_id, "think-1");
  assertEquals(reasoningDone?.text, "Working through it.");

  const toolCall = streamEvents.find((event) => event.type === "tool.call");
  assertEquals(toolCall?.actionCallId, "call-1");
  assertEquals(toolCall?.name, "list_files");
  assertEquals(toolCall?.args, { path: "." });

  const toolResult = streamEvents.find((event) => event.type === "tool.result");
  assertEquals(toolResult?.actionCallId, "call-1");
  assertEquals(
    toolResult?.result,
    [{ type: "text", text: "README.md" }],
  );

  assertEquals(traceEvents.some((event) => event.type === "tool.call"), true);
  assertEquals(traceEvents.some((event) => event.type === "tool.result"), true);
});
