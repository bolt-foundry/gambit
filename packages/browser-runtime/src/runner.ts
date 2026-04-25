// deno-lint-ignore-file gambit/no-unexplained-as-unknown
import { ensureDir } from "@std/fs";
import * as path from "@std/path";
import { getLogger } from "./logger.ts";
import { chromium } from "playwright-core";
import type {
  Browser,
  BrowserContext,
  CDPSession,
  Page,
} from "playwright-core";
import {
  buildDemoQuery,
  getDemoBaseUrl,
  getDemoDurationMs,
  getDemoFrameRate,
  getDemoInterpolationMode,
  getDemoOutputFrameRate,
  getDemoPath,
  getDemoViewport,
  getDemoWindowSize,
  getEffectiveDemoContentSize,
  getExecutablePath,
  getIframeShellPath,
  getMediaRecorderChunkMs,
  getMediaRecorderTitle,
  isIframeShellPath,
  shouldRecordAudio,
  shouldRecordMic,
  shouldRecordVideo,
  shouldSkipAutomation,
  shouldTrimAudioDelay,
  shouldUseMediaRecorder,
  shouldWaitForExit,
  useHostBridge,
} from "./config.ts";
import { exportVideo, trimMediaForAudioDelay } from "./capture.ts";
import { startHostBridgeChrome, stopHostBridgeChrome } from "./server.ts";
import {
  type BrowserGraphqlMockOptions,
  installBrowserGraphqlMocks,
} from "./graphqlMocks.ts";
import {
  appendIndexLine,
  buildDemoUrl,
  decodeBase64,
  screenshot,
  toSlug,
  wait,
} from "./utils.ts";
import { sharedBftE2eRoot } from "./paths.ts";
import {
  buildDemoIndexContent,
  copyLatestRun,
  getDemoTarget,
} from "./runnerHelpers.ts";
import type {
  DemoCookie,
  DemoPaths,
  DemoScenarioContext,
} from "./runnerTypes.ts";
export type { DemoScenarioContext } from "./runnerTypes.ts";

const logger = getLogger(import.meta);

export class DemoServerError extends Error {
  readonly exitCode: number;

  constructor(
    message: string,
    options?: { cause?: unknown; exitCode?: number },
  ) {
    super(message, { cause: options?.cause });
    this.name = "DemoServerError";
    this.exitCode = options?.exitCode ?? 42;
  }
}

function formatHostBridgeConnectError(
  wsEndpoint: string,
  error: unknown,
): Error {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const looksLikeTransientDisconnect = message.includes("connectOverCDP") &&
    (message.includes("Target page, context or browser has been closed") ||
      message.includes("remote error") ||
      message.includes("code=1011"));
  if (!looksLikeTransientDisconnect) {
    return error instanceof Error ? error : new Error(message);
  }
  const friendly = [
    "[gambit-demo] failed to attach to host-bridge Chrome (transient CDP disconnect).",
    "The browser websocket disconnected before automation could start.",
    `wsEndpoint: ${wsEndpoint}`,
    "Try rerunning the command. If this repeats, restart the host bridge/browser process.",
  ].join(" ");
  return new Error(friendly, { cause: error });
}
export function getDemoPaths(customSlug?: string): DemoPaths {
  const artifactRoot = Deno.env.get("GAMBIT_BROWSER_ARTIFACT_ROOT")?.trim() ||
    Deno.env.get("GAMBIT_DEMO_ARTIFACT_ROOT")?.trim() ||
    sharedBftE2eRoot;
  const slug = customSlug ??
    toSlug(Deno.env.get("GAMBIT_DEMO_SLUG") || "gambit-ui-demo");
  const rootDir = path.join(artifactRoot, slug);
  const latestDir = path.join(rootDir, "__latest__");
  const logsDir = path.join(latestDir, "logs");
  const screenshotsDir = path.join(latestDir, "screenshots");
  const framesDir = path.join(latestDir, "frames");
  return {
    artifactRoot,
    rootDir,
    latestDir,
    logsDir,
    screenshotsDir,
    framesDir,
    slug,
  };
}

