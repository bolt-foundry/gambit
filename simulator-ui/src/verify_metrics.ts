export type VerifyVerdict = "PASS" | "WARN" | "FAIL";

export type VerifyCalibrationRun = {
  id: string;
  status: "running" | "completed" | "error";
  runAt?: string;
  result?: unknown;
};

type VerifyExamplePoint = {
  runId: string;
  runAt?: string;
  score?: number;
  pass?: boolean;
  reason?: string;
  turnIndex?: number;
  messageRefId?: string;
};

type VerifyExampleBucket = {
  key: string;
  label: string;
  points: Array<VerifyExamplePoint>;
};

export type VerifyOutlier = {
  key: string;
  label: string;
  sampleSize: number;
  agreementRate: number | null;
  scoreDelta: number | null;
  passFlip: boolean;
  instability: boolean;
  minScore: number | null;
  maxScore: number | null;
  minRunId?: string;
  maxRunId?: string;
  turnIndex?: number;
  messageRefId?: string;
};

export type VerifyConsistencyReport = {
  sampleSize: number;
  comparableExampleCount: number;
  agreementRate: number | null;
  scoreSpreadMin: number | null;
  scoreSpreadMedian: number | null;
  scoreSpreadMax: number | null;
  instabilityCount: number;
  verdict: VerifyVerdict;
  verdictReason: string;
  outliers: Array<VerifyOutlier>;
};

export const VERIFY_CONSISTENCY_THRESHOLDS = {
  minSampleSize: 6,
  instabilityScoreDelta: 1.5,
  pass: {
    agreementMin: 0.9,
    maxSpread: 1,
    maxInstabilityCount: 0,
  },
  warn: {
    agreementMin: 0.75,
    maxSpread: 2,
    maxInstabilityCount: 2,
  },
} as const;

const pickPayload = (result: unknown): Record<string, unknown> => {
  if (!result || typeof result !== "object") return {};
  const record = result as Record<string, unknown>;
  if (
    record.payload &&
    typeof record.payload === "object" &&
    !Array.isArray(record.payload)
  ) {
    return record.payload as Record<string, unknown>;
  }
  return record;
};

const extractScoreReasonPass = (result: unknown): {
  score?: number;
  reason?: string;
  pass?: boolean;
} => {
  const payload = pickPayload(result);
  const score =
    typeof payload.score === "number" && Number.isFinite(payload.score)
      ? payload.score
      : undefined;
  const reason = typeof payload.reason === "string"
    ? payload.reason
    : undefined;
  if (typeof payload.pass === "boolean") {
    return { score, reason, pass: payload.pass };
  }
  if (typeof payload.passed === "boolean") {
    return { score, reason, pass: payload.passed };
  }
  if (typeof payload.verdict === "string") {
    const verdict = payload.verdict.trim().toLowerCase();
    if (verdict === "pass") return { score, reason, pass: true };
    if (verdict === "fail") return { score, reason, pass: false };
  }
  if (typeof score === "number") {
    return { score, reason, pass: score >= 0 };
  }
  return { score, reason };
};

const flattenRunExamples = (
  run: VerifyCalibrationRun,
): Array<VerifyExampleBucket> => {
  if (!run.result || typeof run.result !== "object") return [];
  const record = run.result as Record<string, unknown>;
  if (record.mode === "turns" && Array.isArray(record.turns)) {
    const buckets: Array<VerifyExampleBucket> = [];
    record.turns.forEach((turn, fallbackIndex) => {
      if (!turn || typeof turn !== "object") return;
      const turnRecord = turn as Record<string, unknown>;
      const index = typeof turnRecord.index === "number" &&
          Number.isFinite(turnRecord.index)
        ? Math.max(0, Math.round(turnRecord.index))
        : fallbackIndex;
      const messageRefId = typeof turnRecord.messageRefId === "string" &&
          turnRecord.messageRefId.trim().length > 0
        ? turnRecord.messageRefId
        : undefined;
      const key = messageRefId ? `ref:${messageRefId}` : `turn:${index}`;
      const label = `Assistant turn ${fallbackIndex + 1}`;
      const parsed = extractScoreReasonPass(turnRecord.result);
      buckets.push({
        key,
        label,
        points: [{
          runId: run.id,
          runAt: run.runAt,
          score: parsed.score,
          pass: parsed.pass,
          reason: parsed.reason,
          turnIndex: index,
          messageRefId,
        }],
      });
    });
    return buckets;
  }
  const parsed = extractScoreReasonPass(run.result);
  return [{
    key: "conversation",
    label: "Conversation score",
    points: [{
      runId: run.id,
      runAt: run.runAt,
      score: parsed.score,
      pass: parsed.pass,
      reason: parsed.reason,
    }],
  }];
};

const median = (values: Array<number>): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

