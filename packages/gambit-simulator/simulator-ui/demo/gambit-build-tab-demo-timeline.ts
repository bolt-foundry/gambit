import type { DemoTimelineStep } from "./gambit-ui-demo-timeline.ts";

export function buildTabDemoTimeline(opts: {
  userPrompts: Array<string>;
  scenarioLabels?: Array<string>;
}): DemoTimelineStep[] {
  const beatOpenBuild: DemoTimelineStep[] = [
    { type: "wait-for", selector: '[data-testid="nav-build"]' },
    { type: "click", selector: '[data-testid="nav-build"]' },
    { type: "wait-for", selector: '[data-testid="build-chat-input"]' },
    { type: "wait", ms: 400 },
    { type: "screenshot", label: "02-build-layout-50-50" },
  ];

  const prompts = opts.userPrompts.filter((prompt) => prompt.trim().length > 0);
  if (prompts.length === 0) {
    throw new Error("Build tab demo requires at least one user prompt.");
  }

  const beatPrompt: DemoTimelineStep[] = [];
  prompts.forEach((prompt, index) => {
    const isFirst = index === 0;
    const isLast = index === prompts.length - 1;
    beatPrompt.push(
      { type: "click", selector: '[data-testid="build-chat-input"]' },
      {
        type: "type",
        selector: '[data-testid="build-chat-input"]',
        text: prompt,
        clear: true,
        delayMs: 25,
      },
      { type: "wait", ms: 300 },
      {
        type: "click",
        selector: isFirst
          ? '[data-testid="build-start"]'
          : '[data-testid="build-send"]',
      },
    );
    if (!isLast) {
      beatPrompt.push({
        type: "wait-for",
        selector: '[data-testid="build-chat-input"]:not([disabled])',
        timeoutMs: 120_000,
      });
    }
  });
  beatPrompt.push(
    { type: "wait-for", selector: ".build-files-preview-header" },
    {
      type: "click",
      selector: ".build-files-preview-selector .gds-listbox-trigger",
    },
    { type: "wait-for", selector: ".gds-listbox-popover" },
    { type: "wait", ms: 200 },
    { type: "screenshot", label: "03-build-file-selector" },
    {
      type: "click",
      selector:
        '.gds-listbox-option:has-text("PROMPT.md"):not(:has(.gds-listbox-option-meta))',
    },
    {
      type: "wait-for",
      selector: ".build-files-preview-header",
      text: "PROMPT.md",
    },
    { type: "wait-for", selector: ".build-file-preview" },
    { type: "wait", ms: 200 },
    { type: "screenshot", label: "03-build-file-root" },
    {
      type: "click",
      selector: ".build-files-preview-selector .gds-listbox-trigger",
    },
    { type: "wait-for", selector: ".gds-listbox-popover" },
    { type: "click", selector: '.gds-listbox-option:has-text("INTENT.md")' },
    {
      type: "wait-for",
      selector: ".build-files-preview-header",
      text: "INTENT.md",
    },
    { type: "wait-for", selector: ".build-file-preview" },
    { type: "wait", ms: 200 },
    { type: "screenshot", label: "03-build-file-intent" },
    {
      type: "click",
      selector: ".build-files-preview-selector .gds-listbox-trigger",
    },
    { type: "wait-for", selector: ".gds-listbox-popover" },
    { type: "click", selector: '.gds-listbox-option:has-text("POLICY.md")' },
    {
      type: "wait-for",
      selector: ".build-files-preview-header",
      text: "POLICY.md",
    },
    { type: "wait-for", selector: ".build-file-preview" },
    { type: "wait", ms: 200 },
    { type: "screenshot", label: "03-build-file-policy" },
    {
      type: "wait-for",
      selector: '[data-testid="build-chat-input"]:not([disabled])',
      timeoutMs: 120_000,
    },
    { type: "wait", ms: 500 },
    { type: "screenshot", label: "02-build-start" },
  );

  const beatCheckTabs: DemoTimelineStep[] = [];
  beatCheckTabs.push(
    { type: "click", selector: '[data-testid="nav-test"]' },
    { type: "wait-for", selector: '[data-testid="testbot-run"]' },
    { type: "wait", ms: 400 },
    { type: "screenshot", label: "04-test-tab" },
  );
  const scenarioLabels = (opts.scenarioLabels ?? []).filter((label) =>
    label.trim().length > 0
  );
  if (scenarioLabels.length > 0) {
    scenarioLabels.forEach((label, index) => {
      beatCheckTabs.push(
        { type: "click", selector: ".gds-listbox-trigger" },
        { type: "wait-for", selector: ".gds-listbox-popover" },
        { type: "click", text: label },
        { type: "wait", ms: 200 },
        { type: "click", selector: '[data-testid="testbot-run"]' },
        {
          type: "wait-for",
          selector: '[data-testid="testbot-status"]',
          text: "Completed",
          timeoutMs: 180_000,
        },
        { type: "wait", ms: 200 },
        { type: "screenshot", label: `04-test-run-${index + 1}` },
      );
    });
  }
  beatCheckTabs.push(
    { type: "click", selector: '[data-testid="nav-grade"]' },
    { type: "wait-for", text: "Run a grader" },
    { type: "wait", ms: 400 },
    { type: "screenshot", label: "05-grade-tab" },
    { type: "click", selector: '[data-testid="nav-build"]' },
    { type: "wait-for", selector: '[data-testid="build-chat-input"]' },
    { type: "wait", ms: 400 },
    { type: "screenshot", label: "06-build-tab-return" },
  );

  return [
    ...beatOpenBuild,
    ...beatPrompt,
    ...beatCheckTabs,
  ];
}
