// @ts-nocheck
// deno-lint-ignore-file
import { assert, assertEquals } from "@std/assert";
import React from "react";
import TestRenderer, { act } from "npm:react-test-renderer@19.2.0";
import type { ReactTestInstance } from "npm:react-test-renderer@19.2.0";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { default: WorkbenchDrawerIso } = await import(
  "./WorkbenchDrawerIso.tsx"
);
const { default: WorkbenchChatIntro } = await import(
  "./WorkbenchChatIntro.tsx"
);

function readText(node: ReactTestInstance): string {
  return node.children.map((child) =>
    typeof child === "string" ? child : readText(child)
  ).join("");
}

Deno.test("WorkbenchDrawerIso hides chat history toggle when flag is disabled", async () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <WorkbenchDrawerIso
          open
          showChatHistoryToggle={false}
          chatHistoryContent={<div>history</div>}
          chatBody={<div>chat</div>}
        />,
      );
    });
    assert(renderer);

    const toggles = renderer.root.findAll((node: ReactTestInstance) =>
      typeof node.props.className === "string" &&
      node.props.className.includes("workbench-chat-history-toggle")
    );
    assertEquals(toggles.length, 0);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});

Deno.test("WorkbenchChatIntro renders start action and pending label", async () => {
  let startCount = 0;
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <WorkbenchChatIntro
          pending
          onStart={() => {
            startCount += 1;
          }}
        />,
      );
    });
    assert(renderer);

    const startButton = renderer.root.find((node: ReactTestInstance) =>
      node.props["data-testid"] === "build-start"
    );
    assertEquals(readText(startButton), "Starting...");

    await act(async () => {
      startButton.props.onClick();
    });
    assertEquals(startCount, 1);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});
