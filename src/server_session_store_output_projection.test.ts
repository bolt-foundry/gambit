import { assertEquals } from "@std/assert";
import * as path from "@std/path";
import { DatabaseSync } from "node:sqlite";
import type { SavedState } from "@bolt-foundry/gambit-core";
import { createSessionStore } from "@bolt-foundry/gambit-simulator/src/server_session_store.ts";

const leakTolerantTest = (name: string, fn: () => Promise<void> | void) =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for predicate");
}

function createProjectionStore(args: {
  sessionsRoot: string;
  workspaceId: string;
  sessionDir: string;
  statePath: string;
  eventsPath: string;
}) {
  return createSessionStore({
    sessionsRoot: args.sessionsRoot,
    randomId: (prefix: string) => `${prefix}-${crypto.randomUUID()}`,
    logger: { warn: () => {} },
    enrichStateWithSession: (state: SavedState) => {
      const meta = { ...(state.meta ?? {}) };
      meta.sessionId = typeof meta.sessionId === "string"
        ? meta.sessionId
        : args.workspaceId;
      meta.workspaceId = typeof meta.workspaceId === "string"
        ? meta.workspaceId
        : args.workspaceId;
      meta.sessionDir = typeof meta.sessionDir === "string"
        ? meta.sessionDir
        : args.sessionDir;
      meta.sessionStatePath = typeof meta.sessionStatePath === "string"
        ? meta.sessionStatePath
        : args.statePath;
      meta.sessionEventsPath = typeof meta.sessionEventsPath === "string"
        ? meta.sessionEventsPath
        : args.eventsPath;
      meta.workspaceSchemaVersion = "workspace-state.v1";
      return {
        state: { ...state, meta },
        dir: args.sessionDir,
      };
    },
    workspaceStateSchemaVersion: "workspace-state.v1",
    workspaceSchemaError: (id, found) =>
      `Unsupported workspace state schema for ${id}: ${found}`,
  });
}

leakTolerantTest(
  "openresponses output projection collapses duplicate assistant messages that share a messageRefId",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsRoot = path.join(dir, "sessions");
    const workspaceId = "workspace-output-dedupe";
    const sessionDir = path.join(sessionsRoot, workspaceId);
    const statePath = path.join(sessionDir, "state.json");
    const eventsPath = path.join(sessionDir, "events.jsonl");
    const sqlitePath = path.join(sessionDir, "workspace.sqlite");
    const store = createProjectionStore({
      sessionsRoot,
      workspaceId,
      sessionDir,
      statePath,
      eventsPath,
    });

    const initialState = store.persistSessionState({
      runId: workspaceId,
      messages: [],
      meta: { workspaceId, sessionId: workspaceId },
    });
    const runId = "run-1";
    const messageRefId = "msg-assistant-1";

    await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: runId,
      event_type: "response.output_item.done",
      payload: {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          id: messageRefId,
          messageRefId,
          content: [{ type: "output_text", text: "Ready." }],
        },
      } as Record<string, unknown>,
      idempotency_key: `${runId}:event-1`,
    });
    await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: runId,
      event_type: "response.output_item.done",
      payload: {
        type: "response.output_item.done",
        output_index: 4,
        item: {
          type: "message",
          role: "assistant",
          id: messageRefId,
          messageRefId,
          content: [{ type: "output_text", text: "Ready." }],
        },
      } as Record<string, unknown>,
      idempotency_key: `${runId}:event-2`,
    });

    const outputItems = store.listOpenResponsesOutputItems({
      workspaceId,
      runId,
    });
    const assistantMessages = outputItems.filter((item): item is {
      __typename: "OutputMessage";
      id: string;
      role: string;
      content: string;
      messageRefId?: string;
      feedbackEligible: boolean;
    } =>
      item.__typename === "OutputMessage" &&
      item.role === "assistant"
    );
    assertEquals(assistantMessages.length, 1);
    assertEquals(assistantMessages[0]?.id, messageRefId);
    assertEquals(assistantMessages[0]?.messageRefId, messageRefId);
    assertEquals(assistantMessages[0]?.content, "Ready.");

    const db = new DatabaseSync(sqlitePath);
    try {
      const rows = db.prepare(`
        SELECT item_key, item_id, message_ref_id, content
        FROM openresponses_output_items_v0
        WHERE workspace_id = ? AND run_id = ?
      `).all(workspaceId, runId) as Array<{
        item_key: string;
        item_id: string;
        message_ref_id: string | null;
        content: string | null;
      }>;
      assertEquals(rows.length, 1);
      assertEquals(rows[0]?.item_key, `message:assistant:${messageRefId}`);
      assertEquals(rows[0]?.item_id, messageRefId);
      assertEquals(rows[0]?.message_ref_id, messageRefId);
      assertEquals(rows[0]?.content, "Ready.");
    } finally {
      db.close();
    }
  },
);

