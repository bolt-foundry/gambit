import Button from "../gds/Button.tsx";
import Callout from "../gds/Callout.tsx";
import Listbox from "../gds/Listbox.tsx";
import type { GradeGraderOption, GradeTestRunOption } from "./types.ts";

export function GradeRunnerPanel(props: {
  testRunOptions: Array<GradeTestRunOption>;
  selectedTestRunId: string | null;
  onSelectTestRun: (runId: string) => void;
  graders: Array<GradeGraderOption>;
  selectedGraderId: string | null;
  onSelectGrader: (graderId: string | null) => void;
  selectedGraderDescription?: string | null;
  sessionsCount: number;
  onRunGrader: () => void;
  canRun: boolean;
  running: boolean;
  runButtonTestId?: string;
}) {
  return (
    <>
      {props.testRunOptions.length > 0 && (
        <Listbox
          label="Previous test run"
          value={props.selectedTestRunId ?? ""}
          onChange={props.onSelectTestRun}
          options={props.testRunOptions}
          placeholder="Select previous run"
        />
      )}
      <div className="flex-row gap-8 items-center">
        <div className="flex-1">
          <strong>Run a grader</strong>
        </div>
        <Button
          variant="primary"
          onClick={props.onRunGrader}
          disabled={!props.canRun}
          data-testid={props.runButtonTestId}
        >
          {props.running ? "Running…" : "Run grader"}
        </Button>
      </div>
      {props.sessionsCount === 0 && (
        <Callout>
          No sessions found. Run the Test view to capture a session before
          calibrating.
        </Callout>
      )}
      {props.graders.length === 0 && (
        <Callout>
          No graders found in the workspace root deck. Add{" "}
          <code>[[graders]]</code> to <code>PROMPT.md</code>{" "}
          (prefer the Build tab) to enable grading.
        </Callout>
      )}
      {props.sessionsCount > 0 && props.graders.length > 0 && (
        <>
          <Listbox
            label="Grader"
            value={props.selectedGraderId ?? ""}
            onChange={(value) =>
              props.onSelectGrader(value.length ? value : null)}
            options={props.graders.map((grader) => ({
              value: grader.id,
              label: grader.label,
              meta: grader.meta,
            }))}
            placeholder="Select grader"
          />
          {props.selectedGraderDescription && (
            <Callout>
              {props.selectedGraderDescription}
            </Callout>
          )}
        </>
      )}
    </>
  );
}

export default GradeRunnerPanel;
