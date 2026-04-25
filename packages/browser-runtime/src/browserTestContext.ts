// deno-lint-ignore-file no-console
import { ensureDir } from "@std/fs";
import * as path from "@std/path";
import {
  type BrowserLaunchProvider,
  type BrowserRuntimeMode,
  type BrowserRuntimeProfileOverrides,
  getBrowserRuntimeEnvPatch,
  getBrowserRuntimeProfile,
  getBrowserTempEnvPatch,
} from "./browserRuntime.ts";
import { exportVideo, transcodeMediaRecorderVideo } from "./capture.ts";
import { getDefaultBrowserBaseUrl } from "./appTargets.ts";
import {
  type BrowserTestRect,
  type BrowserTestScrollMetrics,
  readElementRect,
  readElementScrollMetrics,
} from "./browserDomMetrics.ts";
import {
  click as clickTarget,
  currentPath as readCurrentPath,
  exists as targetExists,
  graphql as runGraphql,
  safeGoto,
  scrollTo as scrollTarget,
  selectText as selectTargetText,
  text as readText,
  typeInto,
  value as readValue,
  waitForText as waitForTargetText,
  waitForUrl as waitForTargetUrl,
  waitForVisible as waitForTargetVisible,
} from "./browserTestContextActions.ts";
import {
  type ServerProcessInfo,
  type ServerSpawnOptions,
  startEmbeddedServer,
  stopEmbeddedServer,
} from "./browserTestContextServer.ts";
import {
  decodeBase64,
  getDefaultArtifactRoot,
  isIgnorableCloseError,
  killDanglingChromiumProcesses,
  localSystemBrowserError,
  runCleanupStepWithTimeout,
  saveScreenshot,
  wait,
} from "./browserTestContextShared.ts";
import type { BrowserGraphqlMockOptions } from "./graphqlMocks.ts";
import { installBrowserGraphqlMocks } from "./graphqlMocks.ts";
import { startHostBridgeChrome, stopHostBridgeChrome } from "./server.ts";
import { getDemoTarget } from "./runnerHelpers.ts";
import { buildDemoUrl, toSlug } from "./utils.ts";
import {
  buildDemoQuery,
  getDemoFrameRate,
  getExecutablePath,
  getIframeShellPath,
  getMediaRecorderChunkMs,
  getMediaRecorderTitle,
} from "./config.ts";
import {
  type Browser,
  type BrowserContext,
  type CDPSession,
  chromium,
  type Frame,
  type Page,
  type Request as PlaywrightRequest,
} from "playwright-core";

export type CreateBrowserTestContextOptions = {
  mode?: BrowserRuntimeMode;
  runtimeProfileOverrides?: BrowserRuntimeProfileOverrides;
  browserProvider?: BrowserLaunchProvider;
  baseUrl?: string;
  resolveBaseUrl?: (rawBaseUrl: string | undefined) => string;
  artifactRoot?: string;
  server?: ServerSpawnOptions;
  graphqlMocks?: BrowserGraphqlMockOptions;
};

