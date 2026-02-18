import { assert, assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import React from "react";
import TestRenderer, { act } from "npm:react-test-renderer@19.2.0";
import type { ReactTestInstance } from "npm:react-test-renderer@19.2.0";

const globals = globalThis as unknown as {
  window?: Record<string, unknown>;
  EventSource?: unknown;
  fetch?: typeof fetch;
  localStorage?: Storage;
};
if (!globals.window) globals.window = {};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

class MemoryStorage implements Storage {
  #data = new Map<string, string>();

  get length(): number {
    return this.#data.size;
  }

  clear(): void {
    this.#data.clear();
  }

  getItem(key: string): string | null {
    return this.#data.has(key) ? this.#data.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.#data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.#data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#data.set(key, value);
  }
}

if (!globals.localStorage) {
  globals.localStorage = new MemoryStorage();
}
const windowObj = globals.window as {
  localStorage?: Storage;
  location?: { pathname: string; search: string };
};
windowObj.localStorage = globals.localStorage;
if (!windowObj.location) {
  windowObj.location = { pathname: "/workspaces/ws-1/build", search: "" };
}

const {
  default: Chat,
  BuildChatRows,
  ChatView,
  bucketBuildChatDisplay,
  deriveBuildChatActivityState,
  formatElapsedDuration,
} = await import("./Chat.tsx");
const { WorkspaceProvider } = await import("./WorkspaceContext.tsx");
const { globalStyles } = await import("./styles.ts");
type BuildDisplayMessage = import("./utils.ts").BuildDisplayMessage;
type WorkspaceSocketMessage = import("./utils.ts").WorkspaceSocketMessage;
type BuildChatViewState = import("./Chat.tsx").BuildChatViewState;

type ToolCallSummary = import("./utils.ts").ToolCallSummary;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  #listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();
  url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  addEventListener(type: string, listener: EventListener) {
    const existing = this.#listeners.get(type) ?? new Set();
    existing.add(listener as (event: MessageEvent<string>) => void);
    this.#listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: EventListener) {
    const existing = this.#listeners.get(type);
    if (!existing) return;
    existing.delete(listener as (event: MessageEvent<string>) => void);
    if (existing.size === 0) {
      this.#listeners.delete(type);
    }
  }

  emit(message: WorkspaceSocketMessage, offset = 1) {
    const nextEvent = new MessageEvent("message", {
      data: JSON.stringify(message),
      lastEventId: String(offset),
    });
    const listeners = this.#listeners.get(message.type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(nextEvent);
    }
  }
}

function makeTool(id: string, name = "tool_name"): ToolCallSummary {
  return {
    key: id,
    id,
    actionCallId: id,
    name,
    status: "completed",
  };
}

function makeChatState(
  overrides: Partial<BuildChatViewState> = {},
): BuildChatViewState {
  const baseRun = {
    id: "run-1",
    status: "idle" as const,
    messages: [] as Array<{ role: string; content: string }>,
    traces: [],
    toolInserts: [],
    displayMessages: [] as BuildDisplayMessage[],
  };
  const mergedRun = {
    ...baseRun,
    ...(overrides.run ?? {}),
  };
  return {
    toolCalls: [],
    chatDraft: "",
    setChatDraft: () => {},
    chatSending: false,
    chatError: null,
    setChatError: () => {},
    toolCallsOpen: {},
    setToolCallsOpen: () => {},
    optimisticUser: null,
    setOptimisticUser: () => {},
    streamingAssistant: null,
    setStreamingAssistant: () => {},
    resetChat: async () => {},
    sendMessage: async () => {},
    stopChat: async () => {},
    loadChat: async () => {},
    ...overrides,
    run: mergedRun,
  };
}

