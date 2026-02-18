import React, { useCallback, useEffect, useRef, useState } from "react";
import Badge from "./gds/Badge.tsx";
import Icon from "./gds/Icon.tsx";
import ActivityReasoningBubble from "./ActivityReasoningBubble.tsx";
import ToolCallBubble from "./ToolCallBubble.tsx";
import {
  type BuildDisplayMessage,
  classNames,
  renderMarkdown,
} from "./utils.ts";

export type BuildChatTranscriptBucket =
  | {
    kind: "message";
    key: string;
    entry: BuildDisplayMessage & { kind: "message" };
  }
  | {
    kind: "activity";
    key: string;
    entries: BuildDisplayMessage[];
    latestContent: string;
    latestToolLabel: string | null;
    currentToolLabel: string | null;
    reasoningCount: number;
    toolCount: number;
  };

type ActivityBadgeKey = "reasoning" | "tool";
type ActivityBadgeFlashState = Record<ActivityBadgeKey, boolean>;
type ActivityCountSnapshot = Record<ActivityBadgeKey, number>;

function findScrollableAncestor(
  element: HTMLElement | null,
): HTMLElement | null {
  let current = element?.parentElement ?? null;
  while (current) {
    const { overflowY } = globalThis.getComputedStyle(current);
    if (
      (overflowY === "auto" || overflowY === "scroll" ||
        overflowY === "overlay") &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function bucketBuildChatDisplay(
  display: BuildDisplayMessage[],
): BuildChatTranscriptBucket[] {
  const buckets: BuildChatTranscriptBucket[] = [];
  let index = 0;
  while (index < display.length) {
    const entry = display[index];
    if (entry.kind === "message") {
      buckets.push({
        kind: "message",
        key: `message-${index}-${entry.role ?? "assistant"}`,
        entry: entry as BuildDisplayMessage & { kind: "message" },
      });
      index += 1;
      continue;
    }
    if (entry.kind === "tool" || entry.kind === "reasoning") {
      const grouped: BuildDisplayMessage[] = [];
      let cursor = index;
      let reasoningCount = 0;
      let toolCount = 0;
      while (cursor < display.length && display[cursor].kind !== "message") {
        const nextEntry = display[cursor];
        grouped.push(nextEntry);
        if (nextEntry.kind === "reasoning") {
          reasoningCount += 1;
        } else if (nextEntry.kind === "tool") {
          toolCount += 1;
        }
        cursor += 1;
      }
      let latestContent = "";
      let latestToolLabel: string | null = null;
      let currentToolLabel: string | null = null;
      let latestReasoningIndex = -1;
      grouped.forEach((nextEntry, nextEntryIndex) => {
        if (nextEntry.kind === "reasoning") {
          if (
            typeof nextEntry.content === "string" && nextEntry.content.trim()
          ) {
            latestContent = nextEntry.content;
          }
          latestReasoningIndex = nextEntryIndex;
          return;
        }
        if (nextEntry.kind === "tool" && nextEntry.toolSummary) {
          const rawName = nextEntry.toolSummary.name;
          const toolLabel = typeof rawName === "string" && rawName.length > 0
            ? `Tool call: ${rawName}`
            : "Tool call";
          latestToolLabel = toolLabel;
          currentToolLabel = toolLabel;
        }
      });
      if (latestReasoningIndex >= 0) {
        currentToolLabel = null;
        for (
          let entryIdx = latestReasoningIndex + 1;
          entryIdx < grouped.length;
          entryIdx += 1
        ) {
          const nextEntry = grouped[entryIdx];
          if (nextEntry.kind !== "tool" || !nextEntry.toolSummary) continue;
          const rawName = nextEntry.toolSummary.name;
          currentToolLabel = typeof rawName === "string" && rawName.length > 0
            ? `Tool call: ${rawName}`
            : "Tool call";
        }
      }
      buckets.push({
        kind: "activity",
        key: `activity-${index}`,
        entries: grouped,
        latestContent,
        latestToolLabel,
        currentToolLabel,
        reasoningCount,
        toolCount,
      });
      if (cursor === index) {
        index += 1;
        continue;
      }
      index = cursor;
      continue;
    }
    index += 1;
  }
  return buckets;
}

export function ActivityTranscriptRows(props: {
  display: BuildDisplayMessage[];
  renderMessage: (
    entry: BuildDisplayMessage & { kind: "message" },
    messageOrdinal: number,
  ) => React.ReactNode;
  previewToolWhenNoReasoning?: boolean;
}) {
  const { display, renderMessage, previewToolWhenNoReasoning = false } = props;
  const [activityBucketsOpen, setActivityBucketsOpen] = useState<
    Record<string, boolean>
  >({});
  const [activityBadgeFlash, setActivityBadgeFlash] = useState<
    Record<string, ActivityBadgeFlashState>
  >({});
  const activityBadgeTimersRef = useRef<
    Record<
      string,
      Partial<Record<ActivityBadgeKey, ReturnType<typeof setTimeout>>>
    >
  >({});
  const activityRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousActivityCountsRef = useRef<
    Record<string, ActivityCountSnapshot>
  >(
    {},
  );
  const rows: React.ReactNode[] = [];
  const buckets = bucketBuildChatDisplay(display);

  const clearActivityBadgeFlashTimer = useCallback(
    (bucketKey: string, badgeKey: ActivityBadgeKey) => {
      const bucketTimers = activityBadgeTimersRef.current[bucketKey];
      if (!bucketTimers) return;
      const timerId = bucketTimers[badgeKey];
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
      delete bucketTimers[badgeKey];
      if (
        bucketTimers.reasoning === undefined && bucketTimers.tool === undefined
      ) {
        delete activityBadgeTimersRef.current[bucketKey];
      }
    },
    [],
  );

  const triggerActivityBadgeFlash = useCallback(
    (bucketKey: string, badgeKey: ActivityBadgeKey) => {
      setActivityBadgeFlash((prev) => ({
        ...prev,
        [bucketKey]: {
          reasoning: prev[bucketKey]?.reasoning ?? false,
          tool: prev[bucketKey]?.tool ?? false,
          [badgeKey]: true,
        },
      }));

      clearActivityBadgeFlashTimer(bucketKey, badgeKey);

      const bucketTimers = activityBadgeTimersRef.current[bucketKey] ?? {};
      bucketTimers[badgeKey] = setTimeout(() => {
        clearActivityBadgeFlashTimer(bucketKey, badgeKey);
        setActivityBadgeFlash((prev) => {
          const existing = prev[bucketKey];
          if (!existing) return prev;
          const nextBucketState: ActivityBadgeFlashState = {
            reasoning: badgeKey === "reasoning" ? false : existing.reasoning,
            tool: badgeKey === "tool" ? false : existing.tool,
          };
          if (!nextBucketState.reasoning && !nextBucketState.tool) {
            const { [bucketKey]: _, ...rest } = prev;
            return rest;
          }
          return {
            ...prev,
            [bucketKey]: nextBucketState,
          };
        });
      }, 1500);
      activityBadgeTimersRef.current[bucketKey] = bucketTimers;
    },
    [clearActivityBadgeFlashTimer],
  );

  const handleActivityBucketToggle = useCallback(
    (bucketKey: string, isOpen: boolean) => {
      let adjustScroll: (() => void) | null = null;
      if (isOpen) {
        const rowElement = activityRowRefs.current[bucketKey];
        const scrollContainer = findScrollableAncestor(rowElement ?? null);
        const nextElement =
          rowElement?.nextElementSibling instanceof HTMLElement
            ? rowElement.nextElementSibling
            : null;
        const anchorElement = nextElement ?? rowElement ?? null;

        if (scrollContainer && anchorElement) {
          const anchorTopBefore = anchorElement.getBoundingClientRect().top;
          adjustScroll = () => {
            const anchorTopAfter = anchorElement.getBoundingClientRect().top;
            const delta = anchorTopAfter - anchorTopBefore;
            if (Math.abs(delta) < 0.5) return;
            scrollContainer.scrollTop += delta;
          };
        }
      }

      setActivityBucketsOpen((prev) => ({
        ...prev,
        [bucketKey]: !prev[bucketKey],
      }));

      if (adjustScroll) {
        requestAnimationFrame(adjustScroll);
      }
    },
    [],
  );

  useEffect(() => {
    const nextCounts: Record<string, ActivityCountSnapshot> = {};
    const activeBucketKeys = new Set<string>();

    buckets.forEach((bucket) => {
      if (bucket.kind !== "activity") return;
      activeBucketKeys.add(bucket.key);
      nextCounts[bucket.key] = {
        reasoning: bucket.reasoningCount,
        tool: bucket.toolCount,
      };
      const previousCounts = previousActivityCountsRef.current[bucket.key];
      if (!previousCounts) return;
      if (bucket.reasoningCount > previousCounts.reasoning) {
        triggerActivityBadgeFlash(bucket.key, "reasoning");
      }
      if (bucket.toolCount > previousCounts.tool) {
        triggerActivityBadgeFlash(bucket.key, "tool");
      }
    });

    Object.keys(previousActivityCountsRef.current).forEach((bucketKey) => {
      if (activeBucketKeys.has(bucketKey)) return;
      clearActivityBadgeFlashTimer(bucketKey, "reasoning");
      clearActivityBadgeFlashTimer(bucketKey, "tool");
    });

    previousActivityCountsRef.current = nextCounts;

    setActivityBadgeFlash((prev) => {
      let changed = false;
      const next: Record<string, ActivityBadgeFlashState> = {};
      Object.entries(prev).forEach(([bucketKey, value]) => {
        if (!activeBucketKeys.has(bucketKey)) {
          changed = true;
          return;
        }
        if (!value.reasoning && !value.tool) {
          changed = true;
          return;
        }
        next[bucketKey] = value;
      });
      return changed ? next : prev;
    });
  }, [buckets, clearActivityBadgeFlashTimer, triggerActivityBadgeFlash]);

  useEffect(() => {
    return () => {
      Object.entries(activityBadgeTimersRef.current).forEach(([
        bucketKey,
        bucketTimers,
      ]) => {
        if (bucketTimers.reasoning !== undefined) {
          clearTimeout(bucketTimers.reasoning);
        }
        if (bucketTimers.tool !== undefined) {
          clearTimeout(bucketTimers.tool);
        }
        delete activityBadgeTimersRef.current[bucketKey];
      });
    };
  }, []);

  let messageOrdinal = 0;
  buckets.forEach((bucket) => {
    if (bucket.kind === "message") {
      rows.push(renderMessage(bucket.entry, messageOrdinal));
      messageOrdinal += 1;
      return;
    }
    if (bucket.kind === "activity") {
      const isOpen = Boolean(activityBucketsOpen[bucket.key]);
      const latestReasoning = bucket.latestContent.trim().length > 0
        ? bucket.latestContent
        : bucket.reasoningCount > 0
        ? "Reasoning in progress"
        : "";
      const previewToolLabel = previewToolWhenNoReasoning &&
          latestReasoning.length === 0
        ? bucket.currentToolLabel ?? bucket.latestToolLabel
        : null;
      rows.push(
        <div
          key={bucket.key}
          className="tool-calls-collapsible activity-collapsible"
          ref={(element) => {
            activityRowRefs.current[bucket.key] = element;
          }}
        >
          <button
            type="button"
            className={classNames(
              "tool-calls-toggle activity-toggle",
              isOpen && "is-open",
            )}
            onClick={() => handleActivityBucketToggle(bucket.key, isOpen)}
          >
            <span className="tool-calls-toggle-label">
              <span className="activity-toggle-title">Activity</span>
              <Badge
                variant="ghost"
                className={classNames(
                  "activity-count-badge activity-count-badge-reasoning",
                  activityBadgeFlash[bucket.key]?.reasoning && "is-highlight",
                )}
                tooltip={bucket.latestContent}
              >
                Reasoning: {bucket.reasoningCount}
              </Badge>
              <Badge
                variant="ghost"
                className={classNames(
                  "activity-count-badge activity-count-badge-tool",
                  activityBadgeFlash[bucket.key]?.tool && "is-highlight",
                )}
                tooltip={bucket.latestToolLabel}
              >
                Tool calls: {bucket.toolCount}
              </Badge>
            </span>
            <span className="activity-toggle-chevron" aria-hidden="true">
              <Icon name="chevronDown" size={10} />
            </span>
          </button>
          {!isOpen && (
            <div className="activity-preview">
              {latestReasoning && (
                <div
                  className="activity-preview-reasoning"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(latestReasoning),
                  }}
                />
              )}
              {previewToolLabel && (
                <div className="activity-preview-tool">{previewToolLabel}</div>
              )}
            </div>
          )}
          {isOpen && (
            <div className="tool-calls-list activity-details">
              {bucket.entries.map((entry, activityIdx) => {
                if (entry.kind === "tool") {
                  const tool = entry.toolSummary;
                  if (!tool) return null;
                  const toolId = tool.id ?? entry.toolCallId ??
                    `tool-${bucket.key}-${activityIdx}`;
                  return (
                    <div key={`tool-${toolId}-${activityIdx}`}>
                      <ToolCallBubble call={tool} />
                    </div>
                  );
                }
                if (entry.kind !== "reasoning") return null;
                return (
                  <ActivityReasoningBubble
                    key={`reasoning-${bucket.key}-${activityIdx}-${
                      entry.reasoningId ?? "r"
                    }`}
                    entry={entry}
                  />
                );
              })}
            </div>
          )}
        </div>,
      );
      return;
    }
  });
  return <>{rows}</>;
}
