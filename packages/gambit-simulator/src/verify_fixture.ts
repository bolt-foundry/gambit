import * as path from "@std/path";
import { ensureDir } from "@std/fs";
import { parse as parseToml } from "@std/toml";
import { defaultSessionRoot } from "@bolt-foundry/gambit/src/cli_utils.ts";
import { WORKSPACE_STATE_SCHEMA_VERSION } from "./workspace_routes.ts";
import type { GradingRunRecord } from "./server_types.ts";
import { saveCanonicalWorkspaceState } from "@bolt-foundry/gambit/src/workspace_sqlite.ts";
import type { SavedState } from "@bolt-foundry/gambit-core";

type VerifyFixtureKind = "stable" | "borderline" | "inconsistent";

type VerifyFixtureScenario = {
  kind: VerifyFixtureKind;
  scenarioRunId: string;
  label: string;
  scoresByRun: Array<[number, number]>;
};

type ParsedGrader = {
  id: string;
  label: string;
  path: string;
};

export type SeedVerifyFixtureOptions = {
  deckPath?: string;
  sessionsRoot?: string;
  workspaceId?: string;
  now?: Date;
};

export type SeedVerifyFixtureResult = {
  workspaceId: string;
  workspaceDir: string;
  sqlitePath: string;
  deckPath: string;
  graderId: string;
  runCount: number;
};

const DEFAULT_WORKSPACE_ID = "verify-fixture";
const DEFAULT_DECK_PATH = path.resolve(
  path.dirname(path.fromFileUrl(import.meta.url)),
  "..",
  "..",
  "..",
  "src",
  "decks",
  "gambit-bot",
  "PROMPT.md",
);

const FIXTURE_SCENARIOS: Array<VerifyFixtureScenario> = [
  {
    kind: "stable",
    scenarioRunId: "verify-fixture-stable",
    label: "Verify fixture stable",
    scoresByRun: [
      [2, 2],
      [2, 2],
      [2, 1],
      [2, 2],
      [2, 2],
      [2, 1],
      [2, 2],
      [2, 2],
    ],
  },
  {
    kind: "borderline",
    scenarioRunId: "verify-fixture-borderline",
    label: "Verify fixture borderline",
    scoresByRun: [
      [1, 0],
      [1, 1],
      [0, 1],
      [1, 0],
      [1, 1],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
  },
  {
    kind: "inconsistent",
    scenarioRunId: "verify-fixture-inconsistent",
    label: "Verify fixture inconsistent",
    scoresByRun: [
      [2, -2],
      [-1, 2],
      [2, -2],
      [-2, 2],
      [1, -1],
      [-2, 2],
      [2, -2],
      [-1, 1],
    ],
  },
];

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "") || "grader";

const parseTomlFrontmatter = (raw: string): Record<string, unknown> | null => {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "+++") return null;
  const endIndex = lines.findIndex((line, index) =>
    index > 0 && line.trim() === "+++"
  );
  if (endIndex <= 0) return null;
  const frontmatter = lines.slice(1, endIndex).join("\n");
  const parsed = parseToml(frontmatter);
  return parsed && typeof parsed === "object"
    ? parsed as Record<string, unknown>
    : null;
};

const parseGradersFromDeck = async (
  deckPath: string,
): Promise<Array<ParsedGrader>> => {
  const contents = await Deno.readTextFile(deckPath);
  const parsed = parseTomlFrontmatter(contents);
  const rawGraders = parsed?.graders;
  if (!Array.isArray(rawGraders)) return [];
  const deckDir = path.dirname(deckPath);
  return rawGraders
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const grader = entry as Record<string, unknown>;
      const rawPath = typeof grader.path === "string" ? grader.path : undefined;
      const rawLabel = typeof grader.label === "string"
        ? grader.label
        : rawPath
        ? path.basename(rawPath)
        : `grader-${index + 1}`;
      if (!rawPath) return null;
      const resolvedPath = path.isAbsolute(rawPath)
        ? rawPath
        : path.resolve(deckDir, rawPath);
      const id = typeof grader.id === "string" && grader.id.trim().length > 0
        ? grader.id.trim()
        : slugify(`${rawLabel}-${index}`);
      return {
        id,
        label: rawLabel,
        path: resolvedPath,
      };
    })
    .filter((entry): entry is ParsedGrader => Boolean(entry));
};

