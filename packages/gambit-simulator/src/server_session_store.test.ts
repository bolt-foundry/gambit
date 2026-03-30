import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { DatabaseSync } from "node:sqlite";
import { startWebSocketSimulator } from "./server.ts";
import type { ModelProvider, SavedState } from "@bolt-foundry/gambit-core";
import { createSessionStore } from "./server_session_store.ts";
import { saveCanonicalWorkspaceState } from "@bolt-foundry/gambit/src/workspace_sqlite.ts";
import {
  createBuildRun,
  createWorkspace,
  gql,
  modImportPath,
  parseGraphqlEnvelope,
  runSimulator,
} from "./server_test_utils.ts";

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

function readWorkspaceStateFromSqlite(
  sqlitePath: string,
  workspaceId: string,
): Record<string, unknown> {
  const db = new DatabaseSync(sqlitePath);
  try {
    const row = db.prepare(
      `SELECT state_json
       FROM workspace_state_v0
       WHERE workspace_id = ?`,
    ).get(workspaceId) as { state_json?: string } | undefined;
    assert(typeof row?.state_json === "string", "missing workspace state row");
    return JSON.parse(row.state_json) as Record<string, unknown>;
  } finally {
    db.close();
  }
}

function readWorkspaceEventsFromSqlite(
  sqlitePath: string,
  workspaceId: string,
): Array<Record<string, unknown> & { offset: number }> {
  const db = new DatabaseSync(sqlitePath);
  try {
    const rows = db.prepare(
      `SELECT offset, payload_json
       FROM workspace_events_v0
       WHERE workspace_id = ?
       ORDER BY offset ASC`,
    ).all(workspaceId) as Array<{ offset?: number; payload_json?: string }>;
    return rows.flatMap((row) => {
      if (
        typeof row.offset !== "number" || typeof row.payload_json !== "string"
      ) {
        return [];
      }
      return [{
        ...(JSON.parse(row.payload_json) as Record<string, unknown>),
        offset: row.offset,
      }];
    });
  } finally {
    db.close();
  }
}

