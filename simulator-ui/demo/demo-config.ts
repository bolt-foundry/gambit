export type ViewportSize = {
  width: number;
  height: number;
};

function parseViewport(raw: string): ViewportSize | null {
  const match = raw.trim().match(/^(\d+)\s*[xX]\s*(\d+)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

export function shouldRecordVideo(): boolean {
  const raw = (Deno.env.get("GAMBIT_E2E_RECORD_VIDEO") || "")
    .toLowerCase()
    .trim();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

export function shouldUseMediaRecorder(): boolean {
  const raw = (Deno.env.get("GAMBIT_DEMO_MEDIARECORDER") || "")
    .toLowerCase()
    .trim();
  if (!raw) return true;
  return raw === "true" || raw === "1" || raw === "yes";
}

export function getMediaRecorderChunkMs(): number {
  const raw = Deno.env.get("GAMBIT_DEMO_MEDIARECORDER_CHUNK_MS");
  if (!raw) return 1000;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  console.warn(
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
  return raw === "true" || raw === "1" || raw === "yes";
}

export function shouldRecordMic(): boolean {
  const raw = (Deno.env.get("GAMBIT_DEMO_RECORD_MIC") || "")
    .toLowerCase()
    .trim();
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
  return Deno.env.get("GAMBIT_PLAYWRIGHT_EXECUTABLE_PATH") ||
    Deno.env.get("PUPPETEER_EXECUTABLE_PATH") ||
    undefined;
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
  return (Deno.env.get("GAMBIT_DEMO_WAIT") || "")
    .toLowerCase()
    .trim() === "true";
}

export function getDemoViewport(): ViewportSize | null {
  const raw = Deno.env.get("GAMBIT_DEMO_VIEWPORT");
  if (!raw) return null;
  const parsed = parseViewport(raw);
  if (!parsed) {
    console.warn(`[gambit-demo] invalid GAMBIT_DEMO_VIEWPORT: ${raw}`);
    return null;
  }
  return parsed;
}

export function getDemoContentSize(): ViewportSize | null {
  const raw = Deno.env.get("GAMBIT_DEMO_CONTENT");
  if (!raw) return null;
  const parsed = parseViewport(raw);
  if (!parsed) {
    console.warn(`[gambit-demo] invalid GAMBIT_DEMO_CONTENT: ${raw}`);
    return null;
  }
  return parsed;
}

export function getEffectiveDemoContentSize(
  demoPath: string,
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
    console.warn(
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
    console.warn(`[gambit-demo] invalid GAMBIT_DEMO_FPS: ${raw}`);
    return 60;
  }
  return Math.round(value);
}

export function getDemoOutputFrameRate(inputFrameRate: number): number {
  const raw = Deno.env.get("GAMBIT_DEMO_OUTPUT_FPS");
  if (!raw) return inputFrameRate;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(`[gambit-demo] invalid GAMBIT_DEMO_OUTPUT_FPS: ${raw}`);
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
  console.warn(`[gambit-demo] invalid GAMBIT_DEMO_INTERPOLATE: ${raw}`);
  return null;
}

export function getDemoPath(): string {
  return Deno.env.get("GAMBIT_DEMO_PATH") || "/";
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
  const query = params.toString();
  return query.length ? query : null;
}

export function shouldSkipAutomation(): boolean {
  return (Deno.env.get("GAMBIT_DEMO_SKIP_AUTOMATION") || "")
    .toLowerCase()
    .trim() === "true";
}
