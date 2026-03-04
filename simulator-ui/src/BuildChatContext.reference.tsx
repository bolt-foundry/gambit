// LEGACY-ONLY, DO NOT USE. Retained for historical reference during GraphQL/Isograph cutover.
// deno-lint-ignore-file
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { graphqlFetch } from "./graphql_api.ts";
import {
  deriveBuildDisplayMessages,
  summarizeToolCalls,
  type ToolCallSummary,
  type TraceEvent,
} from "./utils.ts";

const WORKSPACE_API_BASE = "/api/workspace";

type BuildRun = {
  id: string;
  status: "idle" | "running" | "completed" | "error" | "canceled";
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  messages: Array<{ role: string; content: string }>;
  displayMessages?: Array<{
    kind: "message" | "tool" | "reasoning";
    role?: "user" | "assistant";
    content?: string;
    toolCallId?: string;
    toolSummary?: ToolCallSummary;
    reasoningId?: string;
    reasoningRaw?: Record<string, unknown>;
  }>;
  traces?: Array<TraceEvent>;
  toolInserts?: Array<{
    actionCallId?: string;
    parentActionCallId?: string;
    name?: string;
    index: number;
  }>;
};

type BuildChatState = {
  run: BuildRun;
  toolCalls: Array<ToolCallSummary>;
  chatDraft: string;
  setChatDraft: React.Dispatch<React.SetStateAction<string>>;
  chatSending: boolean;
  chatError: string | null;
  setChatError: React.Dispatch<React.SetStateAction<string | null>>;
  toolCallsOpen: Record<string, boolean>;
  setToolCallsOpen: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  optimisticUser: { id: string; text: string } | null;
  setOptimisticUser: React.Dispatch<
    React.SetStateAction<{ id: string; text: string } | null>
  >;
  streamingAssistant: { runId: string; turn: number; text: string } | null;
  setStreamingAssistant: React.Dispatch<
    React.SetStateAction<{ runId: string; turn: number; text: string } | null>
  >;
  stopChat: () => Promise<void>;
  resetChat: () => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  loadChat: (runId: string) => Promise<void>;
};

const BuildChatContext = createContext<BuildChatState | null>(null);

const emptyBuildRun = (): BuildRun => ({
  id: "",
  status: "idle",
  messages: [],
  traces: [],
  toolInserts: [],
  displayMessages: [],
});

const normalizeBuildRun = (run: BuildRun): BuildRun => {
  const normalized: BuildRun = {
    ...run,
    messages: Array.isArray(run.messages) ? run.messages : [],
    traces: Array.isArray(run.traces) ? run.traces : [],
    toolInserts: Array.isArray(run.toolInserts) ? run.toolInserts : [],
  };
  normalized.displayMessages = deriveBuildDisplayMessages(
    normalized.messages,
    normalized.traces ?? [],
  );
  return normalized;
};

