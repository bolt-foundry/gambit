import { type BuildDisplayMessage, type FeedbackEntry } from "./utils.ts";

type TranscriptFeedback = {
  id: string;
  runId: string;
  messageRefId: string;
  score: number;
  reason?: string | null;
  createdAt?: string | null;
};

type TranscriptGraphqlEntry =
  | {
    asWorkspaceConversationTranscriptMessage?: {
      id?: string | null;
      role?: string | null;
      content?: string | null;
      messageRefId?: string | null;
      feedbackEligible?: boolean | null;
      feedback?: TranscriptFeedback | null;
    } | null;
    asWorkspaceConversationTranscriptReasoning?: {
      id?: string | null;
      summary?: string | null;
      reasoningType?: string | null;
    } | null;
    asWorkspaceConversationTranscriptToolCall?: {
      id?: string | null;
      toolCallId?: string | null;
      toolName?: string | null;
      status?: string | null;
      argumentsText?: string | null;
      resultText?: string | null;
      error?: string | null;
    } | null;
  }
  | null
  | undefined;

export type ParsedTranscriptEntry =
  | {
    kind: "message";
    id: string;
    role: "user" | "assistant";
    content: string;
    messageRefId?: string;
    feedbackEligible: boolean;
    feedback?: FeedbackEntry;
  }
  | {
    kind: "reasoning";
    id: string;
    summary: string;
    reasoningType?: string | null;
  }
  | {
    kind: "tool";
    id: string;
    toolCallId: string;
    toolName: string;
    status: "RUNNING" | "COMPLETED" | "ERROR";
    argumentsText?: string | null;
    resultText?: string | null;
    error?: string | null;
  };

export type OptimisticTranscriptEntry =
  | {
    __typename: "WorkspaceConversationTranscriptMessage";
    id: string;
    role: "user" | "assistant";
    content: string;
    messageRefId?: string | null;
    feedbackEligible: boolean;
    feedback: TranscriptFeedback | null;
  }
  | {
    __typename: "WorkspaceConversationTranscriptReasoning";
    id: string;
    summary: string;
    reasoningType?: string | null;
  }
  | {
    __typename: "WorkspaceConversationTranscriptToolCall";
    id: string;
    toolCallId: string;
    toolName: string;
    status: "RUNNING" | "COMPLETED" | "ERROR";
    argumentsText?: string | null;
    resultText?: string | null;
    error?: string | null;
  };

function toMessageRole(value: unknown): "user" | "assistant" {
  return value === "user" ? "user" : "assistant";
}

function toTranscriptToolCallStatus(
  value: unknown,
): "RUNNING" | "COMPLETED" | "ERROR" {
  return value === "COMPLETED" || value === "ERROR" ? value : "RUNNING";
}

function normalizeFeedbackEntry(
  feedback: TranscriptFeedback | null | undefined,
): FeedbackEntry | undefined {
  if (!feedback) return undefined;
  return {
    id: feedback.id,
    runId: feedback.runId,
    messageRefId: feedback.messageRefId,
    score: feedback.score,
    reason: feedback.reason ?? undefined,
    createdAt: feedback.createdAt ?? undefined,
  };
}

function parseStructuredText(value: string | null | undefined): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function parseTranscriptEntries(
  entries: ReadonlyArray<TranscriptGraphqlEntry> | null | undefined,
): Array<ParsedTranscriptEntry> {
  const parsedEntries: Array<ParsedTranscriptEntry> = [];
  for (const entry of entries ?? []) {
    const message = entry?.asWorkspaceConversationTranscriptMessage;
    if (message?.id && message.role) {
      parsedEntries.push({
        kind: "message",
        id: message.id,
        role: toMessageRole(message.role),
        content: message.content ?? "",
        messageRefId: message.messageRefId ?? undefined,
        feedbackEligible: message.feedbackEligible === true,
        feedback: normalizeFeedbackEntry(message.feedback),
      });
      continue;
    }
    const reasoning = entry?.asWorkspaceConversationTranscriptReasoning;
    if (reasoning?.id) {
      parsedEntries.push({
        kind: "reasoning",
        id: reasoning.id,
        summary: reasoning.summary ?? "",
        reasoningType: reasoning.reasoningType ?? null,
      });
      continue;
    }
    const toolCall = entry?.asWorkspaceConversationTranscriptToolCall;
    if (toolCall?.id && toolCall.toolCallId && toolCall.toolName) {
      parsedEntries.push({
        kind: "tool",
        id: toolCall.id,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        status: toTranscriptToolCallStatus(toolCall.status),
        argumentsText: toolCall.argumentsText ?? null,
        resultText: toolCall.resultText ?? null,
        error: toolCall.error ?? null,
      });
    }
  }
  return parsedEntries;
}

