import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BUILD_STREAM_ID,
  type BuildBotSocketMessage,
  buildDurableStreamUrl,
  getDurableStreamOffset,
  setDurableStreamOffset,
  summarizeToolCalls,
  type ToolCallSummary,
  type TraceEvent,
} from "./utils.ts";

type BuildRun = {
  id: string;
  status: "idle" | "running" | "completed" | "error" | "canceled";
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  traces?: Array<TraceEvent>;
  toolInserts?: Array<{
    actionCallId?: string;
    parentActionCallId?: string;
    name?: string;
    index: number;
  }>;
};

type BuildChatContextValue = {
  run: BuildRun;
  toolCalls: ToolCallSummary[];
  chatDraft: string;
  setChatDraft: React.Dispatch<React.SetStateAction<string>>;
  chatSending: boolean;
  chatError: string | null;
  setChatError: React.Dispatch<React.SetStateAction<string | null>>;
  toolCallsOpen: Record<number, boolean>;
  setToolCallsOpen: React.Dispatch<
    React.SetStateAction<Record<number, boolean>>
  >;
  optimisticUser: { id: string; text: string } | null;
  setOptimisticUser: React.Dispatch<
    React.SetStateAction<{ id: string; text: string } | null>
  >;
  streamingAssistant: { runId: string; turn: number; text: string } | null;
  setStreamingAssistant: React.Dispatch<
    React.SetStateAction<
      { runId: string; turn: number; text: string } | null
    >
  >;
  resetChat: () => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  loadChat: (runId: string) => Promise<void>;
};

const BuildChatContext = createContext<BuildChatContextValue | null>(null);

