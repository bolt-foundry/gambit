import { assert, assertEquals } from "@std/assert";
import React from "react";
import TestRenderer, { act } from "npm:react-test-renderer@19.2.0";
import type { ReactTestInstance } from "npm:react-test-renderer@19.2.0";

const globals = globalThis as unknown as {
  window?: Record<string, unknown>;
};
if (!globals.window) globals.window = {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const { ActivityTranscriptRows } = await import("./ActivityTranscriptRows.tsx");
type BuildDisplayMessage = import("./utils.ts").BuildDisplayMessage;
type ToolCallSummary = import("./utils.ts").ToolCallSummary;

function makeTool(id: string, name = "tool_name"): ToolCallSummary {
  return {
    key: id,
    id,
    actionCallId: id,
    name,
    status: "completed",
  };
}

Deno.test("ActivityTranscriptRows shows tool preview when no reasoning exists", async () => {
  const display: BuildDisplayMessage[] = [
    {
      kind: "tool",
      toolCallId: "tool-1",
      toolSummary: makeTool("tool-1", "fetch_weather"),
    },
  ];

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <ActivityTranscriptRows
          display={display}
          previewToolWhenNoReasoning
          renderMessage={() => null}
        />,
      );
    });
    assert(renderer);

    const previewRows = renderer.root.findAll((node: ReactTestInstance) =>
      node.props.className === "activity-preview-tool"
    );
    assertEquals(previewRows.length, 1);
    assert(String(previewRows[0].children.join(" ")).includes("fetch_weather"));
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});

Deno.test("ActivityTranscriptRows keeps tool preview hidden when reasoning text exists", async () => {
  const display: BuildDisplayMessage[] = [
    {
      kind: "tool",
      toolCallId: "tool-1",
      toolSummary: makeTool("tool-1", "fetch_weather"),
    },
    {
      kind: "reasoning",
      reasoningId: "reasoning-1",
      content: "I should check weather first",
      reasoningRaw: { step: 1 },
    },
  ];

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <ActivityTranscriptRows
          display={display}
          previewToolWhenNoReasoning
          renderMessage={() => null}
        />,
      );
    });
    assert(renderer);

    const previewRows = renderer.root.findAll((node: ReactTestInstance) =>
      node.props.className === "activity-preview-tool"
    );
    assertEquals(previewRows.length, 0);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});
