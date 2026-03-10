import { iso } from "@iso-gambit-sim";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildWorkspacePath,
  parseWorkspaceRoute,
} from "../../../../src/workspace_routes.ts";
import gambitWorkspaceGradeFlagReasonUpdateMutation from "../../../mutations/GambitWorkspaceGradeFlagReasonUpdateMutation.ts";
import gambitWorkspaceGradeFlagToggleMutation from "../../../mutations/GambitWorkspaceGradeFlagToggleMutation.ts";
import gambitWorkspaceGradeRunCreateMutation from "../../../mutations/GambitWorkspaceGradeRunCreateMutation.ts";
import gambitWorkspaceGradeLiveSubscription from "../../../subscriptions/GambitWorkspaceGradeLiveSubscription.ts";
import { useGambitTypedMutation } from "../../../src/hooks/useGambitTypedMutation.tsx";
import { useGambitTypedSubscription } from "../../../src/hooks/useGambitTypedSubscription.tsx";
import { useRouter } from "../../../src/RouterContext.tsx";
import {
  mergeWorkbenchSelectedContextChip,
  replaceWorkbenchSelectedContextChips,
  resolveWorkbenchSelectedContextChips,
} from "../../../src/workbenchChipStore.ts";
import {
  type WorkbenchSelectedContextChip,
} from "../../../src/workbenchContext.ts";
import GradeTabView from "../grade/GradeTabView.tsx";

function formatRunStatus(
  status: string | null | undefined,
): "idle" | "running" | "completed" | "error" {
  const normalized = (status ?? "").trim().toUpperCase();
  if (normalized === "RUNNING") return "running";
  if (normalized === "COMPLETED") return "completed";
  if (normalized === "ERROR") return "error";
  return "idle";
}