const buildTurnReason = (
  kind: VerifyFixtureKind,
  turn: number,
) => {
  if (kind === "stable") {
    return turn === 1
      ? "Consistent acknowledgment and request capture."
      : "Consistent follow-up and clear next step.";
  }
  if (kind === "borderline") {
    return turn === 1
      ? "Mostly aligned but missing one expected detail."
      : "Adequate answer with minor inconsistency.";
  }
  return turn === 1
    ? "Inconsistent extraction of the primary user request."
    : "Pass/fail flips across repeated runs.";
};

const buildScenarioSummary = (
  scenario: VerifyFixtureScenario,
  updatedAt: string,
) => ({
  scenarioRunId: scenario.scenarioRunId,
  lastEventSeq: scenario.scoresByRun.length,
  updatedAt,
  selectedScenarioDeckId: scenario.scenarioRunId,
  selectedScenarioDeckLabel: scenario.label,
  scenarioConfigPath: `fixtures/${scenario.kind}/scenario.deck.md`,
});

const buildFixtureRuns = (
  opts: {
    workspaceId: string;
    grader: ParsedGrader;
    createdAt: Date;
  },
): Array<GradingRunRecord> => {
  const runs: Array<GradingRunRecord> = [];
  let offsetMinutes = 0;
  for (const scenario of FIXTURE_SCENARIOS) {
    scenario.scoresByRun.forEach((scores, runIndex) => {
      const runAt = new Date(opts.createdAt.getTime() + offsetMinutes * 60_000)
        .toISOString();
      offsetMinutes += 1;
      const runId = [
        opts.workspaceId,
        "verify",
        scenario.kind,
        String(runIndex + 1).padStart(2, "0"),
      ].join("-");
      const turnOneScore = scores[0];
      const turnTwoScore = scores[1];
      const turnOneMessage = "I can help. Please share your order number.";
      const turnTwoMessage =
        "Thanks. I captured the issue and will follow up shortly.";
      const turnOneRefId = `${scenario.scenarioRunId}:assistant:1`;
      const turnTwoRefId = `${scenario.scenarioRunId}:assistant:2`;
      const sessionMessages = [
        { role: "user", content: "Hi, my order has a shipping delay." },
        { role: "assistant", content: turnOneMessage },
        { role: "user", content: "Order 1234 has been stuck for two days." },
        { role: "assistant", content: turnTwoMessage },
      ];
      runs.push({
        id: runId,
        workspaceId: opts.workspaceId,
        gradingRunId: runId,
        graderId: opts.grader.id,
        graderPath: opts.grader.path,
        graderLabel: opts.grader.label,
        status: "completed",
        runAt,
        input: {
          session: {
            messages: sessionMessages,
            meta: {
              scenarioRunId: scenario.scenarioRunId,
              testBotRunId: scenario.scenarioRunId,
            },
          },
        },
        result: {
          mode: "turns",
          totalTurns: 2,
          turns: [
            {
              index: 1,
              gradingRunId: runId,
              artifactRevisionId: `${runId}-rev-1`,
              messageRefId: turnOneRefId,
              message: { role: "assistant", content: turnOneMessage },
              input: {
                session: {
                  messages: sessionMessages.slice(0, 2),
                  meta: {
                    scenarioRunId: scenario.scenarioRunId,
                    testBotRunId: scenario.scenarioRunId,
                  },
                },
                messageToGrade: { role: "assistant", content: turnOneMessage },
              },
              result: {
                payload: {
                  score: turnOneScore,
                  reason: buildTurnReason(scenario.kind, 1),
                },
              },
            },
            {
              index: 3,
              gradingRunId: runId,
              artifactRevisionId: `${runId}-rev-2`,
              messageRefId: turnTwoRefId,
              message: { role: "assistant", content: turnTwoMessage },
              input: {
                session: {
                  messages: sessionMessages,
                  meta: {
                    scenarioRunId: scenario.scenarioRunId,
                    testBotRunId: scenario.scenarioRunId,
                  },
                },
                messageToGrade: { role: "assistant", content: turnTwoMessage },
              },
              result: {
                payload: {
                  score: turnTwoScore,
                  reason: buildTurnReason(scenario.kind, 2),
                },
              },
            },
          ],
        },
      });
    });
  }
  return runs;
};