const resolveVerdict = (input: {
  sampleSize: number;
  agreementRate: number | null;
  spreadMax: number | null;
  instabilityCount: number;
}): { verdict: VerifyVerdict; reason: string } => {
  const t = VERIFY_CONSISTENCY_THRESHOLDS;
  if (input.sampleSize < t.minSampleSize) {
    return {
      verdict: "WARN",
      reason:
        `Need at least ${t.minSampleSize} samples before issuing a firm verdict.`,
    };
  }
  if (input.agreementRate === null) {
    return {
      verdict: "WARN",
      reason: "No comparable pass/fail evidence was found in the sampled runs.",
    };
  }
  const spreadMax = input.spreadMax ?? 0;
  if (
    input.agreementRate >= t.pass.agreementMin &&
    spreadMax <= t.pass.maxSpread &&
    input.instabilityCount <= t.pass.maxInstabilityCount
  ) {
    return {
      verdict: "PASS",
      reason: "Agreement, spread, and instability all meet PASS thresholds.",
    };
  }
  if (
    input.agreementRate >= t.warn.agreementMin &&
    spreadMax <= t.warn.maxSpread &&
    input.instabilityCount <= t.warn.maxInstabilityCount
  ) {
    return {
      verdict: "WARN",
      reason:
        "Some variation was detected, but results remain within WARN thresholds.",
    };
  }
  return {
    verdict: "FAIL",
    reason: "Agreement/spread instability exceeds WARN thresholds.",
  };
};

export function buildVerifyConsistencyReport(
  runs: Array<VerifyCalibrationRun>,
): VerifyConsistencyReport {
  const completedRuns = runs.filter((run) => run.status === "completed");
  const sampleSize = completedRuns.length;
  const bucketsByKey = new Map<string, VerifyExampleBucket>();

  completedRuns.forEach((run) => {
    flattenRunExamples(run).forEach((entry) => {
      const existing = bucketsByKey.get(entry.key);
      if (!existing) {
        bucketsByKey.set(entry.key, {
          key: entry.key,
          label: entry.label,
          points: [...entry.points],
        });
        return;
      }
      existing.points.push(...entry.points);
    });
  });

  const outliers: Array<VerifyOutlier> = [];
  let agreementVotes = 0;
  let agreementTotal = 0;
  const scoreDeltas: Array<number> = [];

  bucketsByKey.forEach((bucket) => {
    const scores = bucket.points
      .map((point) => point.score)
      .filter((score): score is number =>
        typeof score === "number" && Number.isFinite(score)
      );
    const minScore = scores.length ? Math.min(...scores) : null;
    const maxScore = scores.length ? Math.max(...scores) : null;
    const scoreDelta = minScore !== null && maxScore !== null
      ? round2(maxScore - minScore)
      : null;

    const passVotes = bucket.points
      .map((point) => point.pass)
      .filter((pass): pass is boolean => typeof pass === "boolean");
    const passCount = passVotes.filter((value) => value).length;
    const failCount = passVotes.length - passCount;
    const agreementRate = passVotes.length > 0
      ? round2(Math.max(passCount, failCount) / passVotes.length)
      : null;

    if (passVotes.length > 0) {
      agreementVotes += Math.max(passCount, failCount);
      agreementTotal += passVotes.length;
    }

    if (scoreDelta !== null) {
      scoreDeltas.push(scoreDelta);
    }

    const passFlip = passCount > 0 && failCount > 0;
    const instability = passFlip ||
      (scoreDelta !== null &&
        scoreDelta > VERIFY_CONSISTENCY_THRESHOLDS.instabilityScoreDelta);

    const minPoint = minScore === null
      ? undefined
      : bucket.points.find((point) => point.score === minScore);
    const maxPoint = maxScore === null
      ? undefined
      : bucket.points.find((point) => point.score === maxScore);

    outliers.push({
      key: bucket.key,
      label: bucket.label,
      sampleSize: bucket.points.length,
      agreementRate,
      scoreDelta,
      passFlip,
      instability,
      minScore,
      maxScore,
      minRunId: minPoint?.runId,
      maxRunId: maxPoint?.runId,
      turnIndex: maxPoint?.turnIndex ?? minPoint?.turnIndex,
      messageRefId: maxPoint?.messageRefId ?? minPoint?.messageRefId,
    });
  });

  outliers.sort((a, b) => {
    if (a.instability !== b.instability) return a.instability ? -1 : 1;
    if (a.passFlip !== b.passFlip) return a.passFlip ? -1 : 1;
    const aDelta = a.scoreDelta ?? -1;
    const bDelta = b.scoreDelta ?? -1;
    if (aDelta !== bDelta) return bDelta - aDelta;
    if (a.sampleSize !== b.sampleSize) return b.sampleSize - a.sampleSize;
    return a.label.localeCompare(b.label);
  });

  const agreementRate = agreementTotal > 0
    ? round2(agreementVotes / agreementTotal)
    : null;
  const scoreSpreadMin = scoreDeltas.length ? Math.min(...scoreDeltas) : null;
  const scoreSpreadMax = scoreDeltas.length ? Math.max(...scoreDeltas) : null;
  const scoreSpreadMedian = median(scoreDeltas);
  const instabilityCount = outliers.filter((entry) => entry.instability).length;
  const verdict = resolveVerdict({
    sampleSize,
    agreementRate,
    spreadMax: scoreSpreadMax,
    instabilityCount,
  });

  return {
    sampleSize,
    comparableExampleCount: outliers.length,
    agreementRate,
    scoreSpreadMin: scoreSpreadMin === null ? null : round2(scoreSpreadMin),
    scoreSpreadMedian: scoreSpreadMedian === null
      ? null
      : round2(scoreSpreadMedian),
    scoreSpreadMax: scoreSpreadMax === null ? null : round2(scoreSpreadMax),
    instabilityCount,
    verdict: verdict.verdict,
    verdictReason: verdict.reason,
    outliers,
  };
}