export const SimulatorGradePage = iso(`
  field Workspace.GradeTab @component {
    id
    workbenchSelectedContextChips @updatable
    scenarioRuns(first: 50) {
      edges {
        node {
          id
          status
          startedAt
          finishedAt
          error
        }
      }
    }
    gradeTab {
      graderDecks {
        id
        label
        description
        path
      }
      runs {
        id
        workspaceId
        scenarioRunId
        graderId
        graderPath
        graderLabel
        status
        runAt
        error
        summary {
          score
          reason
        }
        turns {
          id
          runId
          turnIndex
          turnNumber
          refId
          score
          reason
          priorUser
          gradedAssistant
        }
      }
      flags {
        id
        refId
        runId
        turnIndex
        reason
        createdAt
      }
    }
  }
`)(function SimulatorGradePage({ data, startUpdate }) {
  function isBuildChatDebugEnabled(): boolean {
    if (typeof globalThis === "undefined") return false;
    const debugGlobal =
      (globalThis as { __GAMBIT_BUILD_CHAT_DEBUG__?: unknown })
        .__GAMBIT_BUILD_CHAT_DEBUG__;
    if (debugGlobal === true) return true;
    const search = typeof globalThis.location?.search === "string"
      ? globalThis.location.search
      : "";
    if (search.length > 0) {
      const value = new URLSearchParams(search).get("gambitBuildChatDebug");
      if (value === "1" || value === "true") return true;
    }
    let stored = "";
    try {
      stored = (globalThis.localStorage?.getItem("gambit:build-chat-debug") ??
        "")
        .toLowerCase()
        .trim();
    } catch {
      return false;
    }
    return stored === "1" || stored === "true" || stored === "yes";
  }

  function logGradeChipDebug(event: string, payload: Record<string, unknown>) {
    if (!isBuildChatDebugEnabled()) return;
    console.info(`[grade-chip-debug] ${event}`, payload);
  }

  const workspaceId = data.id ?? "";
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
  const { currentRoutePath, navigate } = useRouter();
  const workspaceRoutePath = currentRoutePath;
  const route = useMemo(() => parseWorkspaceRoute(workspaceRoutePath), [
    workspaceRoutePath,
  ]);
  const routeGradeRunId = route?.tab === "grade" && route.gradeRunId
    ? route.gradeRunId
    : null;

  const runGradeMutation = useGambitTypedMutation(
    gambitWorkspaceGradeRunCreateMutation,
  );
  const toggleFlagMutation = useGambitTypedMutation(
    gambitWorkspaceGradeFlagToggleMutation,
  );
  const updateReasonMutation = useGambitTypedMutation(
    gambitWorkspaceGradeFlagReasonUpdateMutation,
  );

  const graders = useMemo(
    () =>
      (data.gradeTab?.graderDecks ?? []).flatMap((grader) =>
        grader?.id && grader?.label
          ? [{
            id: grader.id,
            label: grader.label,
            description: grader.description ?? null,
            path: grader.path ?? "",
          }]
          : []
      ),
    [data.gradeTab?.graderDecks],
  );

  const scenarioRuns = useMemo(
    () =>
      (data.scenarioRuns?.edges ?? []).flatMap((edge) => {
        const node = edge?.node;
        if (!node?.id) return [];
        return [{
          id: node.id,
          status: formatRunStatus(node.status),
          startedAt: node.startedAt ?? null,
          finishedAt: node.finishedAt ?? null,
          error: node.error ?? null,
        }];
      }).sort((left, right) => {
        const leftKey = left.finishedAt ?? left.startedAt ?? left.id;
        const rightKey = right.finishedAt ?? right.startedAt ?? right.id;
        return rightKey.localeCompare(leftKey);
      }),
    [data.scenarioRuns?.edges],
  );

  const runs = useMemo(
    () =>
      (data.gradeTab?.runs ?? []).flatMap((run) => {
        if (!run?.id) return [];
        return [{
          id: run.id,
          scenarioRunId: run.scenarioRunId ?? null,
          graderId: run.graderId ?? "",
          graderLabel: run.graderLabel ?? run.graderId ?? "grader",
          status: formatRunStatus(run.status),
          runAt: run.runAt ?? null,
          error: run.error ?? null,
          summary: run.summary
            ? {
              score: typeof run.summary.score === "number"
                ? run.summary.score
                : undefined,
              reason: run.summary.reason ?? undefined,
            }
            : null,
          turns: (run.turns ?? []).flatMap((turn) =>
            turn?.id
              ? [{
                id: turn.id,
                turnNumber: turn.turnNumber ?? turn.turnIndex ?? 0,
                refId: turn.refId ??
                  `gradingRun:${run.id}#turn:${turn.turnIndex ?? 0}`,
                score: typeof turn.score === "number" ? turn.score : undefined,
                reason: turn.reason ?? undefined,
                priorUser: turn.priorUser ?? undefined,
                gradedAssistant: turn.gradedAssistant ?? undefined,
                turnIndex: turn.turnIndex ?? undefined,
              }]
              : []
          ),
        }];
      }).sort((left, right) => {
        const leftKey = left.runAt ?? left.id;
        const rightKey = right.runAt ?? right.id;
        return rightKey.localeCompare(leftKey);
      }),
    [data.gradeTab?.runs],
  );

  const flags = useMemo(
    () =>
      (data.gradeTab?.flags ?? []).flatMap((flag) =>
        flag?.refId
          ? [{
            id: flag.id ?? `flag:${flag.refId}`,
            refId: flag.refId,
            runId: flag.runId ?? undefined,
            turnIndex: typeof flag.turnIndex === "number"
              ? flag.turnIndex
              : undefined,
            reason: flag.reason ?? undefined,
          }]
          : []
      ),
    [data.gradeTab?.flags],
  );

  const flagByRefId = useMemo(
    () => new Map(flags.map((flag) => [flag.refId, flag])),
    [flags],
  );

  const [selectedScenarioRunId, setSelectedScenarioRunId] = useState<
    string | null
  >(
    null,
  );
  const [selectedGraderId, setSelectedGraderId] = useState<string | null>(null);
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({});
  const [expandedResults, setExpandedResults] = useState<
    Record<string, boolean>
  >({});
  const [mutationError, setMutationError] = useState<string | null>(null);

  useGambitTypedSubscription(
    gambitWorkspaceGradeLiveSubscription,
    workspaceId ? { workspaceId } : null,
  );

  useEffect(() => {
    if (
      selectedGraderId &&
      graders.some((grader) => grader.id === selectedGraderId)
    ) {
      return;
    }
    setSelectedGraderId(graders[0]?.id ?? null);
  }, [graders, selectedGraderId]);

  useEffect(() => {
    if (
      selectedScenarioRunId &&
      scenarioRuns.some((scenarioRun) =>
        scenarioRun.id === selectedScenarioRunId
      )
    ) {
      return;
    }
    setSelectedScenarioRunId(scenarioRuns[0]?.id ?? null);
  }, [scenarioRuns, selectedScenarioRunId]);

  useEffect(() => {
    if (!routeGradeRunId) return;
    const routeRun = runs.find((run) => run.id === routeGradeRunId);
    if (!routeRun?.scenarioRunId) return;
    setSelectedScenarioRunId((current) =>
      current === routeRun.scenarioRunId ? current : routeRun.scenarioRunId
    );
  }, [routeGradeRunId, runs]);

  const filteredRuns = useMemo(() => {
    if (!selectedScenarioRunId) return runs;
    return runs.filter((run) => run.scenarioRunId === selectedScenarioRunId);
  }, [runs, selectedScenarioRunId]);

  const routeRun = useMemo(
    () => (routeGradeRunId
      ? runs.find((run) => run.id === routeGradeRunId) ?? null
      : null),
    [routeGradeRunId, runs],
  );
  const routeRunMissing = Boolean(routeGradeRunId && !routeRun);

  const onSelectRun = useCallback((runId: string | null) => {
    const nextPath = buildWorkspacePath("grade", workspaceId, {
      runId: runId ?? undefined,
    });
    navigate(nextPath);
  }, [navigate, workspaceId]);

  const onRunGrader = useCallback(() => {
    if (!workspaceId || !selectedGraderId || !selectedScenarioRunId) return;
    setMutationError(null);
    runGradeMutation.commit(
      {
        input: {
          workspaceId,
          graderId: selectedGraderId,
          scenarioRunId: selectedScenarioRunId,
        },
      },
      {
        onComplete: (result) => {
          const nextRunId = (result as { run?: { id?: string | null } })?.run
            ?.id ?? null;
          onSelectRun(nextRunId);
        },
        onError: () => {
          setMutationError("Failed to run grader.");
        },
      },
    );
  }, [
    onSelectRun,
    runGradeMutation,
    selectedGraderId,
    selectedScenarioRunId,
    workspaceId,
  ]);

  const onToggleFlag = useCallback((args: {
    refId: string;
    runId: string;
    turnIndex?: number;
  }) => {
    if (!workspaceId) return;
    setMutationError(null);
    toggleFlagMutation.commit(
      {
        input: {
          workspaceId,
          refId: args.refId,
          runId: args.runId,
          ...(typeof args.turnIndex === "number"
            ? { turnIndex: args.turnIndex }
            : {}),
        },
      },
      {
        onError: () => {
          setMutationError("Failed to update grade flag.");
        },
      },
    );
  }, [toggleFlagMutation, workspaceId]);

  const onReasonBlur = useCallback((refId: string, reason: string) => {
    if (!workspaceId) return;
    const nextReason = reason;
    const currentReason = flagByRefId.get(refId)?.reason ?? "";
    if (nextReason === currentReason) return;
    updateReasonMutation.commit(
      {
        input: {
          workspaceId,
          refId,
          reason: nextReason,
        },
      },
      {
        onError: () => {
          setMutationError("Failed to update flag reason.");
        },
      },
    );
  }, [flagByRefId, updateReasonMutation, workspaceId]);

  const onReasonDraftChange = useCallback((refId: string, reason: string) => {
    setReasonDrafts((prev) => ({
      ...prev,
      [refId]: reason,
    }));
  }, []);

  const canRunGrader = Boolean(
    !runGradeMutation.inFlight && workspaceId && selectedGraderId &&
      selectedScenarioRunId,
  );

  return (
    <GradeTabView
      scenarioRuns={scenarioRuns}
      selectedScenarioRunId={selectedScenarioRunId}
      onSelectScenarioRun={(scenarioRunId) => {
        setSelectedScenarioRunId(scenarioRunId);
        if (routeGradeRunId) {
          onSelectRun(null);
        }
      }}
      graders={graders}
      selectedGraderId={selectedGraderId}
      onSelectGrader={setSelectedGraderId}
      onRunGrader={onRunGrader}
      runInFlight={runGradeMutation.inFlight}
      canRunGrader={canRunGrader}
      filteredRuns={filteredRuns}
      routeGradeRunId={routeGradeRunId}
      routeRunMissing={routeRunMissing}
      missingRunHref={buildWorkspacePath("grade", workspaceId)}
      onSelectRun={onSelectRun}
      flagByRefId={flagByRefId}
      reasonDrafts={reasonDrafts}
      onReasonDraftChange={onReasonDraftChange}
      onReasonBlur={onReasonBlur}
      onToggleFlag={onToggleFlag}
      onAddFlagToWorkbench={(args) => {
        const flagReason = args.flagReason?.trim();
        const graderReason = args.graderReason?.trim();
        const gradedAssistant = args.gradedAssistant?.trim();
        const message = [
          flagReason ? `Flag reason: ${flagReason}` : null,
          graderReason ? `Grader feedback: ${graderReason}` : null,
          gradedAssistant ? `Assistant response: ${gradedAssistant}` : null,
        ].filter((part): part is string => Boolean(part)).join("\n");
        logGradeChipDebug("flag.add_to_workbench", {
          workspaceId,
          args,
          chipMessage: message || "Flagged by grader",
        });
        updateComposerChips(
          mergeWorkbenchSelectedContextChip(composerChips, {
            chipId: `flag:${args.refId}`,
            source: "grading_flag",
            workspaceId,
            runId: args.runId,
            capturedAt: new Date().toISOString(),
            refId: args.refId,
            score: args.score,
            message: message || "Flagged by grader",
            enabled: true,
          }),
        );
      }}
      onAddErrorToWorkbench={({ runId, error }) => {
        updateComposerChips(
          mergeWorkbenchSelectedContextChip(composerChips, {
            chipId: `grader_run_error:${
              runId ?? routeGradeRunId ?? workspaceId
            }`,
            source: "grader_run_error",
            workspaceId,
            runId: runId ?? routeGradeRunId ?? undefined,
            capturedAt: new Date().toISOString(),
            error,
            enabled: true,
          }),
        );
      }}
      mutationError={mutationError}
      expandedResults={expandedResults}
      onToggleExpandedResult={(itemKey) =>
        setExpandedResults((prev) => ({
          ...prev,
          [itemKey]: !prev[itemKey],
        }))}
    />
  );
});

export default SimulatorGradePage;