leakTolerantTest(
  "openresponses output projection upgrades a matching unresolved assistant row when canonical backfill adds messageRefId",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsRoot = path.join(dir, "sessions");
    const workspaceId = "workspace-output-canonical-upgrade";
    const sessionDir = path.join(sessionsRoot, workspaceId);
    const statePath = path.join(sessionDir, "state.json");
    const eventsPath = path.join(sessionDir, "events.jsonl");
    const sqlitePath = path.join(sessionDir, "workspace.sqlite");
    const store = createProjectionStore({
      sessionsRoot,
      workspaceId,
      sessionDir,
      statePath,
      eventsPath,
    });

    const initialState = store.persistSessionState({
      runId: workspaceId,
      messages: [],
      meta: { workspaceId, sessionId: workspaceId },
    });
    const runId = "run-1";
    const messageRefId = "msg-assistant-1";

    await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: runId,
      event_type: "response.output_item.done",
      payload: {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          id: "provider-message-1",
          content: [{ type: "output_text", text: "Ready." }],
        },
      },
      idempotency_key: `${runId}:event-1`,
    });
    await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: runId,
      event_type: "response.output_item.done",
      payload: {
        type: "response.output_item.done",
        output_index: 4,
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Ready." }],
          id: messageRefId,
        },
      },
      idempotency_key:
        `${runId}:response.output_item.done:canonical:${messageRefId}:ready`,
    });

    await waitFor(() => {
      const outputItems = store.listOpenResponsesOutputItems({
        workspaceId,
        runId,
      });
      return outputItems.some((item) =>
        item.__typename === "OutputMessage" &&
        item.role === "assistant" &&
        item.messageRefId === messageRefId
      );
    }, 5_000);

    const outputItems = store.listOpenResponsesOutputItems({
      workspaceId,
      runId,
    });
    const assistantMessages = outputItems.filter((item): item is {
      __typename: "OutputMessage";
      id: string;
      role: string;
      content: string;
      messageRefId?: string;
      feedbackEligible: boolean;
    } =>
      item.__typename === "OutputMessage" &&
      item.role === "assistant"
    );
    assertEquals(assistantMessages.length, 1);
    assertEquals(assistantMessages[0]?.id, messageRefId);
    assertEquals(assistantMessages[0]?.messageRefId, messageRefId);
    assertEquals(assistantMessages[0]?.content, "Ready.");

    const db = new DatabaseSync(sqlitePath);
    try {
      const rows = db.prepare(`
        SELECT item_key, item_id, message_ref_id, content
        FROM openresponses_output_items_v0
        WHERE workspace_id = ? AND run_id = ?
      `).all(workspaceId, runId) as Array<{
        item_key: string;
        item_id: string;
        message_ref_id: string | null;
        content: string | null;
      }>;
      assertEquals(rows.length, 1);
      assertEquals(rows[0]?.item_id, messageRefId);
      assertEquals(rows[0]?.message_ref_id, messageRefId);
      assertEquals(rows[0]?.content, "Ready.");
    } finally {
      db.close();
    }
  },
);

