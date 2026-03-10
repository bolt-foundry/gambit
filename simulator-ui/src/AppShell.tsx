import { useCallback, useMemo, useState } from "react";
import {
  buildWorkspacePath,
  parseWorkspaceRoute,
} from "../../src/workspace_routes.ts";
import { verifyTabEnabled } from "./utils.ts";
import { useRouter } from "./RouterContext.tsx";
import Button from "./gds/Button.tsx";
import Icon from "./gds/Icon.tsx";
import WorkbenchDrawer from "./WorkbenchDrawer.tsx";
import { classNames, DOCS_PATH } from "./utils.ts";
import { useGambitTypedMutation } from "./hooks/useGambitTypedMutation.tsx";
import gambitWorkspaceCreateMutation from "../mutations/GambitWorkspaceCreateMutation.ts";
import gambitWorkspaceDeleteMutation from "../mutations/GambitWorkspaceDeleteMutation.ts";
import DocsPage from "./DocsPage.tsx";

function getDeckLabelForShell(): string {
  const globals = globalThis as typeof globalThis & {
    __GAMBIT_DECK_LABEL__?: unknown;
    __GAMBIT_DECK_PATH__?: unknown;
  };
  if (
    typeof globals.__GAMBIT_DECK_LABEL__ === "string" &&
    globals.__GAMBIT_DECK_LABEL__.trim().length > 0
  ) {
    return globals.__GAMBIT_DECK_LABEL__;
  }
  if (
    typeof globals.__GAMBIT_DECK_PATH__ === "string" &&
    globals.__GAMBIT_DECK_PATH__.trim().length > 0
  ) {
    const base = globals.__GAMBIT_DECK_PATH__.split(/[\\/]/).pop() ??
      globals.__GAMBIT_DECK_PATH__;
    const trimmed = base.replace(/\.[^.]+$/, "").trim();
    return trimmed.length > 0 ? trimmed : "Unknown deck";
  }
  return "Unknown deck";
}

