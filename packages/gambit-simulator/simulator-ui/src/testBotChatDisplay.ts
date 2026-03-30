import {
  type BuildDisplayMessage,
  deriveReasoningByAssistant,
  summarizeToolCalls,
  type TestBotRun,
  type TraceEvent,
} from "./utils.ts";

export function buildTestBotChatDisplay(
  run: TestBotRun,
): Array<BuildDisplayMessage> {
  const toolCallSummaries = summarizeToolCalls(run.traces ?? []);
  const reasoningByAssistant = deriveReasoningByAssistant(run.traces);

  const deriveInsertsFromTraces = (
    traces: Array<TraceEvent>,
    messageCount: number,
  ) => {
    const inserts: Array<{
      runId?: string;
      actionCallId?: string;
      parentActionCallId?: string;
      name?: string;
      index: number;
    }> = [];
    let messageIndex = 0;
    for (const trace of traces) {
      if (!trace || typeof trace !== "object") continue;
      const traceRecord = trace as Record<string, unknown>;
      const type = typeof traceRecord.type === "string" ? traceRecord.type : "";
      if (type === "message.user") {
        messageIndex++;
        continue;
      }
      if (type === "model.result") {
        const finishReason = typeof traceRecord.finishReason === "string"
          ? traceRecord.finishReason
          : "";
        if (finishReason !== "tool_calls") {
          messageIndex++;
        }
        continue;
      }
      if (type === "tool.call") {
        const runId = typeof traceRecord.runId === "string"
          ? traceRecord.runId
          : undefined;
        const actionCallId = typeof traceRecord.actionCallId === "string"
          ? traceRecord.actionCallId
          : undefined;
        const parentActionCallId =
          typeof traceRecord.parentActionCallId === "string"
            ? traceRecord.parentActionCallId
            : undefined;
        const name = typeof traceRecord.name === "string"
          ? traceRecord.name
          : undefined;
        inserts.push({
          runId,
          actionCallId,
          parentActionCallId,
          name,
          index: Math.min(messageIndex, messageCount),
        });
      }
    }
    return inserts;
  };

  const toolBuckets = (() => {
    const map = new Map<number, ReturnType<typeof summarizeToolCalls>>();
    if (!toolCallSummaries.length) return map;
    const traceInserts = Array.isArray(run.traces) && run.traces.length > 0
      ? deriveInsertsFromTraces(run.traces, run.messages.length)
      : [];
    const insertMap = new Map<
      string,
      { index: number; name?: string; parentActionCallId?: string }
    >();
    const callKey = (runId: string | undefined, actionCallId: string) =>
      `${runId ?? ""}:${actionCallId}`;
    const inserts = traceInserts.length > 0 ? traceInserts : run.toolInserts ??
      [];
    inserts.forEach((insert) => {
      if (
        typeof insert?.index === "number" &&
        insert.index >= 0 &&
        insert.actionCallId
      ) {
        const insertRunId = typeof (insert as { runId?: unknown }).runId ===
            "string"
          ? (insert as { runId?: string }).runId
          : undefined;
        insertMap.set(callKey(insertRunId, insert.actionCallId), {
          index: insert.index,
          name: insert.name ?? undefined,
          parentActionCallId: insert.parentActionCallId ?? undefined,
        });
      }
    });
    for (const call of toolCallSummaries) {
      const insert = call.actionCallId
        ? insertMap.get(callKey(call.runId, call.actionCallId))
        : undefined;
      const index = insert?.index ?? run.messages.length;
      const enriched = insert
        ? {
          ...call,
          name: call.name ?? insert.name,
          parentActionCallId: call.parentActionCallId ??
            insert.parentActionCallId,
        }
        : call;
      const bucket = map.get(index);
      if (bucket) {
        bucket.push(enriched);
      } else {
        map.set(index, [enriched]);
      }
    }
    return map;
  })();

  const entries: Array<BuildDisplayMessage> = [];
  const pushToolBucket = (index: number) => {
    const bucket = toolBuckets.get(index);
    if (!bucket || bucket.length === 0) return;
    bucket.forEach((call, callIndex) => {
      entries.push({
        kind: "tool",
        toolCallId: call.id || call.actionCallId ||
          `tool-${index}-${callIndex}`,
        toolSummary: call,
      });
    });
  };
  const pushReasoningBucket = (assistantIndex: number) => {
    const bucket = reasoningByAssistant.get(assistantIndex);
    if (!bucket || bucket.length === 0) return;
    bucket.forEach((detail, detailIndex) => {
      const reasoningRaw = detail.event &&
          typeof detail.event === "object" &&
          !Array.isArray(detail.event)
        ? detail.event as Record<string, unknown>
        : undefined;
      entries.push({
        kind: "reasoning",
        reasoningId: `${assistantIndex}-${detailIndex}`,
        content: detail.text,
        reasoningRaw,
      });
    });
  };

  pushToolBucket(0);
  let assistantIndex = -1;
  run.messages.forEach((message, messageIndex) => {
    if (message.role === "assistant") {
      assistantIndex += 1;
      pushReasoningBucket(assistantIndex);
    }
    entries.push({
      kind: "message",
      role: message.role === "user" ? "user" : "assistant",
      content: message.content,
    });
    pushToolBucket(messageIndex + 1);
  });

  return entries;
}
