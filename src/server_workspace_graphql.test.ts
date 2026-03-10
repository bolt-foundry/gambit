import { assertEquals } from "@std/assert";
import { createWorkspaceDeckGraphqlOperations } from "./server_workspace_graphql.ts";
import type { WorkspaceDeckState } from "./server_types.ts";

Deno.test(
  "workspace deck GraphQL operations return empty values when deck state is unavailable",
  async () => {
    let activateCalls = 0;
    let debugEvents = 0;
    const ops = createWorkspaceDeckGraphqlOperations({
      activateWorkspaceDeck: () => {
        activateCalls += 1;
        return Promise.resolve();
      },
      readWorkspaceDeckState: () => null,
      getResolvedDeckPath: () => "/tmp/PROMPT.md",
      summarizeWorkspaceDeckState: () => ({}),
      logWorkspaceRefreshDebug: () => {
        debugEvents += 1;
      },
    });

    assertEquals(await ops.listWorkspaceScenarioDecks("workspace-1"), []);
    assertEquals(await ops.listWorkspaceGraderDecks("workspace-1"), []);
    assertEquals(await ops.readWorkspaceAssistantDeck("workspace-1"), {});
    assertEquals(activateCalls, 3);
    assertEquals(debugEvents > 0, true);
  },
);

Deno.test(
  "workspace deck GraphQL operations return deck metadata when state exists",
  async () => {
    const deckState = {
      workspaceId: "workspace-2",
      rootDeckPath: "/tmp/PROMPT.md",
      updatedAt: new Date().toISOString(),
      assistantDeck: {
        deck: "/tmp/PROMPT.md",
        startMode: "assistant",
        inputSchema: null,
        defaults: null,
      },
      scenarioDecks: [{
        id: "scenario-default",
        label: "Default",
        description: "default scenario",
        path: "/tmp/scenarios/default/PROMPT.md",
        maxTurns: 4,
        inputSchema: null,
        defaults: null,
      }],
      graderDecks: [{
        id: "grader-default",
        label: "Default grader",
        description: "default grader",
        path: "/tmp/graders/default/PROMPT.md",
      }],
    } satisfies WorkspaceDeckState;

    const ops = createWorkspaceDeckGraphqlOperations({
      activateWorkspaceDeck: async () => {},
      readWorkspaceDeckState: () => deckState,
      getResolvedDeckPath: () => deckState.rootDeckPath,
      summarizeWorkspaceDeckState: () => ({}),
      logWorkspaceRefreshDebug: () => {},
    });

    assertEquals(await ops.listWorkspaceScenarioDecks("workspace-2"), [{
      id: "scenario-default",
      label: "Default",
      description: "default scenario",
      path: "/tmp/scenarios/default/PROMPT.md",
      maxTurns: 4,
      inputSchema: null,
      defaults: null,
      inputSchemaError: undefined,
    }]);
    assertEquals(await ops.listWorkspaceGraderDecks("workspace-2"), [{
      id: "grader-default",
      label: "Default grader",
      description: "default grader",
      path: "/tmp/graders/default/PROMPT.md",
    }]);
    assertEquals(await ops.readWorkspaceAssistantDeck("workspace-2"), {
      deck: "/tmp/PROMPT.md",
      startMode: "assistant",
      inputSchema: null,
      defaults: null,
    });
  },
);
