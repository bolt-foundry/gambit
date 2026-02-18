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

const { default: Badge } = await import("../Badge.tsx");

Deno.test("Badge renders normally without tooltip", async () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <Badge variant="ghost">status</Badge>,
      );
    });
    assert(renderer);
    const badge = renderer.root.find(
      (node: ReactTestInstance) =>
        node.type === "span" &&
        typeof node.props.className === "string" &&
        node.props.className.includes("badge"),
    );
    assertEquals(badge.props["aria-describedby"], undefined);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});

Deno.test("Badge adds tooltip aria-describedby when tooltip is provided", async () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <Badge variant="ghost" tooltip="Helpful status">
          status
        </Badge>,
      );
    });
    assert(renderer);
    const badge = renderer.root.find(
      (node: ReactTestInstance) =>
        node.type === "span" &&
        typeof node.props.className === "string" &&
        node.props.className.includes("badge"),
    );
    assert(typeof badge.props["aria-describedby"] === "string");
    assert(badge.props["aria-describedby"].startsWith("gds-tooltip-"));
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});

Deno.test("Badge preserves existing aria-describedby when tooltip is provided", async () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <Badge
          variant="ghost"
          tooltip="Helpful status"
          aria-describedby="existing-tip"
        >
          status
        </Badge>,
      );
    });
    assert(renderer);
    const badge = renderer.root.find(
      (node: ReactTestInstance) =>
        node.type === "span" &&
        typeof node.props.className === "string" &&
        node.props.className.includes("badge"),
    );
    assert(typeof badge.props["aria-describedby"] === "string");
    assert(badge.props["aria-describedby"].includes("existing-tip"));
    assert(badge.props["aria-describedby"].includes("gds-tooltip-"));
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});
