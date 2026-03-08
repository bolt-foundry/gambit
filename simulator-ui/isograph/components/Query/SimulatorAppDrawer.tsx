import { iso } from "@iso-gambit-sim";
import { useEffect, useMemo, useState } from "react";
import Button from "../../../src/gds/Button.tsx";
import Icon from "../../../src/gds/Icon.tsx";
import Listbox from "../../../src/gds/Listbox.tsx";
import { GambitLogo } from "../../../src/GambitLogo.tsx";
import {
  classNames,
  formatTimestamp,
  gambitVersion,
} from "../../../src/utils.ts";
import type { SessionMeta } from "../../../src/utils.ts";

export const SimulatorAppDrawer = iso(`
  field Query.SimulatorAppDrawer @component {
    gambitWorkspaces(first: 200) {
      edges {
        node {
          id
          deck
          deckSlug
          testBotName
          createdAt
          sessionDir
          statePath
        }
      }
    }
  }
`)(function SimulatorAppDrawer({ data }, componentProps: {
  open: boolean;
  onSelect: (workspaceId: string) => void;
  onDelete: (workspaceId: string) => Promise<void>;
  onDeleteAll: (workspaceIds: Array<string>) => Promise<void>;
  onClose: () => void;
  activeWorkspaceId?: string | null;
  bundleStamp: string | null;
  onCreateWorkspace?: () => void;
  creatingWorkspace?: boolean;
  deletingWorkspaceId?: string | null;
  deletingAll?: boolean;
  appearance: "light" | "dark" | "system";
  onAppearanceChange: (appearance: "light" | "dark" | "system") => void;
}) {
  const workspaces: Array<SessionMeta> = (data.gambitWorkspaces?.edges ?? [])
    .flatMap((edge) => {
      const node = edge?.node;
      const id = node?.id;
      if (!id || id.trim().length === 0) return [];
      return [{
        id,
        deck: node.deck ?? undefined,
        deckSlug: node.deckSlug ?? undefined,
        testBotName: node.testBotName ?? undefined,
        createdAt: node.createdAt ?? undefined,
        sessionDir: node.sessionDir ?? undefined,
        statePath: node.statePath ?? undefined,
      }];
    });
  const [hiddenWorkspaceIds, setHiddenWorkspaceIds] = useState<Set<string>>(
    new Set(),
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const visibleWorkspaces = useMemo(
    () =>
      workspaces.filter((workspace) => !hiddenWorkspaceIds.has(workspace.id)),
    [hiddenWorkspaceIds, workspaces],
  );

  useEffect(() => {
    if (!componentProps.open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        componentProps.onClose();
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [componentProps.open, componentProps.onClose]);

  if (!componentProps.open) return null;

  return (
    <div className="sessions-drawer">
      <div className="sessions-drawer-panel" role="dialog">
        <header className="sessions-drawer-header">
          <div className="sessions-drawer-logo" aria-label="Gambit">
            <GambitLogo height={20} />
          </div>
          <Button
            variant="ghost"
            onClick={componentProps.onClose}
            aria-label="Close"
          >
            <Icon name="close" size={14} />
          </Button>
        </header>
        <section className="sessions-drawer-section">
          <div className="flex-row items-center gap-8">
            <h3 className="flex-1">Workspaces</h3>
            {componentProps.onCreateWorkspace && (
              <div className="sessions-drawer-actions">
                <Button
                  variant="primary"
                  size="small"
                  data-testid="workspace-create-cta"
                  onClick={componentProps.onCreateWorkspace}
                  disabled={componentProps.creatingWorkspace}
                >
                  New workspace
                </Button>
                <Button
                  variant="danger"
                  size="small"
                  onClick={async () => {
                    setDeleteError(null);
                    try {
                      const workspaceIds = visibleWorkspaces.map((workspace) =>
                        workspace.id
                      );
                      await componentProps.onDeleteAll(workspaceIds);
                      setHiddenWorkspaceIds(
                        new Set(workspaceIds),
                      );
                    } catch (error) {
                      setDeleteError(
                        error instanceof Error
                          ? error.message
                          : "Failed to delete all workspaces",
                      );
                    }
                  }}
                  disabled={componentProps.deletingAll ||
                    visibleWorkspaces.length === 0}
                >
                  Delete all
                </Button>
              </div>
            )}
          </div>
          <div className="sessions-drawer-body">
            {deleteError && <p className="error">{deleteError}</p>}
            <ul className="sessions-list">
              {visibleWorkspaces.map((workspace) => {
                const isActive =
                  componentProps.activeWorkspaceId === workspace.id;
                const isDeleting =
                  componentProps.deletingWorkspaceId === workspace.id;
                return (
                  <li key={workspace.id}>
                    <button
                      type="button"
                      className={classNames(
                        "session-select-button",
                        isActive && "active",
                      )}
                      onClick={() => componentProps.onSelect(workspace.id)}
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
                      onClick={async () => {
                        setDeleteError(null);
                        try {
                          await componentProps.onDelete(workspace.id);
                          setHiddenWorkspaceIds((prev) => {
                            const next = new Set(prev);
                            next.add(workspace.id);
                            return next;
                          });
                        } catch (error) {
                          setDeleteError(
                            error instanceof Error
                              ? error.message
                              : "Failed to delete workspace",
                          );
                        }
                      }}
                      disabled={isDeleting || componentProps.deletingAll}
                      aria-label="Delete workspace"
                      title="Delete workspace"
                    >
                      <Icon name="trash" size={14} />
                    </Button>
                  </li>
                );
              })}
            </ul>
            {visibleWorkspaces.length === 0 && <p>No saved workspaces yet.</p>}
          </div>
        </section>
        <div className="sessions-drawer-footer">
          <div className="appearance-row">
            <span className="appearance-row-label">Display appearance</span>
            <div className="appearance-row-select">
              <Listbox
                value={componentProps.appearance}
                onChange={(next) =>
                  componentProps.onAppearanceChange(
                    next as "light" | "dark" | "system",
                  )}
                options={[
                  { value: "system", label: "System" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
                size="small"
              />
            </div>
          </div>
          {gambitVersion
            ? <span className="bundle-stamp">Gambit v{gambitVersion}</span>
            : componentProps.bundleStamp
            ? (
              <span className="bundle-stamp">
                Bundle {componentProps.bundleStamp}
              </span>
            )
            : null}
        </div>
      </div>
      <button
        type="button"
        className="sessions-drawer-backdrop"
        onClick={componentProps.onClose}
        aria-label="Close workspace drawer"
      />
    </div>
  );
});

export default SimulatorAppDrawer;