Deno.test("bucketBuildChatDisplay collapses adjacent non-message rows into one activity block", () => {
  const display: BuildDisplayMessage[] = [
    { kind: "message", role: "user", content: "start" },
    {
      kind: "tool",
      toolCallId: "tool-1",
      toolSummary: makeTool("tool-1", "tool_alpha"),
    },
    {
      kind: "tool",
      toolCallId: "tool-2",
      toolSummary: makeTool("tool-2", "tool_bravo"),
    },
    { kind: "reasoning", reasoningId: "r-1", content: "old" },
    { kind: "reasoning", reasoningId: "r-2", content: "latest" },
    { kind: "message", role: "assistant", content: "done" },
  ];

  const buckets = bucketBuildChatDisplay(display);
  assertEquals(buckets.map((bucket) => bucket.kind), [
    "message",
    "activity",
    "message",
  ]);

  const activityBucket = buckets[1];
  assert(activityBucket && activityBucket.kind === "activity");
  assertEquals(activityBucket.entries.length, 4);
  assertEquals(activityBucket.latestContent, "latest");
  assertEquals(activityBucket.reasoningCount, 2);
  assertEquals(activityBucket.toolCount, 2);
  assertEquals(activityBucket.latestToolLabel, "Tool call: tool_bravo");
  assertEquals(activityBucket.currentToolLabel, null);
});

Deno.test("bucketBuildChatDisplay clears stale tool preview when new reasoning starts", () => {
  const display: BuildDisplayMessage[] = [
    { kind: "reasoning", reasoningId: "r-1", content: "step 1" },
    {
      kind: "tool",
      toolCallId: "tool-1",
      toolSummary: makeTool("tool-1", "single_tool"),
    },
    { kind: "reasoning", reasoningId: "r-2", content: "step 2" },
  ];

  const buckets = bucketBuildChatDisplay(display);
  assertEquals(buckets.map((bucket) => bucket.kind), ["activity"]);
  const activityBucket = buckets[0];
  assert(activityBucket && activityBucket.kind === "activity");
  assertEquals(activityBucket.latestContent, "step 2");
  assertEquals(activityBucket.latestToolLabel, "Tool call: single_tool");
  assertEquals(activityBucket.currentToolLabel, null);
});

Deno.test("bucketBuildChatDisplay preserves non-adjacent boundaries", () => {
  const display: BuildDisplayMessage[] = [
    { kind: "tool", toolCallId: "tool-1", toolSummary: makeTool("tool-1") },
    { kind: "message", role: "assistant", content: "mid" },
    { kind: "tool", toolCallId: "tool-2", toolSummary: makeTool("tool-2") },
  ];

  const buckets = bucketBuildChatDisplay(display);
  assertEquals(buckets.map((bucket) => bucket.kind), [
    "activity",
    "message",
    "activity",
  ]);
});

Deno.test("BuildChatRows renders latest activity preview and toggles full details", async () => {
  const display: BuildDisplayMessage[] = [
    { kind: "tool", toolCallId: "tool-1", toolSummary: makeTool("tool-1") },
    { kind: "tool", toolCallId: "tool-2", toolSummary: makeTool("tool-2") },
    {
      kind: "reasoning",
      reasoningId: "r-1",
      content: "first reasoning",
      reasoningRaw: { step: 1 },
    },
    {
      kind: "reasoning",
      reasoningId: "r-2",
      content: "latest reasoning",
      reasoningRaw: { step: 2 },
    },
  ];

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(<BuildChatRows display={display} />);
    });
    assert(renderer);

    const titles = renderer.root.findAll((node: ReactTestInstance) =>
      node.props.className === "activity-toggle-title"
    );
    assertEquals(titles.length, 1);
    assertEquals(String(titles[0].children.join("")), "Activity");

    const reasoningBadges = renderer.root.findAll((node: ReactTestInstance) =>
      node.type === "span" &&
      typeof node.props.className === "string" &&
      node.props.className.includes("activity-count-badge-reasoning")
    );
    assertEquals(reasoningBadges.length, 1);
    assertEquals(String(reasoningBadges[0].children.join("")), "Reasoning: 2");

    const toolBadges = renderer.root.findAll((node: ReactTestInstance) =>
      node.type === "span" &&
      typeof node.props.className === "string" &&
      node.props.className.includes("activity-count-badge-tool")
    );
    assertEquals(toolBadges.length, 1);
    assertEquals(String(toolBadges[0].children.join("")), "Tool calls: 2");

    const toggles = renderer.root.findAll((node: ReactTestInstance) =>
      node.props.className === "tool-calls-toggle activity-toggle"
    );
    assertEquals(toggles.length, 1);

    const previewToolText = renderer.root.findAll((node: ReactTestInstance) =>
      node.props.className === "activity-preview-tool"
    ).map((node: ReactTestInstance) => String(node.children.join(" "))).join(
      "\n",
    );
    assert(!previewToolText.includes("Tool call"));

    const previewToolRows = renderer.root.findAll((node: ReactTestInstance) =>
      node.props.className === "activity-preview-tool"
    );
    assertEquals(previewToolRows.length, 0);

    const toolToggle = toggles[0];
    await act(async () => {
      toolToggle.props.onClick();
    });

    const toolCallTitles = renderer.root.findAll((node: ReactTestInstance) =>
      node.props.className === "tool-call-title" &&
      String(node.children.join(" ")).includes("Tool call")
    );
    assertEquals(toolCallTitles.length, 2);

    const reasoningRows = renderer.root.findAll((node: ReactTestInstance) =>
      typeof node.props.className === "string" &&
      node.props.className.includes("reasoning-row")
    );
    assertEquals(reasoningRows.length, 2);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});