export async function prepareDemoPaths(paths: DemoPaths): Promise<void> {
  await Deno.remove(paths.latestDir, { recursive: true }).catch(() => {});
  await ensureDir(paths.latestDir);
  await ensureDir(paths.logsDir);
  await ensureDir(paths.screenshotsDir);
  await ensureDir(paths.framesDir);
}

export async function runDemo(
  scenario: (ctx: DemoScenarioContext) => Promise<void>,
  options: {
    baseUrl: string;
    slug?: string;
    paths?: DemoPaths;
    cookies?: Array<DemoCookie>;
    graphqlMocks?: BrowserGraphqlMockOptions;
  },
): Promise<void> {
  let mediaRecorderIncludesAudio = false;
  const observedServerErrors = new Set<string>();
  const stderrEncoder = new TextEncoder();
  const paths = options.paths ?? getDemoPaths(options.slug);
  if (!options.paths) {
    await prepareDemoPaths(paths);
  }
  const {
    rootDir,
    latestDir,
    logsDir,
    screenshotsDir,
    framesDir,
    slug,
  } = paths;

  const headless = (Deno.env.get("GAMBIT_E2E_SHOW_BROWSER") || "") !== "true";
  const recordVideo = shouldRecordVideo();
  const recordAudio = shouldRecordAudio();
  const recordMic = shouldRecordMic();
  const recordAnyAudio = recordAudio || recordMic;
  const trimAudioDelay = shouldTrimAudioDelay(recordAnyAudio);
  const executablePath = getExecutablePath();
  const epochMs = Date.now();
  const hostBridge = useHostBridge();
  const requestedViewport = getDemoViewport();
  const demoPathRaw = getDemoPath();
  const demoFrameRate = getDemoFrameRate();
  const demoOutputFrameRate = getDemoOutputFrameRate(demoFrameRate);
  const demoInterpolation = getDemoInterpolationMode();
  const demoChunkMs = getMediaRecorderChunkMs();
  const useMediaRecorder = shouldUseMediaRecorder();
  const mediaRecorderTitle = getMediaRecorderTitle();
  const iframeShellPath = getIframeShellPath();
  const demoPath = useMediaRecorder && demoPathRaw === "/"
    ? iframeShellPath
    : demoPathRaw;
  const demoContent = getEffectiveDemoContentSize(demoPath);
  const useIframeShell = isIframeShellPath(demoPath);
  if (hostBridge) {
    await stopHostBridgeChrome();
  }
  const skipAutomation = shouldSkipAutomation();

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let videoSession: CDPSession | null = null;
  const pendingFrameWrites: Set<Promise<void>> = new Set();
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
    const viewport = requestedViewport ?? null;
    const windowSize = getDemoWindowSize(viewport);

    if (hostBridge) {
      const wsEndpoint = await startHostBridgeChrome({
        headless,
        windowSize,
        muteAudio: !recordAnyAudio,
        autoGrantMedia: recordAnyAudio || useMediaRecorder,
        allowScreenCapture: recordAudio || useMediaRecorder,
        autoSelectTabCaptureSourceByTitle: useMediaRecorder
          ? mediaRecorderTitle
          : null,
      });
      logger.info("[gambit-demo] host bridge ws:", wsEndpoint);
      try {
        browser = await chromium.connectOverCDP(wsEndpoint);
      } catch (error) {
        throw formatHostBridgeConnectError(wsEndpoint, error);
      }
    } else {
      const args = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ];
      if (windowSize) {
        args.push(`--window-size=${windowSize.width},${windowSize.height}`);
      }
      if (recordAnyAudio || useMediaRecorder) {
        args.push(
          "--autoplay-policy=no-user-gesture-required",
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
    if (options.graphqlMocks) {
      await installBrowserGraphqlMocks(pg, options.graphqlMocks);
    }
    if (requestedViewport) {
      try {
        await pg.setViewportSize(requestedViewport);
      } catch (error) {
        logger.warn("[gambit-demo] failed to set viewport size:", error);
      }
    }
    const resolvedViewport = requestedViewport ?? pg.viewportSize() ?? null;
    const index = buildDemoIndexContent({
      slug,
      epochMs,
      headless,
      executablePath,
      viewport: resolvedViewport,
      content: demoContent,
      capture: useMediaRecorder ? "mediarecorder" : "cdp",
      mediaRecorderChunkMs: useMediaRecorder ? demoChunkMs : "n/a",
      fps: demoFrameRate,
      outputFps: demoOutputFrameRate,
      interpolation: demoInterpolation ?? "off",
      recordAnyAudio,
      recordAudio,
      recordMic,
      trimAudioDelay: recordAnyAudio ? trimAudioDelay : "n/a",
      latestDir,
    });
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
              logger.warn(
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
    const recordServerError = async (line: string): Promise<void> => {
      observedServerErrors.add(line);
      try {
        Deno.stderr.writeSync(stderrEncoder.encode(`${line}\n`));
      } catch {
        // Best effort stderr surfacing.
      }
      await Deno.writeTextFile(errPath, line + "\n", { append: true }).catch(
        () => {},
      );
    };
    page.on("console", async (msg) => {
      const argsSummary = await Promise.all(
        msg.args().map(async (arg) => {
          try {
            const value = await arg.jsonValue();
            if (typeof value === "string") return value;
            return JSON.stringify(value);
          } catch {
            return "[unserializable]";
          }
        }),
      ).then((parts) => parts.filter(Boolean).join(" "));
      const messageText = [msg.text(), argsSummary].filter(Boolean).join(" ");
      const line = `${
        new Date().toISOString()
      } ${msg.type().toUpperCase()} console ${messageText}\n`;
      await Deno.writeTextFile(logPath, line, { append: true }).catch(() => {});
      if (msg.type() === "warning" || msg.type() === "error") {
        await Deno.writeTextFile(errPath, line, { append: true }).catch(
          () => {},
        );
      }
      if (msg.type() === "error") {
        const normalizedMessage = messageText.replace(/\s+/g, " ").trim();
        await recordServerError(
          `${new Date().toISOString()} ERROR console-error ${
            normalizedMessage || "(empty message)"
          }`,
        );
      }
    });
    page.on("pageerror", async (err) => {
      const line = `${new Date().toISOString()} ERROR pageerror ${
        String(err)
      }\n`;
      await Deno.writeTextFile(errPath, line, { append: true }).catch(() => {});
      const normalizedError = String(err).replace(/\s+/g, " ").trim();
      await recordServerError(
        `${new Date().toISOString()} ERROR pageerror ${
          normalizedError || "(empty error)"
        }`,
      );
    });
    page.on("response", async (response) => {
      const request = response.request();
      const method = request.method().toUpperCase();
      const url = response.url();

      if (response.status() >= 500) {
        await recordServerError(
          `${
            new Date().toISOString()
          } ERROR server-response ${method} ${response.status()} ${url}`,
        );
        return;
      }

      if (!url.includes("/graphql") || method !== "POST") {
        return;
      }

      try {
        const payload = await response.json().catch(() => null) as
          | {
            errors?: Array<
              { message?: string; extensions?: { code?: string } }
            >;
          }
          | null;
        const errors = Array.isArray(payload?.errors) ? payload.errors : [];
        if (errors.length === 0) return;
        const hasInternalServerError = errors.some((error) =>
          error?.extensions?.code === "INTERNAL_SERVER_ERROR"
        );
        if (!hasInternalServerError) return;
        const firstMessage = errors.find((error) =>
          typeof error?.message === "string" && error.message.trim().length > 0
        )?.message ??
          "GraphQL INTERNAL_SERVER_ERROR";
        await recordServerError(
          `${
            new Date().toISOString()
          } ERROR graphql-internal-server-error ${method} ${url} message=${
            JSON.stringify(firstMessage)
          }`,
        );
      } catch (error) {
        await Deno.writeTextFile(
          logPath,
          `${
            new Date().toISOString()
          } WARN graphql-error-parse-failed ${method} ${url} ${
            error instanceof Error ? error.message : String(error)
          }\n`,
          { append: true },
        ).catch(() => {});
      }
    });

    const hostBaseUrl = getDemoBaseUrl(hostBridge);
    const baseUrl = hostBaseUrl ?? options.baseUrl;
    if (recordMic) {
      try {
        await context.grantPermissions(["microphone"], { origin: baseUrl });
      } catch (error) {
        logger.warn("[gambit-demo] failed to grant mic permission:", error);
      }
    }
    if (options.cookies?.length) {
      try {
        await context.addCookies(options.cookies);
      } catch (error) {
        logger.warn("[gambit-demo] failed to add cookies:", error);
      }
    }
    const demoQuery = buildDemoQuery(baseUrl, requestedViewport, demoContent);
    const initialUrl = buildDemoUrl(baseUrl, demoPath, demoQuery);
    await page.goto(initialUrl, { waitUntil: "domcontentloaded" });
    mediaRecorderIncludesAudio = useMediaRecorder &&
      (recordAudio || recordMic);
    if (recordVideo && useMediaRecorder) {
      if (!useIframeShell) {
        logger.warn(
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
          (payload: { mimeType?: string; size?: number }) => {
            if (payload?.mimeType) {
              mediaRecorderMimeType = payload.mimeType;
            }
            if (payload?.size) {
              mediaRecorderBytes = Math.max(mediaRecorderBytes, payload.size);
            }
          },
        );
        try {
          const { needsGesture, startError } = await page.evaluate(
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
                    prepareRecording?: (opts: {
                      chunkMs?: number;
                      frameRate?: number;
                      includeAudio?: boolean;
                      includeMic?: boolean;
                    }) => void;
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
              const opts = {
                chunkMs,
                frameRate,
                includeAudio,
                includeMic,
              };
              if (typeof demo.prepareRecording === "function") {
                demo.prepareRecording(opts);
                return { needsGesture: true };
              }
              try {
                demo.startRecording(opts);
                return { needsGesture: false };
              } catch (error) {
                return {
                  needsGesture: false,
                  startError: error instanceof Error
                    ? error.message
                    : String(error ?? "unknown error"),
                };
              }
            },
            {
              chunkMs: demoChunkMs,
              frameRate: demoFrameRate,
              includeAudio: recordAudio,
              includeMic: recordMic,
            },
          );
          if (startError) {
            logger.warn(
              "[gambit-demo] media recorder start error:",
              startError,
            );
          }
          if (needsGesture) {
            try {
              await page.click("#gambit-start-capture", { timeout: 10_000 });
            } catch (error) {
              logger.warn(
                "[gambit-demo] failed to click media recorder start button:",
                error,
              );
            }
          }
          mediaRecorderActive = true;
          videoStartMs = Date.now();
        } catch (error) {
          logger.warn(
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
        logger.warn("[gambit-demo] audio recording start failed:", error);
      }
    } else if (recordAnyAudio && !useIframeShell) {
      logger.warn(
        "[gambit-demo] audio recording requires iframe-shell demo path.",
      );
    }
    if (!page) {
      throw new Error("[gambit-demo] page not initialized");
    }
    const activePage = page;
    const demoTarget = await getDemoTarget(activePage, useIframeShell);
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
        logger.info(
          `[gambit-demo] waiting ${seconds}s or press Enter to finish recording.`,
        );
        const buffer = new Uint8Array(1);
        await Promise.race([wait(durationMs), Deno.stdin.read(buffer)]);
      } else {
        logger.info(
          `[gambit-demo] waiting ${seconds}s before finishing recording.`,
        );
        await wait(durationMs);
      }
    } else if (waitForExit) {
      logger.info("[gambit-demo] waiting; press Enter to finish recording.");
      const buffer = new Uint8Array(1);
      await Deno.stdin.read(buffer);
    }

    if (observedServerErrors.size > 0) {
      const errors = Array.from(observedServerErrors);
      throw new DemoServerError(
        [
          `[gambit-demo] observed ${errors.length} server error(s) during run.`,
          `See ${errPath} for details.`,
          `First error: ${errors[0]}`,
        ].join(" "),
      );
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
        logger.warn("[gambit-demo] audio recording stop failed:", error);
      }
    }

    if (recordVideo && videoSession) {
      try {
        videoRecordingActive = false;
        await videoSession.send("Page.stopScreencast");
      } catch (error) {
        logger.warn("[gambit-demo] failed to stop screencast:", error);
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
        logger.warn(
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

    const runsDir = path.join(rootDir, "runs");
    const dest = path.join(runsDir, String(epochMs));
    await ensureDir(runsDir);
    await copyLatestRun(latestDir, dest);
  }
}
