import { ensureDir } from "@std/fs";
import * as path from "@std/path";
import { chromium } from "npm:playwright-core";
import type {
  Browser,
  BrowserContext,
  CDPSession,
  Frame,
  Page,
} from "npm:playwright-core";

const DEFAULT_SERVER_COMMAND = [
  "deno",
  "run",
  "-A",
  "src/cli.ts",
  "serve",
  "examples/voice_front_desk/decks/root.deck.md",
  "--bundle",
];

const DEFAULT_READY_PATTERN = /Simulator listening on http:\/\/localhost:\d+/i;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

function findAvailablePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await Deno.stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function shouldRecordVideo(): boolean {
  const raw = (Deno.env.get("GAMBIT_E2E_RECORD_VIDEO") || "")
    .toLowerCase()
    .trim();
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

function shouldUseMediaRecorder(): boolean {
  const raw = (Deno.env.get("GAMBIT_DEMO_MEDIARECORDER") || "")
    .toLowerCase()
    .trim();
  if (!raw) return true;
  return raw === "true" || raw === "1" || raw === "yes";
}

function getMediaRecorderChunkMs(): number {
  const raw = Deno.env.get("GAMBIT_DEMO_MEDIARECORDER_CHUNK_MS");
  if (!raw) return 1000;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  console.warn(
    `[gambit-demo] invalid GAMBIT_DEMO_MEDIARECORDER_CHUNK_MS: ${raw}`,
  );
  return 1000;
}

function getMediaRecorderTitle(): string {
  return Deno.env.get("GAMBIT_DEMO_MEDIARECORDER_TITLE") ||
    "Gambit Demo Harness";
}

function shouldRecordAudio(): boolean {
  const raw = (Deno.env.get("GAMBIT_DEMO_RECORD_AUDIO") || "")
    .toLowerCase()
    .trim();
  return raw === "true" || raw === "1" || raw === "yes";
}

function shouldRecordMic(): boolean {
  const raw = (Deno.env.get("GAMBIT_DEMO_RECORD_MIC") || "")
    .toLowerCase()
    .trim();
  return raw === "true" || raw === "1" || raw === "yes";
}

function shouldTrimAudioDelay(recordAnyAudio: boolean): boolean {
  const raw = (Deno.env.get("GAMBIT_DEMO_TRIM_AUDIO_DELAY") || "")
    .toLowerCase()
    .trim();
  if (!raw) return recordAnyAudio;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return true;
}

function getExecutablePath(): string | undefined {
  return Deno.env.get("GAMBIT_PLAYWRIGHT_EXECUTABLE_PATH") ||
    Deno.env.get("PUPPETEER_EXECUTABLE_PATH") ||
    undefined;
}

function useHostBridge(): boolean {
  return (Deno.env.get("GAMBIT_USE_HOST_BRIDGE") || "")
    .toLowerCase()
    .trim() === "true";
}

function getHostBridgeUrl(): string {
  return Deno.env.get("GAMBIT_HOST_BRIDGE_URL") ||
    "https://host.boltfoundry.bflocal:8017";
}

async function stopHostBridgeChrome(): Promise<void> {
  const baseUrl = getHostBridgeUrl();
  try {
    const res = await fetch(`${baseUrl}/browser/debugger/stop`, {
      method: "POST",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[gambit-demo] host bridge stop failed (${res.status}): ${
          text || res.statusText
        }`,
      );
    }
  } catch (error) {
    console.warn("[gambit-demo] failed to stop host bridge chrome:", error);
  }
}

function getDemoPort(hostBridge: boolean): number | undefined {
  const raw = Deno.env.get("GAMBIT_DEMO_PORT");
  if (raw) {
    const port = Number(raw);
    if (Number.isFinite(port)) return port;
  }
  if (hostBridge) return 8000;
  return undefined;
}

function getDemoBaseUrl(hostBridge: boolean): string | null {
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

function shouldWaitForExit(): boolean {
  return (Deno.env.get("GAMBIT_DEMO_WAIT") || "")
    .toLowerCase()
    .trim() === "true";
}

type ViewportSize = {
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

function getDemoViewport(): ViewportSize | null {
  const raw = Deno.env.get("GAMBIT_DEMO_VIEWPORT");
  if (!raw) return null;
  const parsed = parseViewport(raw);
  if (!parsed) {
    console.warn(`[gambit-demo] invalid GAMBIT_DEMO_VIEWPORT: ${raw}`);
    return null;
  }
  return parsed;
}

function getDemoContentSize(): ViewportSize | null {
  const raw = Deno.env.get("GAMBIT_DEMO_CONTENT");
  if (!raw) return null;
  const parsed = parseViewport(raw);
  if (!parsed) {
    console.warn(`[gambit-demo] invalid GAMBIT_DEMO_CONTENT: ${raw}`);
    return null;
  }
  return parsed;
}

function getEffectiveDemoContentSize(demoPath: string): ViewportSize | null {
  const explicit = getDemoContentSize();
  if (explicit) return explicit;
  return null;
}

function getDemoDurationMs(): number | null {
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

function getDemoFrameRate(): number {
  const raw = Deno.env.get("GAMBIT_DEMO_FPS");
  if (!raw) return 60;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(`[gambit-demo] invalid GAMBIT_DEMO_FPS: ${raw}`);
    return 60;
  }
  return Math.round(value);
}

function getDemoOutputFrameRate(inputFrameRate: number): number {
  const raw = Deno.env.get("GAMBIT_DEMO_OUTPUT_FPS");
  if (!raw) return inputFrameRate;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(`[gambit-demo] invalid GAMBIT_DEMO_OUTPUT_FPS: ${raw}`);
    return inputFrameRate;
  }
  return Math.round(value);
}

function getDemoInterpolationMode(): "mc" | "blend" | null {
  const raw = (Deno.env.get("GAMBIT_DEMO_INTERPOLATE") || "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw === "mc" || raw === "motion") return "mc";
  if (raw === "blend") return "blend";
  console.warn(`[gambit-demo] invalid GAMBIT_DEMO_INTERPOLATE: ${raw}`);
  return null;
}

function getDemoPath(): string {
  return Deno.env.get("GAMBIT_DEMO_PATH") || "/";
}

function resolveDemoQuery(baseUrl: string): string | null {
  const raw = Deno.env.get("GAMBIT_DEMO_QUERY");
  if (!raw) return null;
  return raw
    .replaceAll("{{BASE_URL}}", encodeURIComponent(baseUrl))
    .replaceAll("{{BASE_URL_RAW}}", baseUrl);
}

function buildDemoQuery(
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

function shouldSkipAutomation(): boolean {
  return (Deno.env.get("GAMBIT_DEMO_SKIP_AUTOMATION") || "")
    .toLowerCase()
    .trim() === "true";
}

async function getDemoTarget(
  page: Page,
  useIframeShell: boolean,
): Promise<Page | Frame> {
  if (!useIframeShell) return page;
  const iframe = await page.waitForSelector("#demo-frame", { timeout: 30_000 });
  const frame = await iframe?.contentFrame();
  if (!frame) throw new Error("[gambit-demo] iframe content not available");
  await frame.waitForLoadState("domcontentloaded");
  return frame;
}

function buildDemoUrl(
  baseUrl: string,
  demoPath: string,
  extraQuery?: string | null,
): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const resolved = new URL(demoPath, normalizedBase);
  if (extraQuery) {
    const query = extraQuery.startsWith("?") ? extraQuery.slice(1) : extraQuery;
    if (query.length) {
      if (resolved.search) {
        resolved.search += `&${query}`;
      } else {
        resolved.search = `?${query}`;
      }
    }
  }
  return resolved.toString();
}

async function stopBoltfoundryDevServer(): Promise<void> {
  console.log(
    "[gambit-demo] ensuring `bft dev boltfoundry-com` is stopped for port 8000...",
  );
  try {
    const result = await new Deno.Command("bft", {
      args: ["dev", "boltfoundry-com", "--stop"],
      stdout: "null",
      stderr: "piped",
    }).output();
    if (result.code === 0) {
      console.log("[gambit-demo] boltfoundry-com dev server stopped.");
    } else {
      const stderr = new TextDecoder().decode(result.stderr).trim();
      console.warn(
        `[gambit-demo] failed to stop boltfoundry-com dev server (code ${result.code})${
          stderr ? `: ${stderr}` : ""
        }`,
      );
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.warn(
        "[gambit-demo] `bft` command not found; skipping dev server shutdown.",
      );
    } else {
      console.warn(
        "[gambit-demo] error while stopping boltfoundry-com dev server:",
        error,
      );
    }
  }
}

async function writeLogLine(logPath: string, prefix: string, chunk: string) {
  const normalized = chunk.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return;
  const lines = normalized.split("\n").filter((line) => line.length > 0);
  if (!lines.length) return;
  const payload = lines.map((line) =>
    `${new Date().toISOString()} [${prefix}] ${line}\n`
  ).join("");
  await Deno.writeTextFile(logPath, payload, { append: true });
}

async function startServer(opts: {
  logsDir: string;
  cwd: string;
  command?: string[];
  readyPattern?: RegExp;
  port?: number;
}): Promise<{
  process: ReturnType<Deno.Command["spawn"]>;
  status: Promise<Deno.CommandStatus>;
  stdoutTask?: Promise<void>;
  stderrTask?: Promise<void>;
  port: number;
  baseUrl: string;
  logPath: string;
  previousBaseUrl?: string;
}> {
  const port = opts.port ?? findAvailablePort();
  const command = opts.command ? [...opts.command] : [
    ...DEFAULT_SERVER_COMMAND,
    "--port",
    String(port),
  ];

  const logPath = path.join(opts.logsDir, "dev-server.log");
  const header = [
    "# gambit demo embedded dev server",
    `# started: ${new Date().toISOString()}`,
  ].join("\n") + "\n";
  await Deno.writeTextFile(logPath, header, { create: true });

  const child = new Deno.Command(command[0], {
    args: command.slice(1),
    cwd: opts.cwd,
    stdout: "piped",
    stderr: "piped",
    env: Deno.env.toObject(),
  }).spawn();

  const decoder = new TextDecoder();
  const readyPattern = opts.readyPattern ?? DEFAULT_READY_PATTERN;
  let readinessBuffer = "";

  let readyResolved = false;
  let readyReject: ((error: Error) => void) | undefined;
  let readyResolve: (() => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = () => {
      readyResolved = true;
      resolve();
    };
    readyReject = reject;
  });

  const statusPromise = child.status.then((status) => {
    if (!readyResolved) {
      readyReject?.(
        new Error(
          `Embedded server exited before it was ready (code ${status.code})`,
        ),
      );
    }
    return status;
  }).catch((error) => {
    if (!readyResolved) {
      readyReject?.(
        error instanceof Error
          ? error
          : new Error(String(error ?? "unknown server error")),
      );
    }
    throw error;
  });

  const stdoutTask = child.stdout
    ? (async () => {
      const reader = child.stdout!.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          const chunk = decoder.decode(value);
          readinessBuffer = `${readinessBuffer}${chunk}`.slice(-4096);
          if (!readyResolved && readyPattern.test(readinessBuffer)) {
            readyResolve?.();
          }
          await writeLogLine(logPath, "stdout", chunk);
        }
      } finally {
        reader.releaseLock();
      }
    })()
    : undefined;

  const stderrTask = child.stderr
    ? (async () => {
      const reader = child.stderr!.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          const chunk = decoder.decode(value);
          readinessBuffer = `${readinessBuffer}${chunk}`.slice(-4096);
          if (!readyResolved && readyPattern.test(readinessBuffer)) {
            readyResolve?.();
          }
          await writeLogLine(logPath, "stderr", chunk);
        }
      } finally {
        reader.releaseLock();
      }
    })()
    : undefined;

  const timeoutMs = 60_000;
  const timeout = setTimeout(() => {
    if (!readyResolved) {
      readyReject?.(
        new Error(
          `Timed out waiting for embedded server to start after ${timeoutMs} ms`,
        ),
      );
    }
  }, timeoutMs);

  try {
    await readyPromise;
  } catch (error) {
    clearTimeout(timeout);
    try {
      child.kill("SIGTERM");
    } catch (_) {
      // ignore
    }
    await statusPromise.catch(() => {});
    await Promise.allSettled(
      [stdoutTask, stderrTask].filter(Boolean) as Array<Promise<unknown>>,
    );
    throw error;
  }

  clearTimeout(timeout);

  const baseUrl = `http://127.0.0.1:${port}`;
  const previousBaseUrl = Deno.env.get("GAMBIT_E2E_URL");
  Deno.env.set("GAMBIT_E2E_URL", baseUrl);

  return {
    process: child,
    status: statusPromise,
    stdoutTask,
    stderrTask,
    port,
    baseUrl,
    logPath,
    previousBaseUrl,
  };
}

