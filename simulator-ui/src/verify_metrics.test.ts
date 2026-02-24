import { assertEquals } from "@std/assert";
import {
  buildVerifyConsistencyReport,
  type VerifyCalibrationRun,
} from "./verify_metrics.ts";

const makeConversationRun = (
  id: string,
  score: number,
): VerifyCalibrationRun => ({
  id,
  status: "completed",
  runAt: new Date().toISOString(),
  result: { payload: { score, reason: `score=${score}` } },
});

const makeTurnsRun = (
  id: string,
  turns: Array<{ score: number; index: number; messageRefId: string }>,
): VerifyCalibrationRun => ({
  id,
  status: "completed",
  runAt: new Date().toISOString(),
  result: {
    mode: "turns",
    totalTurns: turns.length,
    turns: turns.map((turn) => ({
      index: turn.index,
      messageRefId: turn.messageRefId,
      result: { payload: { score: turn.score, reason: `score=${turn.score}` } },
    })),
  },
});

Deno.test("buildVerifyConsistencyReport returns PASS for consistent runs", () => {
  const runs = [
    makeConversationRun("run-1", 2),
    makeConversationRun("run-2", 2),
    makeConversationRun("run-3", 2),
    makeConversationRun("run-4", 2),
    makeConversationRun("run-5", 2),
    makeConversationRun("run-6", 2),
  ];
  const report = buildVerifyConsistencyReport(runs);
  assertEquals(report.sampleSize, 6);
  assertEquals(report.verdict, "PASS");
  assertEquals(report.agreementRate, 1);
  assertEquals(report.scoreSpreadMax, 0);
  assertEquals(report.instabilityCount, 0);
});

Deno.test("buildVerifyConsistencyReport returns WARN when sample size is below minimum", () => {
  const runs = [
    makeConversationRun("run-1", 1),
    makeConversationRun("run-2", 1),
    makeConversationRun("run-3", 1),
  ];
  const report = buildVerifyConsistencyReport(runs);
  assertEquals(report.sampleSize, 3);
  assertEquals(report.verdict, "WARN");
});

Deno.test("buildVerifyConsistencyReport returns FAIL for unstable pass/fail flips", () => {
  const runs = [
    makeTurnsRun("run-1", [{
      score: 2,
      index: 0,
      messageRefId: "assistant-1",
    }]),
    makeTurnsRun("run-2", [{
      score: 2,
      index: 0,
      messageRefId: "assistant-1",
    }]),
    makeTurnsRun("run-3", [{
      score: -1,
      index: 0,
      messageRefId: "assistant-1",
    }]),
    makeTurnsRun("run-4", [{
      score: -2,
      index: 0,
      messageRefId: "assistant-1",
    }]),
    makeTurnsRun("run-5", [{
      score: 2,
      index: 0,
      messageRefId: "assistant-1",
    }]),
    makeTurnsRun("run-6", [{
      score: -2,
      index: 0,
      messageRefId: "assistant-1",
    }]),
  ];
  const report = buildVerifyConsistencyReport(runs);
  assertEquals(report.sampleSize, 6);
  assertEquals(report.verdict, "FAIL");
  assertEquals(report.outliers[0]?.passFlip, true);
  assertEquals(report.outliers[0]?.instability, true);
});
