import { assertEquals } from "@std/assert";
import {
  sortVerifyOutlierScenarioRuns,
  VERIFY_DEFAULTS,
  VERIFY_LIMITS,
} from "./verify_unified.ts";

Deno.test("verify unified defaults are explicit and stable", () => {
  assertEquals(VERIFY_DEFAULTS.scenarioRuns, 10);
  assertEquals(VERIFY_DEFAULTS.graderRepeatsPerScenario, 10);
  assertEquals(VERIFY_DEFAULTS.concurrency, 4);
  assertEquals(VERIFY_LIMITS.scenarioRunsMax, 24);
  assertEquals(VERIFY_LIMITS.graderRepeatsMax, 24);
  assertEquals(VERIFY_LIMITS.concurrencyMax, 6);
});

Deno.test("verify outlier ordering ranks failed first then low score", () => {
  const sorted = sortVerifyOutlierScenarioRuns([
    { scenarioRunId: "run-c", failed: false, averageScore: 0.7 },
    { scenarioRunId: "run-b", failed: false, averageScore: 0.2 },
    { scenarioRunId: "run-a", failed: true, averageScore: 0.9 },
    { scenarioRunId: "run-d", failed: true, averageScore: null },
  ]);

  assertEquals(sorted.map((row) => row.scenarioRunId), [
    "run-a",
    "run-d",
    "run-b",
    "run-c",
  ]);
});