async function stopServer(server: {
  process: ReturnType<Deno.Command["spawn"]>;
  status: Promise<Deno.CommandStatus>;
  stdoutTask?: Promise<void>;
  stderrTask?: Promise<void>;
  previousBaseUrl?: string;
}): Promise<void> {
  try {
    server.process.kill("SIGTERM");
  } catch (_) {
    // ignore
  }

  try {
    await server.status.catch(() => {});
  } catch (_) {
    // ignore
  }

  await Promise.allSettled(
    [server.stdoutTask, server.stderrTask].filter(Boolean) as Array<
      Promise<unknown>
    >,
  );

  if (server.previousBaseUrl === undefined) {
    Deno.env.delete("GAMBIT_E2E_URL");
  } else {
    Deno.env.set("GAMBIT_E2E_URL", server.previousBaseUrl);
  }
}

async function startHostBridgeChrome(opts: {
  headless: boolean;
  viewport?: ViewportSize | null;
  muteAudio?: boolean;
  autoGrantMedia?: boolean;
  allowScreenCapture?: boolean;
  autoSelectTabCaptureSourceByTitle?: string | null;
}): Promise<string> {
  const baseUrl = getHostBridgeUrl();
  const payload: Record<string, unknown> = {
    headless: opts.headless,
  };
  if (opts.viewport) {
    payload.windowWidth = opts.viewport.width;
    payload.windowHeight = opts.viewport.height;
  }
  if (typeof opts.muteAudio === "boolean") {
    payload.muteAudio = opts.muteAudio;
  }
  if (opts.autoGrantMedia) {
    payload.autoGrantMedia = true;
  }
  if (opts.allowScreenCapture) {
    payload.allowScreenCapture = true;
  }
  if (opts.autoSelectTabCaptureSourceByTitle) {
    payload.autoSelectTabCaptureSourceByTitle =
      opts.autoSelectTabCaptureSourceByTitle;
  }
  const portRaw = Deno.env.get("GAMBIT_HOST_BRIDGE_PORT");
  if (portRaw) {
    const portNum = Number(portRaw);
    if (Number.isFinite(portNum)) payload.port = portNum;
  }

  const res = await fetch(`${baseUrl}/browser/debugger/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `host-bridge start failed (${res.status}): ${text || res.statusText}`,
    );
  }
  const data = await res.json() as { wsEndpoint?: string };
  if (!data.wsEndpoint) {
    throw new Error("host-bridge start did not return wsEndpoint");
  }
  const raw = data.wsEndpoint;
  if (raw.startsWith("ws://") && baseUrl.startsWith("https://")) {
    return `wss://${raw.slice("ws://".length)}`;
  }
  return raw;
}

