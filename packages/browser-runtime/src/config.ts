import { getLogger } from "./logger.ts";

const logger = getLogger(import.meta);

export type ViewportSize = {
  width: number;
  height: number;
};

const DEFAULT_DEMO_VIEWPORT: ViewportSize = { width: 1440, height: 900 };
const DEFAULT_WINDOW_CHROME_HEIGHT = 88;

function normalizePathname(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1) {
    return withSlash.replace(/\/+$/, "");
  }
  return withSlash;
}

function parseViewport(raw: string): ViewportSize | null {
  const match = raw.trim().match(/^(\d+)\s*[xX]\s*(\d+)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function parseBooleanEnv(
  key: string,
  defaultValue: boolean,
): boolean {
  const raw = (Deno.env.get(key) || "").toLowerCase().trim();
  if (!raw) return defaultValue;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") {
    return false;
  }
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") {
    return true;
  }
  logger.warn(`[gambit-demo] invalid ${key}: ${raw}`);
  return defaultValue;
}

export function shouldRecordVideo(): boolean {
  return parseBooleanEnv("GAMBIT_E2E_RECORD_VIDEO", true);
}

export function shouldUseMediaRecorder(): boolean {
  return parseBooleanEnv("GAMBIT_DEMO_MEDIARECORDER", true);
}

export function getMediaRecorderChunkMs(): number {
  const raw = Deno.env.get("GAMBIT_DEMO_MEDIARECORDER_CHUNK_MS");
  if (!raw) return 1000;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  logger.warn(
    `[gambit-demo] invalid GAMBIT_DEMO_MEDIARECORDER_CHUNK_MS: ${raw}`,
  );
  return 1000;
}

export function getMediaRecorderTitle(): string {
  return Deno.env.get("GAMBIT_DEMO_MEDIARECORDER_TITLE") ||
    "Gambit Demo Harness";
}

export function shouldRecordAudio(): boolean {
  const raw = (Deno.env.get("GAMBIT_DEMO_RECORD_AUDIO") || "")
    .toLowerCase()
    .trim();
  if (!raw) return false;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return raw === "true" || raw === "1" || raw === "yes";
}

export function shouldRecordMic(): boolean {
  const raw = (Deno.env.get("GAMBIT_DEMO_RECORD_MIC") || "")
    .toLowerCase()
    .trim();
  if (!raw) return false;
  return raw === "true" || raw === "1" || raw === "yes";
}

