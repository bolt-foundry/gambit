import { assert, assertEquals, assertRejects } from "@std/assert";
import React from "react";
import TestRenderer, { act } from "npm:react-test-renderer@19.2.0";

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
  windowObj.location = { pathname: "/workspaces/ws-1/test", search: "" };
}

type WorkspaceSocketMessage = import("./utils.ts").WorkspaceSocketMessage;
const { WorkspaceProvider, useWorkspaceBuild, useWorkspaceTest } = await import(
  "./WorkspaceContext.tsx"
);

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

function createSnapshot(
  run?: import("./utils.ts").TestBotRun,
  buildRun?: {
    id?: string;
    status?: "idle" | "running" | "completed" | "error" | "canceled";
    messages?: Array<{ role: string; content: string }>;
    traces?: Array<unknown>;
    toolInserts?: Array<unknown>;
  },
): Record<string, unknown> {
  return {
    workspaceId: "ws-1",
    build: {
      run: {
        id: buildRun?.id ?? "ws-1",
        status: buildRun?.status ?? "idle",
        messages: buildRun?.messages ?? [],
        traces: buildRun?.traces ?? [],
        toolInserts: buildRun?.toolInserts ?? [],
      },
    },
    test: {
      run: run ?? { status: "idle", messages: [], traces: [], toolInserts: [] },
    },
    grade: { graderDecks: [], sessions: [] },
    session: { messages: [], traces: [] },
  };
}

Deno.test("WorkspaceContext test chat start/send/stream/reset transitions", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;

  let hook: any = null;
  const requests: Array<{ url: string; body?: unknown }> = [];

  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let parsedBody: unknown;
    if (typeof init?.body === "string" && init.body.length > 0) {
      parsedBody = JSON.parse(init.body);
    }
    requests.push({ url, body: parsedBody });

    if (url.endsWith("/api/workspaces/ws-1")) {
      return new Response(JSON.stringify(createSnapshot()), { status: 200 });
    }
    if (url.endsWith("/api/workspaces/ws-1/test/run-hydrated")) {
      return new Response(
        JSON.stringify(
          createSnapshot({
            id: "run-hydrated",
            status: "completed",
            workspaceId: "ws-1",
            messages: [{ role: "assistant", content: "hydrated" }],
            traces: [],
            toolInserts: [],
          }),
        ),
        { status: 200 },
      );
    }
    if (url.endsWith("/api/test/message")) {
      const body = (parsedBody ?? {}) as Record<string, unknown>;
      if (body.message === "") {
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

  function Harness() {
    hook = useWorkspaceTest();
    return null;
  }

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <WorkspaceProvider workspaceId="ws-1">
          <Harness />
        </WorkspaceProvider>,
      );
    });
    assert(hook);

    await act(async () => {
      await hook.startAssistant({
        workspaceId: "ws-1",
        runWorkspaceId: undefined,
        botDeckPath: "deck.md",
        context: { foo: "bar" },
      });
    });
    assertEquals(hook.chatSending, false);
    assertEquals(hook.run.id, "run-1");
    const startReq = requests.find((req) =>
      req.url.endsWith("/api/test/message") &&
      (req.body as { message?: unknown })?.message === ""
    );
    assert(startReq);

    await act(async () => {
      hook.setChatDraft("hello");
    });
    await act(async () => {
      await hook.sendMessage("hello", {
        runId: hook.run.id,
        workspaceId: "ws-1",
        runWorkspaceId: "ws-1",
        botDeckPath: "deck.md",
      });
    });
    assertEquals(hook.chatDraft, "");
    assertEquals(hook.optimisticUser?.text, "hello");

    const stream = FakeEventSource.instances.at(-1);
    assert(stream);
    await act(async () => {
      stream.emit({
        type: "testBotStream",
        runId: "run-other",
        role: "assistant",
        chunk: "ignored",
        turn: 0,
      });
    });
    assertEquals(hook.streamingAssistant, null);

    await act(async () => {
      stream.emit({
        type: "testBotStream",
        runId: "run-1",
        role: "assistant",
        chunk: "partial",
        turn: 0,
      });
    });
    assertEquals(hook.streamingAssistant?.text, "partial");

    await act(async () => {
      stream.emit({
        type: "testBotStreamEnd",
        runId: "run-1",
        role: "assistant",
        turn: 0,
      });
    });
    assertEquals(hook.streamingAssistant, null);

    await act(async () => {
      stream.emit({
        type: "testBotStatus",
        run: {
          id: "run-1",
          status: "running",
          workspaceId: "ws-1",
          messages: [{ role: "user", content: "hello" }],
          traces: [],
          toolInserts: [],
        },
      });
    });
    assertEquals(hook.optimisticUser, null);

    let hydrated: any = null;
    await act(async () => {
      hydrated = await hook.refreshStatus({
        workspaceId: "ws-1",
        runId: "run-hydrated",
      });
    });
    assert(hydrated);
    assertEquals(hydrated.id, "run-hydrated");
    assertEquals(hook.run.id, "run-hydrated");

    await act(async () => {
      hook.resetRun();
    });
    assertEquals(hook.run.status, "idle");
    assertEquals(hook.chatDraft, "");
    assertEquals(hook.optimisticUser, null);
    assertEquals(hook.streamingAssistant, null);
    assertEquals(hook.streamingUser, null);
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