Deno.test("BuildChatRows exposes latest tool label on tool-count badge tooltip", async () => {
  const display: BuildDisplayMessage[] = [
    { kind: "tool", toolCallId: "tool-1", toolSummary: makeTool("tool-1") },
    {
      kind: "reasoning",
      reasoningId: "r-1",
      content: "thinking",
      reasoningRaw: { step: 1 },
    },
  ];

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(<BuildChatRows display={display} />);
    });
    assert(renderer);

    const previewToolRows = renderer.root.findAll((node: ReactTestInstance) =>
      node.props.className === "activity-preview-tool"
    );
    assertEquals(previewToolRows.length, 0);

    const toolBadges = renderer.root.findAll((node: ReactTestInstance) =>
      node.type === "span" &&
      typeof node.props.className === "string" &&
      node.props.className.includes("activity-count-badge-tool")
    );
    assertEquals(toolBadges.length, 1);
    assert(typeof toolBadges[0].props["aria-describedby"] === "string");
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});

Deno.test("BuildChatRows highlights activity badge when count increases", async () => {
  const initialDisplay: BuildDisplayMessage[] = [
    {
      kind: "reasoning",
      reasoningId: "r-1",
      content: "thinking",
      reasoningRaw: { step: 1 },
    },
    { kind: "tool", toolCallId: "tool-1", toolSummary: makeTool("tool-1") },
  ];
  const increasedDisplay: BuildDisplayMessage[] = [
    ...initialDisplay,
    { kind: "tool", toolCallId: "tool-2", toolSummary: makeTool("tool-2") },
  ];

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <BuildChatRows display={initialDisplay} />,
      );
    });
    assert(renderer);

    let highlightedToolBadges = renderer.root.findAll((
      node: ReactTestInstance,
    ) =>
      node.type === "span" &&
      typeof node.props.className === "string" &&
      node.props.className.includes("activity-count-badge-tool") &&
      node.props.className.includes("is-highlight")
    );
    assertEquals(highlightedToolBadges.length, 0);

    await act(async () => {
      renderer?.update(<BuildChatRows display={increasedDisplay} />);
    });

    highlightedToolBadges = renderer.root.findAll((node: ReactTestInstance) =>
      node.type === "span" &&
      typeof node.props.className === "string" &&
      node.props.className.includes("activity-count-badge-tool") &&
      node.props.className.includes("is-highlight")
    );
    assertEquals(highlightedToolBadges.length, 1);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1600));
    });

    highlightedToolBadges = renderer.root.findAll((node: ReactTestInstance) =>
      node.type === "span" &&
      typeof node.props.className === "string" &&
      node.props.className.includes("activity-count-badge-tool") &&
      node.props.className.includes("is-highlight")
    );
    assertEquals(highlightedToolBadges.length, 0);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});

