import { iso } from "@iso-gambit-sim";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildWorkspacePath,
  parseWorkspaceRoute,
} from "../../../../src/workspace_routes.ts";
import gambitWorkspaceScenarioRunSendMutation from "../../../mutations/GambitWorkspaceScenarioRunSendMutation.ts";
import gambitWorkspaceScenarioRunStartMutation from "../../../mutations/GambitWorkspaceScenarioRunStartMutation.ts";
import gambitWorkspaceScenarioRunStopMutation from "../../../mutations/GambitWorkspaceScenarioRunStopMutation.ts";
import gambitWorkspaceTestLiveSubscription from "../../../subscriptions/GambitWorkspaceTestLiveSubscription.ts";
import { useGambitTypedMutation } from "../../../src/hooks/useGambitTypedMutation.tsx";
import { useGambitTypedSubscription } from "../../../src/hooks/useGambitTypedSubscription.tsx";
import { useRouter } from "../../../src/RouterContext.tsx";
import {
  deriveInitialFromSchema,
  type FeedbackEntry,
  findMissingRequiredFields,
  formatJson,
  type NormalizedSchema,
  type TestBotRun,
} from "../../../src/utils.ts";
import { buildTestBotChatDisplay } from "../../../src/testBotChatDisplay.ts";
import { buildTestRunHistoryDisplayOptions } from "../../../src/testBotSidebarDisplay.ts";
import { runAwaitsAssistantKickoff } from "../../../src/test_tab_start_gate.ts";
import TestBotSidebarPanels from "../../../src/TestBotSidebarPanels.tsx";
import Button from "../../../src/gds/Button.tsx";
import PageShell from "../../../src/gds/PageShell.tsx";
import PageGrid from "../../../src/gds/PageGrid.tsx";
import Callout from "../../../src/gds/Callout.tsx";
import TestBotChatPanel from "../../../src/TestBotChatPanel.tsx";

function toTestBotStatus(status: string): TestBotRun["status"] {
  const normalized = status.trim().toUpperCase();
  if (normalized === "RUNNING") return "running";
  if (normalized === "COMPLETED") return "completed";
  if (normalized === "ERROR" || normalized === "FAILED") return "error";
  if (normalized === "CANCELED" || normalized === "CANCELLED") {
    return "canceled";
  }
  return "idle";
}

