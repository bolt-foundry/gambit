import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type ToolCallSummary, workspaceOnboardingEnabled } from "./utils.ts";
import PageShell from "./gds/PageShell.tsx";
import PageGrid from "./gds/PageGrid.tsx";
import Panel from "./gds/Panel.tsx";
import Listbox, { type ListboxOption } from "./gds/Listbox.tsx";
import Callout from "./gds/Callout.tsx";
import { useWorkspaceBuild } from "./WorkspaceContext.tsx";

type BuildFileEntry = {
  path: string;
  type: "file" | "dir";
  size?: number;
  modifiedAt?: string;
  label?: string;
};

type BuildFilePreview =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; contents: string }
  | { status: "too-large"; size?: number }
  | { status: "binary"; size?: number }
  | { status: "error"; message: string };

function extractBotWriteChange(call: ToolCallSummary): {
  id: string;
  path: string;
  action?: string;
  before?: string | null;
  after?: string | null;
} | null {
  if (call.name !== "bot_write") return null;
  const args = call.args as { path?: unknown; contents?: unknown } | undefined;
  const result = (() => {
    if (typeof call.result === "string") {
      try {
        return JSON.parse(call.result) as unknown;
      } catch {
        return undefined;
      }
    }
    return call.result;
  })() as
    | { payload?: { path?: unknown; action?: unknown; before?: unknown } }
    | undefined;
  const pathValue = result?.payload?.path ?? args?.path;
  const pathStr = typeof pathValue === "string" ? pathValue : "";
  if (!pathStr) return null;
  const action = typeof result?.payload?.action === "string"
    ? result.payload.action
    : undefined;
  const before = result?.payload
    ? (typeof result.payload.before === "string"
      ? result.payload.before
      : result.payload.before === null
      ? null
      : undefined)
    : undefined;
  const after = typeof args?.contents === "string" ? args.contents : null;
  return { id: call.id, path: pathStr, action, before, after };
}

const fileBaseName = (value: string) => value.split(/[\\/]/g).pop() ?? value;

const formatBytes = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const rounded = size >= 10 || unitIndex === 0
    ? Math.round(size)
    : Math.round(size * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
};

