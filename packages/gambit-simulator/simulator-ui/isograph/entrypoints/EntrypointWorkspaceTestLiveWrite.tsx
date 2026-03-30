import { iso } from "@iso-gambit-sim";

// This entrypoint exists to type/normalize external subscription writes.
// NOTE: keep this rooted on Query for now. Isograph 0.5.x currently does not
// emit full artifacts for Subscription entrypoints (missing entrypoint.ts),
// which breaks generated route imports/codegen in this repo.
export const EntrypointWorkspaceTestLiveWrite = iso(`
  field Query.EntrypointWorkspaceTestLiveWrite($workspaceId: ID!) {
    workspace(id: $workspaceId) {
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
            transcriptEntries {
              asWorkspaceConversationTranscriptMessage {
                id
                messageRefId
                feedbackEligible
                role
                content
                feedback {
                  id
                  runId
                  messageRefId
                  score
                  reason
                  createdAt
                }
              }
              asWorkspaceConversationTranscriptReasoning {
                id
                summary
                reasoningType
              }
              asWorkspaceConversationTranscriptToolCall {
                id
                toolCallId
                toolName
                status
                argumentsText
                resultText
                error
              }
            }
          }
        }
      }
    }
  }
`)(function EntrypointWorkspaceTestLiveWrite() {
  return {
    Body: null,
    title: "Gambit Simulator",
  };
});

export default EntrypointWorkspaceTestLiveWrite;
