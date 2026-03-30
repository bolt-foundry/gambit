import { assertEquals } from "@std/assert";
import {
  parseWorkbenchSelectedContextChips,
  toWorkbenchMessageContext,
  type WorkbenchSelectedContextChip,
} from "./workbenchContext.ts";
import {
  mergeWorkbenchSelectedContextChip,
  readPersistedWorkbenchSelectedContextChips,
  replaceWorkbenchSelectedContextChips,
  resolveWorkbenchSelectedContextChips,
} from "./workbenchChipStore.ts";
import {
  decodeWorkbenchMessageWithContext,
  encodeWorkbenchMessageWithContext,
} from "./Chat.tsx";

Deno.test("workbench chip parsing keeps supported chip types", () => {
  const chips = parseWorkbenchSelectedContextChips([
    {
      chipId: "rating:msg-1:feedback-1",
      source: "message_rating",
      workspaceId: "ws-1",
      runId: "run-1",
      capturedAt: "2026-03-10T00:00:00.000Z",
      messageRefId: "msg-1",
      score: 1,
      reason: "Helpful answer",
      enabled: true,
    },
    {
      chipId: "grader_run_error:run-1",
      source: "grader_run_error",
      workspaceId: "ws-1",
      runId: "run-1",
      capturedAt: "2026-03-10T00:00:00.000Z",
      error: "grader failed",
      enabled: true,
    },
    {
      chipId: "verify:outlier-1",
      source: "verify_outlier",
      workspaceId: "ws-1",
      capturedAt: "2026-03-10T00:00:01.000Z",
      scenarioRunId: "scenario-run-1",
      batchId: "batch-1",
      score: -1,
      instability: true,
      message: "Outlier spread detected",
      enabled: false,
    },
    {
      chipId: "",
      source: "scenario_run_error",
      capturedAt: "2026-03-10T00:00:02.000Z",
      error: "ignored",
    },
  ]);

  assertEquals(chips.length, 3);
  assertEquals(chips[0]?.source, "message_rating");
  assertEquals(chips[1]?.source, "grader_run_error");
  assertEquals(chips[2]?.source, "verify_outlier");
  assertEquals(chips[2]?.enabled, false);
});

Deno.test("mergeWorkbenchSelectedContextChip replaces matching chip ids", () => {
  const base: Array<WorkbenchSelectedContextChip> = [{
    chipId: "flag:ref-1",
    source: "grading_flag",
    workspaceId: "ws-1",
    runId: "run-1",
    capturedAt: "2026-03-10T00:00:00.000Z",
    refId: "ref-1",
    message: "Initial message",
    enabled: false,
  }];

  const next = mergeWorkbenchSelectedContextChip(base, {
    chipId: "flag:ref-1",
    source: "grading_flag",
    workspaceId: "ws-1",
    runId: "run-1",
    capturedAt: "2026-03-10T00:00:01.000Z",
    refId: "ref-1",
    message: "Updated message",
    enabled: true,
  });

  assertEquals(next.length, 1);
  const [chip] = next;
  if (!chip || chip.source !== "grading_flag") {
    throw new Error("Expected grading flag chip");
  }
  assertEquals(chip.message, "Updated message");
  assertEquals(chip.enabled, true);
});

Deno.test("workbench message transport round-trips rating, grader, and verify chips", () => {
  const chips: Array<WorkbenchSelectedContextChip> = [
    {
      chipId: "rating:msg-1:feedback-1",
      source: "message_rating",
      workspaceId: "ws-1",
      runId: "run-1",
      capturedAt: "2026-03-10T00:00:00.000Z",
      messageRefId: "msg-1",
      score: 1,
      reason: "Helpful answer",
      enabled: true,
    },
    {
      chipId: "grader_run_error:run-1",
      source: "grader_run_error",
      workspaceId: "ws-1",
      runId: "run-2",
      capturedAt: "2026-03-10T00:00:01.000Z",
      error: "grader failed",
      enabled: true,
    },
    {
      chipId: "verify:outlier-1",
      source: "verify_outlier",
      workspaceId: "ws-1",
      runId: "grade-run-1",
      capturedAt: "2026-03-10T00:00:02.000Z",
      batchId: "batch-1",
      scenarioRunId: "scenario-run-1",
      messageRefId: "ref-1",
      score: -1,
      instability: true,
      message: "Outlier spread detected",
      enabled: true,
    },
  ];

  const encoded = encodeWorkbenchMessageWithContext(
    "Investigate this",
    chips.map((chip) => toWorkbenchMessageContext(chip)),
  );
  const decoded = decodeWorkbenchMessageWithContext(encoded);

  assertEquals(decoded?.body, "Investigate this");
  assertEquals(decoded?.contexts.length, 3);
  assertEquals(decoded?.contexts[0]?.source, "message_rating");
  assertEquals(decoded?.contexts[1]?.source, "grader_run_error");
  assertEquals(decoded?.contexts[2]?.source, "verify_outlier");
});

Deno.test("workbench chip store falls back to persisted chips when query payload resets empty", () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const storage = new Map<string, string>();
  const localStorageStub = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorageStub,
  });

  try {
    const workspaceId = "ws-persisted";
    const chips: Array<WorkbenchSelectedContextChip> = [{
      chipId: "rating:msg-1:feedback-1",
      source: "message_rating",
      workspaceId,
      runId: "run-1",
      capturedAt: "2026-03-10T00:00:00.000Z",
      messageRefId: "msg-1",
      score: 1,
      reason: "Helpful answer",
      enabled: true,
    }];
    const normalizedChips = parseWorkbenchSelectedContextChips(chips);

    replaceWorkbenchSelectedContextChips(undefined, chips, workspaceId);

    assertEquals(
      readPersistedWorkbenchSelectedContextChips(workspaceId),
      normalizedChips,
    );
    assertEquals(
      resolveWorkbenchSelectedContextChips(workspaceId, []),
      normalizedChips,
    );
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    } else {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  }
});
