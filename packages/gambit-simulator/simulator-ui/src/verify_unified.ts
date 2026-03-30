export const VERIFY_LIMITS = {
  scenarioRunsMax: 24,
  graderRepeatsMax: 24,
  concurrencyMax: 6,
} as const;

export const VERIFY_DEFAULTS = {
  scenarioRuns: 10,
  graderRepeatsPerScenario: 10,
  concurrency: 4,
} as const;

export type VerifyOutlierScenarioRunSortInput = {
  scenarioRunId: string;
  failed: boolean;
  averageScore: number | null;
};

export function sortVerifyOutlierScenarioRuns<
  T extends VerifyOutlierScenarioRunSortInput,
>(
  rows: Array<T>,
): Array<T> {
  return [...rows].sort((left, right) => {
    if (left.failed !== right.failed) return left.failed ? -1 : 1;
    const leftScore = typeof left.averageScore === "number"
      ? left.averageScore
      : Number.POSITIVE_INFINITY;
    const rightScore = typeof right.averageScore === "number"
      ? right.averageScore
      : Number.POSITIVE_INFINITY;
    if (leftScore !== rightScore) return leftScore - rightScore;
    return left.scenarioRunId.localeCompare(right.scenarioRunId);
  });
}