export function getTranscriptMessages(
  entries: ReadonlyArray<ParsedTranscriptEntry>,
): Array<Extract<ParsedTranscriptEntry, { kind: "message" }>> {
  return entries.filter((
    entry,
  ): entry is Extract<ParsedTranscriptEntry, { kind: "message" }> =>
    entry.kind === "message"
  );
}

export function countTranscriptMessages(
  entries: ReadonlyArray<ParsedTranscriptEntry>,
): number {
  return getTranscriptMessages(entries).length;
}

export function countTranscriptUserMessages(
  entries: ReadonlyArray<ParsedTranscriptEntry>,
): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.kind === "message" && entry.role === "user") {
      count += 1;
    }
  }
  return count;
}

export function toOptimisticTranscriptEntries(
  entries: ReadonlyArray<ParsedTranscriptEntry>,
): Array<OptimisticTranscriptEntry> {
  return entries.map((entry) => {
    switch (entry.kind) {
      case "message":
        return {
          __typename: "WorkspaceConversationTranscriptMessage",
          id: entry.id,
          role: entry.role,
          content: entry.content,
          messageRefId: entry.messageRefId ?? null,
          feedbackEligible: entry.feedbackEligible,
          feedback: entry.feedback
            ? {
              id: entry.feedback.id,
              runId: entry.feedback.runId,
              messageRefId: entry.feedback.messageRefId,
              score: entry.feedback.score,
              reason: entry.feedback.reason ?? null,
              createdAt: entry.feedback.createdAt ?? null,
            }
            : null,
        };
      case "reasoning":
        return {
          __typename: "WorkspaceConversationTranscriptReasoning",
          id: entry.id,
          summary: entry.summary,
          reasoningType: entry.reasoningType ?? null,
        };
      case "tool":
        return {
          __typename: "WorkspaceConversationTranscriptToolCall",
          id: entry.id,
          toolCallId: entry.toolCallId,
          toolName: entry.toolName,
          status: entry.status,
          argumentsText: entry.argumentsText ?? null,
          resultText: entry.resultText ?? null,
          error: entry.error ?? null,
        };
    }
  });
}

export function toBuildDisplayEntries(
  entries: ReadonlyArray<ParsedTranscriptEntry>,
): Array<BuildDisplayMessage> {
  return entries.map((entry) => {
    switch (entry.kind) {
      case "message":
        return {
          kind: "message",
          id: entry.id,
          role: entry.role,
          content: entry.content,
          messageRefId: entry.messageRefId ?? null,
          feedbackEligible: entry.feedbackEligible,
          feedback: entry.feedback,
        };
      case "reasoning":
        return {
          kind: "reasoning",
          reasoningId: entry.id,
          content: entry.summary,
          reasoningType: entry.reasoningType ?? undefined,
        };
      case "tool":
        return {
          kind: "tool",
          toolCallId: entry.toolCallId,
          toolSummary: {
            key: entry.id,
            id: entry.toolCallId,
            name: entry.toolName,
            status: entry.status === "COMPLETED"
              ? "completed"
              : entry.status === "ERROR"
              ? "error"
              : "running",
            args: parseStructuredText(entry.argumentsText),
            result: parseStructuredText(entry.resultText),
            error: parseStructuredText(entry.error),
          },
        };
    }
  });
}