export function shouldTrimAudioDelay(recordAnyAudio: boolean): boolean {
  const raw = (Deno.env.get("GAMBIT_DEMO_TRIM_AUDIO_DELAY") || "")
    .toLowerCase()
    .trim();
  if (!raw) return recordAnyAudio;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

export function getExecutablePath(): string | undefined {
  const explicit = Deno.env.get("BF_E2E_PLAYWRIGHT_EXECUTABLE_PATH") ||
    Deno.env.get("GAMBIT_PLAYWRIGHT_EXECUTABLE_PATH") ||
    Deno.env.get("PLAYWRIGHT_EXECUTABLE_PATH");
  if (explicit) return explicit;
  for (
    const candidate of [
      "/nix/var/nix/profiles/default/bin/chromium",
      "/run/current-system/sw/bin/chromium",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome-stable",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
  ) {
    try {
      const stat = Deno.statSync(candidate);
      if (stat.isFile) return candidate;
    } catch {
      // keep searching known system browser locations
    }
  }
  return undefined;
}

export function useHostBridge(): boolean {
  return (Deno.env.get("GAMBIT_USE_HOST_BRIDGE") || "")
    .toLowerCase()
    .trim() === "true";
}

export function getHostBridgeUrl(): string {
  return Deno.env.get("GAMBIT_HOST_BRIDGE_URL") ||
    "https://host.boltfoundry.bflocal:8017";
}

export function getDemoPort(hostBridge: boolean): number | undefined {
  const raw = Deno.env.get("GAMBIT_DEMO_PORT");
  if (raw) {
    const port = Number(raw);
    if (Number.isFinite(port)) return port;
  }
  if (hostBridge) return 8000;
  return undefined;
}

export function getDemoBaseUrl(hostBridge: boolean): string | null {
  const override = Deno.env.get("GAMBIT_DEMO_BASE_URL");
  if (override) return override.replace(/\/+$/, "");
  if (!hostBridge) return null;
  const workspaceId = Deno.env.get("WORKSPACE_ID");
  if (!workspaceId) {
    throw new Error(
      "WORKSPACE_ID is required when GAMBIT_USE_HOST_BRIDGE=true.",
    );
  }
  return `https://${workspaceId}.boltfoundry.bflocal`;
}

export function shouldWaitForExit(): boolean {
  return parseBooleanEnv("GAMBIT_DEMO_WAIT", false);
}

export function shouldShowDemoChrome(): boolean {
  return parseBooleanEnv("GAMBIT_DEMO_CHROME", true);
}

export function shouldShowDemoSubtitles(): boolean {
  return parseBooleanEnv("GAMBIT_DEMO_SUBTITLES", true);
}

export function shouldUseSmoothMouse(): boolean {
  return parseBooleanEnv("GAMBIT_DEMO_SMOOTH_MOUSE", true);
}

export function shouldUseSmoothType(): boolean {
  return parseBooleanEnv("GAMBIT_DEMO_SMOOTH_TYPE", true);
}

export function getDemoViewport(): ViewportSize | null {
  const raw = Deno.env.get("GAMBIT_DEMO_VIEWPORT");
  if (!raw) return { ...DEFAULT_DEMO_VIEWPORT };
  const parsed = parseViewport(raw);
  if (!parsed) {
    logger.warn(`[gambit-demo] invalid GAMBIT_DEMO_VIEWPORT: ${raw}`);
    return { ...DEFAULT_DEMO_VIEWPORT };
  }
  return parsed;
}

export function getDemoWindowSize(
  viewport: ViewportSize | null,
): ViewportSize | null {
  const explicit = Deno.env.get("GAMBIT_DEMO_WINDOW_SIZE");
  if (explicit) {
    const parsed = parseViewport(explicit);
    if (parsed) return parsed;
    logger.warn(`[gambit-demo] invalid GAMBIT_DEMO_WINDOW_SIZE: ${explicit}`);
  }
  if (!viewport) return null;
  const chromeHeightRaw = Deno.env.get("GAMBIT_DEMO_WINDOW_CHROME_HEIGHT");
  const chromeHeight = chromeHeightRaw
    ? Number(chromeHeightRaw)
    : DEFAULT_WINDOW_CHROME_HEIGHT;
  if (!Number.isFinite(chromeHeight) || chromeHeight < 0) {
    logger.warn(
      `[gambit-demo] invalid GAMBIT_DEMO_WINDOW_CHROME_HEIGHT: ${chromeHeightRaw}`,
    );
    return {
      width: viewport.width,
      height: viewport.height + DEFAULT_WINDOW_CHROME_HEIGHT,
    };
  }
  return {
    width: viewport.width,
    height: viewport.height + Math.round(chromeHeight),
  };
}

export function getDemoContentSize(): ViewportSize | null {
  const raw = Deno.env.get("GAMBIT_DEMO_CONTENT");
  if (!raw) return null;
  const parsed = parseViewport(raw);
  if (!parsed) {
    logger.warn(`[gambit-demo] invalid GAMBIT_DEMO_CONTENT: ${raw}`);
    return null;
  }
  return parsed;
}

export function getEffectiveDemoContentSize(
  _demoPath: string,
): ViewportSize | null {
  const explicit = getDemoContentSize();
  if (explicit) return explicit;
  return null;
}

export function getDemoDurationMs(): number | null {
  const raw = Deno.env.get("GAMBIT_DEMO_DURATION_SECONDS");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    logger.warn(
      `[gambit-demo] invalid GAMBIT_DEMO_DURATION_SECONDS: ${raw}`,
    );
    return null;
  }
  return Math.round(value * 1000);
}

export function getDemoFrameRate(): number {
  const raw = Deno.env.get("GAMBIT_DEMO_FPS");
  if (!raw) return 60;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    logger.warn(`[gambit-demo] invalid GAMBIT_DEMO_FPS: ${raw}`);
    return 60;
  }
  return Math.round(value);
}

