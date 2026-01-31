/**
 * Gambit UI demo timeline used by the demo-runner automation inside bfmono.
 *
 * How to run:
 * - From repo root: `deno task demo:ui-video` with `cwd=packages/demo-runner`.
 * - This is executed by `packages/demo-runner/src/run-gambit-demo.ts`, which loads `demoTimeline`.
 *
 * Outputs:
 * - Artifacts are written to `../shared/bft-e2e/gambit-ui-demo/__latest__` by default.
 *
 * Controls:
 * - Most knobs are environment variables defined in `packages/demo-runner/src/config.ts`
 *   (e.g., host bridge, ports, viewport/content sizing, recording flags).
 *
 * Authoring tips:
 * - Steps are executed sequentially. `voiceover` blocks by default; set `blocking: false`
 *   to overlap narration with UI actions.
 * - If you add UI actions, keep them close to the related voiceover beat so the story stays in sync.
 */
export type DemoTimelineStep =
  | {
    type: "subtitle";
    text: string;
    durationMs?: number;
  }
  | {
    type: "voiceover";
    text: string;
    rate?: number;
    pitch?: number;
    lang?: string;
    voiceName?: string;
    showSubtitles?: boolean;
    blocking?: boolean;
  }
  | {
    type: "wait";
    ms: number;
  }
  | {
    type: "click";
    selector?: string;
    text?: string;
    move?: boolean;
  }
  | {
    type: "type";
    selector: string;
    text: string;
    clear?: boolean;
    delayMs?: number;
  }
  | {
    type: "scroll";
    selector?: string;
    y?: number;
  }
  | {
    type: "zoom";
    selector: string;
    durationMs?: number;
    padding?: number;
    maxScale?: number;
  }
  | {
    type: "zoom-reset";
    durationMs?: number;
  };

/** Beat 1: Welcome + definition (Gambit is a framework for building LLM workflows in Markdown and code). */
const beatWelcome: DemoTimelineStep[] = [
  {
    type: "voiceover",
    text:
      "Gambit is a framework for building LLM workflows in Markdown and code, then running, debugging, and fixing them.",
    showSubtitles: true,
  },
];

/** Beat 2: Core story + pillars (Build, Run, Verify) and "workflows feel like software." */
const beatPillars: DemoTimelineStep[] = [
  {
    type: "voiceover",
    text:
      "Gambit makes workflows feel like software. You build steps, run them locally, and verify results with test runs and graders.",
    showSubtitles: true,
  },
];

/** Beat 3: Set the scenario (introduce the deck + real intake case). */
const beatScenario: DemoTimelineStep[] = [
  {
    type: "voiceover",
    text:
      "Let’s look at one of our example bots: a front-desk voice assistant for a medical practice.",
    showSubtitles: true,
  },
  {
    type: "voiceover",
    text:
      "It’s set up to handle scenarios like new patient intake, reschedules, billing questions, and results inquiries, and if it can’t help, it offers to log a callback for staff.",
    showSubtitles: true,
  },
  {
    type: "voiceover",
    text:
      "The bot takes a typed input schema, so we’ll fill in a concrete FAQ-first scenario about Sunday hours and let the test bot play it out.",
    showSubtitles: true,
  },
];

/** Beat 4: Run + inspect (Test Bot simulates and produces a reproducible session). */
const beatRunInspect: DemoTimelineStep[] = [
  // Demo note: temporarily drop the tool-backed response guardrail and add a "hallucinate wildly" card
  // to force a FAQ hallucination. Then add a grader to flag it, and restore the guardrail to fix.
  {
    type: "voiceover",
    text:
      "We’ll simulate a patient call with a test bot and watch the workflow run end to end as it streams.",
    showSubtitles: true,
  },
  {
    type: "voiceover",
    text:
      "Here we’re going to trigger a deliberate failure: the patient asks about Sunday hours and the assistant invents a confident answer that isn’t backed by tools or docs.",
    showSubtitles: true,
  },
];

/** Beat 5: Verify (Calibrate shows grader score + evidence). */
const beatVerify: DemoTimelineStep[] = [
  {
    type: "voiceover",
    text:
      "We don’t want this to happen in production, so we’ll start by adding a grader to catch it.",
    showSubtitles: true,
  },
  {
    type: "voiceover",
    text:
      "Once the grader exists, we can wire it into CI and stop this from slipping into the future.",
    showSubtitles: true,
  },
  {
    type: "voiceover",
    text:
      "Now we run the grader, and it flags the response because the FAQ only lists weekday hours and says nothing about Sunday.",
    showSubtitles: true,
  },
];

/** Beat 6: Debug (trace the run to see what happened). */
const beatDebug: DemoTimelineStep[] = [
  {
    type: "voiceover",
    text:
      "With the failed run in hand, we open the trace to see why it happened.",
    showSubtitles: true,
  },
  {
    type: "voiceover",
    text:
      "Engineers can follow the full execution and see which steps produced each part of the conversation.",
    showSubtitles: true,
  },
  {
    type: "voiceover",
    text:
      "Now, let’s go back and update the bot: remove what made it hallucinate, and add a guardrail to prevent hallucinations more generally.",
    showSubtitles: true,
  },
  {
    type: "voiceover",
    text:
      "Then we’ll run the test bot again and rerun the grader to confirm the fix.",
    showSubtitles: true,
  },
  {
    type: "voiceover",
    text: "This time the run stays grounded, and the grader passes.",
    showSubtitles: true,
  },
];

/** Beat 7: Close (end-to-end fix and prevention). */
const beatClose: DemoTimelineStep[] = [
  {
    type: "voiceover",
    text:
      "Gambit’s aim is to make that loop as consistent and quick as possible so you can confidently ship production-grade LLM applications.",
    showSubtitles: true,
  },
  {
    type: "voiceover",
    text:
      "So hopefully you’ve seen how you can execute a bot, fix it, and make sure it doesn’t break in the future.",
    showSubtitles: true,
  },
  {
    type: "voiceover",
    text: "For more on Gambit, check out our GitHub, or visit moltfoundry.com.",
    showSubtitles: true,
  },
];

export const demoTimeline: DemoTimelineStep[] = [
  ...beatWelcome,
  ...beatPillars,
  ...beatScenario,
  ...beatRunInspect,
  ...beatVerify,
  ...beatDebug,
  ...beatClose,
];
