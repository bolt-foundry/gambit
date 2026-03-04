import { formatTimestampShort } from "./utils.ts";

export type TestRunHistoryDisplayOption = {
  runId: string;
  label: string;
  meta: string;
};

export function buildTestRunHistoryDisplayOptions(
  runs: Array<{ id: string; status: string; startedAt?: string | null }>,
): Array<TestRunHistoryDisplayOption> {
  return runs.map((run) => ({
    runId: run.id,
    label: run.id,
    meta: [
      run.startedAt ? formatTimestampShort(run.startedAt) : null,
      run.status,
    ].filter(Boolean).join(" · "),
  }));
}