Deno.test("WorkspaceContext build chat stop cancels run and ignores post-stop stream chunks", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;

  let hook: any = null;
  const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const preservedMessages = [
    { role: "user", content: "keep me" },
    { role: "assistant", content: "still here" },
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
        JSON.stringify(
          createSnapshot(undefined, {
            id: "ws-1",
            status: "running",
            messages: preservedMessages,
          }),
        ),
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

  function Harness() {
    hook = useWorkspaceBuild();
    return null;
  }

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <WorkspaceProvider workspaceId="ws-1">
          <Harness />
        </WorkspaceProvider>,
      );
    });
    assert(hook);
    assertEquals(hook.run.status, "running");
    assertEquals(
      hook.run.messages.map((msg: { content: string }) => msg.content),
      [
        "keep me",
        "still here",
      ],
    );

    const stream = FakeEventSource.instances.at(-1);
    assert(stream);
    await act(async () => {
      stream.emit({
        type: "buildBotStream",
        runId: "ws-1",
        role: "assistant",
        chunk: "before stop",
        turn: 0,
      });
    });
    assertEquals(hook.streamingAssistant?.text, "before stop");

    await act(async () => {
      await hook.stopChat();
    });
    assertEquals(hook.run.status, "canceled");
    assertEquals(hook.streamingAssistant, null);
    assertEquals(
      hook.run.messages.map((msg: { content: string }) => msg.content),
      [
        "keep me",
        "still here",
      ],
    );

    const stopReq = requests.find((req) => req.url.endsWith("/api/build/stop"));
    assert(stopReq);
    assertEquals(stopReq.body?.workspaceId, "ws-1");

    await act(async () => {
      stream.emit({
        type: "buildBotStream",
        runId: "ws-1",
        role: "assistant",
        chunk: "after stop",
        turn: 0,
      });
    });
    assertEquals(hook.streamingAssistant, null);
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

