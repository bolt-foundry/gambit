import { useEffect } from "react";
import Button from "./gds/Button.tsx";
import Icon from "./gds/Icon.tsx";
import { GambitLogo } from "./GambitLogo.tsx";
import { classNames, formatTimestamp, gambitVersion } from "./utils.ts";
import type { SessionMeta } from "./utils.ts";

export default function AppDrawer(props: {
  open: boolean;
  workspaces: SessionMeta[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelect: (workspaceId: string) => void;
  onDelete: (workspaceId: string) => void;
  onDeleteAll: () => void;
  onClose: () => void;
  activeWorkspaceId?: string | null;
  bundleStamp: string | null;
}) {
  const {
    open,
    workspaces,
    loading,
    error,
    onRefresh,
    onSelect,
    onDelete,
    onDeleteAll,
    onClose,
    activeWorkspaceId,
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
            <h3 className="flex-1">Workspaces</h3>
            <div className="sessions-drawer-actions">
              <Button variant="secondary" size="small" onClick={onRefresh}>
                Refresh
              </Button>
              <Button
                variant="danger"
                size="small"
                onClick={onDeleteAll}
                disabled={loading || workspaces.length === 0}
              >
                Delete all
              </Button>
            </div>
          </div>
          <div className="sessions-drawer-body">
            {loading && <p>Loading workspaces…</p>}
            {error && <p className="error">{error}</p>}
            <ul className="sessions-list">
              {workspaces.map((workspace) => {
                const isActive = activeWorkspaceId === workspace.id;
                return (
                  <li key={workspace.id}>
                    <button
                      type="button"
                      className={classNames(
                        "session-select-button",
                        isActive && "active",
                      )}
                      onClick={() => onSelect(workspace.id)}
                    >
                      <strong>
                        {workspace.testBotName ??
                          workspace.deckSlug ??
                          workspace.deck ??
                          "workspace"}
                      </strong>
                      <span>{formatTimestamp(workspace.createdAt)}</span>
                      <code>{workspace.id}</code>
                    </button>
                    <Button
                      variant="ghost-danger"
                      className="session-delete-button"
                      onClick={() => {
                        onDelete(workspace.id);
                      }}
                      aria-label="Delete workspace"
                      title="Delete workspace"
                    >
                      <Icon name="trash" size={14} />
                    </Button>
                  </li>
                );
              })}
            </ul>
            {workspaces.length === 0 && !loading && (
              <p>No saved workspaces yet.</p>
            )}
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
        aria-label="Close workspace drawer"
      />
    </div>
  );
}