export function AppShell(props: {
  children: React.ReactNode;
  Drawer: React.ComponentType<{
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
  }>;
  Workbench?: React.ComponentType<{
    open: boolean;
  }>;
}) {
  type AppearanceSetting = "light" | "dark" | "system";
  const THEME_STORAGE_KEY = "gambit-simulator-theme";
  const { Drawer } = props;
  const { currentRoutePath, navigate } = useRouter();
  const workspaceRoutePath = currentRoutePath;
  const deckLabel = getDeckLabelForShell();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(true);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(
    null,
  );
  const [deletingAll, setDeletingAll] = useState(false);
  const [appearance, setAppearance] = useState<AppearanceSetting>(() => {
    try {
      const savedTheme = globalThis.localStorage.getItem(THEME_STORAGE_KEY);
      if (
        savedTheme === "light" || savedTheme === "dark" ||
        savedTheme === "system"
      ) {
        return savedTheme;
      }
    } catch {
      // ignore storage read errors and fall back to system
    }
    return "system";
  });
  const createWorkspaceMutation = useGambitTypedMutation(
    gambitWorkspaceCreateMutation,
  );
  const deleteWorkspaceMutation = useGambitTypedMutation(
    gambitWorkspaceDeleteMutation,
  );
  const Workbench = props.Workbench ?? WorkbenchDrawer;

  const activeWorkspaceId = useMemo(() => {
    const route = parseWorkspaceRoute(workspaceRoutePath);
    return route?.workspaceId ?? null;
  }, [workspaceRoutePath]);
  const activeWorkspaceTab = useMemo(() => {
    const route = parseWorkspaceRoute(workspaceRoutePath);
    return route?.tab ?? null;
  }, [workspaceRoutePath]);
  const buildTabLabel = "Build";

  const isWorkspacesPath = useMemo(
    () =>
      workspaceRoutePath === "/workspaces" ||
      workspaceRoutePath === "/workspaces/new",
    [workspaceRoutePath],
  );
  const isDocsPath = workspaceRoutePath === "/docs";
  const canOpenWorkbench = Boolean(activeWorkspaceId);
  const workbenchVisible = workbenchOpen && canOpenWorkbench;

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    navigate(buildWorkspacePath("build", workspaceId));
    setDrawerOpen(false);
  }, [navigate]);

  const createWorkspace = useCallback(() => {
    createWorkspaceMutation.commit(
      {},
      {
        onComplete: (result) => {
          const workspaceId = result?.workspace?.id;
          if (!workspaceId) return;
          navigate(buildWorkspacePath("build", workspaceId));
        },
      },
    );
  }, [createWorkspaceMutation, navigate]);

  const persistAppearance = useCallback((nextAppearance: AppearanceSetting) => {
    try {
      globalThis.localStorage.setItem(THEME_STORAGE_KEY, nextAppearance);
    } catch {
      // ignore storage write errors
    }
    globalThis.dispatchEvent(new Event("gambit-simulator-theme-change"));
    setAppearance(nextAppearance);
  }, []);

  const runDeleteWorkspaceMutation = useCallback(
    (workspaceId: string) =>
      new Promise<void>((resolve, reject) => {
        deleteWorkspaceMutation.commit(
          { workspaceId },
          {
            onComplete: (result) => {
              if (result?.deleted) {
                resolve();
                return;
              }
              reject(
                new Error(
                  result?.error ?? `Failed to delete workspace ${workspaceId}`,
                ),
              );
            },
            onError: () => {
              reject(new Error(`Failed to delete workspace ${workspaceId}`));
            },
          },
        );
      }),
    [deleteWorkspaceMutation],
  );

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    setDeletingWorkspaceId(workspaceId);
    try {
      await runDeleteWorkspaceMutation(workspaceId);
      if (workspaceId === activeWorkspaceId) {
        navigate("/workspaces");
      }
    } finally {
      setDeletingWorkspaceId(null);
    }
  }, [activeWorkspaceId, navigate, runDeleteWorkspaceMutation]);

  const deleteAllWorkspaces = useCallback(
    async (workspaceIds: Array<string>) => {
      const uniqueWorkspaceIds = Array.from(
        new Set(workspaceIds.filter((id) => id.trim().length > 0)),
      );
      if (uniqueWorkspaceIds.length === 0) {
        return;
      }
      setDeletingAll(true);
      try {
        await Promise.allSettled(
          uniqueWorkspaceIds.map((workspaceId) =>
            runDeleteWorkspaceMutation(workspaceId)
          ),
        );
        navigate("/workspaces");
      } finally {
        setDeletingAll(false);
      }
    },
    [navigate, runDeleteWorkspaceMutation],
  );

  return (
    <div className="app-root">
      <header className="top-nav">
        <div className="top-nav-left">
          <Button
            data-testid="nav-sessions"
            className={classNames("sessions-toggle", drawerOpen && "active")}
            variant="secondary"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open sessions drawer"
          >
            <Icon
              name="hamburgerMenu"
              size={17}
              style={{ color: "var(--color-text)" }}
            />
          </Button>
        </div>
        <div className="top-nav-buttons tab-anchor-group">
          <span className="tab-anchor-indicator" aria-hidden="true" />
          <Button
            data-testid="nav-docs"
            tab
            variant={isDocsPath ? "primary" : "secondary"}
            className={classNames(
              "tab-anchor",
              isDocsPath && "tab-anchor--active",
            )}
            onClick={() => navigate(DOCS_PATH)}
          >
            Docs
          </Button>
          <Button
            data-testid="nav-build"
            tab
            variant={activeWorkspaceTab === "build" ? "primary" : "secondary"}
            className={classNames(
              "tab-anchor",
              activeWorkspaceTab === "build" && "tab-anchor--active",
            )}
            onClick={() => {
              if (!activeWorkspaceId) return;
              navigate(buildWorkspacePath("build", activeWorkspaceId));
            }}
            disabled={!activeWorkspaceId}
          >
            {buildTabLabel}
          </Button>
          <Button
            data-testid="nav-test"
            tab
            variant={activeWorkspaceTab === "test" ? "primary" : "secondary"}
            className={classNames(
              "tab-anchor",
              activeWorkspaceTab === "test" && "tab-anchor--active",
            )}
            onClick={() => {
              if (!activeWorkspaceId) return;
              navigate(buildWorkspacePath("test", activeWorkspaceId));
            }}
            disabled={!activeWorkspaceId}
          >
            Test
          </Button>
          <Button
            data-testid="nav-grade"
            tab
            variant={activeWorkspaceTab === "grade" ? "primary" : "secondary"}
            className={classNames(
              "tab-anchor",
              activeWorkspaceTab === "grade" && "tab-anchor--active",
            )}
            onClick={() => {
              if (!activeWorkspaceId) return;
              navigate(buildWorkspacePath("grade", activeWorkspaceId));
            }}
            disabled={!activeWorkspaceId}
          >
            Grade
          </Button>
          {verifyTabEnabled && (
            <Button
              data-testid="nav-verify"
              tab
              variant={activeWorkspaceTab === "verify"
                ? "primary"
                : "secondary"}
              className={classNames(
                "tab-anchor",
                activeWorkspaceTab === "verify" && "tab-anchor--active",
              )}
              onClick={() => {
                if (!activeWorkspaceId) return;
                navigate(buildWorkspacePath("verify", activeWorkspaceId));
              }}
              disabled={!activeWorkspaceId}
            >
              Verify
            </Button>
          )}
        </div>
        <div className="top-nav-center">
          <span className="top-nav-deck">{deckLabel}</span>
        </div>
        <div className="top-nav-right">
          <div className="top-nav-actions" />
          <Button
            data-testid="nav-workbench"
            className={classNames(
              "workbench-toggle",
              workbenchVisible && "active",
            )}
            variant="secondary"
            onClick={() => setWorkbenchOpen((prev) => !prev)}
            disabled={!canOpenWorkbench}
            aria-label={workbenchVisible
              ? "Close workbench drawer"
              : "Open workbench drawer"}
          >
            <Icon
              name="chat"
              size={16}
              style={{ color: "currentColor" }}
            />
          </Button>
        </div>
      </header>
      <div className="app-content-frame">
        <main className="page-shell">
          {isWorkspacesPath && (
            <div style={{ padding: "12px 16px 0 16px" }}>
              <Button
                data-testid="workspace-create-cta"
                variant="primary"
                size="small"
                onClick={createWorkspace}
                disabled={createWorkspaceMutation.inFlight}
              >
                New workspace
              </Button>
            </div>
          )}
          {isDocsPath ? <DocsPage /> : props.children}
        </main>
        <Workbench open={workbenchVisible} />
      </div>
      <Drawer
        open={drawerOpen}
        onCreateWorkspace={createWorkspace}
        onSelect={handleSelectWorkspace}
        onDelete={deleteWorkspace}
        onDeleteAll={deleteAllWorkspaces}
        onClose={() => setDrawerOpen(false)}
        activeWorkspaceId={activeWorkspaceId}
        bundleStamp={null}
        creatingWorkspace={createWorkspaceMutation.inFlight}
        deletingWorkspaceId={deletingWorkspaceId}
        deletingAll={deletingAll}
        appearance={appearance}
        onAppearanceChange={persistAppearance}
      />
    </div>
  );
}
