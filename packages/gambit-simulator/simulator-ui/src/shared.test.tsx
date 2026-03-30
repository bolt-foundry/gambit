// deno-lint-ignore-file
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

const { FeedbackControls } = await import("./shared.tsx");

Deno.test("FeedbackControls shows save error when feedback is rejected", async () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <FeedbackControls
          messageRefId="msg-1"
          onScore={() => {
            throw new Error("This message can't receive feedback.");
          }}
          onReasonChange={() => Promise.resolve()}
        />,
      );
    });
    assert(renderer);

    const scoreButton = renderer.root.find(
      (node: ReactTestInstance) =>
        node.props["data-testid"] === "feedback-score--1",
    );

    await act(async () => {
      scoreButton.props.onClick();
      await Promise.resolve();
    });

    const errorNodes = renderer.root.findAll((node: ReactTestInstance) =>
      node.props.className === "error"
    );
    assertEquals(errorNodes.length, 1);
    assertEquals(
      errorNodes[0]?.children.join(""),
      "This message can't receive feedback.",
    );
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
  }
});
