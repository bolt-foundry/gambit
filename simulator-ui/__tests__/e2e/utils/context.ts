// deno-lint-ignore-file no-console
import { ensureDir } from "@std/fs";
import * as path from "@std/path";
import {
  type Browser,
  type CDPSession,
  launch,
  type Page,
  type ConsoleMessage,
} from "puppeteer-core";

function getErrorMessage(err: unknown): string {
  const message = (err as { message?: unknown })?.message;
  const messageStr = typeof message === "string" ? message : "";
  const stack = (err as { stack?: unknown })?.stack;
  const stackStr = typeof stack === "string" ? stack : "";
  const fallback = String(err);
  return [messageStr, fallback, stackStr].filter(Boolean).join(" ");
}

function isIgnorableCloseError(err: unknown): boolean {
  const msg = getErrorMessage(err);
  return /Protocol error .*Target\.closeTarget|ConnectionClosedError|Connection closed/i
    .test(msg);
}

function isTransientActionError(err: unknown): boolean {
  const msg = getErrorMessage(err);
  return /detached|Target closed|Connection closed|Execution context was destroyed|Cannot find context|Frame was detached|detached Frame|Attempted to use detached Frame/i
    .test(msg);
}

/* ──────────────────────────────────────────────────────────────────────────────
   Local helpers
   ──────────────────────────────────────────────────────────────────────────── */

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const moduleDir = path.dirname(path.fromFileUrl(import.meta.url));
const packageRoot = path.resolve(moduleDir, "../../../..");
const repoRoot = path.resolve(packageRoot, "../..");

const E2E_ARTIFACT_ROOT = path.resolve(
  repoRoot,
  "..",
  "shared",
  "bft-e2e",
);