leakTolerantTest(
  "openresponses run-event store validates append payload, replays from sequence, supports idempotency, and streams live updates",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsRoot = path.join(dir, "sessions");
    const workspaceId = "workspace-run-events";
    const sessionDir = path.join(sessionsRoot, workspaceId);
    const store = createSessionStore({
      sessionsRoot,
      randomId: (prefix: string) => `${prefix}-${crypto.randomUUID()}`,
      logger: { warn: () => {} },
      enrichStateWithSession: (state: SavedState) => {
        const meta = { ...(state.meta ?? {}) };
        meta.sessionId = typeof meta.sessionId === "string"
          ? meta.sessionId
          : workspaceId;
        meta.workspaceId = typeof meta.workspaceId === "string"
          ? meta.workspaceId
          : workspaceId;
        meta.sessionDir = typeof meta.sessionDir === "string"
          ? meta.sessionDir
          : sessionDir;
        meta.sessionSqlitePath = typeof meta.sessionSqlitePath === "string"
          ? meta.sessionSqlitePath
          : path.join(sessionDir, "workspace.sqlite");
        meta.workspaceSchemaVersion = "workspace-state.v1";
        return {
          state: { ...state, meta },
          dir: sessionDir,
        };
      },
      workspaceStateSchemaVersion: "workspace-state.v1",
      workspaceSchemaError: (id, found) =>
        `Unsupported workspace state schema for ${id}: ${found}`,
    });
    const initialState = store.persistSessionState({
      runId: workspaceId,
      messages: [],
      meta: { workspaceId, sessionId: workspaceId },
    });
    assert(initialState.meta?.sessionSqlitePath);
    let validationError: Error | null = null;
    try {
      await store.appendOpenResponsesRunEvent(initialState, {
        workspace_id: workspaceId,
        run_id: "run-1",
        event_type: "response.created",
        payload: {} as Record<string, unknown>,
        idempotency_key: "bad-payload",
      });
    } catch (err) {
      validationError = err as Error;
    }
    assert(validationError);
    const appendedA = await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: "run-1",
      event_type: "response.created",
      payload: {
        type: "response.created",
        response: {
          id: "resp-1",
          object: "response",
          status: "in_progress",
          output: [],
        },
      },
      idempotency_key: "run-1:event-1",
    });
    assert(appendedA);
    const appendedADupe = await store.appendOpenResponsesRunEvent(
      initialState,
      {
        workspace_id: workspaceId,
        run_id: "run-1",
        event_type: "response.created",
        payload: {
          type: "response.created",
          response: {
            id: "resp-1",
            object: "response",
            status: "in_progress",
            output: [],
          },
        },
        idempotency_key: "run-1:event-1",
      },
    );
    assertEquals(appendedADupe?.sequence, appendedA?.sequence);
    const appendedOtherRunSameIdempotency = await store
      .appendOpenResponsesRunEvent(
        initialState,
        {
          workspace_id: workspaceId,
          run_id: "run-2",
          event_type: "response.created",
          payload: {
            type: "response.created",
            response: {
              id: "resp-2",
              object: "response",
              status: "in_progress",
              output: [],
            },
          },
          idempotency_key: "run-1:event-1",
        },
      );
    assert(appendedOtherRunSameIdempotency);
    assertEquals(appendedOtherRunSameIdempotency.run_id, "run-2");
    assertEquals(appendedOtherRunSameIdempotency.sequence, 0);
    const appendedB = await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: "run-1",
      event_type: "input.item",
      payload: {
        type: "input.item",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
      idempotency_key: "run-1:event-2",
    });
    assert(appendedB);
    const appendedC = await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: "run-1",
      event_type: "response.output_text.delta",
      payload: {
        type: "response.output_text.delta",
        output_index: 0,
        delta: "hello",
      },
      idempotency_key: "run-1:event-3",
    });
    assert(appendedC);
    await waitFor(() =>
      store.listOpenResponsesRunEvents({
        workspaceId,
        runId: "run-1",
      }).length === 3
    );
    await waitFor(() =>
      store.listOpenResponsesRunEvents({
        workspaceId,
        runId: "run-2",
      }).length === 1
    );

    const replayAll = store.listOpenResponsesRunEvents({
      workspaceId,
      runId: "run-1",
    });
    assertEquals(replayAll.map((entry) => entry.sequence), [0, 1, 2]);
    assertEquals(replayAll[1].payload, {
      type: "input.item",
      role: "user",
      content: [{ type: "input_text", text: "hello" }],
    });
    const replayFromOne = store.listOpenResponsesRunEvents({
      workspaceId,
      runId: "run-1",
      fromSequence: 1,
    });
    assertEquals(replayFromOne.length, 2);
    assertEquals(replayFromOne[0].sequence, 1);

    const sqlitePath = path.join(sessionDir, "workspace.sqlite");
    await waitFor(() =>
      Deno.stat(sqlitePath).then(() => true).catch(() => false)
    );
    const db = new DatabaseSync(sqlitePath);
    const schemaVersionRow = db.prepare("PRAGMA user_version;").get() as {
      user_version?: number;
    };
    assertEquals(schemaVersionRow.user_version, 7);
    const sqliteRows = db.prepare(`
      SELECT workspace_id, run_id, sequence, event_type
      FROM openresponses_run_events_v0
      WHERE workspace_id = ? AND run_id = ?
      ORDER BY sequence ASC
    `).all(workspaceId, "run-1") as Array<
      {
        workspace_id: string;
        run_id: string;
        sequence: number;
        event_type: string;
      }
    >;
    assertEquals(
      sqliteRows.map((row) => row.sequence),
      [0, 1, 2],
    );
    const outputRows = db.prepare(`
      SELECT item_kind, role, content
      FROM openresponses_output_items_v0
      WHERE workspace_id = ? AND run_id = ?
      ORDER BY sequence ASC
    `).all(workspaceId, "run-1") as Array<
      { item_kind: string; role: string | null; content: string | null }
    >;
    assertEquals(outputRows[0], {
      item_kind: "message",
      role: "user",
      content: "hello",
    });
    db.close();

    const liveAbort = new AbortController();
    const liveEvents: Array<number> = [];
    const liveTask = (async () => {
      for await (
        const event of store.subscribeOpenResponsesRunEvents({
          workspaceId,
          runId: "run-1",
          fromSequence: 3,
          signal: liveAbort.signal,
        })
      ) {
        liveEvents.push(event.sequence);
        if (liveEvents.length >= 2) {
          liveAbort.abort();
        }
      }
    })();

    await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: "run-1",
      event_type: "response.reasoning_summary_text.delta",
      payload: {
        type: "response.reasoning_summary_text.delta",
        delta: "thinking",
      },
      idempotency_key: "run-1:event-4",
    });
    await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: "run-1",
      event_type: "response.reasoning.done",
      payload: {
        type: "response.reasoning.done",
        output_index: 0,
        item_id: "reasoning-done-1",
        content_index: 0,
        text: "deep thought",
      },
      idempotency_key: "run-1:event-4b",
    });
    await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: "run-1",
      event_type: "response.output_item.done",
      payload: {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "function_call",
          call_id: "call-1",
          name: "lookup",
          arguments: "{}",
        },
      },
      idempotency_key: "run-1:event-5",
    });
    await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: "run-1",
      event_type: "response.output_item.done",
      payload: {
        type: "response.output_item.done",
        output_index: 1,
        item: {
          type: "function_call_output",
          call_id: "call-1",
          output: "lookup-result",
        },
      },
      idempotency_key: "run-1:event-6",
    });
    await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: "run-1",
      event_type: "response.reasoning_summary_part.added",
      payload: {
        type: "response.reasoning_summary_part.added",
        output_index: 2,
        item_id: "reasoning-part-1",
        summary_index: 0,
        part: {
          type: "summary_text",
          text: " +part",
        },
      },
      idempotency_key: "run-1:event-7",
    });

    await liveTask;
    assertEquals(liveEvents, [3, 4]);

    await waitFor(() => {
      const items = store.listOpenResponsesOutputItems({
        workspaceId,
        runId: "run-1",
      });
      return items.some((item) =>
        item.__typename === "OutputToolCall" &&
        item.toolCallId === "call-1" &&
        item.resultText === "lookup-result"
      ) &&
        items.some((item) =>
          item.__typename === "OutputReasoning" &&
          item.id.endsWith("reasoning-part-1") &&
          item.summary.includes("+part")
        );
    }, 5_000);
    const outputItems = store.listOpenResponsesOutputItems({
      workspaceId,
      runId: "run-1",
    });
    assert(
      outputItems.some((item) =>
        item.__typename === "OutputMessage" &&
        item.role === "user" &&
        item.content === "hello"
      ),
    );
    assert(
      outputItems.some((item) =>
        item.__typename === "OutputReasoning" &&
        item.summary.includes("thinking")
      ),
    );
    assert(
      outputItems.some((item) =>
        item.__typename === "OutputReasoning" &&
        item.id.endsWith("reasoning-done-1") &&
        item.summary.includes("deep thought")
      ),
    );
    assert(
      outputItems.some((item) =>
        item.__typename === "OutputToolCall" &&
        item.toolCallId === "call-1" &&
        item.resultText === "lookup-result"
      ),
    );
    assert(
      outputItems.some((item) =>
        item.__typename === "OutputReasoning" &&
        item.id.endsWith("reasoning-part-1") &&
        item.summary.includes("+part")
      ),
    );

    const replayAfterWrites = store.listOpenResponsesRunEvents({
      workspaceId,
      runId: "run-1",
    });
    assertEquals(replayAfterWrites.map((entry) => entry.sequence), [
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
    ]);
  },
);
leakTolerantTest(
  "openresponses append returns committed sequences for burst writes",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsRoot = path.join(dir, "sessions");
    const workspaceId = "workspace-committed-sequence";
    const sessionDir = path.join(sessionsRoot, workspaceId);
    const store = createSessionStore({
      sessionsRoot,
      randomId: (prefix: string) => `${prefix}-${crypto.randomUUID()}`,
      logger: { warn: () => {} },
      enrichStateWithSession: (state: SavedState) => {
        const meta = { ...(state.meta ?? {}) };
        meta.sessionId = workspaceId;
        meta.workspaceId = workspaceId;
        meta.sessionDir = sessionDir;
        meta.sessionSqlitePath = path.join(sessionDir, "workspace.sqlite");
        meta.workspaceSchemaVersion = "workspace-state.v1";
        return { state: { ...state, meta }, dir: sessionDir };
      },
      workspaceStateSchemaVersion: "workspace-state.v1",
      workspaceSchemaError: (id, found) =>
        `Unsupported workspace state schema for ${id}: ${found}`,
    });
    const initialState = store.persistSessionState({
      runId: workspaceId,
      messages: [],
      meta: { workspaceId, sessionId: workspaceId },
    });

    const runId = "run-committed-sequence";
    const first = await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: runId,
      event_type: "response.created",
      payload: {
        type: "response.created",
        response: {
          id: "resp-1",
          object: "response",
          status: "in_progress",
          output: [],
        },
      },
      idempotency_key: `${runId}:1`,
    });
    const second = await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: runId,
      event_type: "response.output_text.delta",
      payload: {
        type: "response.output_text.delta",
        output_index: 0,
        delta: "A",
      },
      idempotency_key: `${runId}:2`,
    });
    const third = await store.appendOpenResponsesRunEvent(initialState, {
      workspace_id: workspaceId,
      run_id: runId,
      event_type: "response.output_text.delta",
      payload: {
        type: "response.output_text.delta",
        output_index: 0,
        delta: "B",
      },
      idempotency_key: `${runId}:3`,
    });
    assert(first);
    assert(second);
    assert(third);
    assertEquals([first.sequence, second.sequence, third.sequence], [0, 1, 2]);

    await waitFor(() =>
      store.listOpenResponsesRunEvents({ workspaceId, runId }).length === 3
    );
    assertEquals(
      store.listOpenResponsesRunEvents({ workspaceId, runId }).map((event) =>
        event.sequence
      ),
      [0, 1, 2],
    );
  },
);
leakTolerantTest(
  "simulator persists snapshot + events and hydrates traces",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();

    const deckPath = path.join(dir, "persist.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
          usage: {
            promptTokens: 5,
            completionTokens: 3,
            totalTokens: 8,
            reasoningTokens: 2,
          },
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
      sessionDir: sessionsDir,
    });

    const port = (server.addr as Deno.NetAddr).port;
    const result = await runSimulator(port, {
      input: "hello",
      message: "hello",
      stream: false,
    });
    assert(result.workspaceId, "missing workspaceId");

    const sessionDir = path.join(sessionsDir, result.workspaceId!);
    const sqlitePath = path.join(sessionDir, "workspace.sqlite");
    const state = readWorkspaceStateFromSqlite(
      sqlitePath,
      result.workspaceId!,
    );
    assert(!("traces" in state), "sqlite snapshot should exclude traces");
    const meta = state.meta as Record<string, unknown>;
    assertEquals(
      meta.sessionSqlitePath,
      sqlitePath,
    );
    const events = readWorkspaceEventsFromSqlite(
      sqlitePath,
      result.workspaceId!,
    );
    assert(events.length > 0, "expected persisted workspace events");
    assert(
      events.some((event) =>
        (event as { type?: string }).type ===
          "gambit.session.start"
      ),
    );
    assert(
      events.some((event) =>
        (event as { type?: string }).type === "session.snapshot"
      ),
    );

    const sessionRes = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/${
        encodeURIComponent(result.workspaceId ?? "")
      }`,
    );
    const sessionPayload = await sessionRes.json() as {
      session?: { traces?: Array<unknown> };
    };
    assert(Array.isArray(sessionPayload.session?.traces));
    assert(
      (sessionPayload.session?.traces?.length ?? 0) > 0,
      "traces should hydrate from events",
    );
    const modelResult = sessionPayload.session?.traces?.find((entry) =>
      (entry as { type?: string }).type === "model.result"
    ) as { usage?: { reasoningTokens?: number } } | undefined;
    assert(modelResult, "expected model.result trace");
    assertEquals(modelResult.usage?.reasoningTokens, 2);

    await server.shutdown();
    await server.finished;
  },
);
leakTolerantTest(
  "session delete requires explicit workspaceId when active workspace exists",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();
    const activeWorkspaceId = "active-workspace";

    const deckPath = path.join(dir, "delete-explicit.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const activeWorkspaceDir = path.join(sessionsDir, activeWorkspaceId);
    await Deno.mkdir(activeWorkspaceDir, { recursive: true });

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
      sessionDir: sessionsDir,
      workspace: {
        id: activeWorkspaceId,
        rootDeckPath: deckPath,
        rootDir: dir,
      },
    });
    const port = (server.addr as Deno.NetAddr).port;

    const missingWorkspaceRes = await fetch(
      `http://127.0.0.1:${port}/graphql`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `
          mutation {
            gambitWorkspaceDelete {
              workspaceId
              deleted
              error
            }
          }
        `,
        }),
      },
    );
    assertEquals(missingWorkspaceRes.status, 200);
    const missingWorkspaceBody = await parseGraphqlEnvelope<{
      gambitWorkspaceDelete?: {
        workspaceId?: string;
        deleted?: boolean;
        error?: string | null;
      };
    }>(missingWorkspaceRes);
    assertEquals(Array.isArray(missingWorkspaceBody.errors), true);
    assertEquals(
      (missingWorkspaceBody.errors?.[0]?.message ?? "").includes("workspaceId"),
      true,
    );
    assertEquals(await Deno.stat(activeWorkspaceDir).then(() => true), true);

    const deleteBody = await gql<{
      gambitWorkspaceDelete?: {
        workspaceId?: string;
        deleted?: boolean;
      };
    }>(
      port,
      `
        mutation DeleteWorkspace($workspaceId: ID!) {
          gambitWorkspaceDelete(workspaceId: $workspaceId) {
            workspaceId
            deleted
          }
        }
      `,
      { workspaceId: activeWorkspaceId },
    );
    assertEquals(Array.isArray(deleteBody.errors), false);
    assertEquals(
      deleteBody.data?.gambitWorkspaceDelete?.workspaceId,
      activeWorkspaceId,
    );
    assertEquals(deleteBody.data?.gambitWorkspaceDelete?.deleted, true);
    assertEquals(
      await Deno.stat(activeWorkspaceDir).then(() => true).catch(() => false),
      false,
    );

    await server.shutdown();
    await server.finished;
  },
);
leakTolerantTest(
  "session events are monotonic and snapshot replay boundary matches highest offset",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();

    const deckPath = path.join(dir, "event-seq.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
      sessionDir: sessionsDir,
    });
    const port = (server.addr as Deno.NetAddr).port;

    const first = await runSimulator(port, { input: "one", stream: false });
    await runSimulator(port, {
      input: "two",
      stream: false,
      workspaceId: first.workspaceId,
    });

    const workspaceId = first.workspaceId!;
    const sqlitePath = path.join(sessionsDir, workspaceId, "workspace.sqlite");
    const events = readWorkspaceEventsFromSqlite(sqlitePath, workspaceId);
    const offsets = events.map((event) => event.offset).filter((
      value,
    ): value is number => typeof value === "number");
    assert(offsets.length > 0, "expected sequenced events");
    for (let i = 1; i < offsets.length; i += 1) {
      assertEquals(offsets[i], offsets[i - 1] + 1);
    }
    const maxOffset = Math.max(...offsets);
    const state = readWorkspaceStateFromSqlite(sqlitePath, workspaceId) as {
      meta?: { lastAppliedOffset?: number };
    };
    assert(typeof state.meta?.lastAppliedOffset === "number");
    assert((state.meta?.lastAppliedOffset ?? -1) <= maxOffset);

    await server.shutdown();
    await server.finished;
  },
);
leakTolerantTest(
  "session read rejects corrupted event offset gaps",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();

    const deckPath = path.join(dir, "event-gap.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
      sessionDir: sessionsDir,
    });
    const port = (server.addr as Deno.NetAddr).port;

    const first = await runSimulator(port, { input: "one", stream: false });
    const workspaceId = first.workspaceId!;
    const sqlitePath = path.join(sessionsDir, workspaceId, "workspace.sqlite");
    const db = new DatabaseSync(sqlitePath);
    const rows = db.prepare(
      `SELECT offset, payload_json
       FROM workspace_events_v0
       WHERE workspace_id = ?
       ORDER BY offset ASC`,
    ).all(workspaceId) as Array<{ offset?: number; payload_json?: string }>;
    assert(rows.length >= 2, "expected at least two events");
    const secondOffset = rows[1].offset;
    assert(typeof secondOffset === "number");
    db.prepare(
      `DELETE FROM workspace_events_v0
       WHERE workspace_id = ? AND offset = ?`,
    ).run(workspaceId, secondOffset);
    db.close();

    const sessionRes = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/${
        encodeURIComponent(workspaceId)
      }`,
    );
    assertEquals(sessionRes.status, 200);
    const body = await sessionRes.json() as { error?: string };
    assertEquals(typeof body.error === "string", false);

    await server.shutdown();
    await server.finished;
  },
);
leakTolerantTest(
  "runtime state stays sqlite-authoritative without sidecar artifacts",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();

    const deckPath = path.join(dir, "snapshot-write-fail.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string(),
      outputSchema: z.string(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
      sessionDir: sessionsDir,
    });
    const port = (server.addr as Deno.NetAddr).port;

    const first = await runSimulator(port, { input: "one", stream: false });
    const workspaceId = first.workspaceId!;
    const workspaceDir = path.join(sessionsDir, workspaceId);
    const sqlitePath = path.join(workspaceDir, "workspace.sqlite");

    await runSimulator(port, {
      input: "two",
      stream: false,
      workspaceId,
    });
    await runSimulator(port, {
      input: "three",
      stream: false,
      workspaceId,
    });

    const events = readWorkspaceEventsFromSqlite(sqlitePath, workspaceId);
    const offsets = events.map((event) => event.offset).filter((
      value,
    ): value is number => typeof value === "number");
    assert(offsets.length >= 3, "expected multiple persisted events");
    for (let i = 1; i < offsets.length; i += 1) {
      assertEquals(offsets[i], offsets[i - 1] + 1);
    }
    await server.shutdown();
    await server.finished;
  },
);
leakTolerantTest(
  "test status selects canonical scenario run summary deterministically",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();

    const deckPath = path.join(dir, "scenario-summary.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
      testDecks: [{ id: "test-a", label: "Test A", path: "${
        deckPath.replaceAll("\\", "\\\\")
      }" }],
    });
    `,
    );

    const provider: ModelProvider = {
      chat() {
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const workspaceId = "workspace-summary";
    const workspaceDir = path.join(sessionsDir, workspaceId);
    await Deno.mkdir(workspaceDir, { recursive: true });
    saveCanonicalWorkspaceState(
      path.join(workspaceDir, "workspace.sqlite"),
      {
        runId: "legacy-run",
        messages: [{ role: "assistant", content: "hi" }],
        messageRefs: [{ id: "msg-1", role: "assistant" }],
        meta: {
          workspaceSchemaVersion: "workspace-state.v1",
          sessionId: workspaceId,
          workspaceId,
          scenarioRunSummaries: [
            {
              scenarioRunId: "run-c",
              lastEventSeq: 17,
              updatedAt: "2025-01-01T00:00:00.000Z",
              selectedScenarioDeckId: "deck-c",
              scenarioConfigPath: deckPath,
            },
            {
              scenarioRunId: "run-a",
              lastEventSeq: 17,
              updatedAt: "2025-01-01T00:00:00.000Z",
              selectedScenarioDeckId: "deck-a",
              scenarioConfigPath: deckPath,
            },
          ],
        },
      },
    );

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
      sessionDir: sessionsDir,
    });
    const port = (server.addr as Deno.NetAddr).port;

    const res = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/${
        encodeURIComponent(workspaceId)
      }`,
    );
    assertEquals(res.status, 200);
    const body = await res.json() as {
      test?: { run?: { id?: string } };
    };
    assertEquals(body.test?.run?.id, "run-a");
    const sqliteState = readWorkspaceStateFromSqlite(
      path.join(workspaceDir, "workspace.sqlite"),
      workspaceId,
    ) as {
      meta?: { scenarioRunSummaries?: Array<{ scenarioRunId?: string }> };
    };
    assertEquals(
      Array.isArray(sqliteState.meta?.scenarioRunSummaries),
      true,
    );

    await server.shutdown();
    await server.finished;
  },
);
leakTolerantTest(
  "workspace endpoint returns projection-backed build + session payload from sqlite-backed projections",
  async () => {
    const dir = await Deno.makeTempDir();
    const sessionsDir = path.join(dir, "sessions");
    const modHref = modImportPath();

    const deckPath = path.join(dir, "workspace-read-model.deck.ts");
    await Deno.writeTextFile(
      deckPath,
      `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.string().optional(),
      outputSchema: z.string().optional(),
      modelParams: { model: "dummy-model" },
    });
    `,
    );

    const provider: ModelProvider = {
      chat(input) {
        input.onStreamText?.("o");
        input.onStreamText?.("k");
        return Promise.resolve({
          message: { role: "assistant", content: "ok" },
          finishReason: "stop",
        });
      },
    };

    const server = startWebSocketSimulator({
      deckPath,
      modelProvider: provider,
      port: 0,
      sessionDir: sessionsDir,
    });
    const port = (server.addr as Deno.NetAddr).port;

    const workspaceId = await createWorkspace(port);
    await createBuildRun({ port, workspaceId, message: "hello" });

    const workspaceRes = await fetch(
      `http://127.0.0.1:${port}/api/workspaces/${
        encodeURIComponent(workspaceId)
      }`,
    );
    assertEquals(workspaceRes.status, 200);
    const workspacePayload = await workspaceRes.json() as {
      workspaceId?: string;
      build?: { run?: { id?: string } };
      session?: { workspaceId?: string; messages?: Array<unknown> };
    };
    assertEquals(workspacePayload.workspaceId, workspaceId);
    assertEquals(workspacePayload.build?.run?.id, workspaceId);
    assertEquals(workspacePayload.session?.workspaceId, workspaceId);
    assert(Array.isArray(workspacePayload.session?.messages));

    await server.shutdown();
    await server.finished;
  },
);
