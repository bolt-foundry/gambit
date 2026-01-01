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
import {
  buildDemoQuery,
  getDemoBaseUrl,
  getDemoDurationMs,
  getDemoFrameRate,
  getDemoInterpolationMode,
  getDemoOutputFrameRate,
  getDemoPath,
  getDemoPort,
  getDemoViewport,
  getEffectiveDemoContentSize,
  getExecutablePath,
  getMediaRecorderChunkMs,
  getMediaRecorderTitle,
  shouldRecordAudio,
  shouldRecordMic,
  shouldRecordVideo,
  shouldSkipAutomation,
  shouldTrimAudioDelay,
  shouldUseMediaRecorder,
  shouldWaitForExit,
  useHostBridge,
  type ViewportSize,
} from "./demo-config.ts";
import { exportVideo, trimMediaForAudioDelay } from "./demo-capture.ts";
import {
  startHostBridgeChrome,
  startServer,
  stopBoltfoundryDevServer,
  stopHostBridgeChrome,
  stopServer,
} from "./demo-server.ts";
import {
  appendIndexLine,
  buildDemoUrl,
  decodeBase64,
  screenshot,
  toSlug,
  wait,
} from "./demo-utils.ts";

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