async function screenshot(
  page: { screenshot(opts: { path: string }): Promise<unknown> },
  dir: string,
  label: string,
): Promise<string> {
  await ensureDir(dir);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const filename = `${ts}_${safeLabel}.png`;
  const filePath = path.join(dir, filename);
  await page.screenshot({ path: filePath });
  return filePath;
}

async function appendIndexLine(rootDir: string, line: string) {
  await Deno.writeTextFile(path.join(rootDir, "index.txt"), line + "\n", {
    append: true,
  }).catch(() => {});
}

async function exportVideo(
  framesDir: string,
  latestDir: string,
  frameRate?: number | null,
  interpolate?: "mc" | "blend" | null,
): Promise<void> {
  let hasFrames = false;
  try {
    for await (const entry of Deno.readDir(framesDir)) {
      if (entry.isFile) {
        hasFrames = true;
        break;
      }
    }
  } catch (error) {
    console.warn("[gambit-demo] failed to read frames directory:", error);
  }
  if (!hasFrames) return;
  const mp4Path = path.join(latestDir, "video.mp4");
  try {
    const fps = frameRate && frameRate > 0 ? Math.round(frameRate) : 30;
    const filters: Array<string> = [];
    if (interpolate === "mc") {
      filters.push(
        `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir`,
      );
    } else if (interpolate === "blend") {
      filters.push("tblend=all_mode=average");
    }
    filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p");
    const command = new Deno.Command("ffmpeg", {
      args: [
        "-y",
        "-loglevel",
        "error",
        "-framerate",
        String(fps),
        "-i",
        "frame-%06d.png",
        "-r",
        String(fps),
        "-vf",
        filters.join(","),
        "../video.mp4",
      ],
      cwd: framesDir,
      stdout: "null",
      stderr: "piped",
    });
    const { code, stderr } = await command.output();
    if (code !== 0) {
      const message = new TextDecoder().decode(stderr).trim();
      console.warn("[gambit-demo] ffmpeg failed:", message || code);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.warn("[gambit-demo] ffmpeg not found; keeping frame PNGs");
    } else {
      console.warn("[gambit-demo] ffmpeg failed:", error);
    }
  }
}