export function getDemoOutputFrameRate(inputFrameRate: number): number {
  const raw = Deno.env.get("GAMBIT_DEMO_OUTPUT_FPS");
  if (!raw) return inputFrameRate;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    logger.warn(`[gambit-demo] invalid GAMBIT_DEMO_OUTPUT_FPS: ${raw}`);
    return inputFrameRate;
  }
  return Math.round(value);
}

export function getDemoInterpolationMode(): "mc" | "blend" | null {
  const raw = (Deno.env.get("GAMBIT_DEMO_INTERPOLATE") || "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw === "mc" || raw === "motion") return "mc";
  if (raw === "blend") return "blend";
  logger.warn(`[gambit-demo] invalid GAMBIT_DEMO_INTERPOLATE: ${raw}`);
  return null;
}

export function getDemoPath(): string {
  return Deno.env.get("GAMBIT_DEMO_PATH") || "/";
}

export function getIframeShellPath(): string {
  const raw = Deno.env.get("GAMBIT_DEMO_IFRAME_PATH") ||
    Deno.env.get("GAMBIT_E2E_IFRAME_PATH") ||
    "/demo/iframe-shell";
  return normalizePathname(raw);
}

export function getIframeShellPaths(): Array<string> {
  const basePath = getIframeShellPath();
  const paths = new Set<string>([basePath]);
  if (basePath.endsWith(".html")) {
    paths.add(basePath.slice(0, -".html".length));
  } else {
    paths.add(`${basePath}.html`);
  }
  return [...paths];
}

export function isIframeShellPath(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return getIframeShellPaths().includes(normalized);
}

export function resolveDemoQuery(baseUrl: string): string | null {
  const raw = Deno.env.get("GAMBIT_DEMO_QUERY");
  if (!raw) return null;
  return raw
    .replaceAll("{{BASE_URL}}", encodeURIComponent(baseUrl))
    .replaceAll("{{BASE_URL_RAW}}", baseUrl);
}

export function buildDemoQuery(
  baseUrl: string,
  viewport: ViewportSize | null,
  content: ViewportSize | null,
): string | null {
  const raw = resolveDemoQuery(baseUrl);
  const params = new URLSearchParams(
    raw ? (raw.startsWith("?") ? raw.slice(1) : raw) : "",
  );
  if (content && !params.has("content")) {
    params.set("content", `${content.width}x${content.height}`);
  }
  if (viewport && !params.has("shell") && !content) {
    params.set("shell", `${viewport.width}x${viewport.height}`);
  }
  if (!params.has("chrome")) {
    params.set("chrome", shouldShowDemoChrome() ? "true" : "false");
  }
  if (!params.has("subtitles")) {
    params.set("subtitles", shouldShowDemoSubtitles() ? "true" : "false");
  }
  if (!params.has("smoothMouse")) {
    params.set("smoothMouse", shouldUseSmoothMouse() ? "true" : "false");
  }
  if (!params.has("smoothType")) {
    params.set("smoothType", shouldUseSmoothType() ? "true" : "false");
  }
  const query = params.toString();
  return query.length ? query : null;
}

export function shouldSkipAutomation(): boolean {
  return (Deno.env.get("GAMBIT_DEMO_SKIP_AUTOMATION") || "")
    .toLowerCase()
    .trim() === "true";
}