export default function BuildPage(props: {
  setNavActions?: (actions: React.ReactNode | null) => void;
}) {
  const { setNavActions } = props;

  const { run, toolCalls } = useWorkspaceBuild();
  const [fileEntries, setFileEntries] = useState<BuildFileEntry[]>([]);
  const [fileListLoading, setFileListLoading] = useState(false);
  const [fileListError, setFileListError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<BuildFilePreview>({
    status: "idle",
  });
  const lastTraceCountRef = useRef<number>(0);
  const traceRefreshTimerRef = useRef<number | null>(null);
  const fileListRefreshInFlightRef = useRef(false);
  const fileListRefreshQueuedRef = useRef(false);

  useEffect(() => {
    if (!setNavActions) return;
    setNavActions(null);
    return () => setNavActions(null);
  }, [setNavActions]);

  const refreshFileList = useCallback(async () => {
    if (fileListRefreshInFlightRef.current) {
      fileListRefreshQueuedRef.current = true;
      return;
    }
    fileListRefreshInFlightRef.current = true;
    setFileListLoading(true);
    setFileListError(null);
    try {
      let shouldRun = true;
      while (shouldRun) {
        fileListRefreshQueuedRef.current = false;
        const query = run.id
          ? `?workspaceId=${encodeURIComponent(run.id)}`
          : "";
        const res = await fetch(`/api/build/files${query}`);
        const data = await res.json().catch(() => ({})) as {
          entries?: BuildFileEntry[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(
            typeof data.error === "string" ? data.error : res.statusText,
          );
        }
        setFileEntries(Array.isArray(data.entries) ? data.entries : []);
        shouldRun = fileListRefreshQueuedRef.current;
      }
    } catch (err) {
      setFileListError(err instanceof Error ? err.message : String(err));
      setFileEntries([]);
    } finally {
      fileListRefreshInFlightRef.current = false;
      setFileListLoading(false);
    }
  }, [run.id]);

  const clearTraceRefreshTimer = useCallback(() => {
    if (traceRefreshTimerRef.current === null) return;
    clearTimeout(traceRefreshTimerRef.current);
    traceRefreshTimerRef.current = null;
  }, []);

  useEffect(() => {
    refreshFileList().catch(() => {});
  }, [refreshFileList]);

  useEffect(() => {
    const traceCount = run.traces?.length ?? 0;
    clearTraceRefreshTimer();
    if (traceCount === lastTraceCountRef.current) return;
    lastTraceCountRef.current = traceCount;
    traceRefreshTimerRef.current = setTimeout(() => {
      traceRefreshTimerRef.current = null;
      refreshFileList().catch(() => {});
    }, 250);
  }, [clearTraceRefreshTimer, run.traces?.length, refreshFileList]);

  useEffect(() => {
    return () => {
      clearTraceRefreshTimer();
    };
  }, [clearTraceRefreshTimer]);

  const fileEntriesByPath = useMemo(() => {
    const map = new Map<string, BuildFileEntry>();
    for (const entry of fileEntries) {
      if (entry.type === "file") {
        map.set(entry.path, entry);
      }
    }
    return map;
  }, [fileEntries]);

  const fileSelectorOptions = useMemo((): ListboxOption[] => {
    const paths = Array.from(fileEntriesByPath.keys());
    paths.sort((a, b) => a.localeCompare(b));

    const pinnedOrder = [
      "PROMPT.md",
      "root.deck.md",
      "INTENT.md",
      "POLICY.md",
    ];
    const pinned = pinnedOrder.filter((path) => fileEntriesByPath.has(path));
    const pinnedSet = new Set(pinned);
    const rest = paths.filter((path) => !pinnedSet.has(path));

    const toOption = (path: string): ListboxOption => {
      const entry = fileEntriesByPath.get(path);
      const base = fileBaseName(path);
      const frontmatterLabel = typeof entry?.label === "string"
        ? entry.label.trim()
        : "";
      const label = frontmatterLabel.length > 0
        ? `${frontmatterLabel} | ${base}`
        : base;
      return { value: path, label, meta: base === path ? null : path };
    };

    const options: ListboxOption[] = [];
    if (pinned.length > 0) {
      options.push({ kind: "header", label: "Pinned" });
      pinned.forEach((path) => options.push(toOption(path)));
    }
    if (rest.length > 0) {
      if (pinned.length > 0) {
        options.push({ kind: "separator" });
        options.push({ kind: "header", label: "All files" });
      }
      rest.forEach((path) => options.push(toOption(path)));
    }
    return options;
  }, [fileEntriesByPath]);

  const selectedEntry = selectedPath
    ? fileEntriesByPath.get(selectedPath)
    : undefined;

  const selectedPathChangeToken = useMemo(() => {
    if (!selectedPath) return "";
    for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
      const change = extractBotWriteChange(toolCalls[i]);
      if (change?.path === selectedPath) {
        return `${change.id}:${change.action ?? ""}`;
      }
    }
    return "";
  }, [selectedPath, toolCalls]);

  useEffect(() => {
    const filePaths = Array.from(fileEntriesByPath.keys());
    const hasSelected = selectedPath && fileEntriesByPath.has(selectedPath);
    if (selectedPath && !hasSelected) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath && filePaths.length > 0) {
      const preferred = [
        "PROMPT.md",
        "root.deck.md",
        "INTENT.md",
        "POLICY.md",
      ].find((p) => fileEntriesByPath.has(p));
      if (preferred) {
        setSelectedPath(preferred);
      } else {
        filePaths.sort((a, b) => a.localeCompare(b));
        setSelectedPath(filePaths[0]);
      }
    }
  }, [fileEntriesByPath, selectedPath]);

  useEffect(() => {
    if (!selectedPath) {
      setFilePreview({ status: "idle" });
      return;
    }
    let canceled = false;
    const fetchPreview = async () => {
      setFilePreview({ status: "loading" });
      try {
        const params = new URLSearchParams({
          path: selectedPath,
        });
        if (run.id) {
          params.set("workspaceId", run.id);
        }
        const res = await fetch(`/api/build/file?${params.toString()}`);
        const data = await res.json().catch(() => ({})) as {
          contents?: string;
          tooLarge?: boolean;
          binary?: boolean;
          size?: number;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(
            typeof data.error === "string" ? data.error : res.statusText,
          );
        }
        if (data.tooLarge) {
          if (!canceled) {
            setFilePreview({ status: "too-large", size: data.size });
          }
          return;
        }
        if (data.binary) {
          if (!canceled) {
            setFilePreview({ status: "binary", size: data.size });
          }
          return;
        }
        if (!canceled) {
          setFilePreview({
            status: "ready",
            contents: typeof data.contents === "string" ? data.contents : "",
          });
        }
      } catch (err) {
        if (!canceled) {
          setFilePreview({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };
    fetchPreview();
    return () => {
      canceled = true;
    };
  }, [
    run.id,
    selectedPath,
    selectedEntry?.modifiedAt,
    selectedEntry?.size,
    selectedPathChangeToken,
  ]);

  return (
    <PageShell>
      <PageGrid as="main" className="editor-main build-main">
        <Panel
          className="flex-column gap-8 flex-1 build-files-panel"
          style={{ minHeight: 0 }}
        >
          {workspaceOnboardingEnabled && (
            <Callout variant="emphasis">
              Workspace scaffold created. Use the Build chat to refine
              <code>PROMPT.md</code>,{" "}
              <code>INTENT.md</code>, and the default scenario/grader decks.
            </Callout>
          )}
          {fileListError && <div className="error">{fileListError}</div>}
          <div className="build-files-preview">
            <div className="build-files-preview-header">
              <div className="build-files-preview-controls">
                <div className="build-files-preview-selector">
                  <Listbox
                    value={selectedPath}
                    placeholder={fileListLoading
                      ? "Loading files…"
                      : "Select file"}
                    options={fileSelectorOptions}
                    disabled={fileEntriesByPath.size === 0}
                    onChange={(next) => setSelectedPath(next)}
                  />
                </div>
                <div className="build-files-preview-actions">
                  {selectedEntry?.size !== undefined && (
                    <span className="build-file-size">
                      {formatBytes(selectedEntry.size)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="build-files-preview-body">
              {!selectedPath && (
                <Callout>
                  Select a file to preview its contents.
                </Callout>
              )}
              {selectedPath && filePreview.status === "loading" && (
                <Callout>Loading preview…</Callout>
              )}
              {selectedPath && filePreview.status === "too-large" && (
                <Callout>
                  File is too large to preview
                  {filePreview.size
                    ? ` (${formatBytes(filePreview.size)}).`
                    : "."}
                </Callout>
              )}
              {selectedPath && filePreview.status === "binary" && (
                <Callout>
                  Cannot preview binary data
                  {filePreview.size
                    ? ` (${formatBytes(filePreview.size)}).`
                    : "."}
                </Callout>
              )}
              {selectedPath && filePreview.status === "error" && (
                <div className="error">{filePreview.message}</div>
              )}
              {selectedPath && filePreview.status === "ready" && (
                <pre className="build-file-preview">
                  {filePreview.contents}
                </pre>
              )}
            </div>
          </div>
        </Panel>
      </PageGrid>
    </PageShell>
  );
}
