import React, { useState } from "react";
import Badge from "./gds/Badge.tsx";
import Icon from "./gds/Icon.tsx";
import { classNames, formatJson, type ToolCallSummary } from "./utils.ts";

function ToolCallField(props: {
  label: string;
  value: unknown;
  isError?: boolean;
}) {
  const { label, value, isError } = props;
  const text = formatJson(value);
  return (
    <div className="tool-call-field">
      <div className="tool-call-field-label">{label}</div>
      <pre
        className={classNames(
          "trace-json",
          isError && "tool-call-error",
        )}
      >
        {text}
      </pre>
    </div>
  );
}

export default function ToolCallBubble(props: { call: ToolCallSummary }) {
  const { call } = props;
  const [open, setOpen] = useState(false);
  const statusLabel = call.status === "completed"
    ? "Completed"
    : call.status === "error"
    ? "Error"
    : call.status === "running"
    ? "Running"
    : "Pending";
  const indentStyle = call.depth && call.depth > 0
    ? { marginLeft: call.depth * 12 }
    : undefined;
  return (
    <div className="imessage-row tool-call-row" style={indentStyle}>
      <div className="imessage-bubble tool-call-bubble">
        <button
          type="button"
          className="tool-call-collapse tool-call-collapse-activity"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
        >
          <div className="tool-call-header">
            <div className="tool-call-header-main">
              <div className="tool-call-title" title={call.id}>
                Tool call
              </div>
              <Badge status={call.status}>{statusLabel}</Badge>
              {call.handledError && (
                <div className="tool-call-handled">Error handled</div>
              )}
            </div>
            <span
              className={classNames("tool-call-chevron", open && "is-open")}
              aria-hidden="true"
            >
              <Icon name="chevronDown" size={10} />
            </span>
          </div>
          <div className="tool-call-summary">
            <div className="tool-call-name" title={call.id}>
              {call.name ?? call.id}
            </div>
          </div>
        </button>
        {open && (
          <div className="tool-call-detail">
            {call.args !== undefined && (
              <ToolCallField label="Arguments" value={call.args} />
            )}
            {call.result !== undefined && (
              <ToolCallField label="Result" value={call.result} />
            )}
            {call.error !== undefined && (
              <ToolCallField label="Error" value={call.error} isError />
            )}
            {call.handledError && (
              <>
                <div className="tool-call-divider" />
                <ToolCallField
                  label="Handled error"
                  value={call.handledError}
                  isError
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
