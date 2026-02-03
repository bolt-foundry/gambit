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
  props: { children: React.ReactNode },
) {
  const { children } = props;
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

  const refreshStatus = useCallback(async (opts?: { runId?: string }) => {
    const query = opts?.runId ? `?runId=${encodeURIComponent(opts.runId)}` : "";
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
  }, []);

  useEffect(() => {
    refreshStatus().catch(() => {});
  }, [refreshStatus]);

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

  const ensureRunId = useCallback(() => {
    if (runIdRef.current) return runIdRef.current;
    const next = `build-ui-${crypto.randomUUID()}`;
    runIdRef.current = next;
    setRun((prev) => ({ ...prev, id: next }));
    return next;
  }, []);

  const resetChat = useCallback(async () => {
    const runId = runIdRef.current;
    if (!runId) {
      setRun({
        id: "",
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
      });
      setChatDraft("");
      setChatError(null);
      setStreamingAssistant(null);
      setOptimisticUser(null);
      setToolCallsOpen({});
      return;
    }
    await fetch("/api/build/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId }),
    }).catch(() => {});
    runIdRef.current = "";
    setRun({
      id: "",
      status: "idle",
      messages: [],
      traces: [],
      toolInserts: [],
    });
    setChatDraft("");
    setChatError(null);
    setStreamingAssistant(null);
    setOptimisticUser(null);
    setToolCallsOpen({});
  }, []);

  const sendMessage = useCallback(async (message: string) => {
    const runId = ensureRunId();
    setChatSending(true);
    setChatError(null);
    try {
      const res = await fetch("/api/build/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, message }),
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
  }, [ensureRunId]);

  const loadChat = useCallback(async (runId: string) => {
    setChatSending(true);
    setChatError(null);
    try {
      const res = await fetch("/api/build/load", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId }),
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
