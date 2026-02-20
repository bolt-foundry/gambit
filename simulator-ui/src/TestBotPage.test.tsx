import { assert, assertEquals } from "@std/assert";
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
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
};
windowObj.localStorage = globals.localStorage;
if (!windowObj.location) {
  windowObj.location = { pathname: "/workspaces/ws-1/test", search: "" };
}
windowObj.setInterval = globalThis.setInterval.bind(globalThis);
windowObj.clearInterval = globalThis.clearInterval.bind(globalThis);

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
}

const { WorkspaceProvider } = await import("./WorkspaceContext.tsx");
const { default: TestBotPage } = await import("./TestBotPage.tsx");

type RequestEntry = { url: string; body?: Record<string, unknown> };

function createSnapshot() {
  return {
    workspaceId: "ws-1",
    build: {
      run: {
        id: "ws-1",
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
      },
    },
    test: {
      run: { status: "idle", messages: [], traces: [], toolInserts: [] },
    },
    grade: { graderDecks: [], sessions: [] },
    session: { messages: [], traces: [] },
  };
}

function findByTestId(
  root: ReactTestInstance,
  testId: string,
): ReactTestInstance {
  const matches = root.findAll((node: ReactTestInstance) =>
    node.props["data-testid"] === testId
  );
  assert(matches.length > 0, `Missing node with data-testid=${testId}`);
  return matches[0];
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

Deno.test("TestBotPage uses JSON-only input with parse and required-field gating", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  const requests: RequestEntry[] = [];
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  try {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    globalThis.fetch =
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const pathname = new URL(url, "http://localhost").pathname;
        const search = new URL(url, "http://localhost").search;
        let body: Record<string, unknown> | undefined;
        if (typeof init?.body === "string" && init.body.length > 0) {
          body = JSON.parse(init.body) as Record<string, unknown>;
        }
        requests.push({ url, body });

        if (pathname === "/api/workspaces/ws-1") {
          return new Response(JSON.stringify(createSnapshot()), {
            status: 200,
          });
        }
        if (pathname.startsWith("/api/workspaces/ws-1/test/")) {
          return new Response(
            JSON.stringify({
              ...createSnapshot(),
              test: {
                run: {
                  id: "run-1",
                  status: "running",
                  workspaceId: "ws-1",
                  messages: [],
                  traces: [],
                  toolInserts: [],
                },
              },
            }),
            { status: 200 },
          );
        }
        if (pathname === "/api/test") {
          return new Response(
            JSON.stringify({
              selectedDeckId: "deck-1",
              testDecks: [{
                id: "deck-1",
                label: "Scenario 1",
                path: "/tmp/scenario-1.md",
              }],
              inputSchema: {
                kind: "object",
                optional: false,
                fields: {
                  foo: { kind: "string", optional: false },
                },
              },
              defaults: { input: { foo: "preset" } },
            }),
            { status: 200 },
          );
        }
        if (pathname === "/schema") {
          assertEquals(search, "?workspaceId=ws-1");
          return new Response(
            JSON.stringify({
              schema: {
                kind: "object",
                optional: false,
                fields: {
                  contextId: { kind: "string", optional: false },
                },
              },
              defaults: { contextId: "ctx-default" },
              startMode: "assistant",
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as typeof fetch;

    await act(async () => {
      renderer = TestRenderer.create(
        <WorkspaceProvider workspaceId="ws-1">
          <TestBotPage
            activeWorkspaceId="ws-1"
            onReplaceTestBotSession={() => {}}
            onResetTestBotSession={() => {}}
          />
        </WorkspaceProvider>,
      );
    });

    assert(renderer);
    await flushEffects();
    await flushEffects();

    const scenarioInput = findByTestId(
      renderer.root,
      "testbot-scenario-json-input",
    );
    const assistantInput = findByTestId(
      renderer.root,
      "testbot-assistant-init-json-input",
    );
    const runButton = findByTestId(renderer.root, "testbot-run");
    const startAssistantButton = findByTestId(
      renderer.root,
      "testbot-start-assistant",
    );

    assertEquals(Boolean(runButton.props.disabled), false);
    assertEquals(Boolean(startAssistantButton.props.disabled), false);

    await act(async () => {
      scenarioInput.props.onChange({ target: { value: "{" } });
    });
    const jsonErrorsAfterInvalid = renderer.root.findAll(
      (node: ReactTestInstance) =>
        node.props.className === "error" &&
        String(node.children.join("")).includes("Invalid JSON"),
    );
    assert(jsonErrorsAfterInvalid.length > 0);
    assertEquals(
      Boolean(findByTestId(renderer.root, "testbot-run").props.disabled),
      true,
    );

    await act(async () => {
      scenarioInput.props.onChange({ target: { value: "{}" } });
    });
    assertEquals(
      Boolean(findByTestId(renderer.root, "testbot-run").props.disabled),
      true,
    );

    await act(async () => {
      scenarioInput.props.onChange({
        target: { value: JSON.stringify({ foo: "ready" }, null, 2) },
      });
    });
    assertEquals(
      Boolean(findByTestId(renderer.root, "testbot-run").props.disabled),
      false,
    );

    await act(async () => {
      assistantInput.props.onChange({ target: { value: "{" } });
    });
    assertEquals(
      Boolean(
        findByTestId(renderer.root, "testbot-start-assistant").props.disabled,
      ),
      true,
    );

    const messageRequests = requests.filter((entry) =>
      entry.url.includes("/api/test/message")
    );
    assertEquals(messageRequests.length, 0);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  }
});

Deno.test("TestBotPage submits parsed JSON payload for scenario runs", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  const requests: RequestEntry[] = [];
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  try {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    globalThis.fetch =
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const pathname = new URL(url, "http://localhost").pathname;
        let body: Record<string, unknown> | undefined;
        if (typeof init?.body === "string" && init.body.length > 0) {
          body = JSON.parse(init.body) as Record<string, unknown>;
        }
        requests.push({ url, body });

        if (pathname === "/api/workspaces/ws-1") {
          return new Response(JSON.stringify(createSnapshot()), {
            status: 200,
          });
        }
        if (pathname.startsWith("/api/workspaces/ws-1/test/")) {
          return new Response(
            JSON.stringify({
              ...createSnapshot(),
              test: {
                run: {
                  id: "run-1",
                  status: "running",
                  workspaceId: "ws-1",
                  messages: [],
                  traces: [],
                  toolInserts: [],
                },
              },
            }),
            { status: 200 },
          );
        }
        if (pathname === "/api/test") {
          return new Response(
            JSON.stringify({
              selectedDeckId: "deck-1",
              testDecks: [{
                id: "deck-1",
                label: "Scenario 1",
                path: "/tmp/scenario-1.md",
              }],
              inputSchema: {
                kind: "object",
                optional: false,
                fields: {
                  foo: { kind: "string", optional: false },
                },
              },
              defaults: { input: { foo: "preset" } },
            }),
            { status: 200 },
          );
        }
        if (pathname === "/schema") {
          return new Response(
            JSON.stringify({
              schema: {
                kind: "object",
                optional: false,
                fields: {
                  contextId: { kind: "string", optional: false },
                },
              },
              defaults: { contextId: "ctx-default" },
              startMode: "assistant",
            }),
            { status: 200 },
          );
        }
        if (pathname === "/api/test/run") {
          return new Response(
            JSON.stringify({
              run: {
                id: "run-1",
                status: "running",
                workspaceId: "ws-1",
                messages: [],
                traces: [],
                toolInserts: [],
              },
            }),
            { status: 200 },
          );
        }
        if (pathname === "/api/test/message") {
          return new Response(
            JSON.stringify({
              run: {
                id: "run-1",
                status: "running",
                workspaceId: "ws-1",
                messages: [],
                traces: [],
                toolInserts: [],
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as typeof fetch;

    await act(async () => {
      renderer = TestRenderer.create(
        <WorkspaceProvider workspaceId="ws-1">
          <TestBotPage
            activeWorkspaceId="ws-1"
            onReplaceTestBotSession={() => {}}
            onResetTestBotSession={() => {}}
          />
        </WorkspaceProvider>,
      );
    });

    assert(renderer);
    await flushEffects();
    await flushEffects();

    const scenarioInput = findByTestId(
      renderer.root,
      "testbot-scenario-json-input",
    );
    const assistantInput = findByTestId(
      renderer.root,
      "testbot-assistant-init-json-input",
    );

    await act(async () => {
      scenarioInput.props.onChange({
        target: { value: JSON.stringify({ foo: "scenario-json" }, null, 2) },
      });
      assistantInput.props.onChange({
        target: {
          value: JSON.stringify({ contextId: "assistant-json" }, null, 2),
        },
      });
    });

    await act(async () => {
      findByTestId(renderer.root, "testbot-run").props.onClick();
    });

    const runRequest = requests.find((entry) =>
      entry.url.includes("/api/test/run")
    );
    assert(runRequest?.body);
    assertEquals(runRequest.body.botInput, { foo: "scenario-json" });
    assertEquals(runRequest.body.context, { contextId: "assistant-json" });
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  }
});

Deno.test("TestBotPage submits parsed JSON payload for assistant start", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  const requests: RequestEntry[] = [];
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  try {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    globalThis.fetch =
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const pathname = new URL(url, "http://localhost").pathname;
        let body: Record<string, unknown> | undefined;
        if (typeof init?.body === "string" && init.body.length > 0) {
          body = JSON.parse(init.body) as Record<string, unknown>;
        }
        requests.push({ url, body });

        if (pathname === "/api/workspaces/ws-1") {
          return new Response(JSON.stringify(createSnapshot()), {
            status: 200,
          });
        }
        if (pathname.startsWith("/api/workspaces/ws-1/test/")) {
          return new Response(
            JSON.stringify({
              ...createSnapshot(),
              test: {
                run: {
                  id: "run-1",
                  status: "running",
                  workspaceId: "ws-1",
                  messages: [],
                  traces: [],
                  toolInserts: [],
                },
              },
            }),
            { status: 200 },
          );
        }
        if (pathname === "/api/test") {
          return new Response(
            JSON.stringify({
              selectedDeckId: "deck-1",
              testDecks: [{
                id: "deck-1",
                label: "Scenario 1",
                path: "/tmp/scenario-1.md",
              }],
              inputSchema: {
                kind: "object",
                optional: false,
                fields: {
                  foo: { kind: "string", optional: false },
                },
              },
              defaults: { input: { foo: "preset" } },
            }),
            { status: 200 },
          );
        }
        if (pathname === "/schema") {
          return new Response(
            JSON.stringify({
              schema: {
                kind: "object",
                optional: false,
                fields: {
                  contextId: { kind: "string", optional: false },
                },
              },
              defaults: { contextId: "ctx-default" },
              startMode: "assistant",
            }),
            { status: 200 },
          );
        }
        if (pathname === "/api/test/message") {
          return new Response(
            JSON.stringify({
              run: {
                id: "run-1",
                status: "running",
                workspaceId: "ws-1",
                messages: [],
                traces: [],
                toolInserts: [],
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as typeof fetch;

    await act(async () => {
      renderer = TestRenderer.create(
        <WorkspaceProvider workspaceId="ws-1">
          <TestBotPage
            activeWorkspaceId="ws-1"
            onReplaceTestBotSession={() => {}}
            onResetTestBotSession={() => {}}
          />
        </WorkspaceProvider>,
      );
    });

    assert(renderer);
    await flushEffects();
    await flushEffects();

    const assistantInput = findByTestId(
      renderer.root,
      "testbot-assistant-init-json-input",
    );
    await act(async () => {
      assistantInput.props.onChange({
        target: {
          value: JSON.stringify({ contextId: "assistant-json" }, null, 2),
        },
      });
    });

    await act(async () => {
      findByTestId(renderer.root, "testbot-start-assistant").props.onClick();
    });

    const messageRequests = requests.filter((entry) =>
      entry.url.includes("/api/test/message")
    );
    assert(messageRequests.length > 0);
    const startRequest = messageRequests[0];
    assert(startRequest?.body);
    assertEquals(startRequest.body.message, "");
    assertEquals(startRequest.body.context, { contextId: "assistant-json" });
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  }
});

Deno.test("TestBotPage New chat clears current run without rehydrating latest workspace run", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  const requests: RequestEntry[] = [];
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  try {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    globalThis.fetch =
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const pathname = new URL(url, "http://localhost").pathname;
        let body: Record<string, unknown> | undefined;
        if (typeof init?.body === "string" && init.body.length > 0) {
          body = JSON.parse(init.body) as Record<string, unknown>;
        }
        requests.push({ url, body });

        if (pathname === "/api/workspaces/ws-1") {
          return new Response(
            JSON.stringify({
              ...createSnapshot(),
              test: {
                run: {
                  id: "run-latest",
                  status: "completed",
                  workspaceId: "ws-1",
                  messages: [{
                    role: "assistant",
                    content: "latest workspace run",
                  }],
                  traces: [],
                  toolInserts: [],
                },
              },
            }),
            { status: 200 },
          );
        }
        if (pathname === "/api/workspaces/ws-1/test/run-1") {
          return new Response(
            JSON.stringify({
              ...createSnapshot(),
              test: {
                run: {
                  id: "run-1",
                  status: "completed",
                  workspaceId: "ws-1",
                  messages: [{
                    role: "assistant",
                    content: "requested run message",
                  }],
                  traces: [],
                  toolInserts: [],
                },
              },
            }),
            { status: 200 },
          );
        }
        if (pathname === "/api/test") {
          return new Response(
            JSON.stringify({
              selectedDeckId: "deck-1",
              testDecks: [{
                id: "deck-1",
                label: "Scenario 1",
                path: "/tmp/scenario-1.md",
              }],
              inputSchema: {
                kind: "object",
                optional: false,
                fields: {
                  foo: { kind: "string", optional: false },
                },
              },
              defaults: { input: { foo: "preset" } },
            }),
            { status: 200 },
          );
        }
        if (pathname === "/schema") {
          return new Response(
            JSON.stringify({
              schema: {
                kind: "object",
                optional: false,
                fields: {
                  contextId: { kind: "string", optional: false },
                },
              },
              defaults: { contextId: "ctx-default" },
              startMode: "assistant",
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as typeof fetch;

    function Harness() {
      const [requestedRunId, setRequestedRunId] = React.useState<string | null>(
        "run-1",
      );
      return (
        <WorkspaceProvider workspaceId="ws-1">
          <TestBotPage
            activeWorkspaceId="ws-1"
            requestedRunId={requestedRunId}
            onReplaceTestBotSession={() => {}}
            onResetTestBotSession={() => setRequestedRunId(null)}
          />
        </WorkspaceProvider>
      );
    }

    await act(async () => {
      renderer = TestRenderer.create(<Harness />);
    });

    assert(renderer);
    await flushEffects();
    await flushEffects();

    const requestedRunText = renderer.root.findAll((node: ReactTestInstance) =>
      String(node.children.join("")).includes("requested run message")
    );
    assert(requestedRunText.length > 0);

    const newChatButton = renderer.root.find((node: ReactTestInstance) =>
      node.type === "button" && String(node.children.join("")) === "New chat"
    );

    await act(async () => {
      await newChatButton.props.onClick();
    });
    await flushEffects();
    await flushEffects();

    const latestRunText = renderer.root.findAll((node: ReactTestInstance) =>
      String(node.children.join("")).includes("latest workspace run")
    );
    assertEquals(latestRunText.length, 0);
    const emptyState = renderer.root.findAll((node: ReactTestInstance) =>
      String(node.children.join("")).includes("No messages yet.")
    );
    assert(emptyState.length > 0);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  }
});

Deno.test("TestBotPage exposes scenario error callout action for workbench chat", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  let addPayload:
    | { workspaceId?: string; runId?: string; error: string }
    | null = null;

  try {
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    globalThis.fetch =
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const pathname = new URL(url, "http://localhost").pathname;
        if (pathname === "/api/workspaces/ws-1") {
          return new Response(JSON.stringify(createSnapshot()), {
            status: 200,
          });
        }
        if (pathname === "/api/test") {
          return new Response(
            JSON.stringify({
              selectedDeckId: "deck-1",
              testDecks: [{
                id: "deck-1",
                label: "Scenario 1",
                path: "/tmp/scenario-1.md",
              }],
              inputSchema: {
                kind: "object",
                optional: false,
                fields: {
                  foo: { kind: "string", optional: false },
                },
              },
              defaults: { input: { foo: "preset" } },
            }),
            { status: 200 },
          );
        }
        if (pathname === "/schema") {
          return new Response(
            JSON.stringify({
              schema: {
                kind: "object",
                optional: false,
                fields: {
                  contextId: { kind: "string", optional: false },
                },
              },
              defaults: { contextId: "ctx-default" },
              startMode: "assistant",
            }),
            { status: 200 },
          );
        }
        if (pathname === "/api/test/run") {
          const body = typeof init?.body === "string" && init.body.length > 0
            ? JSON.parse(init.body) as Record<string, unknown>
            : {};
          assertEquals(body.workspaceId, "ws-1");
          return new Response(
            JSON.stringify({
              error: "Scenario exploded while validating tool output",
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }) as typeof fetch;

    await act(async () => {
      renderer = TestRenderer.create(
        <WorkspaceProvider workspaceId="ws-1">
          <TestBotPage
            activeWorkspaceId="ws-1"
            onReplaceTestBotSession={() => {}}
            onResetTestBotSession={() => {}}
            onAddScenarioErrorToWorkbench={(payload) => {
              addPayload = payload;
            }}
          />
        </WorkspaceProvider>,
      );
    });

    assert(renderer);
    await flushEffects();
    await flushEffects();

    await act(async () => {
      findByTestId(renderer.root, "testbot-run").props.onClick();
    });
    await flushEffects();

    const callout = findByTestId(renderer.root, "testbot-error-callout");
    assert(callout);
    const addButton = findByTestId(renderer.root, "testbot-add-error-to-chat");
    await act(async () => {
      addButton.props.onClick();
    });

    const payload = addPayload as
      | { workspaceId?: string; runId?: string; error: string }
      | null;
    assert(payload !== null);
    assertEquals(
      payload.error,
      "Scenario exploded while validating tool output",
    );
    assertEquals(payload.workspaceId, "ws-1");
    assertEquals(payload.runId, undefined);
  } finally {
    if (renderer) {
      await act(async () => {
        renderer.unmount();
      });
    }
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
  }
});
