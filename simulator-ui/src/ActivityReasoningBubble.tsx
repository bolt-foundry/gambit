import React, { useState } from "react";
import Icon from "./gds/Icon.tsx";
import {
  type BuildDisplayMessage,
  classNames,
  renderMarkdown,
} from "./utils.ts";

export default function ActivityReasoningBubble(
  props: { entry: BuildDisplayMessage },
) {
  const { entry } = props;
  const [open, setOpen] = useState(false);
  const reasoningSummaryText = typeof entry.content === "string" &&
      entry.content.trim().length > 0
    ? entry.content
    : "No reasoning content";
  const reasoningSummaryHtml = renderMarkdown(reasoningSummaryText);

  return (
    <div className="imessage-row tool-call-row reasoning-row">
      <div className="imessage-bubble tool-call-bubble reasoning-bubble">
        <button
          type="button"
          className={classNames(
            "tool-call-collapse",
            "tool-call-collapse-activity",
          )}
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
        >
          <div className="tool-call-header">
            <div className="tool-call-title">Reasoning</div>
            <span
              className={classNames("tool-call-chevron", open && "is-open")}
              aria-hidden="true"
            >
              <Icon name="chevronDown" size={10} />
            </span>
          </div>
          <div
            className="tool-call-summary reasoning-summary"
            dangerouslySetInnerHTML={{ __html: reasoningSummaryHtml }}
          >
          </div>
        </button>
        {open && (
          <div className="tool-call-detail">
            {entry.reasoningRaw
              ? (
                <pre className="trace-json reasoning-json">
                  {JSON.stringify(entry.reasoningRaw, null, 2)}
                </pre>
              )
              : <div className="reasoning-details-empty">No details</div>}
          </div>
        )}
      </div>
    </div>
  );
}
