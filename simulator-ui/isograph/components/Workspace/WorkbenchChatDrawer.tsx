import { iso } from "@iso-gambit-sim";
import { useCallback, useState } from "react";
import gambitSimulatorStopRunMutation from "../../../mutations/GambitSimulatorStopRunMutation.ts";
import gambitWorkspaceBuildRunCreateMutation from "../../../mutations/GambitWorkspaceBuildRunCreateMutation.ts";
import gambitWorkspaceWorkbenchLiveSubscription from "../../../subscriptions/GambitWorkspaceWorkbenchLiveSubscription.ts";
import Button from "../../../src/gds/Button.tsx";
import Callout from "../../../src/gds/Callout.tsx";
import { useGambitTypedMutation } from "../../../src/hooks/useGambitTypedMutation.tsx";
import { useGambitTypedSubscription } from "../../../src/hooks/useGambitTypedSubscription.tsx";
import WorkbenchDrawerIso from "../../../src/WorkbenchDrawerIso.tsx";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "GraphQL request failed";
}

export const WorkbenchChatDrawer = iso(`
  field Workspace.WorkbenchChatDrawer @component {
    id
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
`)(function WorkbenchChatDrawer({ data }, componentProps: { open: boolean }) {
  const workspaceId = typeof data.id === "string" && data.id.trim().length > 0
    ? data.id
    : null;

  useGambitTypedSubscription(
    gambitWorkspaceWorkbenchLiveSubscription,
    workspaceId ? { workspaceId } : null,
  );

  const runNode = (data.buildRuns?.edges ?? []).flatMap((edge) =>
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
  const stopRunMutation = useGambitTypedMutation(
    gambitSimulatorStopRunMutation,
  );
  const [chatError, setChatError] = useState<string | null>(null);

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
  if (ConversationRunChat && workspaceId) {
    return (
      <ConversationRunChat
        open={componentProps.open}
        isSending={createRunMutation.inFlight}
        isStopping={stopRunMutation.inFlight}
        codexAccess={codexStatus}
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
                          status: "RUNNING",
                          openResponses____first___l_1: {
                            edges: [{
                              node: {
                                __typename: "OpenResponse",
                                id: args.optimisticOpenResponseId,
                                status: "RUNNING",
                                outputItems____first___l_200: {
                                  edges: [
                                    ...args.optimisticOutputEdges,
                                    {
                                      node: {
                                        __typename: "OutputMessage",
                                        asOutputMessage: {
                                          id: args.optimisticMessageId,
                                          role: "user",
                                          content: args.message,
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                            }],
                          },
                        },
                      }],
                    },
                  },
                  run: {
                    __typename: "WorkspaceBuildRun",
                    id: args.runId,
                    status: "RUNNING",
                    openResponses____first___l_1: {
                      edges: [{
                        node: {
                          __typename: "OpenResponse",
                          id: args.optimisticOpenResponseId,
                          status: "RUNNING",
                          outputItems____first___l_200: {
                            edges: [
                              ...args.optimisticOutputEdges,
                              {
                                node: {
                                  __typename: "OutputMessage",
                                  asOutputMessage: {
                                    id: args.optimisticMessageId,
                                    role: "user",
                                    content: args.message,
                                  },
                                },
                              },
                            ],
                          },
                        },
                      }],
                    },
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
                          status: "CANCELED",
                          openResponses____first___l_1: {
                            edges: [{
                              node: {
                                __typename: "OpenResponse",
                                id: args.optimisticOpenResponseId,
                                status: "CANCELED",
                                outputItems____first___l_200: {
                                  edges: args.optimisticOutputEdges,
                                },
                              },
                            }],
                          },
                        },
                      }],
                    },
                  },
                  run: {
                    __typename: "WorkspaceBuildRun",
                    id: args.runId,
                    status: "CANCELED",
                    openResponses____first___l_1: {
                      edges: [{
                        node: {
                          __typename: "OpenResponse",
                          id: args.optimisticOpenResponseId,
                          status: "CANCELED",
                          outputItems____first___l_200: {
                            edges: args.optimisticOutputEdges,
                          },
                        },
                      }],
                    },
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
      <Callout variant="emphasis">
        Start the assistant to begin editing.
      </Callout>
      <div className="composer-actions">
        <Button
          variant="primary"
          data-testid="build-start"
          disabled={!workspaceId || createRunMutation.inFlight ||
            codexLoginRequired}
          onClick={() => {
            void startAssistant();
          }}
        >
          {createRunMutation.inFlight ? "Starting..." : "Start"}
        </Button>
      </div>
      {codexLoginRequired && (
        <Callout variant="danger" title="Codex login required">
          {codexStatus?.statusText?.trim() || "Run `codex login` to continue."}
        </Callout>
      )}
      {chatError && <div className="error">{chatError}</div>}
    </div>
  );

  return (
    <WorkbenchDrawerIso
      open={componentProps.open}
      runStatus="IDLE"
      chatBody={fallbackBody}
    />
  );
});

export default WorkbenchChatDrawer;
