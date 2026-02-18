import { assert, assertEquals } from "@std/assert";
import React from "react";
import TestRenderer, { act } from "npm:react-test-renderer@19.2.0";

const globals = globalThis as unknown as {
  window?: Record<string, unknown>;
};
if (!globals.window) globals.window = {};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const { default: Tooltip } = await import("../Tooltip.tsx");

Deno.test("Tooltip adds aria-describedby to child element", async () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <Tooltip content="Helpful context">
          <button type="button">Info</button>
        </Tooltip>,
      );
    });
    assert(renderer);
    const button = renderer.root.findByType("button");
    assert(typeof button.props["aria-describedby"] === "string");
    assert(button.props["aria-describedby"].startsWith("gds-tooltip-"));
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});

Deno.test("Tooltip omits aria-describedby when disabled", async () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <Tooltip content="Helpful context" disabled>
          <button type="button">Info</button>
        </Tooltip>,
      );
    });
    assert(renderer);
    const button = renderer.root.findByType("button");
    assertEquals(button.props["aria-describedby"], undefined);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});

Deno.test("Tooltip preserves existing aria-describedby values", async () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <Tooltip content="Helpful context">
          <button type="button" aria-describedby="existing-tip">Info</button>
        </Tooltip>,
      );
    });
    assert(renderer);
    const button = renderer.root.findByType("button");
    assert(typeof button.props["aria-describedby"] === "string");
    assert(button.props["aria-describedby"].includes("existing-tip"));
    assert(button.props["aria-describedby"].includes("gds-tooltip-"));
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});
