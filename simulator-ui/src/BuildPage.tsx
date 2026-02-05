import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { type ToolCallSummary, workspaceOnboardingEnabled } from "./utils.ts";
import PageShell from "./gds/PageShell.tsx";
import PageGrid from "./gds/PageGrid.tsx";
import Panel from "./gds/Panel.tsx";
import Badge from "./gds/Badge.tsx";
import Listbox, { type ListboxOption } from "./gds/Listbox.tsx";
import { useBuildChat } from "./BuildChatContext.tsx";

type BuildFileEntry = {
  path: string;
  type: "file" | "dir";
  size?: number;
  modifiedAt?: string;
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

  const { run, toolCalls } = useBuildChat();
  const [fileEntries, setFileEntries] = useState<BuildFileEntry[]>([]);
  const [fileListLoading, setFileListLoading] = useState(false);
  const [fileListError, setFileListError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<BuildFilePreview>({
    status: "idle",
  });
  const [recentChangesOpen, setRecentChangesOpen] = useState(false);
  const [recentChangesReadCount, setRecentChangesReadCount] = useState(0);
  const recentChangesTriggerRef = useRef<HTMLButtonElement | null>(null);
  const recentChangesPopoverRef = useRef<HTMLDivElement | null>(null);
  const [recentChangesPopoverStyle, setRecentChangesPopoverStyle] = useState<
    React.CSSProperties | null
  >(null);
  const lastTraceCountRef = useRef<number>(0);

  useEffect(() => {
    if (!setNavActions) return;
    setNavActions(null);
    return () => setNavActions(null);
  }, [setNavActions]);

  const refreshFileList = useCallback(async () => {
    setFileListLoading(true);
    setFileListError(null);
    try {
      const query = run.id ? `?workspaceId=${encodeURIComponent(run.id)}` : "";
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
    } catch (err) {
      setFileListError(err instanceof Error ? err.message : String(err));
      setFileEntries([]);
    } finally {
      setFileListLoading(false);
    }
  }, [run.id]);

  useEffect(() => {
    refreshFileList().catch(() => {});
  }, [refreshFileList]);

  useEffect(() => {
    const traceCount = run.traces?.length ?? 0;
    if (traceCount === lastTraceCountRef.current) return;
    lastTraceCountRef.current = traceCount;
    refreshFileList().catch(() => {});
  }, [run.traces?.length, refreshFileList]);

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
      const base = fileBaseName(path);
      return { value: path, label: base, meta: base === path ? null : path };
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
  }, [selectedPath]);

  const toolInsertIndexByCall = useMemo(() => {
    const map = new Map<string, number>();
    for (const insert of run.toolInserts ?? []) {
      if (!insert.actionCallId) continue;
      map.set(
        insert.actionCallId,
        typeof insert.index === "number" ? insert.index : 0,
      );
    }
    return map;
  }, [run.toolInserts]);

  const changes = useMemo(() => {
    return toolCalls
      .map(extractBotWriteChange)
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [toolCalls]);

  const auditTrail = useMemo(() => {
    const limited = changes.slice(-50);
    return limited.map((change) => ({
      ...change,
      turn: toolInsertIndexByCall.get(change.id),
    }));
  }, [changes, toolInsertIndexByCall]);

  const unreadRecentChangesCount = Math.max(
    0,
    changes.length - recentChangesReadCount,
  );

  const updateRecentChangesPopover = useCallback(() => {
    const trigger = recentChangesTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(380, Math.max(260, window.innerWidth - 24));
    const left = Math.max(
      12,
      Math.min(rect.right - width, window.innerWidth - width - 12),
    );
    setRecentChangesPopoverStyle({
      position: "fixed",
      top: rect.bottom + 6,
      left,
      width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!recentChangesOpen) return;
    updateRecentChangesPopover();
  }, [recentChangesOpen, updateRecentChangesPopover]);

  useEffect(() => {
    if (!recentChangesOpen) {
      setRecentChangesPopoverStyle(null);
      return;
    }
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const isInTrigger = recentChangesTriggerRef.current &&
        target &&
        recentChangesTriggerRef.current.contains(target);
      const isInPopover = recentChangesPopoverRef.current &&
        target &&
        recentChangesPopoverRef.current.contains(target);
      if (!isInTrigger && !isInPopover) {
        setRecentChangesOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setRecentChangesOpen(false);
      }
    };
    const handleReposition = () => updateRecentChangesPopover();
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [recentChangesOpen, updateRecentChangesPopover]);

  useEffect(() => {
    setRecentChangesOpen(false);
    setRecentChangesReadCount(0);
    setRecentChangesPopoverStyle(null);
  }, [run.id]);

  return (
    <PageShell>
      <PageGrid as="main" className="editor-main build-main">
        <Panel
          className="flex-column gap-8 flex-1 build-files-panel"
          style={{ minHeight: 0 }}
        >
          {workspaceOnboardingEnabled && (
            <div className="placeholder emphasis">
              Workspace scaffold created. Use the Build chat to refine
              <code>PROMPT.md</code>,{" "}
              <code>INTENT.md</code>, and the default scenario/grader decks.
            </div>
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
                  <button
                    type="button"
                    className="build-recent-changes-trigger"
                    onClick={() => {
                      if (recentChangesOpen) {
                        setRecentChangesOpen(false);
                        return;
                      }
                      setRecentChangesReadCount(changes.length);
                      updateRecentChangesPopover();
                      setRecentChangesOpen(true);
                    }}
                    aria-haspopup="dialog"
                    aria-expanded={recentChangesOpen}
                    ref={recentChangesTriggerRef}
                  >
                    <span className="build-recent-changes-label">
                      Recent changes
                    </span>
                    <Badge
                      variant={unreadRecentChangesCount > 0
                        ? "running"
                        : "ghost"}
                      data-testid="build-changes-count"
                      className="build-recent-changes-badge"
                    >
                      {unreadRecentChangesCount}
                    </Badge>
                  </button>
                </div>
              </div>
            </div>
            <div className="build-files-preview-body">
              {!selectedPath && (
                <div className="placeholder">
                  Select a file to preview its contents.
                </div>
              )}
              {selectedPath && filePreview.status === "loading" && (
                <div className="placeholder">Loading preview…</div>
              )}
              {selectedPath && filePreview.status === "too-large" && (
                <div className="placeholder">
                  File is too large to preview
                  {filePreview.size
                    ? ` (${formatBytes(filePreview.size)}).`
                    : "."}
                </div>
              )}
              {selectedPath && filePreview.status === "binary" && (
                <div className="placeholder">
                  Cannot preview binary data
                  {filePreview.size
                    ? ` (${formatBytes(filePreview.size)}).`
                    : "."}
                </div>
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
          {recentChangesOpen && recentChangesPopoverStyle &&
            createPortal(
              <div
                className="build-recent-changes-popover"
                style={recentChangesPopoverStyle}
                ref={recentChangesPopoverRef}
                data-testid="build-changes-panel"
              >
                {auditTrail.length === 0
                  ? <div className="placeholder">No recent changes yet.</div>
                  : (
                    <div className="build-recent-changes-list">
                      {[...auditTrail].reverse().map((change, idx) => (
                        <button
                          key={`${change.path}-${idx}`}
                          type="button"
                          className="build-recent-change-row"
                          onClick={() => {
                            setSelectedPath(change.path);
                            setRecentChangesOpen(false);
                          }}
                        >
                          <div className="build-recent-change-summary">
                            {change.action ?? "updated"}:{" "}
                            <code>{change.path}</code>
                          </div>
                          <div className="build-recent-change-meta">
                            {change.before === null
                              ? "Created file."
                              : change.before === undefined
                              ? "No before snapshot."
                              : "Updated file."} {change.turn !== undefined
                              ? `· Turn ${change.turn + 1}`
                              : ""}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
              </div>,
              document.body,
            )}
        </Panel>
      </PageGrid>
    </PageShell>
  );
}
