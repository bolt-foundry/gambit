import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  botFilename,
  cloneValue,
  deriveInitialFromSchema,
  fileNameFromPath,
  findMissingRequiredFields,
  formatJson,
  formatTimestampShort,
  scenarioNameFromValue,
} from "./utils.ts";
import type {
  NormalizedSchema,
  TestBotConfigResponse,
  TestBotRun,
  TestDeckMeta,
} from "./utils.ts";
import { useHttpSchema } from "./shared.tsx";
import PageGrid from "./gds/PageGrid.tsx";
import PageShell from "./gds/PageShell.tsx";
import Panel from "./gds/Panel.tsx";
import Button from "./gds/Button.tsx";
import Tabs from "./gds/Tabs.tsx";
import List from "./gds/List.tsx";
import ListItem from "./gds/ListItem.tsx";
import Listbox from "./gds/Listbox.tsx";
import ScrollingText from "./gds/ScrollingText.tsx";
import { useWorkspaceTest } from "./WorkspaceContext.tsx";
import TestBotChatPanel from "./TestBotChatPanel.tsx";

const TEST_STATUS_POLL_INTERVAL_MS = 5000;

type TestRunSummary = {
  runId: string;
  lastEventSeq?: number;
  updatedAt?: string;
  selectedScenarioDeckId?: string;
  selectedScenarioDeckLabel?: string;
  scenarioConfigPath?: string;
};

const getScenarioTitle = (
  summary: TestRunSummary,
  opts?: {
    labelById?: Record<string, string>;
    labelByPath?: Record<string, string>;
  },
): string => {
  const fromDeckCatalogById = typeof summary.selectedScenarioDeckId === "string"
    ? opts?.labelById?.[summary.selectedScenarioDeckId]
    : undefined;
  const fromDeckCatalogByPath = typeof summary.scenarioConfigPath === "string"
    ? opts?.labelByPath?.[summary.scenarioConfigPath]
    : undefined;
  const fromDeckLabel = typeof summary.selectedScenarioDeckLabel === "string" &&
      summary.selectedScenarioDeckLabel.trim().length > 0
    ? summary.selectedScenarioDeckLabel
    : null;
  const fromDeckId = typeof summary.selectedScenarioDeckId === "string" &&
      summary.selectedScenarioDeckId.trim().length > 0
    ? scenarioNameFromValue(summary.selectedScenarioDeckId) ??
      summary.selectedScenarioDeckId
    : null;
  const fromPath = scenarioNameFromValue(summary.scenarioConfigPath) ??
    botFilename(summary.scenarioConfigPath);
  return fromDeckCatalogById ?? fromDeckCatalogByPath ?? fromDeckLabel ??
    fromDeckId ?? fromPath ?? summary.runId;
};