const resolveGrader = async (deckPath: string): Promise<ParsedGrader> => {
  const graders = await parseGradersFromDeck(deckPath);
  if (graders.length > 0) return graders[0];
  return {
    id: "verify-fixture-grader-0",
    label: "Verify fixture grader",
    path: deckPath,
  };
};

export async function seedVerifyFixture(
  opts?: SeedVerifyFixtureOptions,
): Promise<SeedVerifyFixtureResult> {
  const deckPath = path.resolve(opts?.deckPath ?? DEFAULT_DECK_PATH);
  const sessionsRoot = path.resolve(
    opts?.sessionsRoot ?? defaultSessionRoot(deckPath),
  );
  const workspaceId = opts?.workspaceId?.trim() || DEFAULT_WORKSPACE_ID;
  const createdAt = opts?.now ?? new Date();
  const grader = await resolveGrader(deckPath);
  const runs = buildFixtureRuns({
    workspaceId,
    grader,
    createdAt,
  });
  const latestUpdatedAt = runs.at(-1)?.runAt ?? createdAt.toISOString();
  const workspaceDir = path.join(sessionsRoot, workspaceId);
  const sqlitePath = path.join(workspaceDir, "workspace.sqlite");

  await ensureDir(workspaceDir);

  const scenarioSummaries = FIXTURE_SCENARIOS.map((scenario) =>
    buildScenarioSummary(scenario, latestUpdatedAt)
  );

  const state: SavedState = {
    runId: workspaceId,
    messages: [
      {
        role: "user",
        content: "Please summarize status for order 1234.",
      },
      {
        role: "assistant",
        content: "I can help. Please share your order number.",
      },
      {
        role: "user",
        content: "Order 1234 is delayed and I need an update.",
      },
      {
        role: "assistant",
        content: "Thanks. I captured the issue and will follow up shortly.",
      },
    ],
    messageRefs: [
      { id: "verify:user:1", role: "user" },
      { id: "verify:assistant:1", role: "assistant", source: "scenario" },
      { id: "verify:user:2", role: "user" },
      { id: "verify:assistant:2", role: "assistant", source: "scenario" },
    ],
    traces: [],
    feedback: [],
    meta: {
      workspaceSchemaVersion: WORKSPACE_STATE_SCHEMA_VERSION,
      workspaceId,
      workspaceRootDeckPath: deckPath,
      workspaceRootDir: path.dirname(deckPath),
      workspaceCreatedAt: createdAt.toISOString(),
      sessionCreatedAt: createdAt.toISOString(),
      sessionId: workspaceId,
      deck: deckPath,
      deckSlug: slugify(path.basename(deckPath).replace(/\.[^.]+$/, "")),
      scenarioRunId:
        FIXTURE_SCENARIOS[FIXTURE_SCENARIOS.length - 1].scenarioRunId,
      testBotRunId:
        FIXTURE_SCENARIOS[FIXTURE_SCENARIOS.length - 1].scenarioRunId,
      scenarioRunSummary: scenarioSummaries[scenarioSummaries.length - 1],
      scenarioRunSummaries: scenarioSummaries,
      gradingRuns: runs,
      gradingFlags: [],
      verifyFixtureSeededAt: new Date().toISOString(),
    },
  };

  saveCanonicalWorkspaceState(sqlitePath, state);

  return {
    workspaceId,
    workspaceDir,
    sqlitePath,
    deckPath,
    graderId: grader.id,
    runCount: runs.length,
  };
}