function getBaseUrl(): string {
  const envUrl = Deno.env.get("GAMBIT_E2E_URL");
  return envUrl?.trim().replace(/\/+$/, "") || "http://127.0.0.1:8000";
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

async function safeGoto(page: Page, url: string): Promise<void> {
  const normalizedUrl = url.replace(/\/+$/g, "");
  await page.goto(normalizedUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
}

async function saveScreenshot(
  page: Page,
  label: string,
  runBaseDir: string,
): Promise<string> {
  const screenshotsDir = path.join(runBaseDir, "screenshots");
  const latestDir = path.join(E2E_ARTIFACT_ROOT, "latest-artifacts");
  await ensureDir(screenshotsDir);
  await ensureDir(latestDir);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const filename = `${ts}_${safeLabel}.png`;
  const filePath = path.join(screenshotsDir, filename);
  try {
    await page.screenshot({ path: filePath as `${string}.png` });
    const latestPath = path.join(latestDir, `${safeLabel}.png`);
    await Deno.copyFile(filePath, latestPath);
    console.info(`[gambit-e2e] screenshot saved: ${filePath}`);
    return filePath;
  } catch (err) {
    if (
      (Deno.env.get("GAMBIT_E2E_VERBOSE_SCREENSHOT_ERRORS") || "") === "true"
    ) {
      console.warn("[gambit-e2e] failed to take screenshot:", err);
    }
    return "";
  }
}

type ServerSpawnOptions = {
  command?: Array<string>;
  port?: number;
  mode?: "development" | "production";
  env?: Record<string, string>;
  cwd?: string;
  readyPattern?: RegExp;
  startupTimeoutMs?: number;
  inheritEnv?: boolean;
  logFileName?: string;
};

export type CreateE2eTestContextOptions = {
  server?: ServerSpawnOptions;
};

type CommandChild = ReturnType<Deno.Command["spawn"]>;

type ServerProcessInfo = {
  process: CommandChild;
  status: Promise<Deno.CommandStatus>;
  stdoutTask?: Promise<void>;
  stderrTask?: Promise<void>;
  port: number;
  baseUrl: string;
  logPath: string;
  previousBaseUrl?: string;
};

function findAvailablePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

const DEFAULT_SERVER_COMMAND = [
  "deno",
  "run",
  "-A",
  "src/cli.ts",
  "serve",
  "init/examples/advanced/voice_front_desk/decks/root.deck.md",
  "--bundle",
];

const DEFAULT_READY_PATTERN = /Simulator listening on http:\/\/localhost:\d+/i;

const SERVER_LOG_HEADER = [
  "# gambit e2e embedded dev server",
  `# started: ${new Date().toISOString()}`,
].join("\n") + "\n";

export type E2eContext = {
  meta(): {
    testName: string;
    slug: string;
    epochMs: number;
    headless: boolean;
  };
  viewportControl: {
    zoomTo(
      selector: string,
      opts?: { padding?: number; maxScale?: number; durationMs?: number },
    ): Promise<void>;
    resetZoom(opts?: { durationMs?: number }): Promise<void>;
    highlight(selector: string): Promise<void>;
    scrollTo(selector: string): Promise<void>;
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
  currentPath(): Promise<string>;
  click(selector: string): Promise<void>;
  type(
    selector: string,
    text: string,
    opts?: { clear?: boolean },
  ): Promise<void>;
  exists(selector: string): Promise<boolean>;
  text(selector: string): Promise<string>;
  screenshot(label: string): Promise<string>;
  close(): Promise<void>;
};
export type DisposableE2eContext = E2eContext & {
  [Symbol.asyncDispose](): PromiseLike<void>;
};

async function killDanglingChromiumProcesses() {
  const pkill = async (pattern: string) => {
    try {
      const command = new Deno.Command("pkill", {
        args: ["-f", pattern],
        stdout: "null",
        stderr: "piped",
      });
      const { code, stderr } = await command.output();
      if (code !== 0 && code !== 1) {
        console.warn(
          `[gambit-e2e] pkill exit code ${code} for pattern ${pattern}: ${
            new TextDecoder().decode(stderr).trim()
          }`,
        );
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.warn(
          `[gambit-e2e] pkill not available for pattern ${pattern}:`,
          error,
        );
      }
    }
  };

  await pkill("libexec/chromium/chromium");
  await pkill("chrome_crashpad_handler");
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

class E2eTestContext {
  browser: Browser | null = null;
  page: Page | null = null;
  runBaseDir?: string;
  slug: string;
  testName: string;
  epochMs: number = Date.now();
  headless: boolean = true;
  recordVideo: boolean = true;
  videoSession?: CDPSession;
  pendingFrameWrites: Set<Promise<void>> = new Set();
  frameSeq: number = 0;
  frameDir?: string;
  videoPath?: string;
  latestVideoPath?: string;
  videoRecordingActive = false;
  viewportControl: E2eContext["viewportControl"];
  private server?: ServerProcessInfo;

  private constructor(slug: string, testName: string) {
    this.slug = slug;
    this.testName = testName;
    this.viewportControl = {
      zoomTo: (selector, opts) =>
        this.callViewportControl("zoomTo", [selector, opts]),
      resetZoom: (opts) => this.callViewportControl("resetZoom", [opts]),
      highlight: (selector) =>
        this.callViewportControl("highlight", [selector]),
      scrollTo: (selector) => this.callViewportControl("scrollTo", [selector]),
    };
  }

  static async create(
    testName: string,
    options?: CreateE2eTestContextOptions,
  ): Promise<E2eTestContext> {
    const headless = (Deno.env.get("GAMBIT_E2E_SHOW_BROWSER") || "") !== "true";
    const executablePath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") ||
      undefined;

    await killDanglingChromiumProcesses();

    const slug = toSlug(testName);
    const ctx = new E2eTestContext(slug, testName);
    ctx.headless = headless;

    // Prepare storage layout: ../shared/bft-e2e/$TEST/__latest__
    const root = path.join(E2E_ARTIFACT_ROOT, slug);
    const latestDir = path.join(root, "__latest__");
    await Deno.remove(latestDir, { recursive: true }).catch(() => {});
    await ensureDir(latestDir);
    ctx.runBaseDir = latestDir;

    // Pre-create common subdirs
    const logsDir = path.join(latestDir, "logs");
    await ensureDir(logsDir);
    if (options?.server) {
      await ctx.startServer(options.server, logsDir);
    }

    // Write run index metadata
    const now = ctx.epochMs;
    const index = [
      `test_name: ${testName}`,
      `slug: ${slug}`,
      `epoch_ms: ${now}`,
      `headless: ${String(headless)}`,
      `executable_path: ${String(executablePath ?? "auto")}`,
      `base_dir: ${latestDir}`,
    ].join("\n");
    await Deno.writeTextFile(path.join(latestDir, "index.txt"), index + "\n");

    ctx.browser = await launch({
      headless,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1280,720",
      ],
      defaultViewport: { width: 1280, height: 720 },
      dumpio: false,
    });

    ctx.page = await ctx.browser.newPage();
    await ctx.page.setViewport({ width: 1280, height: 720 });

    // Browser console and pageerror → log files for debugging
    const clientLogPath = path.join(logsDir, "client.log");
    const clientErrPath = path.join(logsDir, "client.errors.log");
    const writeLog = async (level: string, source: string, msg: string) => {
      const line = `${
        new Date().toISOString()
      } ${level.toUpperCase()} ${source} ${msg}\n`;
      try {
        await Deno.writeTextFile(clientLogPath, line, { append: true });
        if (level === "warn" || level === "error") {
          await Deno.writeTextFile(clientErrPath, line, { append: true });
        }
      } catch (_) {
        // ignore file write errors in CI
      }
    };
    ctx.page.on("console", (msg: ConsoleMessage) => {
      writeLog(msg.type(), "console", msg.text()).catch(() => {});
    });
    ctx.page.on("pageerror", (err: unknown) => {
      writeLog("error", "pageerror", String(err)).catch(() => {});
    });

    const framesDir = path.join(latestDir, "frames");
    await ensureDir(framesDir);
    ctx.frameDir = framesDir;
    ctx.videoPath = path.join(latestDir, "video.mp4");

    const shouldRecord = (() => {
      const raw = (Deno.env.get("GAMBIT_E2E_RECORD_VIDEO") || "").toLowerCase()
        .trim();
      if (raw === "false" || raw === "0" || raw === "no") return false;
      return true;
    })();
    ctx.recordVideo = shouldRecord;

    if (ctx.recordVideo) {
      const latestArtifactsDir = path.join(
        E2E_ARTIFACT_ROOT,
        "latest-artifacts",
      );
      await ensureDir(latestArtifactsDir);
      ctx.latestVideoPath = path.join(latestArtifactsDir, `${slug}.mp4`);
      await ctx.startVideoRecording().catch((error) => {
        console.warn("[gambit-e2e] failed to enable video recording:", error);
        ctx.recordVideo = false;
        ctx.videoRecordingActive = false;
      });
    }

    return ctx;
  }

  // Support for `await using`
  async [Symbol.asyncDispose](): Promise<void> {
    await this.teardown();
  }

  async screenshot(label: string): Promise<string> {
    if (!this.page || !this.runBaseDir) return "";
    return await saveScreenshot(this.page, label, this.runBaseDir);
  }

  // High-level API implementations
  async navigate(urlOrPath: string): Promise<void> {
    if (!this.page) throw new Error("context page not initialized");
    const base = getBaseUrl();
    const url = /^(https?:)?\/\//.test(urlOrPath)
      ? urlOrPath
      : new URL(urlOrPath, base).toString();
    await safeGoto(this.page, url);
  }

  async waitForUrl(
    re: RegExp,
    opts?: { quietMs?: number; timeoutMs?: number },
  ): Promise<void> {
    if (!this.page) throw new Error("context page not initialized");
    const quietMs = opts?.quietMs ?? 300;
    const timeoutMs = opts?.timeoutMs ?? 8_000;
    const attempt = async () => {
      await this.page!.waitForFunction(
        (pattern: string, flags: string) => {
          const matcher = new RegExp(pattern, flags);
          const href = new URL(location.href);
          return matcher.test(href.pathname);
        },
        { timeout: timeoutMs },
        re.source,
        re.flags,
      );
    };
    for (let tries = 0; tries < 3; tries += 1) {
      try {
        await attempt();
        break;
      } catch (err) {
        if (!isTransientActionError(err) || tries === 2) throw err;
        await wait(400);
      }
    }
    if (quietMs > 0) await wait(quietMs);
  }

  async currentPath(): Promise<string> {
    if (!this.page) throw new Error("context page not initialized");
    return await this.page.evaluate(() => globalThis.location.pathname);
  }

  async click(selector: string): Promise<void> {
    if (!this.page) throw new Error("context page not initialized");
    const attempt = async () => {
      await this.page!.waitForSelector(selector, {
        timeout: 15_000,
        visible: true,
      });
      const ok = await this.page!.evaluate((sel: string) => {
        const doc = document;
        const el = doc.querySelector(sel) as HTMLElement | null;
        if (!el) return false;
        el.scrollIntoView({ block: "center", inline: "center" });
        el.click();
        return true;
      }, selector);
      if (!ok) throw new Error(`Selector ${selector} not found for click`);
    };
    for (let tries = 0; tries < 3; tries += 1) {
      try {
        await attempt();
        return;
      } catch (err) {
        if (!isTransientActionError(err) || tries === 2) throw err;
        await wait(400);
      }
    }
  }

  async type(
    selector: string,
    text: string,
    opts?: { clear?: boolean },
  ): Promise<void> {
    if (!this.page) throw new Error("context page not initialized");
    const timeout = 15_000;
    const attempt = async () => {
      await this.page!.waitForSelector(selector, {
        timeout,
        visible: true,
      });
      if (opts?.clear) {
        await this.page!.evaluate((sel: string) => {
          const doc = document;
          const el = doc.querySelector(sel) as
            | HTMLInputElement
            | HTMLTextAreaElement
            | null;
          if (el) el.value = "";
        }, selector);
      }
      await this.page!.type(selector, text);
    };
    for (let tries = 0; tries < 3; tries += 1) {
      try {
        await attempt();
        return;
      } catch (err) {
        if (!isTransientActionError(err) || tries === 2) throw err;
        await wait(400);
      }
    }
  }

  async exists(selector: string): Promise<boolean> {
    if (!this.page) throw new Error("context page not initialized");
    try {
      const handle = await this.page.$(selector);
      const ok = Boolean(handle);
      await handle?.dispose();
      return ok;
    } catch (_) {
      return false;
    }
  }

  async text(selector: string): Promise<string> {
    if (!this.page) throw new Error("context page not initialized");
    try {
      const handle = await this.page.$(selector);
      if (!handle) return "";
      const txt = await this.page.evaluate(
        (el: Element) => (el.textContent || "").trim(),
        handle,
      );
      await handle.dispose();
      return txt ?? "";
    } catch (_) {
      return "";
    }
  }

  private async callViewportControl(
    method: string,
    args: Array<unknown>,
  ): Promise<void> {
    if (!this.page) throw new Error("context page not initialized");
    await this.page.evaluate(
      (fnName: string, fnArgs: Array<unknown>) => {
        const api = (window as { gambitDemo?: Record<string, unknown> })
          .gambitDemo;
        const target = api?.[fnName as keyof typeof api];
        if (typeof target !== "function") {
          throw new Error(
            `viewportControl: ${fnName} unavailable (gambitDemo missing)`,
          );
        }
        return (target as (...args: Array<unknown>) => unknown)(...fnArgs);
      },
      method,
      args,
    );
  }

  private async startServer(
    options: ServerSpawnOptions,
    logsDir: string,
  ): Promise<void> {
    const mode = options.mode ?? "production";
    const port = options.port ?? findAvailablePort();

    if (options.command && options.port === undefined) {
      throw new Error(
        "createE2eTestContext: server.port must be provided when supplying a custom command.",
      );
    }

    const command = options.command ? [...options.command] : [
      ...DEFAULT_SERVER_COMMAND,
      "--port",
      String(port),
    ];

    const inheritEnv = options.inheritEnv !== false;
    const env: Record<string, string> = inheritEnv
      ? { ...Deno.env.toObject() }
      : {};

    if (env.GAMBIT_ENV === undefined) {
      env.GAMBIT_ENV = mode === "production" ? "production" : "development";
    }

    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        env[key] = value;
      }
    }

    const logPath = path.join(
      logsDir,
      options.logFileName ?? "dev-server.log",
    );
    await Deno.writeTextFile(logPath, SERVER_LOG_HEADER, { create: true });

    const child = new Deno.Command(command[0], {
      args: command.slice(1),
      cwd: options.cwd ?? packageRoot,
      stdout: "piped",
      stderr: "piped",
      env,
    }).spawn();

    const decoder = new TextDecoder();
    const readyPattern = options.readyPattern ?? DEFAULT_READY_PATTERN;
    let readinessBuffer = "";

    const appendLog = async (prefix: string, chunk: string) => {
      const normalized = chunk.replace(/\r\n/g, "\n");
      if (!normalized.trim()) return;
      const lines = normalized.split("\n").filter((line) => line.length > 0);
      if (!lines.length) return;
      const payload = lines.map((line) =>
        `${new Date().toISOString()} [${prefix}] ${line}\n`
      ).join("");
      await Deno.writeTextFile(logPath, payload, { append: true });
    };

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
            await appendLog("stdout", chunk);
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
            await appendLog("stderr", chunk);
          }
        } finally {
          reader.releaseLock();
        }
      })()
      : undefined;

    const timeoutMs = options.startupTimeoutMs ?? 45_000;
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

    this.server = {
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

  private async stopServer(): Promise<void> {
    if (!this.server) return;
    const { process, status, stdoutTask, stderrTask, previousBaseUrl } =
      this.server;

    try {
      process.kill("SIGTERM");
    } catch (_) {
      // ignore
    }

    try {
      await status.catch(() => {});
    } catch (_) {
      // ignore
    }

    await Promise.allSettled(
      [stdoutTask, stderrTask].filter(Boolean) as Array<Promise<unknown>>,
    );

    if (previousBaseUrl === undefined) {
      Deno.env.delete("GAMBIT_E2E_URL");
    } else {
      Deno.env.set("GAMBIT_E2E_URL", previousBaseUrl);
    }

    this.server = undefined;
  }

  // Internal helpers for video recording.
  private async startVideoRecording(): Promise<void> {
    if (!this.page || !this.frameDir || !this.videoPath) return;
    const target = this.page.target();
    const session = await target.createCDPSession();
    this.videoSession = session;
    this.pendingFrameWrites.clear();
    this.frameSeq = 0;
    this.videoRecordingActive = true;

    await session.send("Page.enable");
    const handler = (event: { data: string; sessionId: number }) => {
      if (!this.videoRecordingActive || !this.frameDir) {
        void session.send("Page.screencastFrameAck", {
          sessionId: event.sessionId,
        }).catch(() => {});
        return;
      }
      const seq = ++this.frameSeq;
      const filename = `frame-${seq.toString().padStart(6, "0")}.png`;
      const filepath = path.join(this.frameDir, filename);
      const writePromise = (async () => {
        try {
          const bytes = decodeBase64(event.data);
          await Deno.writeFile(filepath, bytes);
        } catch (error) {
          console.warn(
            `[gambit-e2e] failed to write frame ${filename}:`,
            error,
          );
        }
      })();
      this.pendingFrameWrites.add(writePromise);
      writePromise.finally(() => {
        this.pendingFrameWrites.delete(writePromise);
      });
      void session.send("Page.screencastFrameAck", {
        sessionId: event.sessionId,
      }).catch(() => {});
    };
    session.on("Page.screencastFrame", handler);
    try {
      await session.send("Page.startScreencast", {
        format: "png",
        everyNthFrame: 1,
        quality: 80,
      });
    } catch (error) {
      this.videoRecordingActive = false;
      try {
        (session as unknown as { removeAllListeners?: () => void })
          .removeAllListeners?.();
      } catch (_) {
        // ignore
      }
      await session.detach().catch(() => {});
      this.videoSession = undefined;
      throw error;
    }
  }

  private async stopVideoRecording(): Promise<void> {
    if (!this.videoSession) return;
    this.videoRecordingActive = false;
    try {
      await this.videoSession.send("Page.stopScreencast");
    } catch (error) {
      console.warn("[gambit-e2e] failed to stop screencast:", error);
    }
    try {
      (this.videoSession as unknown as { removeAllListeners?: () => void })
        .removeAllListeners?.();
    } catch (_) {
      // ignore
    }
    try {
      await this.videoSession.detach();
    } catch (error) {
      console.warn("[gambit-e2e] failed to detach CDP session:", error);
    }
    this.videoSession = undefined;
  }

  private async flushVideoFrames(): Promise<void> {
    if (!this.pendingFrameWrites.size) return;
    const pending = [...this.pendingFrameWrites];
    this.pendingFrameWrites.clear();
    await Promise.all(
      pending.map((promise) =>
        promise.catch((err) => {
          console.warn("[gambit-e2e] frame write failed:", err);
        })
      ),
    );
  }

  private async hasRecordedFrames(): Promise<boolean> {
    if (!this.frameDir) return false;
    try {
      for await (const entry of Deno.readDir(this.frameDir)) {
        if (entry.isFile) return true;
      }
    } catch (error) {
      console.warn("[gambit-e2e] failed to read frames directory:", error);
    }
    return false;
  }

  private async exportVideo(): Promise<void> {
    if (!this.frameDir || !this.videoPath) return;
    if (!(await this.hasRecordedFrames())) return;
    try {
      const command = new Deno.Command("ffmpeg", {
        args: [
          "-y",
          "-loglevel",
          "error",
          "-framerate",
          "30",
          "-i",
          "frame-%06d.png",
          "-vf",
          "format=yuv420p",
          "../video.mp4",
        ],
        cwd: this.frameDir,
        stdout: "null",
        stderr: "piped",
      });
      const { code, stderr } = await command.output();
      if (code !== 0) {
        const message = new TextDecoder().decode(stderr).trim();
        console.warn(
          "[gambit-e2e] ffmpeg exited with code",
          code,
          message ? `(${message})` : "",
        );
        return;
      }
      if (this.latestVideoPath) {
        try {
          await Deno.copyFile(this.videoPath, this.latestVideoPath);
        } catch (error) {
          console.warn(
            "[gambit-e2e] failed to copy latest video artifact:",
            error,
          );
        }
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        console.warn(
          "[gambit-e2e] ffmpeg not found; keeping individual frame PNGs",
        );
      } else {
        console.warn("[gambit-e2e] ffmpeg failed to render video:", error);
      }
    }
  }

  async teardown(): Promise<void> {
    try {
      if (this.page && this.recordVideo) {
        await this.stopVideoRecording();
      }

      if (this.page && !this.page.isClosed()) {
        try {
          await this.page.close();
        } catch (error) {
          if (!isIgnorableCloseError(error)) {
            console.warn("[gambit-e2e] page close failed:", error);
          }
        }
      }
      this.page = null;

      if (this.recordVideo) {
        await this.flushVideoFrames();
        await this.exportVideo();
      }

      if (this.browser) {
        try {
          (this.browser as unknown as { removeAllListeners?: () => void })
            .removeAllListeners?.();
        } catch (_) {
          // ignore
        }
        try {
          await this.browser.close();
          await new Promise((r) => setTimeout(r, 100));
        } catch (error) {
          if (!isIgnorableCloseError(error)) {
            console.warn("[gambit-e2e] browser close failed:", error);
          }
        }
      }
      this.browser = null;

      // Snapshot latest -> runs/<epoch_ms> using reflink/copy (after artifacts are finalized)
      const base = this.runBaseDir!;
      const parent = path.join(base, "..", "runs");
      const epoch = String(this.epochMs);
      const dest = path.join(parent, epoch);
      await ensureDir(parent);
      try {
        await new Deno.Command("cp", {
          args: ["--reflink=auto", "-a", base + "/", dest + "/"],
          stdout: "null",
          stderr: "piped",
        }).output();
      } catch {
        try {
          await new Deno.Command("cp", {
            args: ["-a", "-c", base + "/", dest + "/"],
            stdout: "null",
            stderr: "piped",
          }).output();
        } catch {
          await new Deno.Command("cp", {
            args: ["-a", base + "/", dest + "/"],
            stdout: "null",
            stderr: "piped",
          }).output();
        }
      }

      await this.stopServer();

      await killDanglingChromiumProcesses();
    } catch (error) {
      console.error("[gambit-e2e] cleanup encountered an error:", error);
    }
  }
}

