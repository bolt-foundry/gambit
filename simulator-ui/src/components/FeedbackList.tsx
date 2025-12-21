import React from "react";
import { formatTimestamp } from "../utils.ts";

type FeedbackItem = {
  sessionId: string;
  messageRefId: string;
  score?: number;
  reason?: string;
  createdAt?: string;
  archivedAt?: string;
  messageContent?: unknown;
  sessionCreatedAt?: string;
};

type Props = {
  items: FeedbackItem[];
  showArchived: boolean;
  archivingKey: string | null;
  loading: boolean;
  error: string | null;
  onToggleShowArchived: (next: boolean) => void;
  onView: (sessionId: string, messageRefId: string) => void;
  onArchive: (
    sessionId: string,
    messageRefId: string,
    archived: boolean,
  ) => void;
};

export function FeedbackList(props: Props) {
  const {
    items,
    showArchived,
    archivingKey,
    loading,
    error,
    onToggleShowArchived,
    onView,
    onArchive,
  } = props;

  const visible = items.filter((f) => showArchived || !f.archivedAt);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong>Feedback</strong>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
          }}
        >
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => onToggleShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>
      {loading && <div className="placeholder">Loading feedback…</div>}
      {error && <div className="error">{error}</div>}
      {!loading && !error && visible.length === 0 && (
        <div className="placeholder">No feedback yet.</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((fb) => (
          <div
            key={`${fb.sessionId}:${fb.messageRefId}`}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: 10,
              background: "#f8fafc",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <span style={{ fontWeight: 700 }}>Score:</span>
                <span>{typeof fb.score === "number" ? fb.score : "—"}</span>
              </div>
              <div style={{ display: "inline-flex", gap: 6 }}>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => onView(fb.sessionId, fb.messageRefId)}
                >
                  View
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={archivingKey ===
                    `${fb.sessionId}:${fb.messageRefId}`}
                  onClick={() =>
                    onArchive(fb.sessionId, fb.messageRefId, !fb.archivedAt)}
                >
                  {fb.archivedAt ? "Unarchive" : "Archive"}
                </button>
              </div>
            </div>
            {fb.reason && (
              <div style={{ marginTop: 6, fontSize: 13 }}>
                {fb.reason}
              </div>
            )}
            {fb.messageContent !== undefined && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: "#475569",
                  background: "#e2e8f0",
                  padding: 8,
                  borderRadius: 8,
                  whiteSpace: "pre-wrap",
                }}
              >
                {String(fb.messageContent).slice(0, 240)}
                {String(fb.messageContent).length > 240 ? "…" : ""}
              </div>
            )}
            <div style={{ marginTop: 6, fontSize: 11, color: "#475569" }}>
              {fb.createdAt ? `Feedback: ${formatTimestamp(fb.createdAt)}` : ""}
              {fb.sessionCreatedAt
                ? ` · Session: ${formatTimestamp(fb.sessionCreatedAt)}`
                : ""}
              {fb.archivedAt
                ? ` · Archived ${formatTimestamp(fb.archivedAt)}`
                : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
