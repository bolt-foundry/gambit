import { Suspense, useCallback, useMemo, useState } from "react";
import {
  buildWorkspacePath,
  parseWorkspaceRoute,
} from "../../src/workspace_routes.ts";
import { verifyTabEnabled } from "./utils.ts";
import { useRouter } from "./RouterContext.tsx";
import Button from "./gds/Button.tsx";
import Icon from "./gds/Icon.tsx";
import WorkbenchDrawer from "./WorkbenchDrawer.tsx";
import { classNames } from "./utils.ts";
import { useGambitTypedMutation } from "./hooks/useGambitTypedMutation.tsx";
import gambitWorkspaceCreateMutation from "../mutations/GambitWorkspaceCreateMutation.ts";

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
    onClose: () => void;
    activeWorkspaceId?: string | null;
    bundleStamp: string | null;
    onCreateWorkspace?: () => void;
    creatingWorkspace?: boolean;
  }>;
  Workbench?: React.ComponentType<{
    open: boolean;
  }>;
}) {
  const { Drawer } = props;
  const { currentRoutePath, navigate } = useRouter();
  const routePrefix = useMemo(
    () =>
      currentRoutePath === "/isograph" ||
        currentRoutePath.startsWith("/isograph/")
        ? "/isograph"
        : "",
    [currentRoutePath],
  );
  const toPrefixedPath = useCallback(
    (path: string) => `${routePrefix}${path}`,
    [routePrefix],
  );
  const workspaceRoutePath = useMemo(() => {
    if (!routePrefix) return currentRoutePath;
    const stripped = currentRoutePath.slice(routePrefix.length);
    return stripped.length > 0 ? stripped : "/";
  }, [currentRoutePath, routePrefix]);
  const deckLabel = getDeckLabelForShell();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [workbenchOpen, setWorkbenchOpen] = useState(true);
  const createWorkspaceMutation = useGambitTypedMutation(
    gambitWorkspaceCreateMutation,
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
  const buildTabLabel = routePrefix ? "Build (isograph)" : "Build";

  const isWorkspacesPath = useMemo(
    () =>
      workspaceRoutePath === "/workspaces" ||
      workspaceRoutePath === "/workspaces/new",
    [workspaceRoutePath],
  );
  const canOpenWorkbench = Boolean(activeWorkspaceId);
  const workbenchVisible = workbenchOpen && canOpenWorkbench;

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    navigate(toPrefixedPath(buildWorkspacePath("build", workspaceId)));
    setDrawerOpen(false);
  }, [navigate, toPrefixedPath]);

  const createWorkspace = useCallback(() => {
    createWorkspaceMutation.commit(
      {},
      {
        onComplete: (result) => {
          const workspaceId = result?.workspace?.id;
          if (!workspaceId) return;
          navigate(toPrefixedPath(buildWorkspacePath("build", workspaceId)));
        },
      },
    );
  }, [createWorkspaceMutation, navigate, toPrefixedPath]);

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
            data-testid="nav-workspaces"
            tab
            variant={isWorkspacesPath ? "primary" : "secondary"}
            className={classNames(
              "tab-anchor",
              isWorkspacesPath && "tab-anchor--active",
            )}
            onClick={() => navigate(toPrefixedPath("/workspaces"))}
          >
            Workspaces
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
              navigate(
                toPrefixedPath(
                  buildWorkspacePath("build", activeWorkspaceId),
                ),
              );
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
              navigate(
                toPrefixedPath(
                  buildWorkspacePath("test", activeWorkspaceId),
                ),
              );
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
              navigate(
                toPrefixedPath(
                  buildWorkspacePath("grade", activeWorkspaceId),
                ),
              );
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
                navigate(
                  toPrefixedPath(
                    buildWorkspacePath("verify", activeWorkspaceId),
                  ),
                );
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
          <Suspense
            fallback={<div style={{ padding: "12px 16px" }}>Loading...</div>}
          >
            {props.children}
          </Suspense>
        </main>
        <Workbench open={workbenchVisible} />
      </div>
      <Drawer
        open={drawerOpen}
        onCreateWorkspace={createWorkspace}
        onSelect={handleSelectWorkspace}
        onClose={() => setDrawerOpen(false)}
        activeWorkspaceId={activeWorkspaceId}
        bundleStamp={null}
        creatingWorkspace={createWorkspaceMutation.inFlight}
      />
    </div>
  );
}
