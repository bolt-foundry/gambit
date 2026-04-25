import * as path from "@std/path";
import { runTimelineSteps } from "./automation/timeline.ts";
import type { BrowserGraphqlMockOptions } from "./graphqlMocks.ts";
import { getDemoPaths, prepareDemoPaths, runDemo } from "./runner.ts";
import type { DemoPaths, DemoScenarioContext } from "./runnerTypes.ts";

export type BrowserRuntimeMode = "demo" | "test" | "live";
export type BrowserLaunchProvider =
  | "host-bridge"
  | "local-system"
  | "playwright-managed";

export type BrowserRuntimeAuthoringStyle = "ordered-steps" | "direct-control";

export type BrowserRuntimeProfile = {
  mode: BrowserRuntimeMode;
  authoringStyles: ReadonlyArray<BrowserRuntimeAuthoringStyle>;
  browserProvider: BrowserLaunchProvider;
  useHostBridge: boolean;
  recordVideo: boolean;
  useMediaRecorder: boolean;
  chrome: boolean;
  subtitles: boolean;
  smoothMouse: boolean;
  smoothType: boolean;
  keepBrowserOpen: boolean;
  artifactLevel: "full" | "debug" | "operator";
  supportsBackgroundLiveControl: boolean;
};

export type BrowserRuntimeScenarioContext = DemoScenarioContext & {
  mode: BrowserRuntimeMode;
  profile: BrowserRuntimeProfile;
  artifacts: DemoPaths;
};

export type BrowserRuntimeScenario = (
  ctx: BrowserRuntimeScenarioContext,
) => Promise<void>;

export type BrowserTimelineStep = Parameters<
  typeof runTimelineSteps
>[1][number];

export type BrowserRuntimeEnvPatch = Record<string, string | undefined>;

const BROWSER_TEMP_ENV_KEYS = [
  "TMPDIR",
  "TMP",
  "TEMP",
  "TEMPDIR",
  "NIX_BUILD_TOP",
] as const;

export function usesNestedNixShellTempDir(raw?: string | null): boolean {
  if (!raw) return false;
  const matches = raw.match(/\/nix-shell\.[^/]+/g) ?? [];
  return matches.length >= 2;
}

function createSingleLevelNixShellTempDir(): string {
  const candidateDirs = [
    Deno.env.get("HOME") ? path.join(Deno.env.get("HOME")!, "tmp") : undefined,
    "/tmp",
  ].filter((value): value is string => Boolean(value));

  for (const dir of candidateDirs) {
    try {
      Deno.mkdirSync(dir, { recursive: true });
      return Deno.makeTempDirSync({
        dir,
        prefix: "nix-shell.",
      });
    } catch (error) {
      if (
        !(error instanceof Deno.errors.NotFound) &&
        !(error instanceof Deno.errors.PermissionDenied)
      ) {
        throw error;
      }
    }
  }

  return Deno.makeTempDirSync({
    prefix: "nix-shell.",
  });
}

export function getBrowserTempEnvPatch(): BrowserRuntimeEnvPatch {
  const currentValues = BROWSER_TEMP_ENV_KEYS.map((key) => Deno.env.get(key));
  if (!currentValues.some((value) => usesNestedNixShellTempDir(value))) {
    return {};
  }

  const tempDir = createSingleLevelNixShellTempDir();
  return Object.fromEntries(
    BROWSER_TEMP_ENV_KEYS.map((key) => [key, tempDir]),
  );
}

function parseBrowserProviderEnvOverride(): BrowserLaunchProvider | undefined {
  const raw = Deno.env.get("GAMBIT_BROWSER_PROVIDER")?.trim().toLowerCase();
  if (!raw) return undefined;
  if (
    raw === "host-bridge" || raw === "local-system" ||
    raw === "playwright-managed"
  ) {
    return raw;
  }
  return undefined;
}

function toBrowserProvider(
  input: BrowserLaunchProvider | boolean | undefined,
): BrowserLaunchProvider | undefined {
  if (typeof input === "string") return input;
  if (typeof input === "boolean") {
    return input ? "host-bridge" : "local-system";
  }
  return undefined;
}