export function BuildChatProvider(
  props: {
    children: React.ReactNode;
    workspaceId?: string | null;
    onWorkspaceChange?: (workspaceId: string) => void;
  },
) {
  const { children, workspaceId, onWorkspaceChange } = props;
  const [run, setRun] = useState<BuildRun>({
    id: "",
    status: "idle",
    messages: [],
    traces: [],
    toolInserts: [],
  });
  const runIdRef = useRef<string>("");

  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [toolCallsOpen, setToolCallsOpen] = useState<Record<number, boolean>>(
    {},
  );
  const [optimisticUser, setOptimisticUser] = useState<
    { id: string; text: string } | null
  >(null);
  const [streamingAssistant, setStreamingAssistant] = useState<
    { runId: string; turn: number; text: string } | null
  >(null);

  const refreshStatus = useCallback(async (opts?: { workspaceId?: string }) => {
    const query = opts?.workspaceId
      ? `?workspaceId=${encodeURIComponent(opts.workspaceId)}`
      : "";
    const res = await fetch(`/api/build/status${query}`);
    const data = await res.json().catch(() => ({})) as { run?: BuildRun };
    if (data.run) {
      setRun({
        ...data.run,
        messages: data.run.messages ?? [],
        traces: data.run.traces ?? [],
        toolInserts: data.run.toolInserts ?? [],
      });
      if (typeof data.run.id === "string" && data.run.id) {
        runIdRef.current = data.run.id;
      }
    }
  }, [onWorkspaceChange]);

  useEffect(() => {
    if (workspaceId) {
      runIdRef.current = workspaceId;
      refreshStatus({ workspaceId }).catch(() => {});
      return;
    }
    refreshStatus().catch(() => {});
  }, [refreshStatus, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    if (runIdRef.current === workspaceId) return;
    runIdRef.current = workspaceId;
    setRun((prev) => ({
      ...prev,
      id: workspaceId,
    }));
    setChatError(null);
    setStreamingAssistant(null);
    setOptimisticUser(null);
    setToolCallsOpen({});
    refreshStatus({ workspaceId }).catch(() => {});
  }, [refreshStatus, workspaceId]);

  useEffect(() => {
    const streamId = BUILD_STREAM_ID;
    const streamUrl = buildDurableStreamUrl(
      streamId,
      getDurableStreamOffset(streamId),
    );
    const source = new EventSource(streamUrl);

    source.onmessage = (event) => {
      let envelope: { offset?: unknown; data?: unknown } | null = null;
      try {
        envelope = JSON.parse(event.data) as {
          offset?: unknown;
          data?: unknown;
        };
      } catch {
        return;
      }
      if (
        envelope &&
        typeof envelope.offset === "number" &&
        Number.isFinite(envelope.offset)
      ) {
        setDurableStreamOffset(streamId, envelope.offset + 1);
      }
      const msg = envelope?.data as BuildBotSocketMessage | undefined;
      if (!msg) return;
      const activeRunId = runIdRef.current;
      if (msg.type === "buildBotStatus" && msg.run) {
        if (activeRunId && msg.run.id !== activeRunId) return;
        setRun({
          ...msg.run,
          messages: msg.run.messages ?? [],
          traces: msg.run.traces ?? [],
          toolInserts: msg.run.toolInserts ?? [],
        } as BuildRun);
        return;
      }
      if (msg.type === "buildBotStream") {
        if (!msg.runId || (activeRunId && msg.runId !== activeRunId)) return;
        const streamRunId = msg.runId;
        const turn = typeof msg.turn === "number" ? msg.turn : 0;
        if (msg.role !== "assistant") return;
        setStreamingAssistant((prev) =>
          prev && prev.runId === streamRunId && prev.turn === turn
            ? { ...prev, text: prev.text + msg.chunk }
            : { runId: streamRunId, turn, text: msg.chunk }
        );
        return;
      }
      if (msg.type === "buildBotStreamEnd") {
        if (!msg.runId || (activeRunId && msg.runId !== activeRunId)) return;
        const turn = typeof msg.turn === "number" ? msg.turn : 0;
        setStreamingAssistant((prev) =>
          prev && prev.runId === msg.runId && prev.turn === turn ? null : prev
        );
      }
    };

    return () => {
      source.close();
    };
  }, []);

  const toolCalls = useMemo(
    () => summarizeToolCalls(run.traces ?? []),
    [run.traces],
  );

  const ensureWorkspaceId = useCallback(async () => {
    if (workspaceId) return workspaceId;
    if (runIdRef.current) return runIdRef.current;
    try {
      const res = await fetch("/api/workspace/new", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({})) as {
        workspaceId?: string;
      };
      if (res.ok && typeof data.workspaceId === "string") {
        const nextWorkspaceId = data.workspaceId;
        runIdRef.current = nextWorkspaceId;
        setRun((prev) => ({ ...prev, id: nextWorkspaceId }));
        onWorkspaceChange?.(nextWorkspaceId);
        return nextWorkspaceId;
      }
    } catch {
      // ignore
    }
    const fallback = `workspace-${crypto.randomUUID()}`;
    runIdRef.current = fallback;
    setRun((prev) => ({ ...prev, id: fallback }));
    return fallback;
  }, [onWorkspaceChange, workspaceId]);

  const resetChat = useCallback(async () => {
    const res = await fetch("/api/workspace/new", { method: "POST" }).catch(
      () => null,
    );
    const data = res
      ? await res.json().catch(() => ({})) as { workspaceId?: string }
      : {};
    if (res && res.ok && typeof data.workspaceId === "string") {
      runIdRef.current = data.workspaceId;
      setRun({
        id: data.workspaceId,
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
      });
      onWorkspaceChange?.(data.workspaceId);
    } else {
      runIdRef.current = "";
      setRun({
        id: "",
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
      });
    }
    setChatDraft("");
    setChatError(null);
    setStreamingAssistant(null);
    setOptimisticUser(null);
    setToolCallsOpen({});
  }, [onWorkspaceChange]);

  const sendMessage = useCallback(async (message: string) => {
    const runId = await ensureWorkspaceId();
    setChatSending(true);
    setChatError(null);
    try {
      const res = await fetch("/api/build/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: runId, message }),
      });
      const data = await res.json().catch(() => ({})) as {
        run?: BuildRun;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : res.statusText,
        );
      }
      if (data.run) {
        setRun({
          ...data.run,
          messages: data.run.messages ?? [],
          traces: data.run.traces ?? [],
          toolInserts: data.run.toolInserts ?? [],
        });
        if (typeof data.run.id === "string" && data.run.id) {
          runIdRef.current = data.run.id;
        }
      }
    } finally {
      setChatSending(false);
    }
  }, [ensureWorkspaceId]);

  const loadChat = useCallback(async (runId: string) => {
    setChatSending(true);
    setChatError(null);
    try {
      const res = await fetch("/api/build/load", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: runId }),
      });
      const data = await res.json().catch(() => ({})) as {
        run?: BuildRun;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : res.statusText,
        );
      }
      if (data.run) {
        setRun({
          ...data.run,
          messages: data.run.messages ?? [],
          traces: data.run.traces ?? [],
          toolInserts: data.run.toolInserts ?? [],
        });
        if (typeof data.run.id === "string" && data.run.id) {
          runIdRef.current = data.run.id;
        }
        if (typeof data.run.id === "string" && data.run.id) {
          onWorkspaceChange?.(data.run.id);
        }
        setChatDraft("");
        setOptimisticUser(null);
        setStreamingAssistant(null);
        setToolCallsOpen({});
      }
    } finally {
      setChatSending(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      run,
      toolCalls,
      chatDraft,
      setChatDraft,
      chatSending,
      chatError,
      setChatError,
      toolCallsOpen,
      setToolCallsOpen,
      optimisticUser,
      setOptimisticUser,
      streamingAssistant,
      setStreamingAssistant,
      resetChat,
      sendMessage,
      loadChat,
    }),
    [
      run,
      toolCalls,
      chatDraft,
      setChatDraft,
      chatSending,
      chatError,
      setChatError,
      toolCallsOpen,
      setToolCallsOpen,
      optimisticUser,
      setOptimisticUser,
      streamingAssistant,
      setStreamingAssistant,
      resetChat,
      sendMessage,
      loadChat,
    ],
  );

  return (
    <BuildChatContext.Provider value={value}>
      {children}
    </BuildChatContext.Provider>
  );
}

export function useBuildChat() {
  const context = useContext(BuildChatContext);
  if (!context) {
    throw new Error("useBuildChat must be used within BuildChatProvider");
  }
  return context;
}