Deno.test("WorkspaceContext build stop fallback payload does not wipe transcript", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;

  let hook: any = null;
  const preservedMessages = [
    { role: "user", content: "keep this" },
    { role: "assistant", content: "and this" },
  ];

  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let parsedBody: Record<string, unknown> | undefined;
    if (typeof init?.body === "string" && init.body.length > 0) {
      parsedBody = JSON.parse(init.body) as Record<string, unknown>;
    }

    if (url.endsWith("/api/workspaces/ws-1")) {
      return new Response(
        JSON.stringify(
          createSnapshot(
            undefined,
            {
              id: "ws-1",
              status: "running",
              messages: preservedMessages,
              traces: [{ type: "tool.call" }],
              toolInserts: [{ index: 0 }],
            },
          ),
        ),
        { status: 200 },
      );
    }
    if (url.endsWith("/api/build/stop")) {
      return new Response(
        JSON.stringify({
          stopped: true,
          run: {
            id: parsedBody?.workspaceId,
            status: "idle",
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

  function Harness() {
    hook = useWorkspaceBuild();
    return null;
  }

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <WorkspaceProvider workspaceId="ws-1">
          <Harness />
        </WorkspaceProvider>,
      );
    });
    assert(hook);
    assertEquals(hook.run.status, "running");
    assertEquals(hook.run.messages, preservedMessages);

    await act(async () => {
      await hook.stopChat();
    });
    assertEquals(hook.run.status, "canceled");
    assertEquals(hook.run.messages, preservedMessages);
    assertEquals(hook.run.traces.length, 1);
    assertEquals(hook.run.toolInserts.length, 1);
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

Deno.test("WorkspaceContext build chat stop failure restores live build updates", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;

  let hook: any = null;
  let workspaceFetchCount = 0;

  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/workspaces/ws-1")) {
      workspaceFetchCount += 1;
      return new Response(
        JSON.stringify(
          createSnapshot(
            undefined,
            workspaceFetchCount > 1
              ? {
                id: "ws-1",
                status: "running",
                messages: [{ role: "assistant", content: "still running" }],
              }
              : {
                id: "ws-1",
                status: "running",
                messages: [{ role: "assistant", content: "initial" }],
              },
          ),
        ),
        { status: 200 },
      );
    }

    if (url.endsWith("/api/build/stop")) {
      if (typeof init?.body !== "string") {
        throw new Error("Expected JSON body");
      }
      return new Response(
        JSON.stringify({ error: "stop failed" }),
        { status: 500 },
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  function Harness() {
    hook = useWorkspaceBuild();
    return null;
  }

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <WorkspaceProvider workspaceId="ws-1">
          <Harness />
        </WorkspaceProvider>,
      );
    });
    assert(hook);
    assertEquals(hook.run.status, "running");
    assertEquals(workspaceFetchCount, 1);

    const stream = FakeEventSource.instances.at(-1);
    assert(stream);

    await assertRejects(
      async () => {
        await act(async () => {
          await hook.stopChat();
        });
      },
      Error,
      "stop failed",
    );

    // Stop failure should refresh workspace status and clear ignore-list gating.
    assertEquals(workspaceFetchCount, 2);
    assertEquals(hook.run.status, "running");

    await act(async () => {
      stream.emit({
        type: "buildBotStream",
        runId: "ws-1",
        role: "assistant",
        chunk: "resumed",
        turn: 0,
      });
    });
    assertEquals(hook.streamingAssistant?.text, "resumed");
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

Deno.test("WorkspaceContext build stop failure does not refresh stale workspace after navigation", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;

  let hook: any = null;
  let setWorkspaceId: ((value: string) => void) | null = null;
  const stopControl: { resolve?: (response: Response) => void } = {};
  let ws1Fetches = 0;
  let ws2Fetches = 0;

  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/workspaces/ws-1")) {
      ws1Fetches += 1;
      return new Response(
        JSON.stringify(
          createSnapshot(
            undefined,
            {
              id: "ws-1",
              status: "running",
              messages: [{ role: "assistant", content: "workspace one" }],
            },
          ),
        ),
        { status: 200 },
      );
    }

    if (url.endsWith("/api/workspaces/ws-2")) {
      ws2Fetches += 1;
      return new Response(
        JSON.stringify(
          createSnapshot(
            undefined,
            {
              id: "ws-2",
              status: "idle",
              messages: [{ role: "assistant", content: "workspace two" }],
            },
          ),
        ),
        { status: 200 },
      );
    }

    if (url.endsWith("/api/build/stop")) {
      return await new Promise<Response>((resolve) => {
        stopControl.resolve = resolve;
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  function RootHarness() {
    const [workspaceId, setWorkspace] = React.useState("ws-1");
    setWorkspaceId = setWorkspace;
    return (
      <WorkspaceProvider workspaceId={workspaceId}>
        <InnerHarness />
      </WorkspaceProvider>
    );
  }

  function InnerHarness() {
    hook = useWorkspaceBuild();
    return null;
  }

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <RootHarness />,
      );
    });
    assert(hook);
    assert(setWorkspaceId);
    assertEquals(hook.run.id, "ws-1");
    assertEquals(ws1Fetches, 1);

    let stopPromise!: Promise<{ ok: boolean; err?: unknown }>;
    await act(async () => {
      stopPromise = hook.stopChat().then(
        () => ({ ok: true }),
        (err: unknown) => ({ ok: false, err }),
      );
    });

    await act(async () => {
      setWorkspaceId!("ws-2");
    });
    assertEquals(ws2Fetches, 1);
    assertEquals(hook.run.id, "ws-2");

    const resolveStopResponse = stopControl.resolve;
    if (!resolveStopResponse) {
      throw new Error("Expected deferred stop response resolver");
    }
    await act(async () => {
      resolveStopResponse(
        new Response(JSON.stringify({ error: "stop failed" }), { status: 500 }),
      );
    });
    const stopResult = await stopPromise;
    assertEquals(stopResult.ok, false);

    // Must not re-fetch stale workspace ws-1 during stop failure recovery.
    assertEquals(ws1Fetches, 1);
    assertEquals(hook.run.id, "ws-2");
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

Deno.test("WorkspaceContext feedback save lifecycle updates run messages", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;

  let hook: any = null;
  const feedbackRequests: Array<Record<string, unknown>> = [];
  let requestMode: "save" | "delete" | "error" = "save";

  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let parsedBody: Record<string, unknown> = {};
    if (typeof init?.body === "string" && init.body.length > 0) {
      parsedBody = JSON.parse(init.body) as Record<string, unknown>;
    }

    if (url.endsWith("/api/workspaces/ws-1")) {
      return new Response(JSON.stringify(createSnapshot()), { status: 200 });
    }
    if (url.endsWith("/api/workspace/feedback")) {
      feedbackRequests.push(parsedBody);
      if (requestMode === "error") {
        return new Response("write failed", { status: 500 });
      }
      if (requestMode === "delete") {
        return new Response(
          JSON.stringify({
            workspaceId: "ws-1",
            deleted: true,
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          workspaceId: "ws-1",
          deleted: false,
          feedback: {
            id: "fb-1",
            runId: "run-1",
            messageRefId: "assistant-1",
            score: 2,
            reason: "solid answer",
            createdAt: new Date().toISOString(),
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  function Harness() {
    hook = useWorkspaceTest();
    return null;
  }

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <WorkspaceProvider workspaceId="ws-1">
          <Harness />
        </WorkspaceProvider>,
      );
    });
    assert(hook);

    await act(async () => {
      hook.setRun({
        id: "run-1",
        status: "completed",
        workspaceId: "ws-1",
        sessionId: "ws-1",
        messages: [{
          role: "assistant",
          content: "baseline",
          messageRefId: "assistant-1",
        }],
        traces: [],
        toolInserts: [],
      });
    });

    requestMode = "save";
    await act(async () => {
      await hook.saveFeedback({
        workspaceId: "ws-1",
        messageRefId: "assistant-1",
        score: 2,
        reason: "solid answer",
      });
    });
    assertEquals(feedbackRequests.at(-1)?.workspaceId, "ws-1");
    assertEquals(feedbackRequests.at(-1)?.messageRefId, "assistant-1");
    assertEquals(hook.run.messages[0]?.feedback?.score, 2);
    assertEquals(hook.run.messages[0]?.feedback?.reason, "solid answer");

    requestMode = "delete";
    await act(async () => {
      await hook.saveFeedback({
        workspaceId: "ws-1",
        messageRefId: "assistant-1",
        score: null,
      });
    });
    assertEquals(hook.run.messages[0]?.feedback, undefined);

    requestMode = "error";
    await assertRejects(async () => {
      await act(async () => {
        await hook.saveFeedback({
          workspaceId: "ws-1",
          messageRefId: "assistant-1",
          score: 1,
          reason: "retry",
        });
      });
    });
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

Deno.test("WorkspaceContext build chat stream/status lifecycle", async () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;

  let hook: any = null;
  const requests: Array<{ url: string; body?: unknown }> = [];

  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let parsedBody: unknown;
    if (typeof init?.body === "string" && init.body.length > 0) {
      parsedBody = JSON.parse(init.body);
    }
    requests.push({ url, body: parsedBody });

    if (url.endsWith("/api/workspaces/ws-1")) {
      return new Response(JSON.stringify(createSnapshot()), { status: 200 });
    }
    if (url.endsWith("/api/build/message")) {
      return new Response(
        JSON.stringify({
          run: {
            id: "ws-1",
            status: "running",
            workspaceId: "ws-1",
            messages: [{ role: "user", content: "hello" }],
            traces: [],
            toolInserts: [],
          },
        }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  function Harness() {
    hook = useWorkspaceBuild();
    return null;
  }

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <WorkspaceProvider workspaceId="ws-1">
          <Harness />
        </WorkspaceProvider>,
      );
    });
    assert(hook);

    await act(async () => {
      await hook.sendMessage("hello");
    });
    assertEquals(hook.chatSending, false);
    assertEquals(hook.run.status, "running");
    const sendReq = requests.find((req) =>
      req.url.endsWith("/api/build/message")
    );
    assert(sendReq);

    const stream = FakeEventSource.instances.at(-1);
    assert(stream);

    await act(async () => {
      stream.emit({
        type: "buildBotStream",
        runId: "ws-1",
        role: "assistant",
        chunk: "partial",
        turn: 0,
      });
    });
    assertEquals(hook.streamingAssistant?.text, "partial");

    await act(async () => {
      stream.emit({
        type: "buildBotStreamEnd",
        runId: "ws-1",
        role: "assistant",
        turn: 0,
      });
    });
    assertEquals(hook.streamingAssistant, null);

    await act(async () => {
      stream.emit({
        type: "buildBotStatus",
        run: {
          id: "ws-1",
          status: "completed",
          workspaceId: "ws-1",
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "done" },
          ],
          traces: [],
          toolInserts: [],
        },
      });
    });
    assertEquals(hook.run.status, "completed");
    assertEquals(hook.run.messages.length, 2);
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