async function trimMediaForAudioDelay(opts: {
  latestDir: string;
  trimMs: number;
  audioPath?: string | null;
}): Promise<void> {
  const { latestDir, trimMs, audioPath } = opts;
  const trimSeconds = (trimMs / 1000).toFixed(3);
  const videoPath = path.join(latestDir, "video.mp4");
  const trimmedVideoPath = path.join(latestDir, "video-trimmed.mp4");
  const hasVideo = await fileExists(videoPath);
  if (!hasVideo) return;

  try {
    const args = [
      "-y",
      "-ss",
      trimSeconds,
      "-i",
      videoPath,
      "-c:v",
      "copy",
      "-an",
      trimmedVideoPath,
    ];
    const { code, stderr } = await new Deno.Command("ffmpeg", {
      args,
      stdout: "null",
      stderr: "piped",
    }).output();
    if (code !== 0) {
      const message = new TextDecoder().decode(stderr).trim();
      console.warn("[gambit-demo] video trim failed:", message || code);
      return;
    }
  } catch (error) {
    console.warn("[gambit-demo] video trim failed:", error);
    return;
  }

  let trimmedAudioPath: string | null = null;
  if (audioPath && await fileExists(audioPath)) {
    const ext = path.extname(audioPath) || ".webm";
    trimmedAudioPath = path.join(latestDir, `audio-trimmed${ext}`);
    try {
      const args = [
        "-y",
        "-ss",
        trimSeconds,
        "-i",
        audioPath,
        "-c:a",
        "copy",
        trimmedAudioPath,
      ];
      const { code, stderr } = await new Deno.Command("ffmpeg", {
        args,
        stdout: "null",
        stderr: "piped",
      }).output();
      if (code !== 0) {
        const message = new TextDecoder().decode(stderr).trim();
        console.warn("[gambit-demo] audio trim failed:", message || code);
        trimmedAudioPath = null;
      }
    } catch (error) {
      console.warn("[gambit-demo] audio trim failed:", error);
      trimmedAudioPath = null;
    }
  }

  if (trimmedAudioPath) {
    const muxedPath = path.join(latestDir, "video-with-audio-trimmed.mp4");
    try {
      const args = [
        "-y",
        "-i",
        trimmedVideoPath,
        "-i",
        trimmedAudioPath,
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        muxedPath,
      ];
      const { code, stderr } = await new Deno.Command("ffmpeg", {
        args,
        stdout: "null",
        stderr: "piped",
      }).output();
      if (code !== 0) {
        const message = new TextDecoder().decode(stderr).trim();
        console.warn("[gambit-demo] trimmed mux failed:", message || code);
      }
    } catch (error) {
      console.warn("[gambit-demo] trimmed mux failed:", error);
    }
  }
}