function buildDefaultServerOptions(): ServerSpawnOptions {
  return {
    port: findAvailablePort(),
    readyPattern: DEFAULT_READY_PATTERN,
    startupTimeoutMs: 60_000,
    cwd: packageRoot,
  };
}

export async function createE2eTestContext(
  testName: string,
  options?: CreateE2eTestContextOptions,
): Promise<DisposableE2eContext> {
  const mergedOptions: CreateE2eTestContextOptions = options?.server
    ? options
    : {
      server: buildDefaultServerOptions(),
    };
  const impl = await E2eTestContext.create(testName, mergedOptions);
  const root = path.join(E2E_ARTIFACT_ROOT, impl.slug);
  const latest = impl.runBaseDir!;
  const paths = {
    root,
    latest,
    logs: path.join(latest, "logs"),
    screenshots: path.join(latest, "screenshots"),
    frames: path.join(latest, "frames"),
    video: path.join(latest, "video.mp4"),
  } as const;
  const meta = {
    testName: impl.testName,
    slug: impl.slug,
    epochMs: impl.epochMs,
    headless: impl.headless,
  } as const;
  const api: DisposableE2eContext = {
    meta: () => meta,
    paths: () => paths,
    viewportControl: impl.viewportControl,
    navigate: (u: string) => impl.navigate(u),
    waitForUrl: (re: RegExp, o?: { quietMs?: number; timeoutMs?: number }) =>
      impl.waitForUrl(re, o),
    currentPath: () => impl.currentPath(),
    click: (s: string) => impl.click(s),
    type: (s: string, t: string, o?: { clear?: boolean }) => impl.type(s, t, o),
    exists: (s: string) => impl.exists(s),
    text: (s: string) => impl.text(s),
    screenshot: (l: string) => impl.screenshot(l),
    close: () => impl.teardown(),
    async [Symbol.asyncDispose]() {
      await impl.teardown();
    },
  };
  return api;
}
