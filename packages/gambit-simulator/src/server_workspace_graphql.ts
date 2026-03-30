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
  readWorkspaceDeckState: (workspaceId: string) => WorkspaceDeckState | null;
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
): WorkspaceDeckGraphqlOperations => {
  const readWorkspaceDeckStateGracefully = async (
    workspaceId: string,
    source:
      | "graphql:listWorkspaceGraderDecks"
      | "graphql:listWorkspaceScenarioDecks"
      | "graphql:readWorkspaceAssistantDeck",
  ): Promise<WorkspaceDeckState | null> => {
    await deps.activateWorkspaceDeck(workspaceId, {
      forceReload: true,
      source,
    });
    const deckState = deps.readWorkspaceDeckState(workspaceId);
    if (deckState) return deckState;
    deps.logWorkspaceRefreshDebug("graphql.deckState.unavailable", {
      workspaceId,
      source,
      resolvedDeckPath: deps.getResolvedDeckPath(),
      ...deps.summarizeWorkspaceDeckState(workspaceId),
    });
    return null;
  };

  return {
    listWorkspaceGraderDecks: async (workspaceId: string) => {
      const deckState = await readWorkspaceDeckStateGracefully(
        workspaceId,
        "graphql:listWorkspaceGraderDecks",
      );
      if (!deckState) return [];
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
      const deckState = await readWorkspaceDeckStateGracefully(
        workspaceId,
        "graphql:listWorkspaceScenarioDecks",
      );
      deps.logWorkspaceRefreshDebug(
        "graphql.scenarioDecks.list.afterActivate",
        {
          workspaceId,
          resolvedDeckPath: deps.getResolvedDeckPath(),
          ...deps.summarizeWorkspaceDeckState(workspaceId),
        },
      );
      if (!deckState) {
        deps.logWorkspaceRefreshDebug("graphql.scenarioDecks.list.return", {
          workspaceId,
          returnedDeckCount: 0,
          returnedDeckPaths: [],
          reason: "deck-state-unavailable",
        });
        return [];
      }
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
      const deckState = await readWorkspaceDeckStateGracefully(
        workspaceId,
        "graphql:readWorkspaceAssistantDeck",
      );
      return deckState?.assistantDeck ?? {};
    },
  };
};