export default function TestBotPage(props: {
  onReplaceTestBotSession: (workspaceId: string, runId?: string) => void;
  onResetTestBotSession: () => void;
  activeWorkspaceId: string | null;
  requestedRunId?: string | null;
  resetToken?: number;
  setNavActions?: (actions: React.ReactNode | null) => void;
  onFeedbackPersisted?: (workspaceId: string) => void;
}) {
  const {
    onReplaceTestBotSession,
    onResetTestBotSession,
    activeWorkspaceId,
    requestedRunId,
    resetToken,
    setNavActions,
    onFeedbackPersisted,
  } = props;
  const deckStorageKey = "gambit:test:selected-deck";
  const [testDecks, setTestDecks] = useState<TestDeckMeta[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [botDescription, setBotDescription] = useState<string | null>(null);
  const [botInputSchema, setBotInputSchema] = useState<NormalizedSchema | null>(
    null,
  );
  const [botInputSchemaError, setBotInputSchemaError] = useState<string | null>(
    null,
  );
  const [botInputValue, setBotInputValue] = useState<unknown>(undefined);
  const [botInputDirty, setBotInputDirty] = useState(false);
  const [botInputJsonText, setBotInputJsonText] = useState("");
  const [botInputJsonError, setBotInputJsonError] = useState<string | null>(
    null,
  );
  const [botInputDefaults, setBotInputDefaults] = useState<unknown>(undefined);
  const [initialUserMessage] = useState("");
  const workspaceTest = useWorkspaceTest();
  const {
    run,
    setRun,
    streamingUser,
    streamingAssistant,
    chatDraft,
    setChatDraft,
    chatSending,
    chatError,
    optimisticUser,
  } = workspaceTest;
  const refreshTestStatusApi = workspaceTest.refreshStatus;
  const startTestRunApi = workspaceTest.startRun;
  const startTestAssistantApi = workspaceTest.startAssistant;
  const sendTestMessageApi = workspaceTest.sendMessage;
  const stopTestRunApi = workspaceTest.stopRun;
  const resetTestRunApi = workspaceTest.resetRun;
  const saveTestFeedbackApi = workspaceTest.saveFeedback;
  const [lastInitFill, setLastInitFill] = useState<
    TestBotRun["initFill"] | null
  >(null);
  const [requestedRunNotFound, setRequestedRunNotFound] = useState(false);
  const runIdRef = useRef<string | undefined>(run.id);
  const [assistantDeckTab, setAssistantDeckTab] = useState<
    "input" | "tools" | "schema"
  >("input");
  const [testRunHistory, setTestRunHistory] = useState<TestRunSummary[]>([]);
  const runWorkspaceId = run.workspaceId ?? run.sessionId;
  const deckSchema = useHttpSchema({ workspaceId: activeWorkspaceId });
  const deckInputSchema = deckSchema.schemaResponse?.schema;
  const deckSchemaDefaults = deckSchema.schemaResponse?.defaults;
  const deckSchemaError = deckSchema.schemaResponse?.error ??
    deckSchema.error ??
    undefined;

  const [deckInitValue, setDeckInitValue] = useState<unknown>(undefined);
  const [deckInitDirty, setDeckInitDirty] = useState(false);
  const [deckInitJsonText, setDeckInitJsonText] = useState("");
  const [deckInitJsonError, setDeckInitJsonError] = useState<string | null>(
    null,
  );
  const pollTimeoutRef = useRef<number | null>(null);
  const pollSeqRef = useRef(0);
  const pollInFlightRef = useRef(false);
  const lastResetTokenRef = useRef<number | undefined>(resetToken);
  const handleNewChatRef = useRef<() => void>(() => {});
  const allowRunSessionNavRef = useRef(false);
  const suppressWorkspaceHydrateRef = useRef(false);
  const lastWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);

  const loadTestBot = useCallback(async (opts?: { deckId?: string }) => {
    let storedDeckId: string | null = null;
    try {
      storedDeckId = localStorage.getItem(deckStorageKey);
    } catch {
      storedDeckId = null;
    }
    const requestedDeckId = opts?.deckId ?? storedDeckId ?? undefined;
    const fetchTestBotConfig = async (deckId?: string) => {
      const params = new URLSearchParams();
      if (deckId) params.set("deckPath", deckId);
      if (activeWorkspaceId) params.set("workspaceId", activeWorkspaceId);
      const query = params.toString() ? `?${params.toString()}` : "";
      return fetch(`/api/test${query}`);
    };
    const loadResponse = async (
      res: Response,
    ): Promise<TestBotConfigResponse> => {
      if (!res.ok) throw new Error(res.statusText);
      return await res.json() as TestBotConfigResponse;
    };
    try {
      let data: TestBotConfigResponse;
      if (!opts?.deckId && storedDeckId) {
        const initial = await fetchTestBotConfig();
        data = await loadResponse(initial);
        const decks = Array.isArray(data.testDecks) ? data.testDecks : [];
        if (decks.some((deck) => deck.id === storedDeckId)) {
          const res = await fetchTestBotConfig(storedDeckId);
          data = await loadResponse(res);
        } else {
          try {
            localStorage.removeItem(deckStorageKey);
          } catch {
            // ignore storage failures
          }
        }
      } else {
        let res = await fetchTestBotConfig(requestedDeckId);
        if (!res.ok && res.status === 400 && requestedDeckId) {
          try {
            localStorage.removeItem(deckStorageKey);
          } catch {
            // ignore storage failures
          }
          res = await fetchTestBotConfig();
        }
        data = await loadResponse(res);
      }
      const decks = Array.isArray(data.testDecks) ? data.testDecks : [];
      setTestDecks(decks);
      setBotDescription(
        typeof data.botDescription === "string" ? data.botDescription : null,
      );
      const nextDeckId = (() => {
        if (!decks.length) return null;
        const requested = data.selectedDeckId ?? requestedDeckId ?? null;
        if (requested && decks.some((deck) => deck.id === requested)) {
          return requested;
        }
        return decks[0]?.id ?? null;
      })();
      setSelectedDeckId(nextDeckId ?? null);
      setBotInputSchema(data.inputSchema ?? null);
      setBotInputSchemaError(
        typeof data.inputSchemaError === "string"
          ? data.inputSchemaError
          : null,
      );
      setBotInputDirty(false);
      setBotInputDefaults(data.defaults?.input);
      setBotInputValue(data.defaults?.input);
      setBotInputJsonText(formatJson(data.defaults?.input));
      setBotInputJsonError(null);
    } catch (err) {
      console.error(err);
    }
  }, [activeWorkspaceId, deckStorageKey]);

  const loadTestRunHistory = useCallback(async () => {
    if (!activeWorkspaceId) {
      setTestRunHistory([]);
      return;
    }
    const parseSummary = (value: unknown): TestRunSummary | null => {
      if (!value || typeof value !== "object") return null;
      const summary = value as Record<string, unknown>;
      const runId = typeof summary.scenarioRunId === "string"
        ? summary.scenarioRunId
        : null;
      if (!runId) return null;
      return {
        runId,
        lastEventSeq: typeof summary.lastEventSeq === "number" &&
            Number.isFinite(summary.lastEventSeq)
          ? summary.lastEventSeq
          : undefined,
        updatedAt: typeof summary.updatedAt === "string"
          ? summary.updatedAt
          : undefined,
        selectedScenarioDeckId: typeof summary.selectedScenarioDeckId ===
            "string"
          ? summary.selectedScenarioDeckId
          : undefined,
        selectedScenarioDeckLabel:
          typeof summary.selectedScenarioDeckLabel === "string"
            ? summary.selectedScenarioDeckLabel
            : undefined,
        scenarioConfigPath: typeof summary.scenarioConfigPath === "string"
          ? summary.scenarioConfigPath
          : undefined,
      };
    };
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}`,
      );
      if (!res.ok) return;
      const body = await res.json().catch(() => ({})) as {
        session?: { meta?: Record<string, unknown> };
      };
      const meta = body.session?.meta && typeof body.session.meta === "object"
        ? body.session.meta
        : {};
      const fromList = Array.isArray(meta.scenarioRunSummaries)
        ? meta.scenarioRunSummaries.map((entry) => parseSummary(entry))
        : [];
      const current = parseSummary(meta.scenarioRunSummary);
      const all = [
        ...fromList,
        current,
      ].filter((entry): entry is TestRunSummary => Boolean(entry));
      const deduped = new Map<string, TestRunSummary>();
      all.forEach((entry) => {
        const existing = deduped.get(entry.runId);
        if (!existing) {
          deduped.set(entry.runId, entry);
          return;
        }
        const existingSeq = existing.lastEventSeq ?? -1;
        const nextSeq = entry.lastEventSeq ?? -1;
        if (nextSeq > existingSeq) {
          deduped.set(entry.runId, entry);
          return;
        }
        if (nextSeq === existingSeq) {
          const existingStamp = existing.updatedAt ?? "";
          const nextStamp = entry.updatedAt ?? "";
          if (nextStamp.localeCompare(existingStamp) > 0) {
            deduped.set(entry.runId, entry);
          }
        }
      });
      setTestRunHistory(
        [...deduped.values()].sort((a, b) => {
          const aTime = Date.parse(a.updatedAt ?? "");
          const bTime = Date.parse(b.updatedAt ?? "");
          const aValidTime = Number.isFinite(aTime) ? aTime : -1;
          const bValidTime = Number.isFinite(bTime) ? bTime : -1;
          if (aValidTime !== bValidTime) return bValidTime - aValidTime;
          const aSeq = a.lastEventSeq ?? -1;
          const bSeq = b.lastEventSeq ?? -1;
          if (aSeq !== bSeq) return bSeq - aSeq;
          return b.runId.localeCompare(a.runId);
        }),
      );
    } catch {
      // Ignore run history fetch failures; chat still works without this list.
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    loadTestBot();
  }, [loadTestBot]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setTestRunHistory([]);
      return;
    }
    if (run.status === "running") return;
    loadTestRunHistory();
  }, [
    activeWorkspaceId,
    loadTestRunHistory,
    requestedRunId,
    run.id,
    run.status,
  ]);

  useEffect(() => {
    if (!runWorkspaceId) return;
    if (runWorkspaceId === "new") return;
    if (!allowRunSessionNavRef.current) return;
    if (activeWorkspaceId && runWorkspaceId !== activeWorkspaceId) {
      return;
    }
    onReplaceTestBotSession(runWorkspaceId, run.id);
    allowRunSessionNavRef.current = false;
  }, [activeWorkspaceId, onReplaceTestBotSession, run.id, runWorkspaceId]);

  useEffect(() => {
    if (!selectedDeckId) return;
    try {
      localStorage.setItem(deckStorageKey, selectedDeckId);
    } catch {
      // ignore storage failures
    }
  }, [deckStorageKey, selectedDeckId]);

  useEffect(() => {
    runIdRef.current = run.id;
  }, [run.id]);

  const refreshStatus = useCallback(async (
    opts?: { runId?: string; workspaceId?: string },
  ) => {
    try {
      const runId = opts?.runId ??
        (opts?.workspaceId ? undefined : runIdRef.current);
      const deckParam = testDecks.length
        ? (selectedDeckId || testDecks[0]?.id || "")
        : "";
      return await refreshTestStatusApi({
        runId,
        workspaceId: opts?.workspaceId ?? activeWorkspaceId ??
          runWorkspaceId ??
          undefined,
        deckPath: deckParam || undefined,
      });
    } catch (err) {
      console.error(err);
      return {
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
      } as TestBotRun;
    }
  }, [
    activeWorkspaceId,
    refreshTestStatusApi,
    runWorkspaceId,
    selectedDeckId,
    testDecks,
  ]);

  useEffect(() => {
    if (lastWorkspaceIdRef.current !== activeWorkspaceId) {
      lastWorkspaceIdRef.current = activeWorkspaceId;
      suppressWorkspaceHydrateRef.current = false;
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (activeWorkspaceId) return;
    setRequestedRunNotFound(false);
    refreshStatus();
  }, [activeWorkspaceId, refreshStatus]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    if (allowRunSessionNavRef.current) return;
    if (suppressWorkspaceHydrateRef.current && !requestedRunId) return;
    const hydrate = async () => {
      const hydrated = await refreshStatus({
        workspaceId: activeWorkspaceId,
        runId: requestedRunId ?? undefined,
      });
      if (
        requestedRunId &&
        (!hydrated.id || hydrated.id !== requestedRunId)
      ) {
        setRequestedRunNotFound(true);
        setRun({
          id: requestedRunId,
          status: "error",
          workspaceId: activeWorkspaceId,
          sessionId: activeWorkspaceId,
          error: `Run "${requestedRunId}" was not found.`,
          messages: [],
          traces: [],
          toolInserts: [],
        });
        return;
      }
      setRequestedRunNotFound(false);
    };
    hydrate().catch((err) => console.error(err));
  }, [activeWorkspaceId, refreshStatus, requestedRunId, setRun]);

  useEffect(() => {
    if (!deckInputSchema) return;
    if (deckInitDirty) return;
    const nextInit = deckSchemaDefaults !== undefined
      ? cloneValue(deckSchemaDefaults)
      : deriveInitialFromSchema(deckInputSchema);
    setDeckInitValue(nextInit);
    setDeckInitJsonText(formatJson(nextInit));
    setDeckInitJsonError(null);
  }, [deckInputSchema, deckSchemaDefaults, deckInitDirty]);

  useEffect(() => {
    if (!botInputSchema) return;
    if (botInputDirty) return;
    const nextBotInput = botInputDefaults !== undefined
      ? cloneValue(botInputDefaults)
      : deriveInitialFromSchema(botInputSchema);
    setBotInputValue(nextBotInput);
    setBotInputJsonText(formatJson(nextBotInput));
    setBotInputJsonError(null);
  }, [botInputSchema, botInputDirty, botInputDefaults]);

  useEffect(() => {
    if (run.status === "error" && run.error) {
      console.error("[scenario] run error (state)", run.error);
    }
  }, [run.error, run.status]);

  const missingBotInput = useMemo(() => {
    if (!botInputSchema) return [];
    return findMissingRequiredFields(botInputSchema, botInputValue);
  }, [botInputSchema, botInputValue]);

  const botJsonErrorCount = useMemo(() => {
    return botInputJsonError ? 1 : 0;
  }, [botInputJsonError]);

  const missingDeckInit = useMemo(() => {
    if (!deckInputSchema) return [];
    return findMissingRequiredFields(deckInputSchema, deckInitValue);
  }, [deckInputSchema, deckInitValue]);

  const deckJsonErrorCount = useMemo(() => {
    return deckInitJsonError ? 1 : 0;
  }, [deckInitJsonError]);
  const deckTools = useMemo(() => {
    const tools = deckSchema.schemaResponse?.tools;
    if (!Array.isArray(tools)) return [];
    return tools
      .filter(
        (tool): tool is {
          name: string;
          label?: string;
          description?: string;
          path?: string;
        } => Boolean(tool && typeof tool.name === "string"),
      )
      .map((tool) => {
        const pathValue = typeof tool.path === "string" ? tool.path : undefined;
        const fileName = fileNameFromPath(pathValue);
        return {
          name: tool.name,
          label: tool.label && tool.label.trim().length > 0
            ? tool.label
            : tool.name,
          description: tool.description,
          path: pathValue,
          fileName,
        };
      })
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      );
  }, [deckSchema.schemaResponse?.tools]);

  const canRunPersona = testDecks.length > 0;
  const hasPersonaSelection = Boolean(selectedDeckId);
  const hasDeckSelection = !canRunPersona || hasPersonaSelection;
  const canStart = canRunPersona && hasPersonaSelection &&
    (!botInputSchema || missingBotInput.length === 0) &&
    botJsonErrorCount === 0 &&
    deckJsonErrorCount === 0;

  useEffect(() => {
    pollSeqRef.current += 1;
    const seq = pollSeqRef.current;
    if (pollTimeoutRef.current !== null) {
      globalThis.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    if (run.status !== "running") {
      pollInFlightRef.current = false;
      return;
    }

    const scheduleNext = () => {
      if (pollSeqRef.current !== seq) return;
      pollTimeoutRef.current = globalThis.setTimeout(() => {
        void tick();
      }, TEST_STATUS_POLL_INTERVAL_MS);
    };

    const tick = async () => {
      if (pollSeqRef.current !== seq) return;
      if (pollInFlightRef.current) {
        scheduleNext();
        return;
      }
      pollInFlightRef.current = true;
      try {
        await refreshStatus();
      } finally {
        pollInFlightRef.current = false;
      }
      scheduleNext();
    };

    scheduleNext();
    return () => {
      if (pollSeqRef.current === seq) {
        pollSeqRef.current += 1;
      }
      pollInFlightRef.current = false;
      if (pollTimeoutRef.current !== null) {
        globalThis.clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [run.status, refreshStatus]);

  const startRun = useCallback(async () => {
    try {
      allowRunSessionNavRef.current = true;
      const initFillRequest = missingDeckInit.length > 0
        ? { requested: missingDeckInit }
        : null;
      if (initFillRequest) {
        setLastInitFill(initFillRequest);
        console.info("[scenario] init fill requested", initFillRequest);
      }
      const payload: Record<string, unknown> = {
        botInput: botInputValue,
        initialUserMessage,
        botDeckPath: selectedDeckId ?? undefined,
        context: deckInitValue,
        initFill: missingDeckInit.length > 0
          ? { missing: missingDeckInit }
          : undefined,
        workspaceId: activeWorkspaceId ?? undefined,
      };
      const data = await startTestRunApi(payload) as {
        run?: TestBotRun;
        error?: string;
        initFill?: TestBotRun["initFill"];
        sessionPath?: string;
      };
      if (!data.run) {
        allowRunSessionNavRef.current = false;
        if (data.initFill) {
          setLastInitFill(data.initFill);
          console.info("[scenario] init fill error", data.initFill);
        }
        if (data.sessionPath) {
          console.info(
            "[scenario] init fill session saved",
            data.sessionPath,
          );
        }
        const errorMessage = typeof data.error === "string"
          ? data.error
          : "Failed to start scenario run";
        console.error("[scenario] run error", errorMessage);
        setRun({
          status: "error",
          error: errorMessage,
          initFill: data.initFill,
          messages: [],
          traces: [],
          toolInserts: [],
        });
        return;
      }
      if (data.run.initFill) {
        setLastInitFill(data.run.initFill);
        console.info("[scenario] init fill applied", data.run.initFill);
      }
      refreshStatus({
        runId: data.run?.id,
        workspaceId: activeWorkspaceId ?? undefined,
      });
    } catch (err) {
      allowRunSessionNavRef.current = false;
      console.error(err);
    }
  }, [
    deckInitValue,
    botInputValue,
    initialUserMessage,
    refreshStatus,
    startTestRunApi,
    selectedDeckId,
    missingDeckInit,
    activeWorkspaceId,
  ]);

  const stopRun = useCallback(async () => {
    if (!run.id) return;
    try {
      await stopTestRunApi(run.id);
    } catch (err) {
      console.error(err);
    } finally {
      refreshStatus({ runId: run.id });
    }
  }, [refreshStatus, run.id, stopTestRunApi]);

  const handleNewChat = useCallback(async () => {
    if (run.status === "running") {
      await stopRun();
    }
    allowRunSessionNavRef.current = false;
    suppressWorkspaceHydrateRef.current = true;
    resetTestRunApi();
    setRequestedRunNotFound(false);
    onResetTestBotSession();
  }, [onResetTestBotSession, run.status, stopRun, resetTestRunApi]);

  useEffect(() => {
    handleNewChatRef.current = handleNewChat;
  }, [handleNewChat]);

  useEffect(() => {
    if (resetToken === undefined) return;
    const previous = lastResetTokenRef.current;
    lastResetTokenRef.current = resetToken;
    if (previous === undefined || previous === resetToken) return;
    handleNewChatRef.current();
  }, [resetToken]);

  useEffect(() => {
    if (!setNavActions) return;
    setNavActions(null);
    return () => setNavActions(null);
  }, [handleNewChat, setNavActions]);

  const saveTestBotFeedback = useCallback(async (
    messageRefId: string,
    score: number | null,
    reason?: string,
  ) => {
    const feedbackWorkspaceId = activeWorkspaceId ?? runWorkspaceId;
    if (!feedbackWorkspaceId) {
      throw new Error("Missing workspace context for feedback save");
    }
    if (
      activeWorkspaceId &&
      runWorkspaceId &&
      activeWorkspaceId !== runWorkspaceId
    ) {
      throw new Error(
        "Active workspace does not match the current test run workspace",
      );
    }
    await saveTestFeedbackApi({
      workspaceId: feedbackWorkspaceId,
      runId: run.id || undefined,
      messageRefId,
      score,
      reason,
    });
    onFeedbackPersisted?.(feedbackWorkspaceId);
  }, [
    activeWorkspaceId,
    onFeedbackPersisted,
    runWorkspaceId,
    saveTestFeedbackApi,
  ]);

  const handleTestBotScore = useCallback(
    async (messageRefId: string, score: number | null) => {
      await saveTestBotFeedback(messageRefId, score);
    },
    [saveTestBotFeedback],
  );

  const handleTestBotReason = useCallback(
    async (messageRefId: string, score: number, reason: string) => {
      await saveTestBotFeedback(messageRefId, score, reason);
    },
    [saveTestBotFeedback],
  );

  const handleDeckSelection = useCallback(async (nextId: string) => {
    if (!nextId) return;
    if (nextId === selectedDeckId) return;
    await handleNewChat();
    setSelectedDeckId(nextId);
    loadTestBot({ deckId: nextId });
  }, [handleNewChat, loadTestBot, selectedDeckId]);

  const parseRootJsonInput = useCallback(
    (text: string): { parsed?: unknown; error: string | null } => {
      if (text.trim() === "") {
        return { parsed: undefined, error: null };
      }
      try {
        return { parsed: JSON.parse(text), error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid JSON";
        return { error: `Invalid JSON: ${message}` };
      }
    },
    [],
  );

  const runStatusLabel = run.status === "running"
    ? "Running…"
    : run.status === "completed"
    ? "Completed"
    : run.status === "error"
    ? "Failed"
    : run.status === "canceled"
    ? "Stopped"
    : "Idle";

  const startMode = deckSchema.schemaResponse?.startMode ?? "assistant";
  const isUserStart = startMode === "user";
  const showStartOverlay = hasDeckSelection &&
    startMode === "assistant" &&
    run.status !== "running" &&
    run.messages.length === 0 &&
    !streamingAssistant?.text &&
    !streamingUser?.text;
  const canStartAssistant = showStartOverlay &&
    !chatSending &&
    run.status !== "running" &&
    (Boolean(runWorkspaceId) ||
      (deckJsonErrorCount === 0 && missingDeckInit.length === 0));

  const canSendChat = hasDeckSelection &&
    run.status !== "running" &&
    !chatSending &&
    chatDraft.trim().length > 0 &&
    !showStartOverlay &&
    (Boolean(runWorkspaceId) ||
      (deckJsonErrorCount === 0 && missingDeckInit.length === 0));

  const handleStartAssistant = useCallback(async () => {
    if (!hasDeckSelection || chatSending) return;
    allowRunSessionNavRef.current = true;
    try {
      await startTestAssistantApi({
        runId: run.id,
        workspaceId: activeWorkspaceId ?? undefined,
        runWorkspaceId: runWorkspaceId ?? undefined,
        botDeckPath: selectedDeckId ?? undefined,
        context: !runWorkspaceId ? deckInitValue : undefined,
      });
    } catch {
      // Error state is set in context.
    }
  }, [
    chatSending,
    deckInitValue,
    hasDeckSelection,
    run.id,
    runWorkspaceId,
    selectedDeckId,
    activeWorkspaceId,
    startTestAssistantApi,
  ]);

  const handleSendChat = useCallback(async () => {
    const message = chatDraft.trim();
    if (!message) return;
    allowRunSessionNavRef.current = true;
    try {
      await sendTestMessageApi(message, {
        runId: run.id,
        workspaceId: activeWorkspaceId ?? undefined,
        runWorkspaceId: runWorkspaceId ?? undefined,
        botDeckPath: selectedDeckId ?? undefined,
        context: !runWorkspaceId ? deckInitValue : undefined,
      });
    } catch {
      // Error state is set in context.
    }
  }, [
    chatDraft,
    deckInitValue,
    run.id,
    runWorkspaceId,
    selectedDeckId,
    activeWorkspaceId,
    sendTestMessageApi,
  ]);

  const scenarioLabelById = useMemo(() => {
    const next: Record<string, string> = {};
    for (const deck of testDecks) {
      if (!deck?.id || !deck.label) continue;
      next[deck.id] = deck.label;
    }
    return next;
  }, [testDecks]);

  const scenarioLabelByPath = useMemo(() => {
    const next: Record<string, string> = {};
    for (const deck of testDecks) {
      if (!deck?.path || !deck.label) continue;
      next[deck.path] = deck.label;
    }
    return next;
  }, [testDecks]);

  const runHistoryOptions = useMemo(() => {
    const map = new Map<string, TestRunSummary>();
    testRunHistory.forEach((entry) => {
      map.set(entry.runId, entry);
    });
    if (run.id) {
      const existing = map.get(run.id);
      const selectedDeck = selectedDeckId
        ? testDecks.find((deck) => deck.id === selectedDeckId)
        : null;
      map.set(run.id, {
        ...(existing ?? {}),
        runId: run.id,
        updatedAt: existing?.updatedAt ?? run.finishedAt ?? run.startedAt,
        selectedScenarioDeckId: existing?.selectedScenarioDeckId ??
          selectedDeck?.id,
        selectedScenarioDeckLabel: existing?.selectedScenarioDeckLabel ??
          selectedDeck?.label,
        scenarioConfigPath: existing?.scenarioConfigPath ?? selectedDeck?.path,
      });
    }
    const currentRequested = requestedRunId ?? null;
    if (currentRequested && !map.has(currentRequested)) {
      map.set(currentRequested, { runId: currentRequested });
    }
    return [...map.values()].sort((a, b) => {
      const aTime = Date.parse(a.updatedAt ?? "");
      const bTime = Date.parse(b.updatedAt ?? "");
      const aValidTime = Number.isFinite(aTime) ? aTime : -1;
      const bValidTime = Number.isFinite(bTime) ? bTime : -1;
      if (aValidTime !== bValidTime) return bValidTime - aValidTime;
      const aSeq = a.lastEventSeq ?? -1;
      const bSeq = b.lastEventSeq ?? -1;
      if (aSeq !== bSeq) return bSeq - aSeq;
      return b.runId.localeCompare(a.runId);
    });
  }, [
    requestedRunId,
    run.finishedAt,
    run.id,
    run.startedAt,
    selectedDeckId,
    testDecks,
    testRunHistory,
  ]);

  const selectedRunHistoryValue = requestedRunId ?? run.id ?? "";

  const handleRunHistorySelection = useCallback((nextRunId: string) => {
    if (!nextRunId || !activeWorkspaceId) return;
    if (nextRunId === selectedRunHistoryValue) return;
    suppressWorkspaceHydrateRef.current = false;
    allowRunSessionNavRef.current = false;
    setRequestedRunNotFound(false);
    onReplaceTestBotSession(activeWorkspaceId, nextRunId);
    refreshStatus({
      workspaceId: activeWorkspaceId,
      runId: nextRunId,
    }).catch(() => {});
  }, [
    activeWorkspaceId,
    onReplaceTestBotSession,
    refreshStatus,
    selectedRunHistoryValue,
  ]);

  return (
    <PageShell>
      <PageGrid as="main" className="editor-main">
        <div
          className="flex-column gap-8"
          style={{
            height: "100%",
            overflow: "hidden",
          }}
        >
          <Panel className="test-bot-sidebar flex-column gap-8 flex-1">
            <Listbox
              label="Previous test run"
              value={selectedRunHistoryValue}
              onChange={handleRunHistorySelection}
              disabled={run.status === "running" || chatSending ||
                runHistoryOptions.length === 0}
              options={runHistoryOptions.map((entry) => ({
                value: entry.runId,
                label: getScenarioTitle(entry, {
                  labelById: scenarioLabelById,
                  labelByPath: scenarioLabelByPath,
                }),
                meta: [
                  entry.updatedAt
                    ? formatTimestampShort(entry.updatedAt)
                    : null,
                  entry.runId,
                ].filter(Boolean).join(" · "),
              }))}
              placeholder={runHistoryOptions.length > 0
                ? "Select previous run"
                : "No previous runs"}
            />
            <div className="flex-row gap-8 items-center">
              <div className="flex-1">
                <strong>Scenario deck</strong>
              </div>
              <Button
                variant="primary"
                onClick={startRun}
                disabled={!canStart}
                data-testid="testbot-run"
              >
                Run scenario
              </Button>
            </div>
            {testDecks.length > 0 && (
              <Listbox
                value={selectedDeckId ?? ""}
                onChange={handleDeckSelection}
                options={testDecks.map((deck) => ({
                  value: deck.id,
                  label: deck.label,
                  meta: botFilename(deck.path),
                }))}
              />
            )}
            {testDecks.length === 0 && (
              <div className="placeholder">
                No scenarios found in the workspace root deck. Add{" "}
                <code>[[scenarios]]</code> to <code>PROMPT.md</code>{" "}
                (prefer the Build tab) to enable Test runs.
              </div>
            )}
            {botDescription && (
              <div className="placeholder">{botDescription}</div>
            )}
            <strong>Scenario deck input</strong>
            <div style={{ flex: 1 }}>
              {botInputSchemaError && (
                <div className="error">{botInputSchemaError}</div>
              )}
              {botInputSchema && (
                <div className="init-field">
                  <label>
                    <span>Scenario JSON</span>
                  </label>
                  <textarea
                    className="json-input"
                    data-testid="testbot-scenario-json-input"
                    value={botInputJsonText}
                    placeholder="Paste full scenario JSON payload"
                    onChange={(e) => {
                      const text = e.target.value;
                      setBotInputJsonText(text);
                      setBotInputDirty(true);
                      const { parsed, error } = parseRootJsonInput(text);
                      setBotInputJsonError(error);
                      if (!error) setBotInputValue(parsed);
                    }}
                    style={{ minHeight: 160 }}
                  />
                  {botInputJsonError && (
                    <div className="error">{botInputJsonError}</div>
                  )}
                  {!botInputJsonError && (
                    <div className="secondary-note">
                      Paste a complete JSON payload matching the schema.
                    </div>
                  )}
                </div>
              )}
              {!botInputSchema && (
                <div className="placeholder">
                  No scenario input schema configured.
                </div>
              )}
            </div>
          </Panel>

          <Panel className="flex-column gap-10 flex-1">
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <strong>Assistant deck</strong>
            </div>
            <Tabs
              className="panel-tabs"
              style={{ marginTop: 6 }}
              size="small"
              tabClassName="flex-1"
              activeId={assistantDeckTab}
              onChange={(next) =>
                setAssistantDeckTab(next as typeof assistantDeckTab)}
              tabs={[
                { id: "input", label: "Input" },
                { id: "tools", label: "Tools" },
                { id: "schema", label: "Schema" },
              ]}
            />
            {assistantDeckTab === "input" && (
              <>
                {deckSchema.loading && (
                  <div className="editor-status">Loading schema…</div>
                )}
                {deckSchemaError && (
                  <div className="error">{deckSchemaError}</div>
                )}
                {deckInputSchema && (
                  <>
                    <div className="init-field">
                      <label>
                        <span>Init JSON</span>
                      </label>
                      <textarea
                        className="json-input"
                        data-testid="testbot-assistant-init-json-input"
                        value={deckInitJsonText}
                        placeholder="Paste full assistant init JSON payload"
                        onChange={(e) => {
                          const text = e.target.value;
                          setDeckInitJsonText(text);
                          setDeckInitDirty(true);
                          const { parsed, error } = parseRootJsonInput(text);
                          setDeckInitJsonError(error);
                          if (!error) setDeckInitValue(parsed);
                        }}
                        style={{ minHeight: 160 }}
                      />
                      {deckInitJsonError && (
                        <div className="error">{deckInitJsonError}</div>
                      )}
                      {!deckInitJsonError && (
                        <div className="secondary-note">
                          Paste a complete JSON payload matching the schema.
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDeckInitDirty(false);
                          const nextInit = deckSchemaDefaults !== undefined
                            ? cloneValue(deckSchemaDefaults)
                            : deriveInitialFromSchema(deckInputSchema);
                          setDeckInitValue(nextInit);
                          setDeckInitJsonText(formatJson(nextInit));
                          setDeckInitJsonError(null);
                        }}
                      >
                        Reset init
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => deckSchema.refresh()}
                      >
                        Refresh schema
                      </Button>
                    </div>
                  </>
                )}
                {!deckInputSchema && !deckSchema.loading && (
                  <div className="placeholder">
                    No input schema found for this deck.
                  </div>
                )}
              </>
            )}
            {assistantDeckTab === "tools" && (
              <>
                {deckSchema.loading && (
                  <div className="editor-status">Loading tools…</div>
                )}
                {deckSchemaError && (
                  <div className="error">{deckSchemaError}</div>
                )}
                {!deckSchema.loading && !deckSchemaError &&
                  deckTools.length === 0 && (
                  <div className="placeholder">
                    No tools declared for this deck.
                  </div>
                )}
                {deckTools.length > 0 && (
                  <List>
                    {deckTools.map((tool) => (
                      <ListItem
                        key={tool.name}
                        title={tool.label}
                        meta={tool.fileName
                          ? <code>{tool.fileName}</code>
                          : null}
                        description={tool.description}
                      />
                    ))}
                  </List>
                )}
              </>
            )}
            {assistantDeckTab === "schema" && (
              <div className="flex-column gap-6 flex-1">
                {deckSchema.loading && (
                  <div className="editor-status">Loading schema…</div>
                )}
                {deckSchemaError && (
                  <div className="error">{deckSchemaError}</div>
                )}
                {!deckSchema.loading && !deckSchemaError && (
                  deckSchema.schemaResponse
                    ? (
                      <List className="flex-1">
                        <ListItem
                          title="Deck metadata"
                          description={
                            <>
                              <div className="flex-row gap-4">
                                <span>
                                  <strong>Path</strong>:
                                </span>
                                <ScrollingText
                                  as="div"
                                  text={deckSchema.schemaResponse?.deck ??
                                    "unknown"}
                                />
                              </div>
                              <div>
                                <strong>Start mode</strong>:{" "}
                                {deckSchema.schemaResponse?.startMode ??
                                  "assistant"}
                              </div>
                              {deckSchema.schemaResponse?.modelParams &&
                                (
                                  <div className="flex-column gap-4">
                                    <strong>Model params</strong>
                                    <pre className="trace-json">
                                      {formatJson(
                                        deckSchema.schemaResponse?.modelParams,
                                      )}
                                    </pre>
                                  </div>
                                )}
                            </>
                          }
                        />
                      </List>
                    )
                    : (
                      <div className="placeholder">
                        No schema available for this deck.
                      </div>
                    )
                )}
              </div>
            )}
          </Panel>
        </div>

        <TestBotChatPanel
          run={run}
          runWorkspaceId={runWorkspaceId}
          runStatusLabel={runStatusLabel}
          activeWorkspaceId={activeWorkspaceId}
          requestedRunNotFound={requestedRunNotFound}
          canStart={canStart}
          canRunPersona={canRunPersona}
          hasPersonaSelection={hasPersonaSelection}
          botJsonErrorCount={botJsonErrorCount}
          deckJsonErrorCount={deckJsonErrorCount}
          missingBotInput={missingBotInput}
          missingDeckInit={missingDeckInit}
          lastInitFill={lastInitFill}
          isUserStart={isUserStart}
          showStartOverlay={showStartOverlay}
          canStartAssistant={canStartAssistant}
          canSendChat={canSendChat}
          chatDraft={chatDraft}
          setChatDraft={setChatDraft}
          chatError={chatError}
          optimisticUser={optimisticUser}
          streamingUser={streamingUser}
          streamingAssistant={streamingAssistant}
          startRun={startRun}
          stopRun={stopRun}
          handleNewChat={handleNewChat}
          handleSendChat={handleSendChat}
          handleStartAssistant={handleStartAssistant}
          onScore={handleTestBotScore}
          onReasonChange={handleTestBotReason}
        />
      </PageGrid>
    </PageShell>
  );
}
