import { iso } from "@iso-gambit-sim";
import { useCallback, useEffect, useMemo, useState } from "react";
import gambitSimulatorResetWorkspaceMutation from "../../../mutations/GambitSimulatorResetWorkspaceMutation.ts";
import gambitSimulatorStopRunMutation from "../../../mutations/GambitSimulatorStopRunMutation.ts";
import gambitWorkspaceBuildRunCreateMutation from "../../../mutations/GambitWorkspaceBuildRunCreateMutation.ts";
import gambitWorkspaceWorkbenchLiveSubscription from "../../../subscriptions/GambitWorkspaceWorkbenchLiveSubscription.ts";
import Callout from "../../../src/gds/Callout.tsx";
import Listbox, { type ListboxOption } from "../../../src/gds/Listbox.tsx";
import List from "../../../src/gds/List.tsx";
import ListItem from "../../../src/gds/ListItem.tsx";
import WorkbenchChatIntro from "../../../src/WorkbenchChatIntro.tsx";
import { useGambitTypedMutation } from "../../../src/hooks/useGambitTypedMutation.tsx";
import { useGambitTypedSubscription } from "../../../src/hooks/useGambitTypedSubscription.tsx";
import WorkbenchDrawerIso from "../../../src/WorkbenchDrawerIso.tsx";
import {
  type BuildChatProvider,
  formatTimestampShort,
  workbenchChatTopActionsEnabled,
} from "../../../src/utils.ts";
import {
  replaceWorkbenchSelectedContextChips,
  resolveWorkbenchSelectedContextChips,
} from "../../../src/workbenchChipStore.ts";
import {
  type WorkbenchSelectedContextChip,
} from "../../../src/workbenchContext.ts";
import {
  buildWorkspacePath,
  WORKSPACES_API_BASE,
} from "../../../../src/workspace_contract.ts";

const BUILD_CHAT_PROVIDER_STORAGE_KEY = "gambit:build-chat-provider";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "GraphQL request failed";
}

function normalizeBuildChatProvider(
  value: unknown,
): BuildChatProvider | null {
  if (value === "claude-code-cli") return "claude-code-cli";
  if (value === "codex-cli") return "codex-cli";
  return null;
}

function readStoredBuildChatProvider(): BuildChatProvider {
  if (typeof globalThis === "undefined") return "codex-cli";
  try {
    return normalizeBuildChatProvider(
      globalThis.localStorage.getItem(BUILD_CHAT_PROVIDER_STORAGE_KEY),
    ) ?? "codex-cli";
  } catch {
    return "codex-cli";
  }
}

function storeBuildChatProvider(provider: BuildChatProvider) {
  if (typeof globalThis === "undefined") return;
  try {
    globalThis.localStorage.setItem(BUILD_CHAT_PROVIDER_STORAGE_KEY, provider);
  } catch {
    // ignore storage failures
  }
}