export function BuildChatProvider(
  props: {
    children: React.ReactNode;
    workspaceId?: string | null;
    onWorkspaceChange?: (workspaceId: string) => void;
  },
) {
  const { children, workspaceId, onWorkspaceChange } = props;
  const [run, setRun] = useState<BuildRun>(() => emptyBuildRun());
  const runRef = useRef<BuildRun>(emptyBuildRun());
  const runIdRef = useRef<string>("");
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [toolCallsOpen, setToolCallsOpen] = useState<Record<string, boolean>>(
    {},
  );
  const [optimisticUser, setOptimisticUser] = useState<
    { id: string; text: string } | null
  >(null);
  const [streamingAssistant, setStreamingAssistant] = useState<
    { runId: string; turn: number; text: string } | null
  >(null);

  useEffect(() => {
    runRef.current = run;
    if (run.id) runIdRef.current = run.id;
  }, [run]);

  const refreshBuildStatus = useCallback(async (id: string) => {
    const res = await graphqlFetch(`/api/workspaces/${encodeURIComponent(id)}`);
    if (!res.ok) {
      throw new Error(res.statusText);
    }
    const data = await res.json().catch(() => ({})) as {
      build?: { run?: BuildRun };
      workspaceId?: string;
    };
    if (!data.build?.run) return;
    const nextRun = normalizeBuildRun(data.build.run);
    runIdRef.current = nextRun.id || id;
    setRun(nextRun);
  }, []);

  useEffect(() => {
    const activeRun = runRef.current;
    if (!activeRun.id || activeRun.status !== "running") return;
    let canceled = false;
    const tick = async () => {
      if (canceled) return;
      try {
        await refreshBuildStatus(activeRun.id);
      } catch {
        // ignore polling failures; next tick will retry
      }
    };
    const handle = globalThis.setInterval(() => {
      void tick();
    }, 1000);
    void tick();
    return () => {
      canceled = true;
      globalThis.clearInterval(handle);
    };
  }, [refreshBuildStatus, run.id, run.status]);

  const ensureWorkspaceId = useCallback(async () => {
    if (workspaceId) return workspaceId;
    if (runIdRef.current) return runIdRef.current;
    const res = await graphqlFetch(`${WORKSPACE_API_BASE}/new`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({})) as {
      workspaceId?: string;
      error?: string;
    };
    if (!res.ok || typeof data.workspaceId !== "string") {
      throw new Error(
        typeof data.error === "string"
          ? data.error
          : "Failed to create workspace",
      );
    }
    runIdRef.current = data.workspaceId;
    onWorkspaceChange?.(data.workspaceId);
    return data.workspaceId;
  }, [onWorkspaceChange, workspaceId]);

  const sendMessage = useCallback(async (message: string) => {
    const id = await ensureWorkspaceId();
    setChatSending(true);
    setChatError(null);
    try {
      const res = await graphqlFetch("/api/build/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: id, message }),
      });
      const data = await res.json().catch(() => ({})) as {
        run?: BuildRun;
        error?: string;
      };
      if (!res.ok || !data.run) {
        throw new Error(
          typeof data.error === "string" ? data.error : res.statusText,
        );
      }
      const nextRun = normalizeBuildRun(data.run);
      runIdRef.current = nextRun.id || id;
      setRun(nextRun);
    } finally {
      setChatSending(false);
    }
  }, [ensureWorkspaceId]);

  const stopChat = useCallback(async () => {
    const id = runRef.current.id || runIdRef.current;
    if (!id) return;
    const res = await graphqlFetch("/api/build/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: id }),
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
      setRun(normalizeBuildRun(data.run));
      return;
    }
    await refreshBuildStatus(id);
  }, [refreshBuildStatus]);

  const loadChat = useCallback(async (runId: string) => {
    setChatSending(true);
    setChatError(null);
    try {
      await refreshBuildStatus(runId);
      onWorkspaceChange?.(runId);
    } finally {
      setChatSending(false);
    }
  }, [onWorkspaceChange, refreshBuildStatus]);

  const resetChat = useCallback(async () => {
    const res = await graphqlFetch(`${WORKSPACE_API_BASE}/new`, {
      method: "POST",
    }).catch(() => null);
    const data = res
      ? await res.json().catch(() => ({})) as { workspaceId?: string }
      : {};
    if (res && res.ok && typeof data.workspaceId === "string") {
      runIdRef.current = data.workspaceId;
      setRun({
        ...emptyBuildRun(),
        id: data.workspaceId,
      });
      onWorkspaceChange?.(data.workspaceId);
    } else {
      runIdRef.current = "";
      setRun(emptyBuildRun());
    }
    setChatDraft("");
    setChatError(null);
    setStreamingAssistant(null);
    setOptimisticUser(null);
    setToolCallsOpen({});
  }, [onWorkspaceChange]);

  const toolCalls = useMemo(() => summarizeToolCalls(run.traces ?? []), [
    run.traces,
  ]);

  const value = useMemo<BuildChatState>(() => ({
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
    stopChat,
    resetChat,
    sendMessage,
    loadChat,
  }), [
    chatDraft,
    chatError,
    chatSending,
    loadChat,
    optimisticUser,
    resetChat,
    run,
    sendMessage,
    stopChat,
    streamingAssistant,
    toolCalls,
    toolCallsOpen,
  ]);

  return (
    <BuildChatContext.Provider value={value}>
      {children}
    </BuildChatContext.Provider>
  );
}

export function useBuildChat() {
  const ctx = useContext(BuildChatContext);
  if (!ctx) {
    throw new Error("useBuildChat must be used within BuildChatProvider");
  }
  return ctx;
}