function syncBrowserProvider(
  profile: BrowserRuntimeProfile,
  browserProvider: BrowserLaunchProvider,
): BrowserRuntimeProfile {
  return {
    ...profile,
    browserProvider,
    useHostBridge: browserProvider === "host-bridge",
  };
}

function parseBooleanEnvOverride(key: string): boolean | undefined {
  const raw = Deno.env.get(key)?.trim().toLowerCase();
  if (!raw) return undefined;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  return undefined;
}

function applyEnvironmentOverrides(
  profile: BrowserRuntimeProfile,
): BrowserRuntimeProfile {
  const browserProviderOverride = parseBrowserProviderEnvOverride();
  const useHostBridge = parseBooleanEnvOverride("GAMBIT_USE_HOST_BRIDGE");
  const recordVideo = parseBooleanEnvOverride("GAMBIT_E2E_RECORD_VIDEO") ??
    parseBooleanEnvOverride("BF_E2E_RECORD_VIDEO");
  const useMediaRecorder = parseBooleanEnvOverride("GAMBIT_DEMO_MEDIARECORDER");
  const keepBrowserOpen = parseBooleanEnvOverride("GAMBIT_DEMO_WAIT");
  const chrome = parseBooleanEnvOverride("GAMBIT_DEMO_CHROME");
  const subtitles = parseBooleanEnvOverride("GAMBIT_DEMO_SUBTITLES");
  const smoothMouse = parseBooleanEnvOverride("GAMBIT_DEMO_SMOOTH_MOUSE");
  const smoothType = parseBooleanEnvOverride("GAMBIT_DEMO_SMOOTH_TYPE");

  const browserProvider = browserProviderOverride ??
    toBrowserProvider(useHostBridge) ??
    profile.browserProvider;
  return syncBrowserProvider({
    ...profile,
    recordVideo: recordVideo ?? profile.recordVideo,
    useMediaRecorder: useMediaRecorder ?? profile.useMediaRecorder,
    keepBrowserOpen: keepBrowserOpen ?? profile.keepBrowserOpen,
    chrome: chrome ?? profile.chrome,
    subtitles: subtitles ?? profile.subtitles,
    smoothMouse: smoothMouse ?? profile.smoothMouse,
    smoothType: smoothType ?? profile.smoothType,
  }, browserProvider);
}

const BASE_PROFILES: Record<BrowserRuntimeMode, BrowserRuntimeProfile> = {
  demo: {
    mode: "demo",
    authoringStyles: ["ordered-steps", "direct-control"],
    browserProvider: "host-bridge",
    useHostBridge: true,
    recordVideo: true,
    useMediaRecorder: true,
    chrome: true,
    subtitles: true,
    smoothMouse: true,
    smoothType: true,
    keepBrowserOpen: false,
    artifactLevel: "full",
    supportsBackgroundLiveControl: false,
  },
  test: {
    mode: "test",
    authoringStyles: ["ordered-steps", "direct-control"],
    browserProvider: "host-bridge",
    useHostBridge: true,
    recordVideo: false,
    useMediaRecorder: true,
    chrome: false,
    subtitles: false,
    smoothMouse: false,
    smoothType: false,
    keepBrowserOpen: false,
    artifactLevel: "debug",
    supportsBackgroundLiveControl: false,
  },
  live: {
    mode: "live",
    authoringStyles: ["ordered-steps", "direct-control"],
    browserProvider: "host-bridge",
    useHostBridge: true,
    recordVideo: false,
    useMediaRecorder: false,
    chrome: true,
    subtitles: true,
    smoothMouse: true,
    smoothType: true,
    keepBrowserOpen: true,
    artifactLevel: "operator",
    supportsBackgroundLiveControl: true,
  },
};

export type BrowserRuntimeProfileOverrides =
  & Partial<
    Omit<BrowserRuntimeProfile, "mode" | "authoringStyles">
  >
  & {
    authoringStyles?: ReadonlyArray<BrowserRuntimeAuthoringStyle>;
  };