export const WorkbenchChatDrawer = iso(`
  field Workspace.WorkbenchChatDrawer @component {
    id
    workbenchSelectedContextChips @updatable
    models {
      codex {
        model
        workspaceId
        available
        requiresLogin
        loggedIn
        statusText
        trustedPath
        writeEnabled
      }
    }
    buildRuns(first: 1) {
      edges {
        node {
          id
          WorkbenchConversationRunChat
        }
      }
    }
  }
`)(
  function WorkbenchChatDrawer(
    { data, startUpdate },
    componentProps: { open: boolean },
  ) {
    const workspaceId = typeof data.id === "string" && data.id.trim().length > 0
      ? data.id
      : null;
    const composerChips = useMemo(
      () =>
        resolveWorkbenchSelectedContextChips(
          workspaceId,
          data.workbenchSelectedContextChips,
        ),
      [data.workbenchSelectedContextChips, workspaceId],
    );
    const updateComposerChips = useCallback(
      (next: Array<WorkbenchSelectedContextChip>) => {
        replaceWorkbenchSelectedContextChips(startUpdate, next, workspaceId);
      },
      [startUpdate, workspaceId],
    );

    useGambitTypedSubscription(
      gambitWorkspaceWorkbenchLiveSubscription,
      workspaceId ? { workspaceId } : null,
    );

    const runNode =
      (data.buildRuns?.edges ?? []).flatMap((edge) =>
        edge?.node ? [edge.node] : []
      )[0] ?? null;
    const codexStatus = data.models?.codex
      ? {
        model: data.models.codex.model ?? "codex",
        workspaceId: data.models.codex.workspaceId ?? workspaceId ?? "",
        available: data.models.codex.available === true,
        requiresLogin: data.models.codex.requiresLogin === true,
        loggedIn: data.models.codex.loggedIn === true,
        statusText: data.models.codex.statusText ?? "",
        trustedPath: data.models.codex.trustedPath ?? null,
        writeEnabled: data.models.codex.writeEnabled === true,
      }
      : null;
    const codexLoginRequired = codexStatus
      ? (codexStatus.requiresLogin || !codexStatus.loggedIn)
      : false;
    const createRunMutation = useGambitTypedMutation(
      gambitWorkspaceBuildRunCreateMutation,
    );
    const resetWorkspaceMutation = useGambitTypedMutation(
      gambitSimulatorResetWorkspaceMutation,
    );
    const stopRunMutation = useGambitTypedMutation(
      gambitSimulatorStopRunMutation,
    );
    const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
    const [chatHistory, setChatHistory] = useState<
      Array<{
        id: string;
        updatedAt?: string;
        startedAt?: string;
      }>
    >([]);
    const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
    const [chatHistoryError, setChatHistoryError] = useState<string | null>(
      null,
    );
    const [buildChatProvider, setBuildChatProvider] = useState<
      BuildChatProvider
    >(
      () => readStoredBuildChatProvider(),
    );
    const [chatError, setChatError] = useState<string | null>(null);
    const buildProviderOptions = useMemo<Array<ListboxOption>>(
      () => [
        { value: "codex-cli", label: "Codex" },
        { value: "claude-code-cli", label: "Claude Code" },
      ],
      [],
    );
    const providerSelector = (
      <label className="workbench-provider-select-label">
        <div
          className="workbench-provider-select"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Listbox
            value={buildChatProvider}
            onChange={(value) =>
              onBuildChatProviderChange(value as BuildChatProvider)}
            options={buildProviderOptions}
            disabled={createRunMutation.inFlight || stopRunMutation.inFlight ||
              resetWorkspaceMutation.inFlight}
            size="small"
            popoverMatchTriggerWidth={false}
            popoverMinWidth={200}
            popoverAlign="right"
          />
        </div>
      </label>
    );

    const loadChatHistory = useCallback(async () => {
      setChatHistoryLoading(true);
      setChatHistoryError(null);
      try {
        const res = await fetch(WORKSPACES_API_BASE);
        if (!res.ok) throw new Error(res.statusText);
        const payload = await res.json() as {
          workspaces?: Array<{ id?: string; createdAt?: string }>;
        };
        const runs = Array.isArray(payload.workspaces)
          ? payload.workspaces.filter((entry) => typeof entry?.id === "string")
            .map((entry) => ({
              id: entry.id as string,
              updatedAt: entry.createdAt,
              startedAt: entry.createdAt,
            }))
          : [];
        setChatHistory(runs);
      } catch (error) {
        setChatHistoryError(toErrorMessage(error));
      } finally {
        setChatHistoryLoading(false);
      }
    }, []);

    useEffect(() => {
      if (!componentProps.open) return;
      void loadChatHistory();
    }, [componentProps.open, loadChatHistory]);

    const onBuildChatProviderChange = useCallback(
      (provider: BuildChatProvider) => {
        storeBuildChatProvider(provider);
        setBuildChatProvider(provider);
        if (!workspaceId) return;
        void fetch("/api/build/provider", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            buildChatProvider: provider,
          }),
        });
      },
      [workspaceId],
    );

    const resetWorkspace = useCallback(async () => {
      if (!workspaceId || resetWorkspaceMutation.inFlight) {
        return;
      }
      setChatError(null);
      try {
        await new Promise<void>((resolve, reject) => {
          resetWorkspaceMutation.commit(
            {
              input: {
                workspaceId,
              },
            },
            {
              onComplete: () => {
                setChatError(null);
                setChatHistoryOpen(false);
                resolve();
              },
              onError: () => {
                reject(new Error("GraphQL request failed"));
              },
            },
          );
        });
        await loadChatHistory();
      } catch (error) {
        setChatError(toErrorMessage(error));
      }
    }, [loadChatHistory, resetWorkspaceMutation, workspaceId]);

    const startAssistant = useCallback(async () => {
      if (!workspaceId || createRunMutation.inFlight) {
        return;
      }
      setChatError(null);
      try {
        await new Promise<void>((resolve, reject) => {
          createRunMutation.commit(
            {
              input: {
                workspaceId,
                inputItems: [{ role: "user", content: "" }],
              },
            },
            {
              onComplete: () => {
                setChatError(null);
                resolve();
              },
              onError: () => {
                reject(new Error("GraphQL request failed"));
              },
            },
          );
        });
      } catch (error) {
        setChatError(toErrorMessage(error));
      }
    }, [createRunMutation, workspaceId]);

    const ConversationRunChat = runNode?.WorkbenchConversationRunChat ?? null;
    const headerActions = (
      <>
        {providerSelector}
      </>
    );
    const historyContent = (
      <>
        {chatHistoryLoading && (
          <Callout>
            Loading chat history…
          </Callout>
        )}
        {chatHistoryError && <div className="error">{chatHistoryError}</div>}
        {!chatHistoryLoading && !chatHistoryError && chatHistory.length === 0 &&
          (
            <Callout>
              No previous chats yet.
            </Callout>
          )}
        {!chatHistoryLoading && !chatHistoryError && chatHistory.length > 0 && (
          <List className="workbench-chat-history-list">
            {chatHistory.map((entry) => {
              const timestamp = entry.updatedAt ?? entry.startedAt;
              const label = timestamp
                ? formatTimestampShort(timestamp)
                : "Unknown date";
              return (
                <button
                  key={entry.id}
                  type="button"
                  className="workbench-chat-history-row gds-list-item-button"
                  onClick={() => {
                    setChatHistoryOpen(false);
                    globalThis.location.assign(
                      buildWorkspacePath("build", entry.id),
                    );
                  }}
                >
                  <ListItem title={`Chat - ${label}`} />
                </button>
              );
            })}
          </List>
        )}
      </>
    );

    if (ConversationRunChat && workspaceId) {
      return (
        <ConversationRunChat
          open={componentProps.open}
          composerChips={composerChips}
          onComposerChipsChange={updateComposerChips}
          isSending={createRunMutation.inFlight ||
            resetWorkspaceMutation.inFlight}
          isStopping={stopRunMutation.inFlight}
          codexAccess={codexStatus}
          canStartNewChat={!resetWorkspaceMutation.inFlight}
          onNewChat={() => {
            void resetWorkspace();
          }}
          chatHeaderActions={headerActions}
          chatHistoryOpen={chatHistoryOpen}
          onToggleChatHistory={() =>
            setChatHistoryOpen((previous) => !previous)}
          chatHistoryContent={historyContent}
          onSend={(args) => {
            createRunMutation.commit(
              {
                input: {
                  workspaceId: args.workspaceId,
                  inputItems: [{
                    role: "user",
                    content: args.message,
                  }],
                },
              },
              {
                optimisticNetworkResponse: {
                  workspaceBuildRunCreate____input___v_input: {
                    workspace: {
                      id: args.workspaceId,
                      buildRuns____first___l_1: {
                        edges: [{
                          node: {
                            __typename: "WorkspaceBuildRun",
                            id: args.runId,
                            workspaceId: args.workspaceId,
                            error: null,
                            startedAt: null,
                            openResponses____first___l_1: {
                              edges: [{
                                node: {
                                  __typename: "OpenResponse",
                                  id: args.optimisticOpenResponseId,
                                  status: "RUNNING",
                                },
                              }],
                            },
                            status: "RUNNING",
                            transcriptEntries: [
                              ...args.optimisticTranscriptEntries,
                              {
                                __typename:
                                  "WorkspaceConversationTranscriptMessage",
                                id: args.optimisticMessageId,
                                role: "user",
                                content: args.message,
                                messageRefId: null,
                                feedbackEligible: false,
                                feedback: null,
                              },
                            ],
                          },
                        }],
                      },
                    },
                    run: {
                      __typename: "WorkspaceBuildRun",
                      id: args.runId,
                      workspaceId: args.workspaceId,
                      error: null,
                      startedAt: null,
                      openResponses____first___l_1: {
                        edges: [{
                          node: {
                            __typename: "OpenResponse",
                            id: args.optimisticOpenResponseId,
                            status: "RUNNING",
                          },
                        }],
                      },
                      status: "RUNNING",
                      transcriptEntries: [
                        ...args.optimisticTranscriptEntries,
                        {
                          __typename: "WorkspaceConversationTranscriptMessage",
                          id: args.optimisticMessageId,
                          role: "user",
                          content: args.message,
                          messageRefId: null,
                          feedbackEligible: false,
                          feedback: null,
                        },
                      ],
                    },
                  },
                } as never,
                onComplete: args.onComplete,
                onError: args.onError,
              },
            );
          }}
          onStop={(args) => {
            stopRunMutation.commit(
              {
                input: {
                  workspaceId: args.workspaceId,
                  runId: args.runId,
                },
              },
              {
                optimisticNetworkResponse: {
                  simulatorStopRun____input___v_input: {
                    workspace: {
                      id: args.workspaceId,
                      buildRuns____first___l_1: {
                        edges: [{
                          node: {
                            __typename: "WorkspaceBuildRun",
                            id: args.runId,
                            workspaceId: args.workspaceId,
                            error: null,
                            startedAt: null,
                            openResponses____first___l_1: {
                              edges: [{
                                node: {
                                  __typename: "OpenResponse",
                                  id: args.optimisticOpenResponseId,
                                  status: "CANCELED",
                                },
                              }],
                            },
                            status: "CANCELED",
                            transcriptEntries: args.optimisticTranscriptEntries,
                          },
                        }],
                      },
                    },
                    run: {
                      __typename: "WorkspaceBuildRun",
                      id: args.runId,
                      workspaceId: args.workspaceId,
                      error: null,
                      startedAt: null,
                      openResponses____first___l_1: {
                        edges: [{
                          node: {
                            __typename: "OpenResponse",
                            id: args.optimisticOpenResponseId,
                            status: "CANCELED",
                          },
                        }],
                      },
                      status: "CANCELED",
                      transcriptEntries: args.optimisticTranscriptEntries,
                    },
                  },
                } as never,
                onComplete: args.onComplete,
                onError: args.onError,
              },
            );
          }}
        />
      );
    }

    const fallbackBody = (
      <div className="test-bot-sidebar flex-column gap-8 flex-1 build-chat-panel">
        <WorkbenchChatIntro
          disabled={!workspaceId || createRunMutation.inFlight ||
            codexLoginRequired}
          leadingContent={providerSelector}
          pending={createRunMutation.inFlight}
          title="Start a workspace editing session"
          onStart={() => {
            void startAssistant();
          }}
        />
        <Callout>
          Start a chat session to inspect the workspace and begin editing files.
        </Callout>
        {codexLoginRequired && (
          <Callout variant="danger" title="Codex login required">
            {codexStatus?.statusText?.trim() ||
              "Run `codex login` to continue."}
          </Callout>
        )}
        {chatError && <div className="error">{chatError}</div>}
      </div>
    );

    return (
      <WorkbenchDrawerIso
        open={componentProps.open}
        runStatus="IDLE"
        chatHeaderActions={headerActions}
        showChatHistoryToggle={workbenchChatTopActionsEnabled}
        chatHistoryOpen={workbenchChatTopActionsEnabled
          ? chatHistoryOpen
          : false}
        onToggleChatHistory={() => setChatHistoryOpen((previous) => !previous)}
        chatHistoryContent={historyContent}
        chatBody={fallbackBody}
      />
    );
  },
);

export default WorkbenchChatDrawer;
