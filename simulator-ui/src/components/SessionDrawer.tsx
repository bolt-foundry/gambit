import React from "react";
import { classNames, formatTimestamp } from "../utils.ts";

type SessionNotes = { text?: string; updatedAt?: string };

type SessionState = {
  notes?: SessionNotes;
};

type SessionContextWindow = {
  sessionId: string;
  targetIndex: number;
  start: number;
  end: number;
  messages: Array<{
    role: string;
    content?: string | null;
    id?: string;
  }>;
};

type Props = {
  open: boolean;
  loading: boolean;
  error: string | null;
  context: SessionContextWindow | null;
  session: SessionState | null;
  showFull: boolean;
  notesStatus: "idle" | "saving" | "error";
  onToggleShowFull: () => void;
  onClose: () => void;
  onSaveNotes: (sessionId: string, text: string) => void;
};

export function SessionDrawer(props: Props) {
  const {
    open,
    loading,
    error,
    context,
    session,
    showFull,
    notesStatus,
    onToggleShowFull,
    onClose,
    onSaveNotes,
  } = props;

  const targetSessionId = context?.sessionId;

  if (!open) return null;

  return (
    <div
      className="sessions-overlay"
      style={{ alignItems: "stretch", justifyContent: "flex-end" }}
      onClick={onClose}
    >
      <div
        className="sessions-dialog"
        style={{
          width: "min(520px, 95%)",
          maxHeight: "100vh",
          borderRadius: 0,
          borderTopLeftRadius: 16,
          borderBottomLeftRadius: 16,
          margin: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>Session context</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        {loading && <p>Loading session…</p>}
        {error && <p className="error">{error}</p>}
        {!loading && !error && !context && (
          <p className="placeholder">No session context available.</p>
        )}
        {context && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <strong>Messages</strong>
              <label style={{ fontSize: 12, display: "inline-flex", gap: 4 }}>
                <input
                  type="checkbox"
                  checked={showFull}
                  onChange={onToggleShowFull}
                />
                View full session
              </label>
            </div>
            <div
              style={{
                maxHeight: "50vh",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: 8,
              }}
            >
              {context.messages.map((m, idx) => {
                const absoluteIdx = context.start + idx;
                const isTarget = absoluteIdx === context.targetIndex;
                return (
                  <div
                    key={`${absoluteIdx}:${m.id ?? idx}`}
                    style={{
                      padding: 8,
                      borderRadius: 10,
                      background: isTarget ? "#e0f2fe" : "#f8fafc",
                      border: isTarget
                        ? "1px solid #38bdf8"
                        : "1px solid #e2e8f0",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700 }}>
                      {m.role} #{absoluteIdx + 1}
                      {isTarget ? " (target)" : ""}
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                      {m.content ?? ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {session && targetSessionId && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Session notes
            </label>
            <textarea
              defaultValue={session.notes?.text ?? ""}
              onBlur={(e) =>
                onSaveNotes(targetSessionId, e.target.value)}
              style={{
                width: "100%",
                minHeight: "120px",
                resize: "vertical",
                padding: 10,
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
              }}
            />
            <div className="editor-status">
              {notesStatus === "saving"
                ? "Saving session notes…"
                : notesStatus === "error"
                ? "Save failed"
                : " "}
            </div>
            {session.notes?.updatedAt && (
              <div className="editor-status">
                Last updated {formatTimestamp(session.notes.updatedAt)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
