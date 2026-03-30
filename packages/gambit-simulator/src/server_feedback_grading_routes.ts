import type { SavedState } from "@bolt-foundry/gambit-core";
import type { GradingRunRecord, SessionMeta } from "./server_types.ts";

type JsonRecord = Record<string, unknown>;

type HandleGradingReferenceRouteDeps = {
  url: URL;
  req: Request;
  getWorkspaceIdFromBody: (body: JsonRecord) => string | undefined;
  logWorkspaceBotRoot: (
    endpoint: string,
    workspaceId?: string,
  ) => Promise<void>;
  readSessionState: (sessionId: string) => SavedState | undefined;
  persistSessionState: (state: SavedState) => SavedState;
  appendGradingLog: (state: SavedState, payload: JsonRecord) => void;
  buildSessionMeta: (workspaceId: string, state: SavedState) => SessionMeta;
  appendDurableStreamEvent: (streamId: string, payload: unknown) => void;
  workspaceStreamId: string;
  gradeStreamId: string;
  parseFiniteInteger: (value: unknown) => number | undefined;
  randomId: (prefix: string) => string;
};

export const handleGradingReferenceRoute = async (
  deps: HandleGradingReferenceRouteDeps,
): Promise<Response | null> => {
  const {
    url,
    req,
    getWorkspaceIdFromBody,
    logWorkspaceBotRoot,
    readSessionState,
    persistSessionState,
    appendGradingLog,
    buildSessionMeta,
    appendDurableStreamEvent,
    workspaceStreamId,
    gradeStreamId,
    parseFiniteInteger,
    randomId,
  } = deps;

  if (url.pathname !== "/api/grading/reference") return null;
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  try {
    const body = await req.json() as {
      workspaceId?: string;
      runId?: string;
      turnIndex?: number;
      referenceSample?: {
        score?: number;
        reason?: string;
        evidence?: Array<string>;
      };
    };
    const workspaceId = getWorkspaceIdFromBody(body as JsonRecord);
    if (!workspaceId) throw new Error("Missing workspaceId");
    await logWorkspaceBotRoot("/api/grading/reference", workspaceId);
    if (!body.runId) throw new Error("Missing runId");
    if (!body.referenceSample) {
      throw new Error("Missing referenceSample");
    }
    const score = body.referenceSample.score;
    if (typeof score !== "number" || Number.isNaN(score)) {
      throw new Error("Invalid reference score");
    }
    const reason = body.referenceSample.reason;
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new Error("Missing reference reason");
    }
    const evidence = Array.isArray(body.referenceSample.evidence)
      ? body.referenceSample.evidence.filter((e) =>
        typeof e === "string" && e.trim().length > 0
      )
      : undefined;
    const state = readSessionState(workspaceId);
    if (!state) throw new Error("Workspace not found");
    const previousRuns = Array.isArray(
        (state.meta as { gradingRuns?: unknown })?.gradingRuns,
      )
      ? ((state.meta as { gradingRuns: Array<GradingRunRecord> })
        .gradingRuns)
      : Array.isArray(state.meta?.calibrationRuns)
      ? (state.meta?.calibrationRuns as Array<GradingRunRecord>)
      : [];
    const index = previousRuns.findIndex((run) => run.id === body.runId);
    if (index < 0) throw new Error("Run not found");
    const run = previousRuns[index];
    const nextRun: GradingRunRecord = {
      ...run,
      id: run.id,
      workspaceId,
      gradingRunId: run.id,
    };
    const nextOffsetGuess = (parseFiniteInteger(
      (state.meta as { lastAppliedOffset?: unknown } | undefined)
        ?.lastAppliedOffset,
    ) ??
      parseFiniteInteger(
        (state.meta as { lastAppliedEventSeq?: unknown } | undefined)
          ?.lastAppliedEventSeq,
      ) ??
      -1) + 1;
    if (typeof body.turnIndex === "number") {
      const result = run.result;
      const turnIndex = body.turnIndex;
      if (
        !result || typeof result !== "object" ||
        (result as { mode?: unknown }).mode !== "turns" ||
        !Array.isArray((result as { turns?: unknown }).turns)
      ) {
        throw new Error("Run does not support turn references");
      }
      const turns = (result as {
        turns: Array<Record<string, unknown>>;
      }).turns.map((turn) => ({ ...turn }));
      const targetIndex = turns.findIndex((turn) => turn.index === turnIndex);
      if (targetIndex < 0) {
        throw new Error("Turn not found");
      }
      const targetTurn = turns[targetIndex];
      const messageRefId = typeof targetTurn.messageRefId === "string"
        ? targetTurn.messageRefId
        : undefined;
      if (!messageRefId) {
        throw new Error(
          "Missing messageRefId for grading turn artifact",
        );
      }
      const artifactRevisionId = randomId("grade-ref-rev");
      const referenceRevision = {
        artifactRevisionId,
        workspaceId,
        gradingRunId: run.id,
        turnIndex,
        messageRefId,
        offset: nextOffsetGuess,
        createdAt: new Date().toISOString(),
        referenceSample: { score, reason, evidence },
      };
      const previousRevisions = Array.isArray(
          targetTurn.referenceSampleRevisions,
        )
        ? targetTurn.referenceSampleRevisions as Array<
          Record<string, unknown>
        >
        : [];
      turns[targetIndex] = {
        ...targetTurn,
        workspaceId,
        gradingRunId: run.id,
        turnIndex,
        messageRefId,
        artifactRevisionId,
        referenceSample: {
          score,
          reason,
          evidence,
          artifactRevisionId,
          workspaceId,
          gradingRunId: run.id,
          turnIndex,
          messageRefId,
        },
        referenceSampleRevisions: [
          ...previousRevisions,
          referenceRevision,
        ],
      };
      nextRun.result = { ...(result as object), turns };
    } else {
      const artifactRevisionId = randomId("grade-ref-rev");
      const nextRunRecord = nextRun as Record<string, unknown>;
      const previousRevisions = Array.isArray(
          nextRunRecord.referenceSampleRevisions,
        )
        ? nextRunRecord.referenceSampleRevisions as Array<unknown>
        : [];
      (nextRun as Record<string, unknown>).artifactRevisionId =
        artifactRevisionId;
      (nextRun as Record<string, unknown>).referenceSampleRevisions = [
        ...previousRevisions,
        {
          artifactRevisionId,
          workspaceId,
          gradingRunId: run.id,
          offset: nextOffsetGuess,
          createdAt: new Date().toISOString(),
          referenceSample: { score, reason, evidence },
        },
      ];
      nextRun.referenceSample = {
        score,
        reason,
        evidence,
        artifactRevisionId,
        workspaceId,
        gradingRunId: run.id,
      };
    }
    const nextRuns = previousRuns.map((entry, i) =>
      i === index ? nextRun : entry
    );
    const nextState = persistSessionState({
      ...state,
      meta: {
        ...(state.meta ?? {}),
        gradingRuns: nextRuns,
      },
    });
    appendGradingLog(nextState, {
      type: "grading.reference",
      run: nextRun,
      runId: body.runId,
      turnIndex: body.turnIndex,
      workspaceId,
    });
    const sessionMeta = buildSessionMeta(workspaceId, nextState);
    appendDurableStreamEvent(workspaceStreamId, {
      type: "calibrateSession",
      workspaceId,
      run: nextRun,
      session: sessionMeta,
    });
    appendDurableStreamEvent(gradeStreamId, {
      type: "calibrateSession",
      workspaceId,
      run: nextRun,
      session: sessionMeta,
    });
    return new Response(
      JSON.stringify({
        workspaceId,
        run: nextRun,
        session: sessionMeta,
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
};

type HandleFeedbackRoutesDeps = {
  url: URL;
  req: Request;
  sessionsRoot: string;
  getWorkspaceIdFromBody: (body: JsonRecord) => string | undefined;
  readSessionState: (sessionId: string) => SavedState | undefined;
  persistSessionState: (state: SavedState) => SavedState;
  appendFeedbackLog: (state: SavedState, payload: JsonRecord) => void;
  appendSessionEvent: (state: SavedState, payload: JsonRecord) => void;
};

export const handleFeedbackRoutes = async (
  deps: HandleFeedbackRoutesDeps,
): Promise<Response | null> => {
  const {
    url,
    req,
    sessionsRoot,
    getWorkspaceIdFromBody,
    readSessionState,
    persistSessionState,
    appendFeedbackLog,
    appendSessionEvent,
  } = deps;

  if (url.pathname === "/api/feedback") {
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    const deckPathParam = url.searchParams.get("deckPath");
    if (!deckPathParam) {
      return new Response(
        JSON.stringify({ error: "Missing deckPath" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    const items: Array<Record<string, unknown>> = [];
    try {
      for await (const entry of Deno.readDir(sessionsRoot)) {
        if (!entry.isDirectory) continue;
        const sessionId = entry.name;
        const state = readSessionState(sessionId);
        if (!state) continue;
        if (state.meta?.deck !== deckPathParam) continue;
        const feedbackList = Array.isArray(state.feedback)
          ? state.feedback
          : [];
        feedbackList.forEach((fb) => {
          if (!fb || typeof fb !== "object") return;
          const messageRefId = (fb as { messageRefId?: string })
            .messageRefId;
          if (typeof messageRefId !== "string") return;
          let messageContent: unknown = undefined;
          if (
            Array.isArray(state.messageRefs) &&
            Array.isArray(state.messages)
          ) {
            const idx = state.messageRefs.findIndex((ref) =>
              ref?.id === messageRefId
            );
            if (idx >= 0) {
              messageContent = state.messages[idx]?.content;
            }
          }
          items.push({
            workspaceId: sessionId,
            deck: state.meta?.deck,
            sessionCreatedAt: state.meta?.sessionCreatedAt,
            messageRefId,
            score: (fb as { score?: number }).score,
            reason: (fb as { reason?: string }).reason,
            createdAt: (fb as { createdAt?: string }).createdAt,
            archivedAt: (fb as { archivedAt?: string }).archivedAt,
            messageContent,
          });
        });
      }
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    items.sort((a, b) => {
      const aTime = String(a.createdAt ?? "") || "";
      const bTime = String(b.createdAt ?? "") || "";
      return bTime.localeCompare(aTime);
    });
    return new Response(
      JSON.stringify({ deckPath: deckPathParam, items }),
      {
        headers: { "content-type": "application/json" },
      },
    );
  }

  if (url.pathname === "/api/feedback/archive" && req.method === "POST") {
    try {
      const body = await req.json() as {
        workspaceId?: string;
        runId?: string;
        messageRefId?: string;
        archived?: boolean;
      };
      const workspaceId = getWorkspaceIdFromBody(body as JsonRecord);
      if (!workspaceId || !body.messageRefId) {
        throw new Error("Missing workspaceId or messageRefId");
      }
      const state = readSessionState(workspaceId);
      if (!state || !Array.isArray(state.feedback)) {
        throw new Error("Workspace not found");
      }
      const idx = state.feedback.findIndex((fb) =>
        (fb as { messageRefId?: string }).messageRefId === body.messageRefId
      );
      if (idx === -1) throw new Error("Feedback not found");
      const next = { ...state.feedback[idx] };
      if (body.archived === false) {
        delete (next as Record<string, unknown>).archivedAt;
      } else {
        (next as Record<string, unknown>).archivedAt = new Date()
          .toISOString();
      }
      const nextFeedback = state.feedback.map((fb, i) => i === idx ? next : fb);
      const updated = persistSessionState({
        ...state,
        feedback: nextFeedback,
      });
      appendFeedbackLog(updated, {
        type: "feedback.archive",
        messageRefId: body.messageRefId,
        archivedAt: (next as { archivedAt?: string }).archivedAt,
        archived: body.archived !== false,
      });
      appendSessionEvent(updated, {
        type: "feedback.archive",
        kind: "artifact",
        category: "feedback",
        workspaceId,
        messageRefId: body.messageRefId,
        archivedAt: (next as { archivedAt?: string }).archivedAt,
        archived: body.archived !== false,
      });
      return new Response(
        JSON.stringify({
          workspaceId,
          messageRefId: body.messageRefId,
          archivedAt: (next as { archivedAt?: string }).archivedAt,
          saved: true,
          feedbackCount: updated.feedback?.length ?? 0,
        }),
        { headers: { "content-type": "application/json" } },
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
  }

  return null;
};