function extractOutputItemIndex(outputMessageId: string): number | null {
  const match = outputMessageId.match(/:item:(\d+)$/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toOptimisticOutputEdges(
  messages: Array<{ role: string; content: string; messageRefId?: string }>,
): Array<{
  node: {
    __typename: "OutputMessage";
    id: string;
    role: "user" | "assistant";
    content: string;
  };
}> {
  return messages.map((message, index) => ({
    node: {
      __typename: "OutputMessage",
      id: message.messageRefId ?? `optimistic-message-existing-${index}`,
      role: message.role === "user" ? "user" : "assistant",
      content: message.content,
    },
  }));
}

type ScenarioRunSnapshot = {
  id: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  openResponseId: string | null;
  outputItemCount: number;
  messages: Array<{ role: string; content: string; messageRefId?: string }>;
};

function toOptimisticScenarioRunEdges(args: {
  runs: Array<ScenarioRunSnapshot>;
  runId: string;
  runStatus: string;
  openResponseId: string;
  outputEdges: Array<{
    node: {
      __typename: "OutputMessage";
      id: string;
      role: "user" | "assistant";
      content: string;
    };
  }>;
}): Array<{
  node: {
    __typename: "WorkspaceScenarioRun";
    id: string;
    error: string | null;
    finishedAt: string | null;
    openResponses____first___l_1: {
      edges: Array<{
        node: {
          __typename: "OpenResponse";
          id: string;
          status: string;
          outputItems____first___l_200: {
            edges: Array<{
              node: {
                __typename: "OutputMessage";
                id: string;
                role: "user" | "assistant";
                content: string;
              };
            }>;
          };
        };
      }>;
    };
    startedAt: string | null;
    status: string;
  };
}> {
  const edges = args.runs.map((run) => {
    const isActive = run.id === args.runId;
    const openResponseId = isActive
      ? args.openResponseId
      : run.openResponseId ?? `${run.id}:open-response`;
    const outputEdges = isActive
      ? args.outputEdges
      : toOptimisticOutputEdges(run.messages);
    const status = isActive ? args.runStatus : run.status;
    return {
      node: {
        __typename: "WorkspaceScenarioRun" as const,
        id: run.id,
        error: run.error ?? null,
        finishedAt: run.finishedAt ?? null,
        openResponses____first___l_1: {
          edges: [{
            node: {
              __typename: "OpenResponse" as const,
              id: openResponseId,
              status,
              outputItems____first___l_200: {
                edges: outputEdges,
              },
            },
          }],
        },
        startedAt: run.startedAt ?? null,
        status,
      },
    };
  });
  if (edges.some((edge) => edge.node.id === args.runId)) {
    return edges;
  }
  return [{
    node: {
      __typename: "WorkspaceScenarioRun" as const,
      id: args.runId,
      error: null,
      finishedAt: null,
      openResponses____first___l_1: {
        edges: [{
          node: {
            __typename: "OpenResponse" as const,
            id: args.openResponseId,
            status: args.runStatus,
            outputItems____first___l_200: {
              edges: args.outputEdges,
            },
          },
        }],
      },
      startedAt: null,
      status: args.runStatus,
    },
  }, ...edges];
}

export const SimulatorTestPage = iso(`
  field Workspace.TestTab @component {
    id
    scenarioDecks {
      id
      label
      description
      path
      maxTurns
      inputSchema
      defaults
      inputSchemaError
    }
    assistantDeck {
      deck
      startMode
      modelParams
      inputSchema
      defaults
      tools
      inputSchemaError
    }
    scenarioRuns(first: 25) {
      edges {
        node {
          id
          status
          startedAt
          finishedAt
          error
          openResponses(first: 1) {
            edges {
              node {
                id
                status
                outputItems(first: 200) {
                  edges {
                    node {
                      __typename
                      asOutputMessage {
                        id
                        role
                        content
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`)(function SimulatorTestPage({ data }) {
  const parseJsonField = useCallback((value: unknown): unknown => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }, []);
  const parseRootJsonInput = useCallback(
    (text: string): { parsed?: unknown; error: string | null } => {
      if (text.trim() === "") return { parsed: undefined, error: null };
      try {
        return { parsed: JSON.parse(text), error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid JSON";
        return { error: `Invalid JSON: ${message}` };
      }
    },
    [],
  );
  const workspaceId = data.id ?? "";
  const { currentRoutePath, navigate } = useRouter();
  const routePrefix = useMemo(
    () =>
      currentRoutePath === "/isograph" ||
        currentRoutePath.startsWith("/isograph/")
        ? "/isograph"
        : "",
    [currentRoutePath],
  );
  const workspaceRoutePath = useMemo(() => {
    if (!routePrefix) return currentRoutePath;
    const stripped = currentRoutePath.slice(routePrefix.length);
    return stripped.length > 0 ? stripped : "/";
  }, [currentRoutePath, routePrefix]);
  const toPrefixedPath = useCallback(
    (path: string) => `${routePrefix}${path}`,
    [routePrefix],
  );
  const scenarioDecks = useMemo(
    () =>
      (data.scenarioDecks ?? []).flatMap((deck) =>
        deck?.id && deck.label && deck.path
          ? [{
            id: deck.id,
            label: deck.label,
            description: deck.description ?? null,
            path: deck.path,
            maxTurns: deck.maxTurns ?? null,
            inputSchema: parseJsonField(deck.inputSchema) as
              | NormalizedSchema
              | null,
            defaults: parseJsonField(deck.defaults),
            inputSchemaError: deck.inputSchemaError ?? null,
          }]
          : []
      ),
    [data.scenarioDecks, parseJsonField],
  );
  const assistantDeck = useMemo(() => {
    const deck = data.assistantDeck;
    if (!deck) return null;
    return {
      deck: typeof deck.deck === "string" ? deck.deck : null,
      startMode: deck.startMode === "assistant" || deck.startMode === "user"
        ? deck.startMode
        : "assistant",
      modelParams: parseJsonField(deck.modelParams) ?? null,
      inputSchema: parseJsonField(deck.inputSchema) as NormalizedSchema | null,
      defaults: parseJsonField(deck.defaults),
      tools: Array.isArray(parseJsonField(deck.tools))
        ? parseJsonField(deck.tools) as Array<{
          name?: string;
          label?: string;
          description?: string;
          path?: string;
        }>
        : [],
      inputSchemaError: typeof deck.inputSchemaError === "string"
        ? deck.inputSchemaError
        : null,
    };
  }, [data.assistantDeck, parseJsonField]);
  const [selectedScenarioDeckId, setSelectedScenarioDeckId] = useState<
    string | null
  >(null);
  const [scenarioJsonByDeckId, setScenarioJsonByDeckId] = useState<
    Record<string, string>
  >({});
  const [assistantInitJsonOverride, setAssistantInitJsonOverride] = useState<
    string | null
  >(null);
  const [assistantDeckTab, setAssistantDeckTab] = useState("input");
  const [chatDraft, setChatDraft] = useState("");
  const scenarioDeckStorageKey = useMemo(
    () =>
      workspaceId.trim().length > 0
        ? `gambit:test:selected-deck:${workspaceId}`
        : null,
    [workspaceId],
  );
  const persistedScenarioDeckId = useMemo(() => {
    if (!scenarioDeckStorageKey) return null;
    try {
      return globalThis.localStorage?.getItem(scenarioDeckStorageKey) ?? null;
    } catch {
      return null;
    }
  }, [scenarioDeckStorageKey]);
  const selectedScenarioDeck = useMemo(() => {
    if (scenarioDecks.length === 0) return null;
    if (selectedScenarioDeckId) {
      const selectedDeck = scenarioDecks.find((deck) =>
        deck.id === selectedScenarioDeckId
      );
      if (selectedDeck) return selectedDeck;
    }
    if (persistedScenarioDeckId) {
      const persistedDeck = scenarioDecks.find((deck) =>
        deck.id === persistedScenarioDeckId
      );
      if (persistedDeck) return persistedDeck;
    }
    return scenarioDecks[0] ??
      null;
  }, [persistedScenarioDeckId, scenarioDecks, selectedScenarioDeckId]);
  const handleScenarioDeckChange = useCallback((deckId: string) => {
    setSelectedScenarioDeckId(deckId);
    if (!scenarioDeckStorageKey) return;
    try {
      globalThis.localStorage?.setItem(scenarioDeckStorageKey, deckId);
    } catch {
      // localStorage can be unavailable in restricted contexts.
    }
  }, [scenarioDeckStorageKey]);
  const scenarioJsonText = useMemo(() => {
    if (!selectedScenarioDeck) return "";
    const edited = scenarioJsonByDeckId[selectedScenarioDeck.id];
    if (typeof edited === "string") return edited;
    const defaults = selectedScenarioDeck.defaults ??
      deriveInitialFromSchema(selectedScenarioDeck.inputSchema ?? undefined);
    return formatJson(defaults);
  }, [scenarioJsonByDeckId, selectedScenarioDeck]);
  const parsedScenarioJson = useMemo(
    () => parseRootJsonInput(scenarioJsonText),
    [parseRootJsonInput, scenarioJsonText],
  );
  const missingScenarioFields = useMemo(
    () =>
      findMissingRequiredFields(
        selectedScenarioDeck?.inputSchema ?? undefined,
        parsedScenarioJson.parsed,
      ),
    [parsedScenarioJson.parsed, selectedScenarioDeck?.inputSchema],
  );
  const assistantInitDefault = useMemo(
    () =>
      assistantDeck?.defaults ??
        deriveInitialFromSchema(assistantDeck?.inputSchema ?? undefined),
    [assistantDeck?.defaults, assistantDeck?.inputSchema],
  );
  const assistantInitJsonText = useMemo(
    () => assistantInitJsonOverride ?? formatJson(assistantInitDefault),
    [assistantInitDefault, assistantInitJsonOverride],
  );
  const parsedAssistantInitJson = useMemo(
    () => parseRootJsonInput(assistantInitJsonText),
    [assistantInitJsonText, parseRootJsonInput],
  );
  const missingAssistantInitFields = useMemo(
    () =>
      findMissingRequiredFields(
        assistantDeck?.inputSchema ?? undefined,
        parsedAssistantInitJson.parsed,
      ),
    [assistantDeck?.inputSchema, parsedAssistantInitJson.parsed],
  );
  const scenarioRuns = useMemo(
    () =>
      (data.scenarioRuns?.edges ?? []).flatMap((edge) => {
        const node = edge?.node;
        if (!node?.id || !node.status) return [];
        const firstOpenResponse = (node.openResponses?.edges ?? []).flatMap((
          openResponseEdge,
        ) => openResponseEdge?.node ? [openResponseEdge.node] : [])[0] ?? null;
        const outputItemCount = (firstOpenResponse?.outputItems?.edges ?? [])
          .flatMap((outputEdge) => outputEdge?.node ? [outputEdge.node] : [])
          .length;
        const messageRows = (firstOpenResponse?.outputItems?.edges ?? [])
          .flatMap((
            outputEdge,
            edgeIndex,
          ) => {
            const outputNode = outputEdge?.node;
            const outputMessage = outputNode?.asOutputMessage;
            if (!outputMessage?.id || !outputMessage.role) return [];
            const role = outputMessage.role === "user" ? "user" : "assistant";
            return [{
              role,
              content: outputMessage.content ?? "",
              messageRefId: outputMessage.id,
              outputIndex: extractOutputItemIndex(outputMessage.id),
              edgeIndex,
            }];
          });
        messageRows.sort((a, b) => {
          if (a.outputIndex !== null && b.outputIndex !== null) {
            if (a.outputIndex !== b.outputIndex) {
              return a.outputIndex - b.outputIndex;
            }
            return a.edgeIndex - b.edgeIndex;
          }
          if (a.outputIndex !== null) return -1;
          if (b.outputIndex !== null) return 1;
          return a.edgeIndex - b.edgeIndex;
        });
        const messages = messageRows.map((row) => ({
          role: row.role,
          content: row.content,
          messageRefId: row.messageRefId,
        }));
        return [{
          id: node.id,
          status: node.status,
          startedAt: node.startedAt ?? null,
          finishedAt: node.finishedAt ?? null,
          error: node.error ?? null,
          openResponseId: firstOpenResponse?.id ?? null,
          outputItemCount,
          messages,
        }];
      }),
    [data.scenarioRuns?.edges],
  );
  const route = parseWorkspaceRoute(workspaceRoutePath);
  const selectedRunId = route?.tab === "test" ? route.testRunId ?? null : null;
  const latestRunId = scenarioRuns[0]?.id ?? null;
  const selectedRun = selectedRunId
    ? scenarioRuns.find((run) => run.id === selectedRunId) ?? null
    : null;
  const hasMissingSelectedRun = selectedRunId !== null && selectedRun === null;
  const runHistoryOptions = useMemo(
    () => buildTestRunHistoryDisplayOptions(scenarioRuns),
    [scenarioRuns],
  );
  const selectedRunHistoryValue = selectedRunId ?? latestRunId ?? "";
  const startScenarioRun = useGambitTypedMutation(
    gambitWorkspaceScenarioRunStartMutation,
  );
  const sendScenarioRun = useGambitTypedMutation(
    gambitWorkspaceScenarioRunSendMutation,
  );
  const stopScenarioRun = useGambitTypedMutation(
    gambitWorkspaceScenarioRunStopMutation,
  );
  const canStartScenarioRun = useMemo(() => {
    if (!workspaceId || !selectedScenarioDeck) return false;
    if (startScenarioRun.inFlight) return false;
    if (selectedScenarioDeck.inputSchemaError) return false;
    if (assistantDeck?.inputSchemaError) return false;
    if (parsedScenarioJson.error) return false;
    if (missingScenarioFields.length > 0) return false;
    if (parsedAssistantInitJson.error) return false;
    if (missingAssistantInitFields.length > 0) return false;
    return true;
  }, [
    assistantDeck?.inputSchemaError,
    missingAssistantInitFields.length,
    missingScenarioFields.length,
    parsedAssistantInitJson.error,
    parsedScenarioJson.error,
    selectedScenarioDeck,
    startScenarioRun.inFlight,
    workspaceId,
  ]);
  const canStartAssistantRun = useMemo(() => {
    if (!workspaceId) return false;
    if (startScenarioRun.inFlight) return false;
    if (sendScenarioRun.inFlight) return false;
    if (assistantDeck?.inputSchemaError) return false;
    if (parsedAssistantInitJson.error) return false;
    if (missingAssistantInitFields.length > 0) return false;
    return true;
  }, [
    assistantDeck?.inputSchemaError,
    missingAssistantInitFields.length,
    parsedAssistantInitJson.error,
    sendScenarioRun.inFlight,
    startScenarioRun.inFlight,
    workspaceId,
  ]);
  useGambitTypedSubscription(
    gambitWorkspaceTestLiveSubscription,
    workspaceId ? { workspaceId } : null,
  );
  const startNewScenarioRun = useCallback(() => {
    if (!workspaceId || !selectedScenarioDeck || !canStartScenarioRun) return;
    startScenarioRun.commit(
      {
        input: {
          workspaceId,
          scenarioDeckId: selectedScenarioDeck.id,
          scenarioInput: scenarioJsonText.trim().length > 0
            ? scenarioJsonText
            : null,
          assistantInit: assistantInitJsonText.trim().length > 0
            ? assistantInitJsonText
            : null,
        },
      },
      {
        onComplete: (result) => {
          const runId = result?.run?.id;
          if (!runId) return;
          navigate(
            toPrefixedPath(buildWorkspacePath("test", workspaceId, { runId })),
          );
        },
      },
    );
  }, [
    canStartScenarioRun,
    navigate,
    assistantInitJsonText,
    scenarioJsonText,
    selectedScenarioDeck,
    startScenarioRun,
    toPrefixedPath,
    workspaceId,
  ]);
  const startAssistantChatRun = useCallback(async (): Promise<
    {
      runId: string;
      status: string | null;
    } | null
  > => {
    if (!workspaceId || !canStartAssistantRun) return null;
    const started = await new Promise<
      {
        runId: string;
        status: string | null;
      } | null
    >((resolve) => {
      startScenarioRun.commit(
        {
          input: {
            workspaceId,
            scenarioDeckId: null,
            scenarioInput: null,
            assistantInit: assistantInitJsonText.trim().length > 0
              ? assistantInitJsonText
              : null,
          },
        },
        {
          onComplete: (result) => {
            const runId = result?.run?.id;
            if (!runId) {
              resolve(null);
              return;
            }
            resolve({
              runId,
              status: typeof result?.run?.status === "string"
                ? result.run.status
                : null,
            });
          },
          onError: () => resolve(null),
        },
      );
    });
    if (!started) return null;
    navigate(toPrefixedPath(buildWorkspacePath("test", workspaceId, {
      runId: started.runId,
    })));
    return started;
  }, [
    assistantInitJsonText,
    canStartAssistantRun,
    navigate,
    startScenarioRun,
    toPrefixedPath,
    workspaceId,
  ]);
  const kickoffAssistantTurn = useCallback(async (
    runId: string,
  ): Promise<boolean> => {
    if (!workspaceId || !runId) return false;
    const baseMessages = selectedRun?.id === runId ? selectedRun.messages : [];
    const optimisticOutputEdges = toOptimisticOutputEdges(baseMessages);
    const optimisticOpenResponseId =
      selectedRun?.id === runId && selectedRun.openResponseId
        ? selectedRun.openResponseId
        : `${runId}:open-response`;
    const optimisticScenarioRunEdges = toOptimisticScenarioRunEdges({
      runs: scenarioRuns,
      runId,
      runStatus: "RUNNING",
      openResponseId: optimisticOpenResponseId,
      outputEdges: optimisticOutputEdges,
    });
    return await new Promise<boolean>((resolve) => {
      sendScenarioRun.commit(
        {
          input: {
            workspaceId,
            runId,
            inputItems: [{ role: "user", content: "" }],
          },
        },
        {
          optimisticNetworkResponse: {
            workspaceScenarioRunSend____input___v_input: {
              run: {
                __typename: "WorkspaceScenarioRun",
                id: runId,
                error: null,
                finishedAt: null,
                openResponses____first___l_1: {
                  edges: [{
                    node: {
                      __typename: "OpenResponse",
                      id: optimisticOpenResponseId,
                      status: "RUNNING",
                      outputItems____first___l_200: {
                        edges: optimisticOutputEdges,
                      },
                    },
                  }],
                },
                startedAt: selectedRun?.startedAt ?? null,
                status: "RUNNING",
                workspaceId,
              },
              workspace: {
                id: workspaceId,
                scenarioRuns____first___l_25: {
                  edges: optimisticScenarioRunEdges,
                },
              },
            },
          } as never,
          onComplete: () => resolve(true),
          onError: () => resolve(false),
        },
      );
    });
  }, [scenarioRuns, selectedRun, sendScenarioRun, workspaceId]);
  const selectedRunState = useMemo<TestBotRun>(() => {
    if (!selectedRun) {
      return {
        status: "idle",
        messages: [],
        traces: [],
        toolInserts: [],
      };
    }
    return {
      id: selectedRun.id,
      workspaceId,
      status: toTestBotStatus(selectedRun.status),
      error: selectedRun.error ?? undefined,
      startedAt: selectedRun.startedAt ?? undefined,
      finishedAt: selectedRun.finishedAt ?? undefined,
      messages: selectedRun.messages,
      traces: [],
      toolInserts: [],
    };
  }, [selectedRun, workspaceId]);
  const testChatDisplay = useMemo(
    () => buildTestBotChatDisplay(selectedRunState),
    [selectedRunState],
  );
  const runStatusLabel = selectedRunState.status === "running"
    ? "Running…"
    : selectedRunState.status === "completed"
    ? "Completed"
    : selectedRunState.status === "error"
    ? "Failed"
    : selectedRunState.status === "canceled"
    ? "Stopped"
    : "Idle";
  const selectedRunNeedsAssistantStart = runAwaitsAssistantKickoff(selectedRun);
  const showStartOverlay = Boolean(
    assistantDeck?.startMode !== "user" &&
      selectedRunNeedsAssistantStart,
  );
  const handleStopRun = useCallback(async () => {
    if (!selectedRun?.id || !workspaceId) return;
    stopScenarioRun.commit({
      input: { workspaceId, runId: selectedRun.id },
    });
  }, [selectedRun?.id, stopScenarioRun, workspaceId]);
  const handleSendChat = useCallback(async () => {
    const message = chatDraft.trim();
    if (!message || !workspaceId) return;
    let runId = selectedRun?.id ?? null;
    if (!runId) {
      const started = await startAssistantChatRun();
      if (!started) return;
      runId = started.runId;
    }
    sendScenarioRun.commit(
      {
        input: {
          workspaceId,
          runId,
          inputItems: [{ role: "user", content: message }],
        },
      },
      {
        optimisticNetworkResponse: (() => {
          const baseMessages = selectedRun?.id === runId
            ? selectedRun.messages
            : [];
          const optimisticOpenResponseId =
            selectedRun?.id === runId && selectedRun.openResponseId
              ? selectedRun.openResponseId
              : `${runId}:open-response`;
          const optimisticMessageId = `${runId}:message:${Date.now()}`;
          const optimisticOutputEdges = [
            ...toOptimisticOutputEdges(baseMessages),
            {
              node: {
                __typename: "OutputMessage" as const,
                id: optimisticMessageId,
                role: "user" as const,
                content: message,
              },
            },
          ];
          const optimisticScenarioRunEdges = toOptimisticScenarioRunEdges({
            runs: scenarioRuns,
            runId,
            runStatus: "RUNNING",
            openResponseId: optimisticOpenResponseId,
            outputEdges: optimisticOutputEdges,
          });
          return {
            workspaceScenarioRunSend____input___v_input: {
              run: {
                __typename: "WorkspaceScenarioRun",
                id: runId,
                error: null,
                finishedAt: null,
                openResponses____first___l_1: {
                  edges: [{
                    node: {
                      __typename: "OpenResponse",
                      id: optimisticOpenResponseId,
                      status: "RUNNING",
                      outputItems____first___l_200: {
                        edges: optimisticOutputEdges,
                      },
                    },
                  }],
                },
                startedAt: selectedRun?.startedAt ?? null,
                status: "RUNNING",
                workspaceId,
              },
              workspace: {
                id: workspaceId,
                scenarioRuns____first___l_25: {
                  edges: optimisticScenarioRunEdges,
                },
              },
            },
          };
        })() as never,
        onComplete: () => setChatDraft(""),
      },
    );
  }, [
    chatDraft,
    scenarioRuns,
    selectedRun?.id,
    selectedRun?.messages,
    selectedRun?.openResponseId,
    selectedRun?.startedAt,
    sendScenarioRun,
    startAssistantChatRun,
    workspaceId,
  ]);
  const handleStartAssistant = useCallback(async () => {
    if (!workspaceId) return;
    if (selectedRun?.id && selectedRunNeedsAssistantStart) {
      const kickedSelected = await kickoffAssistantTurn(selectedRun.id);
      if (kickedSelected) return;
    }
    const started = await startAssistantChatRun();
    if (!started) return;
    // Backward compatibility: older simulator backends auto-start this run.
    if (toTestBotStatus(started.status ?? "") !== "idle") return;
    await kickoffAssistantTurn(started.runId);
  }, [
    kickoffAssistantTurn,
    selectedRun?.id,
    selectedRunNeedsAssistantStart,
    startAssistantChatRun,
    workspaceId,
  ]);
  const handleRunHistorySelection = useCallback((nextRunId: string) => {
    if (!nextRunId || !workspaceId) return;
    if (nextRunId === selectedRunHistoryValue) return;
    navigate(
      toPrefixedPath(buildWorkspacePath("test", workspaceId, {
        runId: nextRunId,
      })),
    );
  }, [
    navigate,
    selectedRunHistoryValue,
    toPrefixedPath,
    workspaceId,
  ]);
  const handleNewChat = useCallback(async () => {
    if (!workspaceId) return;
    setChatDraft("");
    navigate(
      toPrefixedPath(buildWorkspacePath("test", workspaceId)),
    );
  }, [navigate, toPrefixedPath, workspaceId]);
  const canRunPersona = scenarioDecks.length > 0;
  const hasPersonaSelection = Boolean(selectedScenarioDeck);

  return (
    <PageShell>
      <PageGrid as="main" className="editor-main">
        <TestBotSidebarPanels
          selectedRunValue={selectedRunHistoryValue}
          onRunHistorySelection={handleRunHistorySelection}
          runHistoryOptions={runHistoryOptions.map((entry) => ({
            value: entry.runId,
            label: entry.label,
            meta: entry.meta,
          }))}
          runHistoryDisabled={selectedRunState.status === "running" ||
            sendScenarioRun.inFlight || runHistoryOptions.length === 0}
          runHistoryPlaceholder={runHistoryOptions.length > 0
            ? "Select previous run"
            : "No previous runs"}
          canStart={canStartScenarioRun}
          onStartRun={startNewScenarioRun}
          selectedDeckValue={selectedScenarioDeck?.id ?? null}
          onDeckSelection={handleScenarioDeckChange}
          deckOptions={scenarioDecks.map((deck) => ({
            value: deck.id,
            label: deck.label,
            meta: deck.path,
          }))}
          noScenariosCallout={
            <Callout>
              No scenarios found in the workspace root deck. Add{" "}
              <code>[[scenarios]]</code> to <code>PROMPT.md</code>{" "}
              (prefer the Build tab) to enable Test runs.
            </Callout>
          }
          botDescription={selectedScenarioDeck?.description ?? null}
          scenarioInputSchemaError={selectedScenarioDeck?.inputSchemaError ??
            null}
          hasScenarioInputSchema={Boolean(selectedScenarioDeck?.inputSchema)}
          scenarioJsonText={scenarioJsonText}
          onScenarioJsonChange={(text) => {
            if (!selectedScenarioDeck) return;
            setScenarioJsonByDeckId((previous) => ({
              ...previous,
              [selectedScenarioDeck.id]: text,
            }));
          }}
          scenarioJsonError={parsedScenarioJson.error}
          scenarioMissingFields={missingScenarioFields}
          assistantDeckTab={assistantDeckTab as "input" | "tools" | "schema"}
          onAssistantDeckTabChange={setAssistantDeckTab}
          assistantInputSchemaError={assistantDeck?.inputSchemaError ?? null}
          hasAssistantInputSchema={Boolean(assistantDeck?.inputSchema)}
          assistantInitJsonText={assistantInitJsonText}
          onAssistantInitJsonChange={(text) =>
            setAssistantInitJsonOverride(text)}
          assistantInitJsonError={parsedAssistantInitJson.error}
          assistantMissingFields={missingAssistantInitFields}
          onAssistantInitReset={() => setAssistantInitJsonOverride(null)}
          onAssistantSchemaRefresh={() => globalThis.location.reload()}
          tools={(assistantDeck?.tools ?? []).map((tool, index) => ({
            key: `${tool?.name ?? "tool"}-${index}`,
            title: tool?.label ?? tool?.name ?? "Tool",
            meta: tool?.path ?? null,
            description: tool?.description ?? null,
          }))}
          schemaPath={assistantDeck?.deck ?? null}
          schemaStartMode={assistantDeck?.startMode ?? "assistant"}
          schemaModelParamsJson={assistantDeck?.modelParams
            ? formatJson(assistantDeck.modelParams)
            : null}
        />
        <TestBotChatPanel
          run={selectedRunState}
          runWorkspaceId={workspaceId}
          runStatusLabel={runStatusLabel}
          testChatDisplay={testChatDisplay}
          activeWorkspaceId={workspaceId || null}
          requestedRunNotFound={hasMissingSelectedRun}
          canStart={canStartScenarioRun}
          canRunPersona={canRunPersona}
          hasPersonaSelection={hasPersonaSelection}
          botJsonErrorCount={parsedScenarioJson.error ? 1 : 0}
          deckJsonErrorCount={parsedAssistantInitJson.error ? 1 : 0}
          missingBotInput={missingScenarioFields}
          missingDeckInit={missingAssistantInitFields}
          lastInitFill={null}
          isUserStart={assistantDeck?.startMode === "user"}
          showStartOverlay={showStartOverlay}
          canStartAssistant={canStartAssistantRun}
          canSendChat={chatDraft.trim().length > 0 && !showStartOverlay &&
            selectedRunState.status !== "running" &&
            !sendScenarioRun.inFlight}
          chatDraft={chatDraft}
          setChatDraft={setChatDraft}
          chatError={null}
          optimisticUser={null}
          streamingUser={null}
          streamingAssistant={null}
          startRun={async () => startNewScenarioRun()}
          stopRun={handleStopRun}
          handleNewChat={handleNewChat}
          handleSendChat={handleSendChat}
          handleStartAssistant={handleStartAssistant}
          onScore={async () => {}}
          onReasonChange={async () => {}}
        />
      </PageGrid>
    </PageShell>
  );
});

export default SimulatorTestPage;