leakTolerantTest(
  "openresponses output projection keeps repeated canonical assistant text as distinct messages",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsRoot = path.join(dir, "sessions");
    const workspaceId = "workspace-output-canonical-distinct";
    const sessionDir = path.join(sessionsRoot, workspaceId);
    const statePath = path.join(sessionDir, "state.json");
    const eventsPath = path.join(sessionDir, "events.jsonl");
    const sqlitePath = path.join(sessionDir, "workspace.sqlite");
    const store = createProjectionStore({
      sessionsRoot,
      workspaceId,
      sessionDir,
      statePath,
      eventsPath,
    });

    const initialState = store.persistSessionState({
      runId: workspaceId,
      messages: [],
      meta: { workspaceId, sessionId: workspaceId },
    });
    const runId = "run-1";
    const firstMessageRefId = "msg-assistant-1";
    const secondMessageRefId = "msg-assistant-2";

    await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: runId,
      event_type: "response.output_item.done",
      payload: {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          role: "assistant",
          id: firstMessageRefId,
          content: [{ type: "output_text", text: "Ready." }],
        },
      },
      idempotency_key:
        `${runId}:response.output_item.done:canonical:${firstMessageRefId}:ready`,
    });
    await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: runId,
      event_type: "response.output_item.done",
      payload: {
        type: "response.output_item.done",
        output_index: 1,
        item: {
          type: "message",
          role: "assistant",
          id: secondMessageRefId,
          content: [{ type: "output_text", text: "Ready." }],
        },
      },
      idempotency_key:
        `${runId}:response.output_item.done:canonical:${secondMessageRefId}:ready`,
    });

    const outputItems = store.listOpenResponsesOutputItems({
      workspaceId,
      runId,
    });
    const assistantMessages = outputItems.filter((item): item is {
      __typename: "OutputMessage";
      id: string;
      role: string;
      content: string;
      messageRefId?: string;
      feedbackEligible: boolean;
    } =>
      item.__typename === "OutputMessage" &&
      item.role === "assistant"
    );
    assertEquals(
      assistantMessages.map((item) => item.messageRefId),
      [firstMessageRefId, secondMessageRefId],
    );

    const db = new DatabaseSync(sqlitePath);
    try {
      const rows = db.prepare(`
        SELECT item_key, item_id, message_ref_id, content
        FROM openresponses_output_items_v0
        WHERE workspace_id = ? AND run_id = ?
        ORDER BY sequence ASC, output_index ASC
      `).all(workspaceId, runId) as Array<{
        item_key: string;
        item_id: string;
        message_ref_id: string | null;
        content: string | null;
      }>;
      assertEquals(rows.length, 2);
      assertEquals(rows[0]?.item_key, `message:assistant:${firstMessageRefId}`);
      assertEquals(rows[0]?.item_id, firstMessageRefId);
      assertEquals(rows[0]?.message_ref_id, firstMessageRefId);
      assertEquals(
        rows[1]?.item_key,
        `message:assistant:${secondMessageRefId}`,
      );
      assertEquals(rows[1]?.item_id, secondMessageRefId);
      assertEquals(rows[1]?.message_ref_id, secondMessageRefId);
    } finally {
      db.close();
    }
  },
);

leakTolerantTest(
  "openresponses output projection preserves whitespace across streamed deltas and final text",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsRoot = path.join(dir, "sessions");
    const workspaceId = "workspace-output-delta-whitespace";
    const sessionDir = path.join(sessionsRoot, workspaceId);
    const statePath = path.join(sessionDir, "state.json");
    const eventsPath = path.join(sessionDir, "events.jsonl");
    const sqlitePath = path.join(sessionDir, "workspace.sqlite");
    const store = createProjectionStore({
      sessionsRoot,
      workspaceId,
      sessionDir,
      statePath,
      eventsPath,
    });

    const initialState = store.persistSessionState({
      runId: workspaceId,
      messages: [],
      meta: { workspaceId, sessionId: workspaceId },
    });
    const runId = "run-1";
    const itemId = "msg-assistant-1";

    for (const [index, delta] of ["Hello", " ", "world"].entries()) {
      await store.appendOpenResponsesRunEvent(initialState, {
        workspace_id: workspaceId,
        run_id: runId,
        event_type: "response.output_text.delta",
        payload: {
          type: "response.output_text.delta",
          output_index: 0,
          item_id: itemId,
          delta,
        },
        idempotency_key: `${runId}:delta:${index}`,
      });
    }
    await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: runId,
      event_type: "response.output_text.done",
      payload: {
        type: "response.output_text.done",
        output_index: 0,
        item_id: itemId,
        text: "Hello world ",
      },
      idempotency_key: `${runId}:done`,
    });

    const outputItems = store.listOpenResponsesOutputItems({
      workspaceId,
      runId,
    });
    const assistantMessages = outputItems.filter((item): item is {
      __typename: "OutputMessage";
      id: string;
      role: string;
      content: string;
      messageRefId?: string;
      feedbackEligible: boolean;
    } =>
      item.__typename === "OutputMessage" &&
      item.role === "assistant"
    );
    assertEquals(assistantMessages.length, 1);
    assertEquals(assistantMessages[0]?.content, "Hello world ");

    const db = new DatabaseSync(sqlitePath);
    try {
      const rows = db.prepare(`
        SELECT content
        FROM openresponses_output_items_v0
        WHERE workspace_id = ? AND run_id = ?
      `).all(workspaceId, runId) as Array<{ content: string | null }>;
      assertEquals(rows.length, 1);
      assertEquals(rows[0]?.content, "Hello world ");
    } finally {
      db.close();
    }
  },
);
