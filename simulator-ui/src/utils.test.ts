import { assertEquals } from "@std/assert";

const globals = globalThis as unknown as { window?: Record<string, unknown> };
if (!globals.window) globals.window = {};

const { deriveReasoningByAssistant, getWorkspaceRouteFromPath } = await import(
  "./utils.ts"
);
type TraceEvent = import("./utils.ts").TraceEvent;
const { deriveBuildDisplayMessages } = await import("./utils.ts");

Deno.test("deriveReasoningByAssistant maps codex reasoning to assistant turn", () => {
  const traces: TraceEvent[] = [
    {
      type: "model.stream.event",
      runId: "run_1",
      actionCallId: "call_1",
      model: "codex-cli/default",
      event: {
        type: "codex.event",
        payload: {
          type: "item.completed",
          item: {
            type: "reasoning",
            text: "Reasoning here",
          },
        },
      },
    },
    {
      type: "model.result",
      runId: "run_1",
      actionCallId: "call_1",
      finishReason: "stop",
      message: { role: "assistant", content: "final answer" },
    },
  ];

  const reasoning = deriveReasoningByAssistant(traces);
  assertEquals(reasoning.size, 1);
  const bucket = reasoning.get(0);
  assertEquals(bucket?.length, 1);
  assertEquals(bucket?.[0].text, "Reasoning here");
  assertEquals(bucket?.[0].model, "codex-cli/default");
});

Deno.test("deriveReasoningByAssistant ignores non-reasoning codex events", () => {
  const traces: TraceEvent[] = [
    {
      type: "model.stream.event",
      actionCallId: "call_1",
      event: {
        type: "codex.event",
        payload: {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: "not reasoning",
          },
        },
      },
    },
    {
      type: "model.stream.event",
      actionCallId: "call_1",
      event: {
        type: "codex.event",
        payload: {
          type: "item.completed",
          item: {
            type: "reasoning",
            text: "   ",
          },
        },
      },
    },
    {
      type: "model.result",
      actionCallId: "call_1",
      finishReason: "stop",
    },
  ];

  const reasoning = deriveReasoningByAssistant(traces);
  assertEquals(reasoning.size, 0);
});

Deno.test("getWorkspaceRouteFromPath parses run-addressed test route", () => {
  assertEquals(getWorkspaceRouteFromPath("/workspaces/ws_1/test/run_1"), {
    workspaceId: "ws_1",
    tab: "test",
    isNew: false,
    testRunId: "run_1",
    gradeRunId: undefined,
  });
});

Deno.test("getWorkspaceRouteFromPath parses run-addressed grade route", () => {
  assertEquals(getWorkspaceRouteFromPath("/workspaces/ws_1/grade/grade_1"), {
    workspaceId: "ws_1",
    tab: "grade",
    isNew: false,
    testRunId: undefined,
    gradeRunId: "grade_1",
  });
});

Deno.test("deriveBuildDisplayMessages keeps assistant turns ordered when item ids repeat across actions", () => {
  const traces: TraceEvent[] = [
    {
      type: "message.user",
      actionCallId: "action-1",
      message: { role: "user", content: "first user turn" },
    },
    {
      type: "model.stream.event",
      actionCallId: "action-1",
      event: {
        type: "codex.event",
        payload: {
          type: "item.completed",
          item: {
            id: "item_1",
            type: "agent_message",
            text: "first assistant turn",
          },
        },
      },
    },
    {
      type: "model.result",
      actionCallId: "action-1",
      message: { role: "assistant", content: "first assistant turn" },
    },
    {
      type: "message.user",
      actionCallId: "action-2",
      message: { role: "user", content: "second user turn" },
    },
    {
      type: "model.stream.event",
      actionCallId: "action-2",
      event: {
        type: "codex.event",
        payload: {
          type: "item.completed",
          item: {
            id: "item_1",
            type: "agent_message",
            text: "second assistant turn",
          },
        },
      },
    },
    {
      type: "model.result",
      actionCallId: "action-2",
      message: { role: "assistant", content: "second assistant turn" },
    },
  ];

  const display = deriveBuildDisplayMessages([], traces);
  const textRows = display.filter((row) => row.kind === "message").map((row) =>
    `${row.role}:${row.content}`
  );
  assertEquals(textRows, [
    "user:first user turn",
    "assistant:first assistant turn",
    "user:second user turn",
    "assistant:second assistant turn",
  ]);
});

Deno.test("deriveBuildDisplayMessages dedupes model.result after streamed output_item.done", () => {
  const traces: TraceEvent[] = [
    {
      type: "message.user",
      actionCallId: "action-1",
      message: { role: "user", content: "hello" },
    },
    {
      type: "model.stream.event",
      actionCallId: "action-1",
      event: {
        type: "codex.event",
        payload: {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "hi there" }],
          },
        },
      },
    },
    {
      type: "model.result",
      actionCallId: "action-1",
      message: { role: "assistant", content: "hi there" },
    },
  ];

  const display = deriveBuildDisplayMessages([], traces);
  const assistantRows = display.filter((row) =>
    row.kind === "message" && row.role === "assistant"
  );
  assertEquals(assistantRows.length, 1);
  assertEquals(assistantRows[0]?.content, "hi there");
});
