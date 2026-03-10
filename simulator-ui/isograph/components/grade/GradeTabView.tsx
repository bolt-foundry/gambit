import { useMemo } from "react";
import GradeResultsPanel from "../../../src/grade/GradeResultsPanel.tsx";
import GradeRunnerPanel from "../../../src/grade/GradeRunnerPanel.tsx";
import GradeTabShell from "../../../src/grade/GradeTabShell.tsx";
import type { GradeRunSection } from "../../../src/grade/types.ts";

export type GradeScenarioRunOption = {
  id: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type GradeGraderOption = {
  id: string;
  label: string;
  description: string | null;
  path: string;
};

export type GradeTurnView = {
  id: string;
  turnNumber: number;
  refId: string;
  score?: number;
  reason?: string;
  priorUser?: string;
  gradedAssistant?: string;
  turnIndex?: number;
};

export type GradeRunView = {
  id: string;
  scenarioRunId: string | null;
  graderId: string;
  graderLabel: string;
  status: "idle" | "running" | "completed" | "error";
  runAt: string | null;
  error: string | null;
  summary: { score?: number; reason?: string } | null;
  turns: Array<GradeTurnView>;
};

export type GradeFlagView = {
  id: string;
  refId: string;
  runId?: string;
  turnIndex?: number;
  reason?: string;
};

function toTurnContextInput(turn: GradeTurnView): unknown {
  return {
    session: {
      messages: turn.priorUser
        ? [{ role: "user", content: turn.priorUser }]
        : [],
    },
    messageToGrade: {
      content: turn.gradedAssistant,
    },
  };
}

export function GradeTabView(props: {
  scenarioRuns: Array<GradeScenarioRunOption>;
  selectedScenarioRunId: string | null;
  onSelectScenarioRun: (scenarioRunId: string | null) => void;
  graders: Array<GradeGraderOption>;
  selectedGraderId: string | null;
  onSelectGrader: (graderId: string | null) => void;
  onRunGrader: () => void;
  runInFlight: boolean;
  canRunGrader: boolean;
  filteredRuns: Array<GradeRunView>;
  routeGradeRunId: string | null;
  routeRunMissing: boolean;
  missingRunHref?: string;
  onSelectRun: (runId: string | null) => void;
  flagByRefId: Map<string, GradeFlagView>;
  reasonDrafts: Record<string, string>;
  onReasonDraftChange: (refId: string, reason: string) => void;
  onReasonBlur: (refId: string, reason: string) => void;
  onToggleFlag: (args: {
    refId: string;
    runId: string;
    turnIndex?: number;
  }) => void;
  onAddFlagToWorkbench?: (args: {
    refId: string;
    runId: string;
    turnIndex?: number;
    score?: number;
    graderReason?: string;
    flagReason?: string;
    priorUser?: string;
    gradedAssistant?: string;
  }) => void;
  onAddErrorToWorkbench?: (args: { runId?: string; error: string }) => void;
  mutationError: string | null;
  expandedResults: Record<string, boolean>;
  onToggleExpandedResult: (itemKey: string) => void;
}) {
  const selectedGrader = useMemo(
    () =>
      props.graders.find((grader) => grader.id === props.selectedGraderId) ??
        null,
    [props.graders, props.selectedGraderId],
  );

  const runSections = useMemo<Array<GradeRunSection>>(
    () =>
      props.filteredRuns.map((run) => {
        const items = run.turns.length > 0
          ? [...run.turns]
            .sort((left, right) => right.turnNumber - left.turnNumber)
            .map((turn) => ({
              key: `${run.id}-${turn.turnIndex ?? turn.turnNumber}`,
              label: `Assistant turn ${turn.turnNumber}`,
              status: run.status,
              runAt: run.runAt ?? undefined,
              error: run.error ?? undefined,
              input: toTurnContextInput(turn),
              result: {
                score: turn.score,
                reason: turn.reason,
              },
              runId: run.id,
              turnIndex: turn.turnIndex,
              turnNumber: turn.turnNumber,
              refId: turn.refId,
              pending: false,
            }))
          : [{
            key: run.id,
            label: "Result",
            status: run.status,
            runAt: run.runAt ?? undefined,
            error: run.error ?? undefined,
            input: undefined,
            result: {
              score: run.summary?.score,
              reason: run.summary?.reason,
            },
            runId: run.id,
            refId: `gradingRun:${run.id}`,
            pending: run.status === "running",
          }];

        return {
          run: {
            id: run.id,
            status: run.status,
            runAt: run.runAt ?? undefined,
            input: undefined,
            result: run.turns.length > 0
              ? {
                mode: "turns",
                totalTurns: run.turns.length,
              }
              : {
                score: run.summary?.score,
                reason: run.summary?.reason,
              },
          },
          label: run.graderLabel,
          items,
        };
      }),
    [props.filteredRuns],
  );

  const flaggedRefSet = useMemo(
    () => new Set([...props.flagByRefId.keys()]),
    [props.flagByRefId],
  );

  const graderOptions = useMemo(
    () =>
      props.graders.map((grader) => ({
        id: grader.id,
        label: grader.label,
        meta: grader.description ?? grader.path,
        description: grader.description ?? undefined,
      })),
    [props.graders],
  );

  const testRunOptions = useMemo(
    () =>
      props.scenarioRuns.map((run) => ({
        value: run.id,
        label: run.id,
        meta: [run.status, run.finishedAt ?? run.startedAt].filter(Boolean)
          .join(" · "),
      })),
    [props.scenarioRuns],
  );

  return (
    <GradeTabShell
      runner={
        <GradeRunnerPanel
          testRunOptions={testRunOptions}
          selectedTestRunId={props.selectedScenarioRunId}
          onSelectTestRun={(runId) => props.onSelectScenarioRun(runId || null)}
          graders={graderOptions}
          selectedGraderId={props.selectedGraderId}
          onSelectGrader={props.onSelectGrader}
          selectedGraderDescription={selectedGrader?.description ?? null}
          sessionsCount={props.scenarioRuns.length}
          onRunGrader={props.onRunGrader}
          canRun={props.canRunGrader}
          running={props.runInFlight}
          runButtonTestId="grade-run-grader"
        />
      }
      results={
        <GradeResultsPanel
          error={props.mutationError}
          loading={false}
          runCount={runSections.length}
          runItemsCount={runSections.flatMap((section) => section.items).length}
          emptyMessage="No grader runs for this selected test run yet."
          routeRunNotFound={props.routeRunMissing}
          missingRunHref={props.missingRunHref}
          runSections={runSections}
          expandedRunId={props.routeGradeRunId}
          onToggleRun={(runId) =>
            props.onSelectRun(props.routeGradeRunId === runId ? null : runId)}
          expandedResults={props.expandedResults}
          onToggleExpandedResult={props.onToggleExpandedResult}
          flaggedRefSet={flaggedRefSet}
          flagReasonDrafts={props.reasonDrafts}
          flagReasonByRefId={props.flagByRefId}
          onToggleFlag={props.onToggleFlag}
          onFlagReasonChange={props.onReasonDraftChange}
          onFlagReasonBlur={props.onReasonBlur}
          onAddFlagToWorkbench={props.onAddFlagToWorkbench}
          onAddErrorToWorkbench={props.onAddErrorToWorkbench}
          topErrorRunId={props.routeGradeRunId}
        />
      }
    />
  );
}

export default GradeTabView;