Deno.test("Build chat stop button appears only while running and dispatches stop without clearing transcript", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];

  const preservedMessages = [
    { role: "user", content: "keep this" },
    { role: "assistant", content: "assistant stays" },
  ];

  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let parsedBody: Record<string, unknown> | undefined;
    if (typeof init?.body === "string" && init.body.length > 0) {
      parsedBody = JSON.parse(init.body) as Record<string, unknown>;
    }
    requests.push({ url, body: parsedBody });

    if (url.endsWith("/api/workspaces/ws-1")) {
      return new Response(
        JSON.stringify({
          workspaceId: "ws-1",
          build: {
            run: {
              id: "ws-1",
              status: "running",
              messages: preservedMessages,
              traces: [],
              toolInserts: [],
            },
          },
          test: {
            run: { status: "idle", messages: [], traces: [], toolInserts: [] },
          },
          grade: { graderDecks: [], sessions: [] },
          session: { messages: [], traces: [] },
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/api/build/stop")) {
      return new Response(
        JSON.stringify({
          stopped: true,
          run: {
            id: "ws-1",
            status: "canceled",
            messages: preservedMessages,
            traces: [],
            toolInserts: [],
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <WorkspaceProvider workspaceId="ws-1">
          <Chat />
        </WorkspaceProvider>,
      );
    });
    assert(renderer);

    const findByTestId = (id: string) =>
      renderer!.root.findAll((node: ReactTestInstance) =>
        node.type === "button" && node.props["data-testid"] === id
      );

    assertEquals(findByTestId("build-stop").length, 1);
    assertEquals(findByTestId("build-send").length, 0);
    assertEquals(findByTestId("build-start").length, 0);

    const stopButton = findByTestId("build-stop")[0];
    await act(async () => {
      stopButton.props.onClick();
    });

    const stopReq = requests.find((req) => req.url.endsWith("/api/build/stop"));
    assert(stopReq);
    assertEquals(stopReq.body?.workspaceId, "ws-1");

    assertEquals(findByTestId("build-stop").length, 0);
    assertEquals(findByTestId("build-send").length, 1);

    const renderedTranscript = renderer.root.findAll((
      node: ReactTestInstance,
    ) =>
      node.props.className === "bubble-text" &&
      typeof node.props.dangerouslySetInnerHTML?.__html === "string"
    ).map((node: ReactTestInstance) =>
      String(node.props.dangerouslySetInnerHTML.__html)
    ).join("\n");
    assert(renderedTranscript.includes("keep this"));
    assert(renderedTranscript.includes("assistant stays"));
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
    FakeEventSource.instances = [];
  }
});

Deno.test("deriveBuildChatActivityState maps to finite activity taxonomy", () => {
  const display: BuildDisplayMessage[] = [];
  assertEquals(
    deriveBuildChatActivityState({
      runStatus: "idle",
      chatSending: false,
      display,
      streamingAssistant: null,
      runId: "run-1",
    }),
    "Idle",
  );
  assertEquals(
    deriveBuildChatActivityState({
      runStatus: "running",
      chatSending: false,
      display,
      streamingAssistant: null,
      runId: "run-1",
    }),
    "Thinking",
  );
  assertEquals(
    deriveBuildChatActivityState({
      runStatus: "running",
      chatSending: false,
      display,
      streamingAssistant: { runId: "run-1", turn: 0, text: "partial" },
      runId: "run-1",
    }),
    "Responding",
  );
  assertEquals(
    deriveBuildChatActivityState({
      runStatus: "completed",
      chatSending: false,
      display,
      streamingAssistant: null,
      runId: "run-1",
    }),
    "Stopped",
  );
});

Deno.test("ChatView shows active indicator for thinking/responding and clears on stop", async () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(<ChatView state={makeChatState()} />);
    });
    assert(renderer);

    let indicators = renderer.root.findAll((node: ReactTestInstance) =>
      node.props["data-testid"] === "build-chat-activity-indicator"
    );
    assertEquals(indicators.length, 0);

    await act(async () => {
      renderer?.update(
        <ChatView
          state={makeChatState({
            chatSending: true,
            run: {
              id: "run-1",
              status: "idle",
              messages: [],
              traces: [],
              toolInserts: [],
              displayMessages: [],
            },
          })}
        />,
      );
    });
    indicators = renderer.root.findAll((node: ReactTestInstance) =>
      node.props["data-testid"] === "build-chat-activity-indicator"
    );
    assertEquals(indicators.length, 1);
    assertEquals(indicators[0].props["data-activity-state"], "Thinking");

    await act(async () => {
      renderer?.update(
        <ChatView
          state={makeChatState({
            run: {
              id: "run-1",
              status: "running",
              messages: [],
              traces: [],
              toolInserts: [],
              displayMessages: [],
            },
            streamingAssistant: {
              runId: "run-1",
              turn: 0,
              text: "stream chunk",
            },
          })}
        />,
      );
    });
    indicators = renderer.root.findAll((node: ReactTestInstance) =>
      node.props["data-testid"] === "build-chat-activity-indicator"
    );
    assertEquals(indicators.length, 1);
    assertEquals(indicators[0].props["data-activity-state"], "Responding");

    const streamingRows = renderer.root.findAll((node: ReactTestInstance) =>
      node.props.className === "imessage-row left"
    );
    assert(streamingRows.length > 0);

    await act(async () => {
      renderer?.update(
        <ChatView
          state={makeChatState({
            run: {
              id: "run-1",
              status: "completed",
              messages: [],
              traces: [],
              toolInserts: [],
              displayMessages: [],
            },
          })}
        />,
      );
    });
    indicators = renderer.root.findAll((node: ReactTestInstance) =>
      node.props["data-testid"] === "build-chat-activity-indicator"
    );
    assertEquals(indicators.length, 0);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});

