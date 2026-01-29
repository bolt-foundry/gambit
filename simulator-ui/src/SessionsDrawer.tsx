import { useEffect } from "react";
import Button from "./gds/Button.tsx";
import Icon from "./gds/Icon.tsx";
import { GambitLogo } from "./GambitLogo.tsx";
import { classNames, formatTimestamp, gambitVersion } from "./utils.ts";
import type { SessionMeta } from "./utils.ts";

export default function SessionsDrawer(props: {
  open: boolean;
  sessions: SessionMeta[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onDeleteAll: () => void;
  onClose: () => void;
  activeSessionId?: string | null;
  bundleStamp: string | null;
}) {
  const {
    open,
    sessions,
    loading,
    error,
    onRefresh,
    onSelect,
    onDelete,
    onDeleteAll,
    onClose,
    activeSessionId,
    bundleStamp,
  } = props;
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div className="sessions-drawer">
      <div className="sessions-drawer-panel" role="dialog">
        <header className="sessions-drawer-header">
          <div className="sessions-drawer-logo" aria-label="Gambit">
            <GambitLogo height={20} />
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </Button>
        </header>
        <section className="sessions-drawer-section">
          <div className="flex-row items-center gap-8">
            <h3 className="flex-1">Sessions</h3>
            <div className="sessions-drawer-actions">
              <Button variant="secondary" size="small" onClick={onRefresh}>
                Refresh
              </Button>
              <Button
                variant="danger"
                size="small"
                onClick={onDeleteAll}
                disabled={loading || sessions.length === 0}
              >
                Delete all
              </Button>
            </div>
          </div>
          <div className="sessions-drawer-body">
            {loading && <p>Loading sessions…</p>}
            {error && <p className="error">{error}</p>}
            <ul className="sessions-list">
              {sessions.map((session) => {
                const isActive = activeSessionId === session.id;
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={classNames(
                        "session-select-button",
                        isActive && "active",
                      )}
                      onClick={() => onSelect(session.id)}
                    >
                      <strong>
                        {session.testBotName ??
                          session.deckSlug ??
                          session.deck ??
                          "session"}
                      </strong>
                      <span>{formatTimestamp(session.createdAt)}</span>
                      <code>{session.id}</code>
                    </button>
                    <Button
                      variant="ghost-danger"
                      className="session-delete-button"
                      onClick={() => {
                        onDelete(session.id);
                      }}
                      aria-label="Delete session"
                      title="Delete session"
                    >
                      <Icon name="trash" size={14} />
                    </Button>
                  </li>
                );
              })}
            </ul>
            {sessions.length === 0 && !loading && <p>No saved sessions yet.</p>}
          </div>
        </section>
        <div className="sessions-drawer-footer">
          {gambitVersion
            ? <span className="bundle-stamp">Gambit v{gambitVersion}</span>
            : bundleStamp
            ? <span className="bundle-stamp">Bundle {bundleStamp}</span>
            : null}
        </div>
      </div>
      <button
        type="button"
        className="sessions-drawer-backdrop"
        onClick={onClose}
        aria-label="Close sessions drawer"
      />
    </div>
  );
}
