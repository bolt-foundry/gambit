import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  classNames,
  flattenSchemaLeaves,
  formatJson,
  getPathValue,
  renderMarkdown,
  SCORE_VALUES,
  setPathValue,
} from "./utils.ts";
import Badge from "./gds/Badge.tsx";
import Panel from "./gds/Panel.tsx";
import Tabs from "./gds/Tabs.tsx";
import type {
  FeedbackEntry,
  ModelMessage,
  NormalizedSchema,
  ReasoningDetail,
  RespondInfo,
  SchemaResponse,
  TraceEvent,
} from "./utils.ts";

export type ConversationMessage = {
  id?: string;
  message: ModelMessage;
  feedback?: FeedbackEntry;
  respond?: RespondInfo;
  reasoning?: ReasoningDetail;
};

export function useHttpSchema(opts?: { workspaceId?: string | null }) {
  const [schemaResponse, setSchemaResponse] = useState<SchemaResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (opts?.workspaceId) params.set("workspaceId", opts.workspaceId);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/schema${query}`);
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json() as SchemaResponse;
      setSchemaResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schema");
    } finally {
      setLoading(false);
    }
  }, [opts?.workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { schemaResponse, loading, error, refresh };
}

export function CopyBadge(props: {
  label: string;
  displayValue?: string | null;
  copyValue?: string | null;
  className?: string;
}) {
  const { label, displayValue, copyValue, className } = props;
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const copyTarget = copyValue ?? displayValue;
  if (!copyTarget) return null;
  const text = displayValue ?? copyTarget;

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copyTarget);
      } else {
        const temp = document.createElement("textarea");
        temp.value = copyTarget;
        temp.style.position = "fixed";
        temp.style.opacity = "0";
        document.body.appendChild(temp);
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
      }
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore copy failures silently
    }
  }, [copyTarget]);

  return (
    <button
      type="button"
      className={classNames("copy-badge", className, copied && "copied")}
      onClick={handleCopy}
      title={copied ? "Copied!" : `Click to copy ${label}`}
    >
      <span className="copy-label">{label}:</span>
      <code>{text}</code>
      {copied && <span className="copy-feedback">Copied</span>}
    </button>
  );
}

export function ConversationView(props: {
  messages: ConversationMessage[];
  header?: React.ReactNode;
  onScore: (
    messageRefId: string,
    score: number | null,
    reason?: string,
  ) => void | Promise<void>;
  onReasonChange: (
    messageRefId: string,
    score: number,
    reason: string,
  ) => void | Promise<void>;
  emptyState?: React.ReactNode;
}) {
  const { messages, header, onScore, onReasonChange, emptyState } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [messages.length]);

  return (
    <Panel className="chat-column" ref={containerRef}>
      {header}
      {messages.map((entry, idx) => (
        <MessageBubble
          key={entry.id ?? idx}
          entry={entry}
          onScore={onScore}
          onReasonChange={onReasonChange}
        />
      ))}
      {messages.length === 0 && (
        emptyState ?? (
          <div className="empty-state">
            <p>No conversation yet. Start a new chat to begin testing.</p>
          </div>
        )
      )}
    </Panel>
  );
}

export function MessageBubble(props: {
  entry: ConversationMessage;
  onScore: (
    messageRefId: string,
    score: number | null,
    reason?: string,
  ) => void | Promise<void>;
  onReasonChange: (
    messageRefId: string,
    score: number,
    reason: string,
  ) => void | Promise<void>;
}) {
  const { entry, onScore, onReasonChange } = props;
  const hasReasoning = Boolean(entry.reasoning);
  const role = entry.message.role;
  const isRespond = Boolean(entry.respond);
  const isTool = role === "tool" && !isRespond;
  const className = classNames(
    "bubble",
    role === "user"
      ? "bubble-user"
      : role === "system"
      ? "bubble-system"
      : "bubble-assistant",
    hasReasoning && "bubble-reasoning",
  );
  const messageRefId = entry.id;
  const content = entry.message.content ?? "";
  return (
    <div className="chat-row">
      <div className={className}>
        <div className="bubble-role">{role}</div>
        {hasReasoning && entry.reasoning && (
          <ReasoningBubble detail={entry.reasoning} />
        )}
        {isRespond && (
          <div className="respond-summary">
            <div className="respond-meta">
              <Badge>gambit_respond</Badge>
              {typeof entry.respond?.status === "number" && (
                <Badge variant="ghost">
                  status {entry.respond.status}
                </Badge>
              )}
              {entry.respond?.code && (
                <Badge variant="ghost">
                  code {entry.respond.code}
                </Badge>
              )}
            </div>
            {entry.respond?.message && (
              <div className="respond-message">
                {entry.respond.message}
              </div>
            )}
            {entry.respond?.payload !== undefined && (
              <pre className="bubble-json">
                {formatJson(entry.respond.payload)}
              </pre>
            )}
            {entry.respond?.meta && (
              <details className="respond-meta-details">
                <summary>Meta</summary>
                <pre className="bubble-json">
                  {formatJson(entry.respond.meta)}
                </pre>
              </details>
            )}
          </div>
        )}
        {!hasReasoning && !isRespond && content && !isTool && (
          <div
            className="bubble-text"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        )}
        {!hasReasoning && !isRespond && content && isTool && (
          <pre className="bubble-json">
            {formatJson(content)}
          </pre>
        )}
        {!hasReasoning && !content && entry.message.tool_calls && (
          <pre className="bubble-json">
            {formatJson(entry.message.tool_calls)}
          </pre>
        )}
        {messageRefId && role === "assistant" && !hasReasoning && (
          <FeedbackControls
            messageRefId={messageRefId}
            feedback={entry.feedback}
            onScore={onScore}
            onReasonChange={onReasonChange}
          />
        )}
      </div>
    </div>
  );
}

export function ReasoningBubble(props: { detail: ReasoningDetail }) {
  const { detail } = props;
  const meta: string[] = [];
  if (detail.model) meta.push(detail.model);
  if (detail.actionCallId) meta.push(`call ${detail.actionCallId}`);
  return (
    <div className="reasoning-bubble">
      <div className="reasoning-header">
        <Badge variant="ghost">Reasoning</Badge>
        {meta.length > 0 && (
          <span className="reasoning-meta">{meta.join(" · ")}</span>
        )}
      </div>
      <div className="reasoning-text">{detail.text}</div>
      <details className="reasoning-details">
        <summary>Details</summary>
        <pre className="bubble-json">
          {formatJson(detail.event)}
        </pre>
      </details>
    </div>
  );
}

export function FeedbackControls(props: {
  messageRefId: string;
  feedback?: FeedbackEntry;
  onScore: (
    messageRefId: string,
    score: number | null,
    reason?: string,
  ) => void | Promise<void>;
  onReasonChange: (
    messageRefId: string,
    score: number,
    reason: string,
  ) => void | Promise<void>;
}) {
  const { messageRefId, feedback, onScore, onReasonChange } = props;
  const [reason, setReason] = useState(feedback?.reason ?? "");
  const [opened, setOpened] = useState(false);
  const [localScore, setLocalScore] = useState<number | null>(null);
  const [status, setStatus] = useState<
    "idle" | "unsaved" | "saving" | "saved" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    setReason(feedback?.reason ?? "");
    if (typeof feedback?.score === "number" || feedback?.reason !== undefined) {
      setStatus("saved");
    } else {
      setStatus("idle");
    }
    setErrorMessage(null);
  }, [feedback?.reason, feedback?.score]);

  useEffect(() => {
    if (typeof feedback?.score === "number") {
      setLocalScore(feedback.score);
      setOpened(true);
    }
  }, [feedback?.score]);

  const effectiveScore = typeof feedback?.score === "number"
    ? feedback.score
    : localScore;

  const persistScore = useCallback(async (score: number | null) => {
    const requestSeq = ++requestSeqRef.current;
    setStatus("saving");
    setErrorMessage(null);
    try {
      const nextReason = score === null ? undefined : reason;
      await Promise.resolve(onScore(messageRefId, score, nextReason));
      if (requestSeqRef.current !== requestSeq) return;
      setStatus(score === null ? "idle" : "saved");
    } catch (err) {
      if (requestSeqRef.current !== requestSeq) return;
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to save feedback",
      );
    }
  }, [messageRefId, onScore, reason]);

  const persistReason = useCallback(
    async (score: number, nextReason: string) => {
      const requestSeq = ++requestSeqRef.current;
      setStatus("saving");
      setErrorMessage(null);
      try {
        await Promise.resolve(onReasonChange(messageRefId, score, nextReason));
        if (requestSeqRef.current !== requestSeq) return;
        setStatus("saved");
      } catch (err) {
        if (requestSeqRef.current !== requestSeq) return;
        setStatus("error");
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to save feedback reason",
        );
      }
    },
    [messageRefId, onReasonChange],
  );

  useEffect(() => {
    if (typeof effectiveScore !== "number") return;
    if (status !== "unsaved") return;
    const handle = window.setTimeout(() => {
      persistReason(effectiveScore, reason);
    }, 650);
    return () => window.clearTimeout(handle);
  }, [effectiveScore, persistReason, reason, status]);

  const showReason = opened ||
    typeof effectiveScore === "number" ||
    (feedback?.reason !== undefined && feedback.reason.length > 0);

  return (
    <div className="feedback-controls">
      <div className="feedback-scores">
        {SCORE_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            className={classNames(
              "score-button",
              effectiveScore === value && "score-button-active",
            )}
            onClick={() => {
              if (effectiveScore === value) {
                setLocalScore(null);
                setOpened(false);
                setReason("");
                persistScore(null);
                return;
              }
              setOpened(true);
              setLocalScore(value);
              persistScore(value);
            }}
          >
            {value}
          </button>
        ))}
      </div>
      {showReason && (
        <>
          <textarea
            className="feedback-reason"
            placeholder="Why?"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setStatus("unsaved");
              setErrorMessage(null);
            }}
            onBlur={() => {
              if (typeof effectiveScore !== "number") return;
              if (status !== "unsaved") return;
              persistReason(effectiveScore, reason);
            }}
          />
          <div
            className={classNames(
              "feedback-status",
              status === "saving" && "saving",
              status === "unsaved" && "unsaved",
              status === "error" && "error",
            )}
          >
            {status === "saving" && "Saving…"}
            {status === "saved" && "Saved"}
            {status === "unsaved" && "Unsaved changes…"}
            {status === "error" && (
              <>
                Save failed{" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    if (typeof effectiveScore === "number") {
                      persistReason(effectiveScore, reason);
                      return;
                    }
                    persistScore(null);
                  }}
                >
                  Retry
                </button>
              </>
            )}
          </div>
          {status === "error" && errorMessage && (
            <div className="error">{errorMessage}</div>
          )}
        </>
      )}
    </div>
  );
}

export function TraceList(props: { traces: TraceEvent[] }) {
  const { traces } = props;
  const ordered = traces;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const codexHighlights = useMemo(() => {
    const asRecord = (value: unknown): Record<string, unknown> | null => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
      return null;
    };
    const asString = (value: unknown): string =>
      typeof value === "string" ? value : "";
    const asOptionalString = (value: unknown): string | undefined => {
      const text = asString(value).trim();
      return text.length > 0 ? text : undefined;
    };
    const extractPayload = (value: unknown): Record<string, unknown> | null => {
      const record = asRecord(value);
      if (!record) return null;
      if (record.type === "codex.event") {
        return asRecord(record.payload);
      }
      return record;
    };
    const summaries: Array<{
      id?: string;
      text: string;
      raw: Record<string, unknown>;
    }> = [];
    const toolItems: Array<{
      id?: string;
      name?: string;
      status?: string;
      args?: unknown;
      result?: unknown;
      error?: unknown;
      raw: Record<string, unknown>;
    }> = [];
    for (const trace of ordered) {
      if (!trace || typeof trace !== "object") continue;
      if (trace.type !== "model.stream.event") continue;
      const event = (trace as { event?: unknown }).event;
      const payload = extractPayload(event);
      if (!payload) continue;
      const payloadType = asString(payload.type);
      if (payloadType.startsWith("response.reasoning")) {
        let text = "";
        if (payloadType === "response.reasoning.delta") {
          text = asString(payload.delta);
        } else if (payloadType === "response.reasoning.done") {
          text = asString(payload.text);
        } else if (
          payloadType === "response.reasoning_summary_text.delta"
        ) {
          text = asString(payload.delta);
        } else if (
          payloadType === "response.reasoning_summary_text.done"
        ) {
          text = asString(payload.text);
        } else if (
          payloadType === "response.reasoning_summary_part.added" ||
          payloadType === "response.reasoning_summary_part.done"
        ) {
          const part = asRecord(payload.part);
          text = part ? asString(part.text) : "";
        }
        if (text.trim()) {
          summaries.push({
            id: asOptionalString(payload.item_id),
            text: text.trim(),
            raw: payload,
          });
        }
        continue;
      }
      const item = asRecord(payload.item);
      if (!item) continue;
      const itemType = asString(item.type);
      if (!itemType) continue;
      if (itemType === "reasoning") {
        let text = "";
        const summary = item.summary;
        if (Array.isArray(summary)) {
          text = summary.map((part) => {
            const partRecord = asRecord(part);
            return partRecord && typeof partRecord.text === "string"
              ? partRecord.text
              : "";
          }).join("");
        } else if (typeof summary === "string") {
          text = summary;
        } else if (typeof item.text === "string") {
          text = item.text;
        }
        if (text.trim()) {
          summaries.push({
            id: asOptionalString(item.id),
            text: text.trim(),
            raw: item,
          });
        }
      } else if (itemType === "function_call" || itemType === "mcp_tool_call") {
        toolItems.push({
          id: asOptionalString(item.id),
          name: asOptionalString(item.name) ?? asOptionalString(item.tool),
          status: asOptionalString(item.status),
          args: item.arguments,
          result: item.result,
          error: item.error,
          raw: item,
        });
      }
    }
    return { summaries, toolItems };
  }, [ordered]);
  const entries = useMemo(() => {
    const depthMap = new Map<string, number>();
    return ordered.map((trace) => {
      let depth = 0;
      if (
        "actionCallId" in trace &&
        typeof trace.actionCallId === "string"
      ) {
        const parentId = "parentActionCallId" in trace &&
            typeof trace.parentActionCallId === "string" &&
            trace.parentActionCallId.length
          ? trace.parentActionCallId
          : undefined;
        if (trace.type === "deck.start" || trace.type === "action.start") {
          const parentDepth = parentId && depthMap.has(parentId)
            ? depthMap.get(parentId)!
            : -1;
          depth = parentDepth + 1;
          depthMap.set(trace.actionCallId, depth);
        } else {
          const existing = depthMap.get(trace.actionCallId);
          if (existing !== undefined) {
            depth = existing;
          } else if (parentId && depthMap.has(parentId)) {
            depth = depthMap.get(parentId)! + 1;
          }
        }
      }
      return { trace, depth };
    });
  }, [ordered]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [traces.length]);

  return (
    <div className="trace-panel" ref={panelRef}>
      <h3>Traces & Tools</h3>
      {(codexHighlights.summaries.length > 0 ||
        codexHighlights.toolItems.length > 0) && (
        <div className="trace-codex-highlights">
          {codexHighlights.summaries.length > 0 && (
            <details open>
              <summary>
                Codex reasoning summaries ({codexHighlights.summaries.length})
              </summary>
              <div className="trace-list">
                {codexHighlights.summaries.map((entry, idx) => (
                  <div key={`codex-summary-${entry.id ?? idx}`}>
                    <div className="trace-text">{entry.text}</div>
                    <pre className="trace-json">{formatJson(entry.raw)}</pre>
                  </div>
                ))}
              </div>
            </details>
          )}
          {codexHighlights.toolItems.length > 0 && (
            <details>
              <summary>
                Codex tool calls ({codexHighlights.toolItems.length})
              </summary>
              <div className="trace-list">
                {codexHighlights.toolItems.map((entry, idx) => (
                  <div key={`codex-tool-${entry.id ?? idx}`}>
                    <div className="trace-text">
                      {entry.name ?? "tool call"}
                      {entry.status ? ` · ${entry.status}` : ""}
                    </div>
                    {(entry.args !== undefined ||
                      entry.result !== undefined ||
                      entry.error !== undefined) && (
                      <pre className="trace-json">
                        {formatJson({
                          args: entry.args,
                          result: entry.result,
                          error: entry.error,
                        })}
                      </pre>
                    )}
                    {(entry.args === undefined &&
                      entry.result === undefined &&
                      entry.error === undefined) && (
                      <pre className="trace-json">
                        {formatJson(entry.raw)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      <div className="trace-list">
        {entries.map(({ trace, depth }, idx) => {
          const isUser = trace.type === "message.user";
          return (
            <div
              key={idx}
              className={classNames("trace-row", isUser && "trace-row-user")}
              style={depth > 0
                ? {
                  marginLeft: depth * 12,
                  borderLeft: "2px solid #e2e8f0",
                  paddingLeft: 8,
                }
                : undefined}
            >
              <strong>{trace.type ?? "trace"}</strong>
              {trace.message?.content && (
                <div className="trace-text">{trace.message.content}</div>
              )}
              {!trace.message?.content && (
                <pre className="trace-json">
                  {formatJson(trace)}
                </pre>
              )}
            </div>
          );
        })}
        {traces.length === 0 && (
          <div className="trace-empty">No trace events yet.</div>
        )}
      </div>
    </div>
  );
}

export function JsonInputField(props: {
  value: unknown;
  optional: boolean;
  placeholder?: string;
  onChange: (value: unknown) => void;
  onErrorChange?: (error: string | null) => void;
}) {
  const { value, optional, placeholder, onChange, onErrorChange } = props;
  const formatInputValue = (input: unknown) => {
    if (input === undefined) return "";
    if (typeof input === "string") return input;
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  };
  const onChangeRef = useRef(onChange);
  const onErrorChangeRef = useRef(onErrorChange);
  const [text, setText] = useState(() => {
    if (value === undefined) return "";
    return formatInputValue(value);
  });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
    onErrorChangeRef.current = onErrorChange;
  }, [onChange, onErrorChange]);

  useEffect(() => {
    if (dirty) return;
    if (value === undefined) {
      setText("");
      return;
    }
    setText(formatInputValue(value));
  }, [value, dirty]);

  useEffect(() => {
    onErrorChangeRef.current?.(error);
  }, [error]);

  useEffect(() => {
    if (!dirty) return;
    const handle = window.setTimeout(() => {
      const trimmed = text.trim();
      if (trimmed === "") {
        if (optional) {
          setError(null);
          onChangeRef.current(undefined);
        } else {
          setError("Required");
        }
        return;
      }
      try {
        const parsed = JSON.parse(text);
        setError(null);
        onChangeRef.current(parsed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid JSON");
      }
    }, 500);
    return () => window.clearTimeout(handle);
  }, [dirty, text, optional]);

  return (
    <>
      <textarea
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
      />
      {error && <div className="error">{error}</div>}
    </>
  );
}

export function InitForm(props: {
  schema: NormalizedSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  onJsonErrorChange: (pathKey: string, error: string | null) => void;
}) {
  const { schema, value, onChange, onJsonErrorChange } = props;
  const leaves = useMemo(() => flattenSchemaLeaves(schema), [schema]);

  return (
    <div className="init-grid">
      {leaves.map(({ path, schema: fieldSchema }) => {
        const pathKey = path.join(".");
        const label = pathKey || "input";
        const fieldValue = getPathValue(value, path);
        const badgeText = fieldSchema.optional ? "optional" : "required";
        const description = fieldSchema.description;

        const setFieldValue = (nextFieldValue: unknown) => {
          const nextRoot = setPathValue(value, path, nextFieldValue);
          onChange(nextRoot);
        };

        return (
          <div className="init-field" key={pathKey}>
            <label>
              <span>{label}</span>
              <Badge>{badgeText}</Badge>
            </label>
            {description && <div className="secondary-note">{description}</div>}
            {fieldSchema.kind === "string" && (
              <input
                value={typeof fieldValue === "string" ? fieldValue : ""}
                placeholder={fieldSchema.optional ? "" : "required"}
                onChange={(e) =>
                  setFieldValue(
                    e.target.value === "" && fieldSchema.optional
                      ? undefined
                      : e.target.value,
                  )}
              />
            )}
            {fieldSchema.kind === "number" && (
              <input
                type="number"
                value={typeof fieldValue === "number" ? String(fieldValue) : ""}
                placeholder={fieldSchema.optional ? "" : "required"}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "" && fieldSchema.optional) {
                    setFieldValue(undefined);
                    return;
                  }
                  const parsed = Number(raw);
                  setFieldValue(Number.isFinite(parsed) ? parsed : undefined);
                }}
              />
            )}
            {fieldSchema.kind === "boolean" && (
              <label style={{ fontWeight: 600, justifyContent: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={Boolean(fieldValue)}
                  onChange={(e) =>
                    setFieldValue(e.target.checked)}
                />
                <span>{Boolean(fieldValue) ? "true" : "false"}</span>
              </label>
            )}
            {fieldSchema.kind === "enum" && (
              <select
                value={fieldValue === undefined ? "" : String(fieldValue)}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "" && fieldSchema.optional) {
                    setFieldValue(undefined);
                    return;
                  }
                  setFieldValue(raw);
                }}
              >
                <option value="">
                  {fieldSchema.optional ? "— optional —" : "Select"}
                </option>
                {(fieldSchema.enumValues ?? []).map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {String(opt)}
                  </option>
                ))}
              </select>
            )}
            {(fieldSchema.kind === "array" || fieldSchema.kind === "unknown" ||
              fieldSchema.kind === "object") &&
              (
                <JsonInputField
                  value={fieldValue}
                  optional={fieldSchema.optional}
                  placeholder="JSON"
                  onChange={(nextVal) => {
                    onJsonErrorChange(pathKey, null);
                    setFieldValue(nextVal);
                  }}
                  onErrorChange={(err) => onJsonErrorChange(pathKey, err)}
                />
              )}
          </div>
        );
      })}
    </div>
  );
}

export function InitPanel(props: {
  schema: NormalizedSchema;
  value: unknown;
  lockedValue: unknown;
  editable: boolean;
  mode: "form" | "json";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: "form" | "json") => void;
  missingRequired: string[];
  jsonErrorCount: number;
  rootJsonText: string;
  rootJsonError: string | null;
  onRootJsonChange: (
    text: string,
    error: string | null,
    parsed?: unknown,
  ) => void;
  schemaError?: string;
  onChange: (next: unknown) => void;
  onJsonErrorChange: (pathKey: string, err: string | null) => void;
}) {
  const {
    schema,
    value,
    lockedValue,
    editable,
    mode,
    open,
    onOpenChange,
    onModeChange,
    missingRequired,
    jsonErrorCount,
    rootJsonText,
    rootJsonError,
    onRootJsonChange,
    schemaError,
    onChange,
    onJsonErrorChange,
  } = props;

  const summaryLabel = editable
    ? "Init input (required before chat)"
    : "Init input (locked)";
  const summaryValue = editable ? value : lockedValue;

  return (
    <details
      className="init-panel"
      open={open}
      onToggle={(e) =>
        onOpenChange((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{summaryLabel}</summary>
      {schemaError && <div className="error">Schema error: {schemaError}</div>}
      <div className="hint">
        Fields are generated from the deck input schema. You can use the form or
        a raw JSON payload. Start a new chat to change init.
      </div>
      {editable && (
        <>
          <Tabs
            className="panel-tabs"
            size="small"
            activeId={mode}
            onChange={(next) => onModeChange(next as typeof mode)}
            tabs={[
              { id: "form", label: "Form" },
              { id: "json", label: "JSON" },
            ]}
          />
          {mode === "form"
            ? (
              <InitForm
                schema={schema}
                value={value}
                onChange={onChange}
                onJsonErrorChange={onJsonErrorChange}
              />
            )
            : (
              <div className="init-field">
                <label>
                  <span>Init JSON</span>
                  <Badge>root</Badge>
                </label>
                <textarea
                  className="json-input"
                  value={rootJsonText}
                  placeholder="Paste full init JSON payload"
                  onChange={(e) => {
                    const text = e.target.value;
                    let error: string | null = null;
                    let parsed: unknown = undefined;
                    if (text.trim() === "") {
                      parsed = undefined;
                    } else {
                      try {
                        parsed = JSON.parse(text);
                      } catch (err) {
                        error = err instanceof Error
                          ? err.message
                          : "Invalid JSON";
                      }
                    }
                    onRootJsonChange(text, error, parsed);
                  }}
                  style={{ minHeight: 140 }}
                />
                {rootJsonError && <div className="error">{rootJsonError}</div>}
                {!rootJsonError && (
                  <div className="secondary-note">
                    Leave blank to unset init. Parsed JSON replaces the form.
                  </div>
                )}
              </div>
            )}
          {(missingRequired.length > 0 || jsonErrorCount > 0) && (
            <div className="init-missing">
              {missingRequired.length > 0 && (
                <div>
                  Missing required: {missingRequired.slice(0, 6).join(", ")}
                  {missingRequired.length > 6 ? "…" : ""}
                </div>
              )}
              {jsonErrorCount > 0 && (
                <div>Fix invalid JSON fields to continue.</div>
              )}
            </div>
          )}
        </>
      )}
      {!editable && (
        <pre className="init-summary-json">
          {formatJson(summaryValue ?? {})}
        </pre>
      )}
    </details>
  );
}
