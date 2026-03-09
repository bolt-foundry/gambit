import type { SimulatorGraphqlOperations } from "./server_isograph_environment.ts";
import type { WorkspaceDeckState } from "./server_types.ts";

type WorkspaceDeckGraphqlOperations = Pick<
  SimulatorGraphqlOperations,
  | "listWorkspaceGraderDecks"
  | "listWorkspaceScenarioDecks"
  | "readWorkspaceAssistantDeck"
>;

type WorkspaceDeckGraphqlDeps = {
  activateWorkspaceDeck: (
    workspaceId?: string | null,
    options?: {
      forceReload?: boolean;
      source?: string;
      reloadAttemptId?: string;
    },
  ) => Promise<void>;
  readWorkspaceDeckStateStrict: (workspaceId: string) => WorkspaceDeckState;
  getResolvedDeckPath: () => string;
  summarizeWorkspaceDeckState: (
    workspaceId?: string | null,
  ) => Record<string, unknown>;
  logWorkspaceRefreshDebug: (
    event: string,
    payload: Record<string, unknown>,
  ) => void;
};

export const createWorkspaceDeckGraphqlOperations = (
  deps: WorkspaceDeckGraphqlDeps,
): WorkspaceDeckGraphqlOperations => ({
  listWorkspaceGraderDecks: async (workspaceId: string) => {
    await deps.activateWorkspaceDeck(workspaceId, {
      source: "graphql:listWorkspaceGraderDecks",
    });
    const deckState = deps.readWorkspaceDeckStateStrict(workspaceId);
    return deckState.graderDecks.map((deck) => ({
      id: deck.id,
      label: deck.label,
      description: deck.description,
      path: deck.path,
    }));
  },
  listWorkspaceScenarioDecks: async (workspaceId: string) => {
    deps.logWorkspaceRefreshDebug("graphql.scenarioDecks.list.begin", {
      workspaceId,
      resolvedDeckPath: deps.getResolvedDeckPath(),
      ...deps.summarizeWorkspaceDeckState(workspaceId),
    });
    await deps.activateWorkspaceDeck(workspaceId, {
      source: "graphql:listWorkspaceScenarioDecks",
    });
    deps.logWorkspaceRefreshDebug("graphql.scenarioDecks.list.afterActivate", {
      workspaceId,
      resolvedDeckPath: deps.getResolvedDeckPath(),
      ...deps.summarizeWorkspaceDeckState(workspaceId),
    });
    const deckState = deps.readWorkspaceDeckStateStrict(workspaceId);
    const result = deckState.scenarioDecks.map((deck) => ({
      id: deck.id,
      label: deck.label,
      description: deck.description,
      path: deck.path,
      maxTurns: deck.maxTurns,
      inputSchema: deck.inputSchema,
      defaults: deck.defaults,
      inputSchemaError: deck.inputSchemaError,
    }));
    deps.logWorkspaceRefreshDebug("graphql.scenarioDecks.list.return", {
      workspaceId,
      returnedDeckCount: result.length,
      returnedDeckPaths: result.slice(0, 12).map((deck) => deck.path),
    });
    return result;
  },
  readWorkspaceAssistantDeck: async (workspaceId: string) => {
    await deps.activateWorkspaceDeck(workspaceId, {
      source: "graphql:readWorkspaceAssistantDeck",
    });
    return deps.readWorkspaceDeckStateStrict(workspaceId).assistantDeck;
  },
});
