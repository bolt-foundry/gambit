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

export const demoTimeline: DemoTimelineStep[] = [
  { type: "wait", ms: 5_000 },
  {
    type: "voiceover",
    text:
      "This docs tab anchors the Gambit Build, Run, Verify story and shows the live deck path.",
    showSubtitles: true,
  },
  {
    type: "voiceover",
    text:
      "We jump to Test Bot from here to see the workflow streaming in real time.",
    showSubtitles: true,
  },
  { type: "click", selector: '[data-testid="nav-test-bot"]' },
  { type: "wait", ms: 1_000 },
  { type: "click", selector: ".test-bot-sidebar select" },
  {
    type: "type",
    selector: ".test-bot-sidebar select",
    text: "New patient intake",
  },
  {
    type: "type",
    selector: '.init-field:has-text("scenarioDescription") input',
    text:
      "Caller wants to book a first visit next week, prefers Monday or Thursday mornings, has Blue Cross PPO, and will share name, DOB, and callback when asked.",
  },
  {
    type: "type",
    selector: '.init-field:has-text("callerName") input',
    text: "Avery Blake",
  },
  {
    type: "type",
    selector: '.init-field:has-text("dob") input',
    text: "1992-08-12",
  },
  { type: "click", selector: '[data-testid="testbot-run"]' },
  { type: "wait", ms: 900 },
  { type: "zoom", selector: '[data-testid="testbot-run"]' },
  { type: "wait", ms: 900 },
  { type: "zoom-reset" },
  { type: "wait", ms: 1200 },
  { type: "click", selector: '[data-testid="nav-calibrate"]' },
  { type: "wait", ms: 900 },
  { type: "click", selector: '[data-testid="nav-debug"]' },
  { type: "wait", ms: 600 },
  { type: "scroll", y: 9999 },
];