export type DemoScenarioContext = {
  baseUrl: string;
  demoTarget: Page | Frame;
  page: Page;
  screenshotsDir: string;
  useIframeShell: boolean;
  wait: (ms: number) => Promise<void>;
  screenshot: (label: string) => Promise<string>;
};

export async function runDemo(
  scenario: (ctx: DemoScenarioContext) => Promise<void>,
): Promise<void> {
  let mediaRecorderIncludesAudio = false;
  const moduleDir = path.dirname(path.fromFileUrl(import.meta.url));
  const packageRoot = path.resolve(moduleDir, "../..");
  const repoRoot = path.resolve(packageRoot, "../..");
  const artifactRoot = path.resolve(repoRoot, "..", "shared", "bft-e2e");
  const slug = toSlug(Deno.env.get("GAMBIT_DEMO_SLUG") || "gambit-ui-demo");
  const rootDir = path.join(artifactRoot, slug);
  const latestDir = path.join(rootDir, "__latest__");
  const logsDir = path.join(latestDir, "logs");
  const screenshotsDir = path.join(latestDir, "screenshots");
  const framesDir = path.join(latestDir, "frames");

  await Deno.remove(latestDir, { recursive: true }).catch(() => {});
  await ensureDir(latestDir);
  await ensureDir(logsDir);
  await ensureDir(screenshotsDir);
  await ensureDir(framesDir);

  const headless = (Deno.env.get("GAMBIT_E2E_SHOW_BROWSER") || "") !== "true";
  const recordVideo = shouldRecordVideo();
  const recordAudio = shouldRecordAudio();
  const recordMic = shouldRecordMic();
  const recordAnyAudio = recordAudio || recordMic;
  const trimAudioDelay = shouldTrimAudioDelay(recordAnyAudio);
  const executablePath = getExecutablePath();
  const epochMs = Date.now();
  const hostBridge = useHostBridge();
  const demoPort = getDemoPort(hostBridge);
  const requestedViewport = getDemoViewport();
  const demoPathRaw = getDemoPath();
  const demoFrameRate = getDemoFrameRate();
  const demoOutputFrameRate = getDemoOutputFrameRate(demoFrameRate);
  const demoInterpolation = getDemoInterpolationMode();
  const demoChunkMs = getMediaRecorderChunkMs();
  const useMediaRecorder = shouldUseMediaRecorder();
  const mediaRecorderTitle = getMediaRecorderTitle();
  const demoPath = useMediaRecorder && demoPathRaw === "/"
    ? "/demo/iframe-shell"
    : demoPathRaw;
  const demoContent = getEffectiveDemoContentSize(demoPath);
  const useIframeShell = demoPath.includes("iframe-shell");
  if (hostBridge && demoPort === 8000) {
    await stopBoltfoundryDevServer();
  }
  if (hostBridge) {
    await stopHostBridgeChrome();
  }
  const skipAutomation = shouldSkipAutomation();

  const server = await startServer({
    logsDir,
    cwd: packageRoot,
    port: demoPort,
  });

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let videoSession: CDPSession | null = null;
  let pendingFrameWrites: Set<Promise<void>> = new Set();
  let frameSeq = 0;
  let videoRecordingActive = false;
  let videoStartMs: number | null = null;
  let audioStartMs: number | null = null;
  let audioDelayMs: number | null = null;
  let audioFilePath: string | null = null;
  let mediaRecorderActive = false;
  let mediaRecorderPath: string | null = null;
  let mediaRecorderMimeType: string | null = null;
  let mediaRecorderBytes = 0;
  let mediaRecorderChunks = 0;

  try {
    const fallbackViewport = { width: 1920, height: 1080 };
    const viewport = requestedViewport ?? null;

    if (hostBridge) {
      const wsEndpoint = await startHostBridgeChrome({
        headless,
        viewport,
        muteAudio: !recordAnyAudio,
        autoGrantMedia: recordAnyAudio || useMediaRecorder,
        allowScreenCapture: recordAudio || useMediaRecorder,
        autoSelectTabCaptureSourceByTitle: useMediaRecorder
          ? mediaRecorderTitle
          : null,
      });
      console.log("[gambit-demo] host bridge ws:", wsEndpoint);
      browser = await chromium.connectOverCDP(wsEndpoint);
    } else {
      const args = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ];
      if (viewport) {
        args.push(`--window-size=${viewport.width},${viewport.height}`);
      }
      if (recordAnyAudio || useMediaRecorder) {
        args.push(
          "--autoplay-policy=no-user-gesture-required",
          "--use-fake-ui-for-media-stream",
          "--enable-usermedia-screen-capturing",
        );
      }
      if (useMediaRecorder && mediaRecorderTitle) {
        args.push(
          `--auto-select-tab-capture-source-by-title=${mediaRecorderTitle}`,
        );
      }
      browser = await chromium.launch({
        headless,
        executablePath,
        args,
      });
    }

    const existingContexts = browser.contexts();
    const ctx = existingContexts[0] ||
      await browser.newContext(
        requestedViewport ? { viewport: requestedViewport } : {},
      );
    context = ctx;

    const existingPages = ctx.pages();
    const pg = existingPages[0] || await ctx.newPage();
    page = pg;
    if (requestedViewport) {
      try {
        await pg.setViewportSize(requestedViewport);
      } catch (error) {
        console.warn("[gambit-demo] failed to set viewport size:", error);
      }
    }
    const resolvedViewport = requestedViewport ?? pg.viewportSize() ??
      fallbackViewport;
    const index = [
      `test_name: gambit-ui-demo`,
      `slug: ${slug}`,
      `epoch_ms: ${epochMs}`,
      `headless: ${String(headless)}`,
      `executable_path: ${String(executablePath ?? "auto")}`,
      `viewport: ${resolvedViewport.width}x${resolvedViewport.height}`,
      `content: ${
        demoContent ? `${demoContent.width}x${demoContent.height}` : "auto"
      }`,
      `capture: ${useMediaRecorder ? "mediarecorder" : "cdp"}`,
      `mediarecorder_chunk_ms: ${useMediaRecorder ? demoChunkMs : "n/a"}`,
      `fps: ${demoFrameRate}`,
      `output_fps: ${demoOutputFrameRate}`,
      `interpolate: ${demoInterpolation ?? "off"}`,
      `audio: ${
        recordAnyAudio ? `tab=${recordAudio} mic=${recordMic}` : "off"
      }`,
      `trim_audio_delay: ${recordAnyAudio ? String(trimAudioDelay) : "n/a"}`,
      `base_dir: ${latestDir}`,
    ].join("\n");
    await Deno.writeTextFile(path.join(latestDir, "index.txt"), index + "\n");

    if (recordVideo && !useMediaRecorder) {
      videoSession = await ctx.newCDPSession(pg);
      await videoSession.send("Page.enable");
      videoRecordingActive = true;
      videoSession.on(
        "Page.screencastFrame",
        (event: { data: string; sessionId: number }) => {
          if (!videoRecordingActive) {
            void videoSession?.send("Page.screencastFrameAck", {
              sessionId: event.sessionId,
            }).catch(() => {});
            return;
          }
          const seq = ++frameSeq;
          const filename = `frame-${seq.toString().padStart(6, "0")}.png`;
          const filepath = path.join(framesDir, filename);
          const writePromise = (async () => {
            try {
              const bytes = decodeBase64(event.data);
              await Deno.writeFile(filepath, bytes);
            } catch (error) {
              console.warn(
                "[gambit-demo] failed to write frame",
                filename,
                error,
              );
            }
          })();
          pendingFrameWrites.add(writePromise);
          writePromise.finally(() => pendingFrameWrites.delete(writePromise));
          void videoSession?.send("Page.screencastFrameAck", {
            sessionId: event.sessionId,
          }).catch(() => {});
        },
      );
      const screencastOptions: {
        format: "png";
        everyNthFrame: number;
        quality: number;
        maxFrameRate?: number;
      } = {
        format: "png",
        everyNthFrame: 1,
        quality: 80,
      };
      screencastOptions.maxFrameRate = demoFrameRate;
      videoStartMs = Date.now();
      await videoSession.send("Page.startScreencast", screencastOptions);
    }

    const logPath = path.join(logsDir, "client.log");
    const errPath = path.join(logsDir, "client.errors.log");
    page.on("console", async (msg) => {
      const line = `${
        new Date().toISOString()
      } ${msg.type().toUpperCase()} console ${msg.text()}\n`;
      await Deno.writeTextFile(logPath, line, { append: true }).catch(() => {});
      if (msg.type() === "warning" || msg.type() === "error") {
        await Deno.writeTextFile(errPath, line, { append: true }).catch(
          () => {},
        );
      }
    });
    page.on("pageerror", async (err) => {
      const line = `${new Date().toISOString()} ERROR pageerror ${
        String(err)
      }\n`;
      await Deno.writeTextFile(errPath, line, { append: true }).catch(() => {});
    });

    const hostBaseUrl = getDemoBaseUrl(hostBridge);
    const baseUrl = hostBaseUrl ?? server.baseUrl;
    if (recordMic) {
      try {
        await context.grantPermissions(["microphone"], { origin: baseUrl });
      } catch (error) {
        console.warn("[gambit-demo] failed to grant mic permission:", error);
      }
    }
    const demoQuery = buildDemoQuery(baseUrl, resolvedViewport, demoContent);
    const initialUrl = buildDemoUrl(baseUrl, demoPath, demoQuery);
    await page.goto(initialUrl, { waitUntil: "domcontentloaded" });
    mediaRecorderIncludesAudio = useMediaRecorder &&
      (recordAudio || recordMic);
    if (recordVideo && useMediaRecorder) {
      if (!useIframeShell) {
        console.warn(
          "[gambit-demo] media recorder capture requires iframe-shell demo path.",
        );
      } else {
        mediaRecorderPath = path.join(latestDir, "mediarecorder.webm");
        await Deno.writeFile(mediaRecorderPath, new Uint8Array());
        await page.exposeFunction(
          "gambitMediaRecorderChunk",
          async (
            payload: { base64?: string; mimeType?: string; size?: number },
          ) => {
            if (!payload?.base64 || !mediaRecorderPath) return;
            const bytes = decodeBase64(payload.base64);
            await Deno.writeFile(mediaRecorderPath, bytes, { append: true });
            mediaRecorderMimeType = payload.mimeType || mediaRecorderMimeType;
            mediaRecorderBytes += payload.size ?? bytes.length;
            mediaRecorderChunks += 1;
          },
        );
        await page.exposeFunction(
          "gambitMediaRecorderStop",
          async (payload: { mimeType?: string; size?: number }) => {
            if (payload?.mimeType) {
              mediaRecorderMimeType = payload.mimeType;
            }
            if (payload?.size) {
              mediaRecorderBytes = Math.max(mediaRecorderBytes, payload.size);
            }
          },
        );
        try {
          await page.evaluate(
            ({ chunkMs, frameRate, includeAudio, includeMic }) => {
              const demo = (window as {
                gambitDemo?: {
                  video?: {
                    startRecording?: (opts: {
                      chunkMs?: number;
                      frameRate?: number;
                      includeAudio?: boolean;
                      includeMic?: boolean;
                    }) => Promise<void> | void;
                    ondata?: (payload: {
                      base64?: string;
                      mimeType?: string;
                      size?: number;
                    }) => void;
                    onstop?: (payload: {
                      mimeType?: string;
                      size?: number;
                    }) => void;
                  };
                };
                gambitMediaRecorderChunk?: (
                  payload: {
                    base64?: string;
                    mimeType?: string;
                    size?: number;
                  },
                ) => void;
                gambitMediaRecorderStop?: (
                  payload: { mimeType?: string; size?: number },
                ) => void;
              }).gambitDemo?.video;
              if (!demo?.startRecording) {
                throw new Error("media recorder API unavailable");
              }
              demo.ondata = (payload) =>
                (window as {
                  gambitMediaRecorderChunk?: (
                    payload: {
                      base64?: string;
                      mimeType?: string;
                      size?: number;
                    },
                  ) => void;
                }).gambitMediaRecorderChunk?.(payload);
              demo.onstop = (payload) =>
                (window as {
                  gambitMediaRecorderStop?: (
                    payload: { mimeType?: string; size?: number },
                  ) => void;
                }).gambitMediaRecorderStop?.(payload);
              demo.startRecording({
                chunkMs,
                frameRate,
                includeAudio,
                includeMic,
              });
            },
            {
              chunkMs: demoChunkMs,
              frameRate: demoFrameRate,
              includeAudio: recordAudio,
              includeMic: recordMic,
            },
          );
          mediaRecorderActive = true;
          videoStartMs = Date.now();
        } catch (error) {
          console.warn(
            "[gambit-demo] media recorder capture start failed:",
            error,
          );
        }
      }
    }
    if (recordAnyAudio && useIframeShell && !mediaRecorderIncludesAudio) {
      try {
        const startRequestMs = Date.now();
        await page.evaluate(
          ({ recordTab, recordMic }) => {
            return (window as {
              gambitDemo?: {
                audio?: {
                  startRecording?: (
                    opts: { includeTabAudio?: boolean; includeMic?: boolean },
                  ) => Promise<void> | void;
                };
              };
            }).gambitDemo?.audio?.startRecording?.({
              includeTabAudio: recordTab,
              includeMic: recordMic,
            });
          },
          { recordTab: recordAudio, recordMic },
        );
        audioStartMs = Date.now();
        if (videoStartMs !== null) {
          audioDelayMs = Math.max(0, audioStartMs - videoStartMs);
        } else {
          audioDelayMs = Math.max(0, audioStartMs - startRequestMs);
        }
        await appendIndexLine(
          latestDir,
          `audio_delay_ms: ${audioDelayMs}`,
        );
      } catch (error) {
        console.warn("[gambit-demo] audio recording start failed:", error);
      }
    } else if (recordAnyAudio && !useIframeShell) {
      console.warn(
        "[gambit-demo] audio recording requires iframe-shell demo path.",
      );
    }
    if (!page) {
      throw new Error("[gambit-demo] page not initialized");
    }
    const activePage = page;
    const demoTarget = await getDemoTarget(activePage, useIframeShell);
    await demoTarget.waitForSelector(".top-nav", { timeout: 30_000 })
      .catch(() => {});
    await wait(600);
    const scenarioContext: DemoScenarioContext = {
      baseUrl,
      demoTarget,
      page: activePage,
      screenshotsDir,
      useIframeShell,
      wait,
      screenshot: (label) => screenshot(activePage, screenshotsDir, label),
    };
    if (skipAutomation) {
      await scenarioContext.screenshot("00-shell");
    } else {
      await scenarioContext.screenshot("01-test-bot");
      await scenario(scenarioContext);
    }

    const durationMs = getDemoDurationMs();
    const waitForExit = shouldWaitForExit();
    if (durationMs) {
      const seconds = Math.round(durationMs / 1000);
      if (waitForExit) {
        console.log(
          `[gambit-demo] waiting ${seconds}s or press Enter to finish recording.`,
        );
        const buffer = new Uint8Array(1);
        await Promise.race([wait(durationMs), Deno.stdin.read(buffer)]);
      } else {
        console.log(
          `[gambit-demo] waiting ${seconds}s before finishing recording.`,
        );
        await wait(durationMs);
      }
    } else if (waitForExit) {
      console.log("[gambit-demo] waiting; press Enter to finish recording.");
      const buffer = new Uint8Array(1);
      await Deno.stdin.read(buffer);
    }
  } finally {
    if (
      recordAnyAudio && useIframeShell && page && !mediaRecorderIncludesAudio
    ) {
      try {
        const result = await page.evaluate(() => {
          return (window as {
            gambitDemo?: {
              audio?: {
                stopRecording?: () =>
                  | Promise<
                    { base64: string; mimeType?: string } | null
                  >
                  | { base64: string; mimeType?: string }
                  | null;
              };
            };
          }).gambitDemo?.audio?.stopRecording?.();
        });
        if (result?.base64) {
          const bytes = decodeBase64(result.base64);
          const mimeType = result.mimeType || "audio/webm";
          const ext = mimeType.includes("ogg") ? "ogg" : "webm";
          const audioPath = path.join(latestDir, `audio.${ext}`);
          await Deno.writeFile(audioPath, bytes);
          audioFilePath = audioPath;
        }
      } catch (error) {
        console.warn("[gambit-demo] audio recording stop failed:", error);
      }
    }

    if (recordVideo && videoSession) {
      try {
        videoRecordingActive = false;
        await videoSession.send("Page.stopScreencast");
      } catch (error) {
        console.warn("[gambit-demo] failed to stop screencast:", error);
      }
      try {
        (videoSession as unknown as { removeAllListeners?: () => void })
          .removeAllListeners?.();
      } catch (_) {
        // ignore
      }
      await videoSession.detach().catch(() => {});
      videoSession = null;
      const pending = [...pendingFrameWrites];
      pendingFrameWrites.clear();
      await Promise.allSettled(pending);
      await exportVideo(
        framesDir,
        latestDir,
        demoOutputFrameRate,
        demoInterpolation,
      );
    }
    if (recordVideo && mediaRecorderActive && page && useIframeShell) {
      try {
        const iframe = await page.$("#demo-frame");
        const frame = await iframe?.contentFrame();
        const result = frame
          ? await frame.evaluate(() => {
            return (window as {
              gambitDemo?: {
                video?: {
                  stopRecording?: () =>
                    | Promise<{ base64?: string; mimeType?: string } | null>
                    | { base64?: string; mimeType?: string }
                    | null;
                };
              };
            }).gambitDemo?.video?.stopRecording?.();
          })
          : null;
        if (result?.base64 && mediaRecorderPath) {
          const bytes = decodeBase64(result.base64);
          await Deno.writeFile(mediaRecorderPath, bytes, { append: true });
          mediaRecorderMimeType = result.mimeType || mediaRecorderMimeType;
          mediaRecorderBytes += bytes.length;
          mediaRecorderChunks += 1;
        }
      } catch (error) {
        console.warn(
          "[gambit-demo] media recorder capture stop failed:",
          error,
        );
      }
      if (mediaRecorderPath) {
        await appendIndexLine(
          latestDir,
          `mediarecorder_path: ${mediaRecorderPath}`,
        );
        await appendIndexLine(
          latestDir,
          `mediarecorder_mime: ${mediaRecorderMimeType ?? "unknown"}`,
        );
        await appendIndexLine(
          latestDir,
          `mediarecorder_bytes: ${mediaRecorderBytes}`,
        );
        await appendIndexLine(
          latestDir,
          `mediarecorder_chunks: ${mediaRecorderChunks}`,
        );
      }
    }

    if (
      recordAnyAudio &&
      recordVideo &&
      trimAudioDelay &&
      audioDelayMs &&
      audioDelayMs > 0
    ) {
      await trimMediaForAudioDelay({
        latestDir,
        trimMs: audioDelayMs,
        audioPath: audioFilePath,
      });
    }

    try {
      if (page) {
        await page.close();
      }
    } catch (_) {
      // ignore
    }

    try {
      if (context) {
        await context.close();
      }
    } catch (_) {
      // ignore
    }

    try {
      if (browser) {
        await browser.close();
      }
    } catch (_) {
      // ignore
    }

    // video export handled via CDP screencast

    await stopServer(server).catch(() => {});

    const runsDir = path.join(rootDir, "runs");
    const dest = path.join(runsDir, String(epochMs));
    await ensureDir(runsDir);
    try {
      await new Deno.Command("cp", {
        args: ["--reflink=auto", "-a", latestDir + "/", dest + "/"],
        stdout: "null",
        stderr: "piped",
      }).output();
    } catch {
      try {
        await new Deno.Command("cp", {
          args: ["-a", "-c", latestDir + "/", dest + "/"],
          stdout: "null",
          stderr: "piped",
        }).output();
      } catch {
        await new Deno.Command("cp", {
          args: ["-a", latestDir + "/", dest + "/"],
          stdout: "null",
          stderr: "piped",
        }).output();
      }
    }
  }
}
