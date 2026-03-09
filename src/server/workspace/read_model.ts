import type { SavedState } from "@bolt-foundry/gambit-core";
import type { SessionMeta, WorkspaceDeckState } from "../../server_types.ts";
import type {
  BuildBotRunStatus,
  TestBotRunEntry,
  TestBotRunStatus,
} from "./types.ts";

type BuildWorkspaceReadModel = (
  workspaceId: string,
  options?: {
    requestedTestDeckPath?: string | null;
    requestedTestRunId?: string | null;
    requestedGradeRunId?: string | null;
  },
) => Promise<unknown>;

type WorkspaceReadModelService = {
  buildWorkspaceReadModel: BuildWorkspaceReadModel;
};

export const createWorkspaceReadModelService = (deps: {
  readSessionState: (workspaceId: string) => SavedState | undefined;
  readSessionStateStrict: (
    workspaceId: string,
    options?: { withTraces?: boolean },
  ) => SavedState | undefined;
  readWorkspaceBuildRunForGraphql: (workspaceId: string) => BuildBotRunStatus;
  getLiveTestRunEntry: (runId: string) => TestBotRunEntry | undefined;
  getLiveTestRunEntryByWorkspaceId: (
    workspaceId: string,
  ) => TestBotRunEntry | undefined;
  readPersistedTestRunStatusById: (
    sessionState: SavedState,
    workspaceId: string,
    requestedRunId: string,
  ) => TestBotRunStatus | null;
  syncTestBotRunFromState: (run: TestBotRunStatus, state: SavedState) => void;
  selectCanonicalScenarioRunSummary: (
    meta: Record<string, unknown>,
  ) => { scenarioRunId: string } | null;
  activateWorkspaceDeck: (
    workspaceId?: string | null,
    options?: {
      forceReload?: boolean;
      source?: string;
      reloadAttemptId?: string;
    },
  ) => Promise<void>;
  readWorkspaceDeckState: (workspaceId: string) => WorkspaceDeckState | null;
  resolveScenarioDeckFromState: (
    deckState: WorkspaceDeckState,
    identifier: string,
  ) => WorkspaceDeckState["scenarioDecks"][number] | undefined;
  listSessions: () => Array<SessionMeta>;
}): WorkspaceReadModelService => {
  const buildWorkspaceReadModel: BuildWorkspaceReadModel = async (
    workspaceId,
    options,
  ) => {
    let state: SavedState | undefined;
    try {
      state = deps.readSessionStateStrict(workspaceId, { withTraces: true });
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
        status: 400,
      } as const;
    }
    if (!state) {
      return {
        error: "Workspace not found",
        status: 404,
      } as const;
    }

    const buildRun = deps.readWorkspaceBuildRunForGraphql(workspaceId);

    const requestedTestRunId =
      typeof options?.requestedTestRunId === "string" &&
        options.requestedTestRunId.trim().length > 0
        ? options.requestedTestRunId
        : null;

    const requestedTestEntry = requestedTestRunId
      ? deps.getLiveTestRunEntry(requestedTestRunId)
      : undefined;
    const requestedLiveRun = requestedTestEntry?.run &&
        (requestedTestEntry.run.workspaceId === workspaceId ||
          requestedTestEntry.run.sessionId === workspaceId)
      ? requestedTestEntry.run
      : undefined;
    const persistedRequestedRun = requestedTestRunId
      ? deps.readPersistedTestRunStatusById(
        state,
        workspaceId,
        requestedTestRunId,
      )
      : null;

    const testEntry = requestedLiveRun
      ? undefined
      : deps.getLiveTestRunEntryByWorkspaceId(workspaceId);
    const testRun = requestedLiveRun ?? persistedRequestedRun ??
      testEntry?.run ?? {
      id: "",
      status: "idle" as const,
      messages: [],
      traces: [],
      toolInserts: [],
      workspaceId,
      sessionId: workspaceId,
    };
    if (!requestedLiveRun && !persistedRequestedRun && !testEntry) {
      deps.syncTestBotRunFromState(testRun, state);
      const meta = state.meta && typeof state.meta === "object"
        ? state.meta as Record<string, unknown>
        : null;
      if (meta) {
        const selectedScenarioSummary = deps.selectCanonicalScenarioRunSummary(
          meta,
        );
        if (selectedScenarioSummary) {
          testRun.id = selectedScenarioSummary.scenarioRunId;
          if (testRun.status === "idle") {
            testRun.status = "completed";
          }
        }
      }
    }
    const feedbackByRef = new Map(
      (state.feedback ?? []).map((entry) => [entry.messageRefId, entry]),
    );
    if (Array.isArray(testRun.messages) && testRun.messages.length > 0) {
      testRun.messages = testRun.messages.map((message) => {
        const refId = typeof message.messageRefId === "string"
          ? message.messageRefId
          : undefined;
        if (!refId) return message;
        const feedback = feedbackByRef.get(refId);
        if (!feedback && !message.feedback) return message;
        if (!feedback) {
          return { ...message, feedback: undefined };
        }
        return { ...message, feedback };
      });
    }

    await deps.activateWorkspaceDeck(workspaceId);
    const deckState = deps.readWorkspaceDeckState(workspaceId);
    const requestedDeck = options?.requestedTestDeckPath ?? null;
    const testSelection = requestedDeck
      ? deckState
        ? deps.resolveScenarioDeckFromState(deckState, requestedDeck)
        : undefined
      : deckState?.scenarioDecks[0];

    const session = {
      workspaceId,
      messages: state.messages,
      messageRefs: state.messageRefs,
      feedback: state.feedback,
      traces: state.traces,
      notes: state.notes,
      meta: state.meta,
    };

    return {
      workspaceId,
      build: { run: buildRun },
      test: {
        run: testRun,
        botPath: testSelection?.path ?? null,
        botLabel: testSelection?.label ?? null,
        botDescription: testSelection?.description ?? null,
        selectedDeckId: testSelection?.id ?? null,
        inputSchema: testSelection?.inputSchema ?? null,
        inputSchemaError: testSelection?.inputSchemaError ?? null,
        defaults: { input: testSelection?.defaults },
        testDecks: deckState?.scenarioDecks ?? [],
      },
      grade: {
        graderDecks: deckState?.graderDecks ?? [],
        sessions: deps.listSessions(),
      },
      session,
    } as const;
  };

  return {
    buildWorkspaceReadModel,
  };
};