export type BrowserTestContext = {
  meta(): {
    testName: string;
    slug: string;
    epochMs: number;
    headless: boolean;
    mode: BrowserRuntimeMode;
  };
  paths(): {
    root: string;
    latest: string;
    logs: string;
    screenshots: string;
    frames: string;
    video: string;
  };
  navigate(urlOrPath: string): Promise<void>;
  waitForUrl(
    re: RegExp,
    opts?: { quietMs?: number; timeoutMs?: number },
  ): Promise<void>;
  waitForText(
    selector: string,
    expected: string | RegExp,
    opts?: { timeoutMs?: number },
  ): Promise<void>;
  currentPath(): Promise<string>;
  graphql(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<unknown>;
  click(selector: string): Promise<void>;
  waitForVisible(
    selector: string,
    opts?: { timeoutMs?: number },
  ): Promise<void>;
  type(
    selector: string,
    text: string,
    opts?: { clear?: boolean },
  ): Promise<void>;
  selectText(
    selector: string,
    opts?: { text?: string; occurrence?: number },
  ): Promise<string>;
  scrollTo(
    selector: string,
    opts: { top?: number; left?: number },
  ): Promise<void>;
  exists(selector: string): Promise<boolean>;
  text(selector: string): Promise<string>;
  value(selector: string): Promise<string>;
  setViewport(size: { width: number; height: number }): Promise<void>;
  rect(selector: string): Promise<BrowserTestRect | null>;
  scrollMetrics(selector: string): Promise<BrowserTestScrollMetrics | null>;
  screenshot(label: string): Promise<string>;
  close(): Promise<void>;
};

export type DisposableBrowserTestContext = BrowserTestContext & {
  [Symbol.asyncDispose](): PromiseLike<void>;
};

function resolveBaseUrl(
  options: CreateBrowserTestContextOptions | undefined,
): string {
  if (options?.resolveBaseUrl) return options.resolveBaseUrl(options.baseUrl);
  if (options?.baseUrl) return options.baseUrl.replace(/\/$/, "");
  return getDefaultBrowserBaseUrl();
}

class BrowserTestContextImpl {
  browser: Browser | null = null;
  context: BrowserContext | null = null;
  page: Page | null = null;
  frame: Frame | null = null;
  runBaseDir?: string;
  slug: string;
  testName: string;
  epochMs = Date.now();
  headless = true;
  recordVideo = true;
  videoSession?: CDPSession;
  pendingFrameWrites: Set<Promise<void>> = new Set();
  frameSeq = 0;
  frameDir?: string;
  videoPath?: string;
  latestVideoPath?: string;
  videoRecordingActive = false;
  private readonly mode: BrowserRuntimeMode;
  private readonly artifactRoot: string;
  private readonly runtimeEnvRestore: Map<string, string | undefined>;
  private readonly resolveBaseUrlFn?: (
    rawBaseUrl: string | undefined,
  ) => string;
  private baseUrl: string;
  private server?: ServerProcessInfo;
  private readonly activeRequests = new Map<PlaywrightRequest, string>();
  private usingHostBridge = false;
  private usingIframeHarness = false;
  private mediaRecorderPath?: string;
  private mediaRecorderMimeType?: string;
  private mediaRecorderBytes = 0;
  private mediaRecorderChunks = 0;
  private mediaRecorderActive = false;
  private mediaRecorderDebugPath?: string;
  private mediaRecorderPendingWrites: Set<Promise<void>> = new Set();

  private constructor(
    slug: string,
    testName: string,
    mode: BrowserRuntimeMode,
    artifactRoot: string,
    baseUrl: string,
    resolveBaseUrlFn: ((rawBaseUrl: string | undefined) => string) | undefined,
    runtimeEnvRestore: Map<string, string | undefined>,
  ) {
    this.slug = slug;
    this.testName = testName;
    this.mode = mode;
    this.artifactRoot = artifactRoot;
    this.baseUrl = baseUrl;
    this.resolveBaseUrlFn = resolveBaseUrlFn;
    this.runtimeEnvRestore = runtimeEnvRestore;
  }

  static async create(
    testName: string,
    options?: CreateBrowserTestContextOptions,
  ): Promise<BrowserTestContextImpl> {
    const mode = options?.mode ?? "test";
    const profile = getBrowserRuntimeProfile(
      mode,
      {
        ...options?.runtimeProfileOverrides,
        browserProvider: options?.browserProvider ??
          options?.runtimeProfileOverrides?.browserProvider,
      },
    );
    const runtimeEnvRestore = new Map<string, string | undefined>();
    for (
      const [key, value] of Object.entries(getBrowserRuntimeEnvPatch(profile))
    ) {
      runtimeEnvRestore.set(key, Deno.env.get(key));
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    for (const [key, value] of Object.entries(getBrowserTempEnvPatch())) {
      if (!runtimeEnvRestore.has(key)) {
        runtimeEnvRestore.set(key, Deno.env.get(key));
      }
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    if (
      profile.useHostBridge && !Deno.env.get("WORKSPACE_ID") &&
      !runtimeEnvRestore.has("WORKSPACE_ID")
    ) {
      runtimeEnvRestore.set("WORKSPACE_ID", undefined);
      Deno.env.set("WORKSPACE_ID", Deno.hostname());
    }

    try {
      const headless = (Deno.env.get("BF_E2E_SHOW_BROWSER") || "") !== "true";
      const executablePath = getExecutablePath();

      await killDanglingChromiumProcesses();

      const slug = toSlug(testName);
      const artifactRoot = options?.artifactRoot ?? getDefaultArtifactRoot();
      const ctx = new BrowserTestContextImpl(
        slug,
        testName,
        mode,
        artifactRoot,
        resolveBaseUrl(options),
        options?.resolveBaseUrl,
        runtimeEnvRestore,
      );
      ctx.headless = headless;

      const latestDir = path.join(artifactRoot, slug, "__latest__");
      await Deno.remove(latestDir, { recursive: true }).catch(() => {});
      await ensureDir(latestDir);
      ctx.runBaseDir = latestDir;

      const logsDir = path.join(latestDir, "logs");
      await ensureDir(logsDir);
      if (options?.server) {
        await ctx.startServer(options.server, logsDir);
      }

      const index = [
        `test_name: ${testName}`,
        `slug: ${slug}`,
        `epoch_ms: ${ctx.epochMs}`,
        `mode: ${mode}`,
        `headless: ${String(headless)}`,
        `executable_path: ${String(executablePath ?? "auto")}`,
        `base_dir: ${latestDir}`,
        `base_url: ${ctx.baseUrl}`,
      ].join("\n");
      await Deno.writeTextFile(path.join(latestDir, "index.txt"), `${index}\n`);

      if (profile.browserProvider === "host-bridge") {
        await stopHostBridgeChrome();
        const wsEndpoint = await startHostBridgeChrome({
          headless,
          windowSize: { width: 1280, height: 720 },
        });
        ctx.browser = await chromium.connectOverCDP(wsEndpoint);
        ctx.usingHostBridge = true;
      } else if (profile.browserProvider === "local-system") {
        if (!executablePath) throw localSystemBrowserError();
        const launchArgs = [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--window-size=1280,720",
        ];
        if (profile.useMediaRecorder) {
          launchArgs.push(
            "--autoplay-policy=no-user-gesture-required",
            "--enable-usermedia-screen-capturing",
          );
          const mediaRecorderTitle = getMediaRecorderTitle();
          if (mediaRecorderTitle) {
            launchArgs.push(
              `--auto-select-tab-capture-source-by-title=${mediaRecorderTitle}`,
            );
          }
        }
        ctx.browser = await chromium.launch({
          headless,
          executablePath,
          args: launchArgs,
        });
      } else {
        const launchArgs = [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--window-size=1280,720",
        ];
        if (profile.useMediaRecorder) {
          launchArgs.push(
            "--autoplay-policy=no-user-gesture-required",
            "--enable-usermedia-screen-capturing",
          );
          const mediaRecorderTitle = getMediaRecorderTitle();
          if (mediaRecorderTitle) {
            launchArgs.push(
              `--auto-select-tab-capture-source-by-title=${mediaRecorderTitle}`,
            );
          }
        }
        ctx.browser = await chromium.launch({
          headless,
          args: launchArgs,
        });
      }

      ctx.context = ctx.browser.contexts()[0] ?? await ctx.browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      ctx.page = ctx.context.pages()[0] ?? await ctx.context.newPage();
      if (options?.graphqlMocks) {
        await installBrowserGraphqlMocks(ctx.page, options.graphqlMocks);
      }
      await ctx.page.setViewportSize({ width: 1280, height: 720 }).catch(
        () => {},
      );

      const clientLogPath = path.join(logsDir, "client.log");
      const clientErrPath = path.join(logsDir, "client.errors.log");
      const writeLog = async (level: string, source: string, msg: string) => {
        const line = `${
          new Date().toISOString()
        } ${level.toUpperCase()} ${source} ${msg}\n`;
        await Deno.writeTextFile(clientLogPath, line, { append: true }).catch(
          () => {},
        );
        if (level === "warn" || level === "warning" || level === "error") {
          await Deno.writeTextFile(clientErrPath, line, {
            append: true,
          }).catch(() => {});
        }
      };
      ctx.page.on("console", (msg) => {
        writeLog(msg.type(), "console", msg.text()).catch(() => {});
      });
      ctx.page.on("pageerror", (err) => {
        writeLog("error", "pageerror", String(err)).catch(() => {});
      });
      ctx.page.on("request", (request) => {
        const descriptor =
          `${request.method()} ${request.resourceType()} ${request.url()}`;
        ctx.activeRequests.set(request, descriptor);
      });
      ctx.page.on("requestfinished", (request) => {
        ctx.activeRequests.delete(request);
      });
      ctx.page.on("requestfailed", (request) => {
        ctx.activeRequests.delete(request);
      });

      ctx.frameDir = path.join(latestDir, "frames");
      await ensureDir(ctx.frameDir);
      ctx.videoPath = path.join(latestDir, "video.mp4");
      ctx.usingIframeHarness = profile.useMediaRecorder;
      if (ctx.usingIframeHarness) {
        await ctx.installIframeShellRoute();
        await ctx.openIframeHarness();
      }
      ctx.recordVideo = (() => {
        const raw = (Deno.env.get("BF_E2E_RECORD_VIDEO") || "").toLowerCase()
          .trim();
        return !(raw === "false" || raw === "0" || raw === "no");
      })();

      if (ctx.recordVideo) {
        const latestArtifactsDir = path.join(artifactRoot, "latest-artifacts");
        await ensureDir(latestArtifactsDir);
        ctx.latestVideoPath = path.join(latestArtifactsDir, `${slug}.mp4`);
        await ctx.startVideoRecording().catch((error) => {
          console.warn(
            "[browser-test] failed to enable CDP video recording:",
            error,
          );
        });
        if (ctx.usingIframeHarness) {
          await ctx.startMediaRecorderRecording().catch((error) => {
            console.warn(
              "[browser-test] failed to enable MediaRecorder video recording:",
              error,
            );
          });
        }
        if (!ctx.videoRecordingActive && !ctx.mediaRecorderActive) {
          ctx.recordVideo = false;
        }
      }

      return ctx;
    } catch (error) {
      for (const [key, value] of runtimeEnvRestore) {
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      }
      throw error;
    }
  }

  async screenshot(label: string): Promise<string> {
    if (!this.page || !this.runBaseDir) return "";
    if (this.usingIframeHarness) {
      return await saveScreenshot(
        this.page.locator("#demo-frame"),
        label,
        this.runBaseDir,
        this.artifactRoot,
      );
    }
    return await saveScreenshot(
      this.page,
      label,
      this.runBaseDir,
      this.artifactRoot,
    );
  }

  async navigate(urlOrPath: string): Promise<void> {
    if (!this.page) throw new Error("context page not initialized");
    const url = /^(https?:)?\/\//.test(urlOrPath)
      ? urlOrPath
      : new URL(urlOrPath, this.baseUrl).toString();
    await this.safeGoto(url);
  }

  async waitForUrl(
    re: RegExp,
    opts?: { quietMs?: number; timeoutMs?: number },
  ): Promise<void> {
    await waitForTargetUrl(this.getActionTarget(), re, opts);
  }

  async currentPath(): Promise<string> {
    return await readCurrentPath(this.getActionTarget());
  }

  async waitForText(
    selector: string,
    expected: string | RegExp,
    opts?: { timeoutMs?: number },
  ): Promise<void> {
    await waitForTargetText(this.getActionTarget(), selector, expected, opts);
  }

  async graphql(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<unknown> {
    return await runGraphql(this.getActionTarget(), query, variables);
  }

  async click(selector: string): Promise<void> {
    await clickTarget(this.getActionTarget(), selector);
  }

  async waitForVisible(
    selector: string,
    opts?: { timeoutMs?: number },
  ): Promise<void> {
    await waitForTargetVisible(this.getActionTarget(), selector, opts);
  }

  async type(
    selector: string,
    text: string,
    opts?: { clear?: boolean },
  ): Promise<void> {
    await typeInto(this.getActionTarget(), selector, text, opts);
  }

  async selectText(
    selector: string,
    opts?: { text?: string; occurrence?: number },
  ): Promise<string> {
    return await selectTargetText(this.getActionTarget(), selector, opts);
  }

  async scrollTo(
    selector: string,
    opts: { top?: number; left?: number },
  ): Promise<void> {
    await scrollTarget(this.getActionTarget(), selector, opts);
  }

  async exists(selector: string): Promise<boolean> {
    return await targetExists(this.getActionTarget(), selector);
  }

  async text(selector: string): Promise<string> {
    return await readText(this.getActionTarget(), selector);
  }

  async value(selector: string): Promise<string> {
    return await readValue(this.getActionTarget(), selector);
  }

  async setViewport(size: { width: number; height: number }): Promise<void> {
    if (!this.page) throw new Error("context page not initialized");
    await this.page.setViewportSize(size);
  }

  async rect(selector: string): Promise<BrowserTestRect | null> {
    return await readElementRect(this.getActionTarget(), selector);
  }

  async scrollMetrics(
    selector: string,
  ): Promise<BrowserTestScrollMetrics | null> {
    return await readElementScrollMetrics(this.getActionTarget(), selector);
  }

  private async safeGoto(url: string): Promise<void> {
    if (!this.page) throw new Error("context page not initialized");
    await safeGoto(
      this.page,
      this.getActionTarget(),
      url,
      this.activeRequests,
      (label) => this.screenshot(label),
    );
  }

  private async startServer(
    options: ServerSpawnOptions,
    logsDir: string,
  ): Promise<void> {
    const server = await startEmbeddedServer(
      options,
      logsDir,
      (rawBaseUrl) =>
        this.resolveBaseUrlFn ? this.resolveBaseUrlFn(rawBaseUrl) : rawBaseUrl,
    );
    this.baseUrl = server.baseUrl;
    this.server = server.server;
  }

  private async stopServer(): Promise<void> {
    if (!this.server) return;
    await stopEmbeddedServer(this.server);
    this.server = undefined;
  }

  private getActionTarget(): Page | Frame {
    if (this.usingIframeHarness && this.frame) return this.frame;
    if (!this.page) throw new Error("context page not initialized");
    return this.page;
  }

  private async installIframeShellRoute(): Promise<void> {
    if (!this.page) return;
    const shellHtml = await Deno.readTextFile(
      path.join(
        path.dirname(path.fromFileUrl(import.meta.url)),
        "../assets/iframe-shell.html",
      ),
    );
    const routePattern = new RegExp(
      `${getIframeShellPath()}(?:\\.html)?(?:\\?.*)?$`,
    );
    await this.page.route(routePattern, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: shellHtml,
      });
    });
  }

  private async openIframeHarness(): Promise<void> {
    if (!this.page) return;
    const shellBaseUrl = this.getIframeShellBaseUrl();
    const query = new URLSearchParams(
      buildDemoQuery(this.baseUrl, { width: 1280, height: 720 }, null) ?? "",
    );
    query.set("base", this.baseUrl);
    query.set("path", "/");
    const shellUrl = buildDemoUrl(
      shellBaseUrl,
      getIframeShellPath(),
      query.toString(),
    );
    await this.page.goto(shellUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    this.frame = await getDemoTarget(this.page, true) as Frame;
  }

  private getIframeShellBaseUrl(): string {
    const shellUrl = new URL(this.baseUrl);
    shellUrl.protocol = "http:";
    shellUrl.hostname = "127.0.0.1";
    if (!shellUrl.port) {
      shellUrl.port = this.server
        ? String(new URL(this.baseUrl).port || 8000)
        : "8000";
    }
    return shellUrl.toString();
  }

  private async startVideoRecording(): Promise<void> {
    if (!this.page || !this.frameDir) return;
    const session = await this.page.context().newCDPSession(this.page);
    this.videoSession = session;
    this.videoRecordingActive = true;
    await session.send("Page.enable");
    session.on(
      "Page.screencastFrame",
      (event: { data: string; sessionId: number }) => {
        if (!this.videoRecordingActive || !this.frameDir) {
          void session.send("Page.screencastFrameAck", {
            sessionId: event.sessionId,
          }).catch(() => {});
          return;
        }
        const filename = `frame-${
          (++this.frameSeq).toString().padStart(6, "0")
        }.png`;
        const writePromise = Deno.writeFile(
          path.join(this.frameDir, filename),
          decodeBase64(event.data),
        ).catch((error) => {
          console.warn(
            `[browser-test] failed to write frame ${filename}:`,
            error,
          );
        });
        this.pendingFrameWrites.add(writePromise);
        writePromise.finally(() =>
          this.pendingFrameWrites.delete(writePromise)
        );
        void session.send("Page.screencastFrameAck", {
          sessionId: event.sessionId,
        }).catch(() => {});
      },
    );
    try {
      await session.send("Page.startScreencast", {
        format: "png",
        everyNthFrame: 1,
        quality: 80,
      });
    } catch (error) {
      this.videoRecordingActive = false;
      await session.detach().catch(() => {});
      this.videoSession = undefined;
      throw error;
    }
  }

  private async stopVideoRecording(): Promise<void> {
    if (!this.videoSession) return;
    this.videoRecordingActive = false;
    await this.videoSession.send("Page.stopScreencast").catch(() => {});
    await this.videoSession.detach().catch(() => {});
    this.videoSession = undefined;
  }

  private async flushVideoFrames(): Promise<void> {
    const pending = [...this.pendingFrameWrites];
    this.pendingFrameWrites.clear();
    await Promise.all(pending);
  }

  private async hasRecordedFrames(): Promise<boolean> {
    if (!this.frameDir) return false;
    for await (const entry of Deno.readDir(this.frameDir)) {
      if (entry.isFile) return true;
    }
    return false;
  }

  private async exportVideo(): Promise<void> {
    if (
      !this.frameDir || !this.videoPath || !(await this.hasRecordedFrames())
    ) {
      return;
    }
    try {
      await exportVideo(this.frameDir, path.dirname(this.videoPath), 30);
      if (this.latestVideoPath) {
        await Deno.copyFile(this.videoPath, this.latestVideoPath).catch(
          () => {},
        );
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        console.warn("[browser-test] ffmpeg not found; preserving PNG frames");
      } else {
        console.warn("[browser-test] ffmpeg failed to render video:", error);
      }
    }
  }

  private async logMediaRecorderDebug(
    event: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.runBaseDir) return;
    if (!this.mediaRecorderDebugPath) {
      this.mediaRecorderDebugPath = path.join(
        this.runBaseDir,
        "logs",
        "mediarecorder.debug.log",
      );
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...details,
    });
    await Deno.writeTextFile(this.mediaRecorderDebugPath, `${line}\n`, {
      append: true,
      create: true,
    }).catch(() => {});
  }

  private async startMediaRecorderRecording(): Promise<void> {
    if (!this.page || !this.runBaseDir || !this.usingIframeHarness) return;
    this.mediaRecorderPath = path.join(this.runBaseDir, "mediarecorder.webm");
    this.mediaRecorderDebugPath = path.join(
      this.runBaseDir,
      "logs",
      "mediarecorder.debug.log",
    );
    this.mediaRecorderMimeType = undefined;
    this.mediaRecorderBytes = 0;
    this.mediaRecorderChunks = 0;
    this.mediaRecorderPendingWrites.clear();
    await Deno.remove(this.mediaRecorderPath).catch(() => {});
    await this.logMediaRecorderDebug("start:init", {
      path: this.mediaRecorderPath,
      usingIframeHarness: this.usingIframeHarness,
    });
    await this.page.exposeFunction(
      "browserTestMediaRecorderChunk",
      (payload: { base64?: string; mimeType?: string; size?: number }) => {
        this.mediaRecorderChunks += 1;
        if (payload?.mimeType) {
          this.mediaRecorderMimeType = payload.mimeType;
        }
        if (payload?.size) {
          this.mediaRecorderBytes += payload.size;
        }
        if (payload?.base64 && this.mediaRecorderPath) {
          const bytes = decodeBase64(payload.base64);
          const writePromise = Deno.writeFile(this.mediaRecorderPath, bytes, {
            append: true,
            create: true,
          });
          this.mediaRecorderPendingWrites.add(writePromise);
          writePromise.finally(() =>
            this.mediaRecorderPendingWrites.delete(writePromise)
          );
        }
        void this.logMediaRecorderDebug("chunk", {
          chunkIndex: this.mediaRecorderChunks,
          mimeType: payload?.mimeType,
          size: payload?.size,
          hasBase64: !!payload?.base64,
        });
      },
    );
    await this.page.exposeFunction(
      "browserTestMediaRecorderStop",
      (payload: { mimeType?: string; size?: number }) => {
        if (payload?.mimeType) {
          this.mediaRecorderMimeType = payload.mimeType;
        }
        if (payload?.size) {
          this.mediaRecorderBytes = Math.max(
            this.mediaRecorderBytes,
            payload.size,
          );
        }
        void this.logMediaRecorderDebug("stop:event", {
          mimeType: payload?.mimeType,
          size: payload?.size,
        });
      },
    );
    const { needsGesture, startError, debug } = await this.page.evaluate(
      async ({ chunkMs, frameRate }) => {
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
          browserTestMediaRecorderChunk?: (payload: {
            base64?: string;
            mimeType?: string;
            size?: number;
          }) => void;
          browserTestMediaRecorderStop?: (payload: {
            mimeType?: string;
            size?: number;
          }) => void;
        }).gambitDemo?.video;
        if (!demo?.startRecording) {
          throw new Error("media recorder API unavailable");
        }
        demo.ondata = undefined;
        demo.onstop = (payload) =>
          (window as {
            browserTestMediaRecorderStop?: (payload: {
              mimeType?: string;
              size?: number;
            }) => void;
          }).browserTestMediaRecorderStop?.(payload);
        demo.ondata = (payload) =>
          (window as {
            browserTestMediaRecorderChunk?: (payload: {
              base64?: string;
              mimeType?: string;
              size?: number;
            }) => void;
          }).browserTestMediaRecorderChunk?.({
            base64: payload?.base64,
            mimeType: payload?.mimeType,
            size: payload?.size,
          });
        const opts = {
          chunkMs,
          frameRate,
          includeAudio: false,
          includeMic: false,
        };
        if (typeof demo.prepareRecording === "function") {
          demo.prepareRecording(opts);
          return {
            needsGesture: true,
            debug: {
              isSecureContext: globalThis.isSecureContext,
              hasMediaDevices: typeof navigator.mediaDevices !== "undefined",
              getDisplayMediaType: typeof navigator.mediaDevices
                ?.getDisplayMedia,
              hasPrepareRecording: true,
              hasStartRecording: typeof demo.startRecording === "function",
            },
          };
        }
        try {
          await Promise.resolve(demo.startRecording(opts));
          return {
            needsGesture: false,
            debug: {
              isSecureContext: globalThis.isSecureContext,
              hasMediaDevices: typeof navigator.mediaDevices !== "undefined",
              getDisplayMediaType: typeof navigator.mediaDevices
                ?.getDisplayMedia,
              hasPrepareRecording: false,
              hasStartRecording: typeof demo.startRecording === "function",
            },
          };
        } catch (error) {
          return {
            needsGesture: false,
            startError: error instanceof Error
              ? error.message
              : String(error ?? "unknown error"),
            debug: {
              isSecureContext: globalThis.isSecureContext,
              hasMediaDevices: typeof navigator.mediaDevices !== "undefined",
              getDisplayMediaType: typeof navigator.mediaDevices
                ?.getDisplayMedia,
              hasPrepareRecording: false,
              hasStartRecording: typeof demo.startRecording === "function",
            },
          };
        }
      },
      {
        chunkMs: getMediaRecorderChunkMs(),
        frameRate: getDemoFrameRate(),
      },
    );
    await this.logMediaRecorderDebug("start:evaluate", {
      needsGesture,
      startError,
      debug,
    });
    if (startError) {
      throw new Error(startError);
    }
    if (needsGesture) {
      await this.page.click("#gambit-start-capture", { timeout: 10_000 });
      await this.logMediaRecorderDebug("start:gesture-clicked");
    }
    this.mediaRecorderActive = true;
    await this.logMediaRecorderDebug("start:active");
  }

  private async stopMediaRecorderRecording(): Promise<void> {
    if (!this.page || !this.mediaRecorderActive) return;
    const result = await this.page.evaluate(() => {
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
    });
    // Chrome may deliver one final dataavailable event just after stop resolves.
    await wait(250);
    await Promise.allSettled([...this.mediaRecorderPendingWrites]);
    await this.logMediaRecorderDebug("stop:result", {
      hasResult: !!result,
      mimeType: result?.mimeType,
      hasBase64: !!result?.base64,
      base64Length: result?.base64?.length,
      bytesSeen: this.mediaRecorderBytes,
      chunksSeen: this.mediaRecorderChunks,
    });
    if (result?.base64 && this.mediaRecorderPath) {
      const bytes = decodeBase64(result.base64);
      await Deno.writeFile(this.mediaRecorderPath, bytes);
      this.mediaRecorderMimeType = result.mimeType ||
        this.mediaRecorderMimeType;
      this.mediaRecorderBytes = Math.max(this.mediaRecorderBytes, bytes.length);
      this.mediaRecorderChunks = Math.max(this.mediaRecorderChunks, 1);
      await this.logMediaRecorderDebug("stop:wrote-file", {
        path: this.mediaRecorderPath,
        bytes: bytes.length,
        mimeType: this.mediaRecorderMimeType,
      });
    }
    this.mediaRecorderActive = false;
    await this.logMediaRecorderDebug("stop:inactive");
  }

  private async exportMediaRecorderVideo(): Promise<boolean> {
    if (!this.mediaRecorderPath || !this.videoPath) return false;
    const mediaRecorderExists = await Deno.stat(this.mediaRecorderPath)
      .then(() => true)
      .catch(() => false);
    if (!mediaRecorderExists) return false;
    const transcoded = await transcodeMediaRecorderVideo(
      this.mediaRecorderPath,
      this.videoPath,
    );
    if (transcoded && this.latestVideoPath) {
      await Deno.copyFile(this.videoPath, this.latestVideoPath).catch(() => {});
    }
    return transcoded;
  }

  async teardown(): Promise<void> {
    try {
      if (this.page && this.recordVideo) {
        if (this.usingIframeHarness) {
          await this.stopMediaRecorderRecording();
        }
        await this.stopVideoRecording();
      }
      if (this.page && !this.page.isClosed()) {
        await runCleanupStepWithTimeout("page.close", () => this.page!.close())
          .catch((error) => {
            if (!isIgnorableCloseError(error)) throw error;
          });
      }
      this.page = null;
      this.frame = null;
      if (this.context) {
        await runCleanupStepWithTimeout(
          "context.close",
          () => this.context!.close(),
        ).catch((error) => {
          if (!isIgnorableCloseError(error)) throw error;
        });
      }
      this.context = null;
      if (this.recordVideo) {
        let mediaRecorderExported = false;
        if (this.usingIframeHarness) {
          mediaRecorderExported = await this.exportMediaRecorderVideo();
        }
        await this.flushVideoFrames();
        if (!mediaRecorderExported) {
          await this.exportVideo();
        }
      }
      if (this.browser) {
        await runCleanupStepWithTimeout(
          "browser.close",
          () => this.browser!.close(),
        ).catch((error) => {
          if (!isIgnorableCloseError(error)) throw error;
        });
        await wait(100);
      }
      this.browser = null;
      if (this.usingHostBridge) {
        await stopHostBridgeChrome();
        this.usingHostBridge = false;
      }

      if (this.runBaseDir) {
        const base = this.runBaseDir;
        const parent = path.join(base, "..", "runs");
        const dest = path.join(parent, String(this.epochMs));
        await ensureDir(parent);
        for (
          const args of [
            ["--reflink=auto", "-a", `${base}/`, `${dest}/`],
            ["-a", "-c", `${base}/`, `${dest}/`],
            ["-a", `${base}/`, `${dest}/`],
          ]
        ) {
          try {
            await new Deno.Command("cp", {
              args,
              stdout: "null",
              stderr: "piped",
            }).output();
            break;
          } catch {
            // Try the next copy strategy.
          }
        }
      }
      await this.stopServer();
      await killDanglingChromiumProcesses();
    } catch (error) {
      console.error("[browser-test] cleanup encountered an error:", error);
    } finally {
      for (const [key, value] of this.runtimeEnvRestore) {
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      }
    }
  }

  toApi(): DisposableBrowserTestContext {
    const latest = this.runBaseDir!;
    return {
      meta: () => ({
        testName: this.testName,
        slug: this.slug,
        epochMs: this.epochMs,
        headless: this.headless,
        mode: this.mode,
      }),
      paths: () => ({
        root: path.join(this.artifactRoot, this.slug),
        latest,
        logs: path.join(latest, "logs"),
        screenshots: path.join(latest, "screenshots"),
        frames: path.join(latest, "frames"),
        video: path.join(latest, "video.mp4"),
      }),
      navigate: (u: string) => this.navigate(u),
      waitForUrl: (
        re: RegExp,
        opts?: { quietMs?: number; timeoutMs?: number },
      ) => this.waitForUrl(re, opts),
      waitForText: (
        selector: string,
        expected: string | RegExp,
        opts?: { timeoutMs?: number },
      ) => this.waitForText(selector, expected, opts),
      currentPath: () => this.currentPath(),
      graphql: (query: string, variables?: Record<string, unknown>) =>
        this.graphql(query, variables),
      click: (selector: string) => this.click(selector),
      waitForVisible: (selector: string, opts?: { timeoutMs?: number }) =>
        this.waitForVisible(selector, opts),
      type: (selector: string, text: string, opts?: { clear?: boolean }) =>
        this.type(selector, text, opts),
      selectText: (
        selector: string,
        opts?: { text?: string; occurrence?: number },
      ) => this.selectText(selector, opts),
      scrollTo: (
        selector: string,
        opts: { top?: number; left?: number },
      ) => this.scrollTo(selector, opts),
      exists: (selector: string) => this.exists(selector),
      text: (selector: string) => this.text(selector),
      value: (selector: string) => this.value(selector),
      setViewport: (size: { width: number; height: number }) =>
        this.setViewport(size),
      rect: (selector: string) => this.rect(selector),
      scrollMetrics: (selector: string) => this.scrollMetrics(selector),
      screenshot: (label: string) => this.screenshot(label),
      close: () => this.teardown(),
      async [Symbol.asyncDispose]() {
        await this.close();
      },
    };
  }
}

export async function createBrowserTestContext(
  testName: string,
  options?: CreateBrowserTestContextOptions,
): Promise<DisposableBrowserTestContext> {
  const impl = await BrowserTestContextImpl.create(testName, options);
  return impl.toApi();
}