Deno.test("ChatView elapsed timer starts, stops, and resets per active cycle", async () => {
  const time = new FakeTime(new Date("2026-01-01T00:00:00Z"));
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <ChatView state={makeChatState({ chatSending: true })} />,
      );
    });
    assert(renderer);

    const timerNode = () =>
      renderer!.root.findAll((node: ReactTestInstance) =>
        node.props["data-testid"] === "build-chat-activity-timer"
      )[0];
    assertEquals(String(timerNode().children.join("")), "00:00");

    await act(async () => {
      time.tick(2300);
    });
    assertEquals(String(timerNode().children.join("")), "00:02");

    await act(async () => {
      renderer?.update(
        <ChatView
          state={makeChatState({
            run: {
              id: "run-1",
              status: "completed",
              messages: [],
              traces: [],
              toolInserts: [],
              displayMessages: [],
            },
          })}
        />,
      );
    });
    const indicatorsAfterStop = renderer.root.findAll((
      node: ReactTestInstance,
    ) => node.props["data-testid"] === "build-chat-activity-indicator");
    assertEquals(indicatorsAfterStop.length, 0);

    await act(async () => {
      renderer?.update(
        <ChatView state={makeChatState({ chatSending: true })} />,
      );
    });
    assertEquals(String(timerNode().children.join("")), "00:00");
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
    time.restore();
  }
});

Deno.test("reduced-motion fallback disables shimmer while status and timer remain visible", async () => {
  assert(globalStyles.includes("@media (prefers-reduced-motion: reduce)"));
  assert(globalStyles.includes(".build-chat-activity-glimmer"));
  assert(globalStyles.includes("opacity: 0;"));

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <ChatView state={makeChatState({ chatSending: true })} />,
      );
    });
    assert(renderer);

    const label = renderer.root.findAll((node: ReactTestInstance) =>
      node.props.className === "build-chat-activity-label"
    );
    const timer = renderer.root.findAll((node: ReactTestInstance) =>
      node.props["data-testid"] === "build-chat-activity-timer"
    );
    assertEquals(label.length, 1);
    assertEquals(timer.length, 1);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
    }
  }
});

Deno.test("formatElapsedDuration renders mm:ss", () => {
  assertEquals(formatElapsedDuration(0), "00:00");
  assertEquals(formatElapsedDuration(61), "01:01");
  assertEquals(formatElapsedDuration(3600 + 9), "60:09");
});