export function getBrowserRuntimeProfile(
  mode: BrowserRuntimeMode,
  overrides?: BrowserRuntimeProfileOverrides,
): BrowserRuntimeProfile {
  const base = BASE_PROFILES[mode];
  const envResolved = applyEnvironmentOverrides({
    ...base,
  });
  const overrideProvider = toBrowserProvider(
    overrides?.browserProvider ?? overrides?.useHostBridge,
  );
  return syncBrowserProvider({
    ...envResolved,
    ...overrides,
    authoringStyles: overrides?.authoringStyles ??
      envResolved.authoringStyles,
  }, overrideProvider ?? envResolved.browserProvider);
}

export function getBrowserRuntimeEnvPatch(
  profile: BrowserRuntimeProfile,
): BrowserRuntimeEnvPatch {
  return {
    GAMBIT_BROWSER_RUNTIME_MODE: profile.mode,
    GAMBIT_BROWSER_PROVIDER: profile.browserProvider,
    GAMBIT_USE_HOST_BRIDGE: profile.useHostBridge ? "true" : "false",
    GAMBIT_E2E_RECORD_VIDEO: profile.recordVideo ? "true" : "false",
    BF_E2E_RECORD_VIDEO: profile.recordVideo ? "true" : "false",
    GAMBIT_DEMO_MEDIARECORDER: profile.useMediaRecorder ? "true" : "false",
    GAMBIT_DEMO_WAIT: profile.keepBrowserOpen ? "true" : "false",
    GAMBIT_DEMO_CHROME: profile.chrome ? "true" : "false",
    GAMBIT_DEMO_SUBTITLES: profile.subtitles ? "true" : "false",
    GAMBIT_DEMO_SMOOTH_MOUSE: profile.smoothMouse ? "true" : "false",
    GAMBIT_DEMO_SMOOTH_TYPE: profile.smoothType ? "true" : "false",
    GAMBIT_DEMO_RECORD_AUDIO: "false",
    GAMBIT_DEMO_RECORD_MIC: "false",
  };
}

export async function withBrowserRuntimeProfile<T>(
  mode: BrowserRuntimeMode,
  fn: (profile: BrowserRuntimeProfile) => Promise<T>,
  overrides?: BrowserRuntimeProfileOverrides,
): Promise<T> {
  const profile = getBrowserRuntimeProfile(mode, overrides);
  const patch = getBrowserRuntimeEnvPatch(profile);
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
  try {
    return await fn(profile);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}

export async function runBrowserScenario(
  mode: BrowserRuntimeMode,
  scenario: BrowserRuntimeScenario,
  options: {
    baseUrl: string;
    slug?: string;
    paths?: DemoPaths;
    overrides?: BrowserRuntimeProfileOverrides;
    graphqlMocks?: BrowserGraphqlMockOptions;
  },
): Promise<void> {
  await withBrowserRuntimeProfile(
    mode,
    async (profile) => {
      const paths = options.paths ?? getDemoPaths(options.slug);
      if (!options.paths) {
        await prepareDemoPaths(paths);
      }
      await runDemo(
        async (ctx) => {
          await scenario({
            ...ctx,
            mode,
            profile,
            artifacts: paths,
          });
        },
        {
          baseUrl: options.baseUrl,
          slug: options.slug,
          paths,
          graphqlMocks: options.graphqlMocks,
        },
      );
    },
    options.overrides,
  );
}

export async function runBrowserTimeline(
  mode: BrowserRuntimeMode,
  steps: Array<BrowserTimelineStep>,
  options: {
    baseUrl: string;
    slug?: string;
    paths?: DemoPaths;
    overrides?: BrowserRuntimeProfileOverrides;
    graphqlMocks?: BrowserGraphqlMockOptions;
  },
): Promise<void> {
  await runBrowserScenario(
    mode,
    async (ctx) => {
      await runTimelineSteps(ctx, steps);
    },
    options,
  );
}

export * from "./graphqlMocks.ts";
