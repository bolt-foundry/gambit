import type { Frame, Page } from "playwright-core";

export type DemoPaths = {
  artifactRoot: string;
  rootDir: string;
  latestDir: string;
  logsDir: string;
  screenshotsDir: string;
  framesDir: string;
  slug: string;
};

export type DemoCookie = {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  partitionKey?: string;
};

export type DemoScenarioContext = {
  baseUrl: string;
  demoTarget: Page | Frame;
  page: Page;
  screenshotsDir: string;
  useIframeShell: boolean;
  wait: (ms: number) => Promise<void>;
  screenshot: (label: string) => Promise<string>;
};
