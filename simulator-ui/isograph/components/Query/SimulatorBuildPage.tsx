import { iso } from "@iso-gambit-sim";
import { useEffect } from "react";
import gambitWorkspaceBuildTabLiveSubscription from "../../../subscriptions/GambitWorkspaceBuildTabLiveSubscription.ts";
import PageShell from "../../../src/gds/PageShell.tsx";
import PageGrid from "../../../src/gds/PageGrid.tsx";
import { useGambitTypedSubscription } from "../../../src/hooks/useGambitTypedSubscription.tsx";
import Listbox, { type ListboxOption } from "../../../src/gds/Listbox.tsx";
import type { Maybe } from "../../../../src/utility_types.ts";

function getRoutePrefixFromLocation(): string {
  const pathname = globalThis.location?.pathname ?? "";
  return pathname === "/isograph" || pathname.startsWith("/isograph/")
    ? "/isograph"
    : "";
}

function decodeBuildPathFromLocation(): Maybe<string> {
  const pathname = (() => {
    if (
      typeof globalThis.location?.pathname === "string" &&
      globalThis.location.pathname.length > 0
    ) {
      return globalThis.location.pathname;
    }
    const globals = globalThis as typeof globalThis & {
      __GAMBIT_CURRENT_PATH__?: unknown;
    };
    return typeof globals.__GAMBIT_CURRENT_PATH__ === "string"
      ? globals.__GAMBIT_CURRENT_PATH__
      : "/";
  })();
  const match = pathname.match(
    /^(?:\/isograph)?\/workspaces\/[^/]+\/build(?:\/(.*))?$/,
  );
  if (!match || !match[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function decodeWorkspaceIdFromLocation(): Maybe<string> {
  const pathname = (() => {
    if (
      typeof globalThis.location?.pathname === "string" &&
      globalThis.location.pathname.length > 0
    ) {
      return globalThis.location.pathname;
    }
    const globals = globalThis as typeof globalThis & {
      __GAMBIT_CURRENT_PATH__?: unknown;
    };
    return typeof globals.__GAMBIT_CURRENT_PATH__ === "string"
      ? globals.__GAMBIT_CURRENT_PATH__
      : "/";
  })();
  const match = pathname.match(
    /^(?:\/isograph)?\/workspaces\/([^/]+)\/build(?:\/.*)?$/,
  );
  if (!match || !match[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function toBuildRoutePath(
  workspaceId: string,
  filePath: string,
): string {
  const routePrefix = getRoutePrefixFromLocation();
  const encodedWorkspaceId = encodeURIComponent(workspaceId);
  const encodedFilePath = filePath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return encodedFilePath.length > 0
    ? `${routePrefix}/workspaces/${encodedWorkspaceId}/build/${encodedFilePath}`
    : `${routePrefix}/workspaces/${encodedWorkspaceId}/build`;
}

function navigateToBuildFile(
  workspaceId: Maybe<string>,
  filePath: string,
) {
  if (!workspaceId) return;
  const nextPath = toBuildRoutePath(workspaceId, filePath);
  const currentPath = globalThis.location?.pathname ?? "";
  if (currentPath === nextPath) return;
  globalThis.history.pushState({}, "", nextPath);
  globalThis.dispatchEvent(new PopStateEvent("popstate"));
}

function findOptionValue(
  input: Maybe<string>,
): Maybe<string> {
  if (!input) return null;
  if (input.trim().length === 0) return null;
  return input;
}

function toFileLabel(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  return parts.at(-1) ?? filePath;
}

function toListboxOptions(
  files: Array<{ id: string; path: string }>,
): Array<ListboxOption> {
  return files.map((file) => ({
    value: file.id,
    label: toFileLabel(file.path),
    meta: toFileLabel(file.path) === file.path ? null : file.path,
  }));
}

export const SimulatorBuildPage = iso(`
  field Workspace.BuildTab @component {
    files(first: 200) {
      edges {
        node {
          id
          path
          PreviewFile
        }
      }
    }
  }
`)(function SimulatorBuildPage({ data }) {
  // Intentional overfetch for local-first build UX; optimize in a later slice.
  const files = (data.files?.edges ?? [])
    .flatMap((edge) => {
      const node = edge?.node;
      if (!node) return [];
      if (typeof node.id !== "string" || node.id.trim().length === 0) {
        return [];
      }
      if (typeof node.path !== "string" || node.path.trim().length === 0) {
        return [];
      }
      if (!node.PreviewFile) return [];
      return [{
        id: node.id,
        path: node.path,
        previewFile: node.PreviewFile,
      }];
    });
  const options = toListboxOptions(files);
  const filePaths = new Set(files.map((file) => file.path).filter(Boolean));
  const workspaceId = decodeWorkspaceIdFromLocation();
  useGambitTypedSubscription(
    gambitWorkspaceBuildTabLiveSubscription,
    workspaceId ? { workspaceId } : null,
  );
  const selectedFromPath = decodeBuildPathFromLocation();
  const candidateFromPath = findOptionValue(selectedFromPath);
  const selectedFromRoute =
    candidateFromPath && filePaths.has(candidateFromPath)
      ? candidateFromPath
      : null;
  const selectedFile = selectedFromRoute
    ? files.find((file) => file.path === selectedFromRoute) ?? null
    : files[0] ?? null;
  const selectedPath = selectedFile?.path ?? null;
  const selectedId = selectedFile?.id ?? null;
  const SelectedPreview = selectedFile?.previewFile ?? null;
  const selectedFileFromListbox = (id: string): Maybe<(typeof files)[number]> =>
    files.find((file) => file.id === id) ?? null;
  const shouldCanonicalizeRoute = selectedFromRoute === null &&
    selectedPath !== null && workspaceId !== null;

  const noFilesPreview = (
    <div className="build-files-preview-body">
      <div className="build-file-meta" style={{ marginBottom: 8 }}>
        No workspace files available
      </div>
      <pre className="build-file-preview">
        No files found for this workspace yet.
      </pre>
    </div>
  );

  useEffect(() => {
    if (!shouldCanonicalizeRoute || !workspaceId || !selectedPath) return;
    const nextPath = toBuildRoutePath(workspaceId, selectedPath);
    if ((globalThis.location?.pathname ?? "") === nextPath) return;
    globalThis.history.replaceState({}, "", nextPath);
  }, [selectedPath, shouldCanonicalizeRoute, workspaceId]);

  return (
    <PageShell>
      <PageGrid as="main" className="editor-main build-main">
        <div
          className="panel flex-column gap-8 flex-1 build-files-panel"
          style={{ minHeight: 0 }}
        >
          <div className="build-files-preview">
            <div className="build-files-preview-header">
              <div className="build-files-preview-controls">
                <div className="build-files-preview-selector">
                  <Listbox
                    value={selectedId}
                    options={options}
                    placeholder="No file selected"
                    disabled={options.length === 0}
                    onChange={(value) => {
                      const file = selectedFileFromListbox(value);
                      if (!file) return;
                      navigateToBuildFile(workspaceId, file.path);
                    }}
                  />
                </div>
                <div className="build-files-preview-actions">
                  <span className="build-file-size">Preview</span>
                </div>
              </div>
            </div>
            {SelectedPreview ? <SelectedPreview /> : noFilesPreview}
          </div>
        </div>
      </PageGrid>
    </PageShell>
  );
});

export default SimulatorBuildPage;
