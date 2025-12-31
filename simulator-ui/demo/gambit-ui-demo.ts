#!/usr/bin/env -S deno run -A

import { ensureDir } from "@std/fs";
import * as path from "@std/path";
import { chromium } from "npm:playwright-core";
import type {
  Browser,
  BrowserContext,
  CDPSession,
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

function shouldRecordVideo(): boolean {
  const raw = (Deno.env.get("GAMBIT_E2E_RECORD_VIDEO") || "")
    .toLowerCase()
    .trim();
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
}): Promise<string> {
  const baseUrl = getHostBridgeUrl();
  const payload: Record<string, unknown> = {
    headless: opts.headless,
  };
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

async function exportVideo(
  framesDir: string,
  latestDir: string,
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
        "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p",
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

async function main(): Promise<void> {
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
  const executablePath = getExecutablePath();
  const epochMs = Date.now();
  const hostBridge = useHostBridge();
  const demoPort = getDemoPort(hostBridge);

  const index = [
    `test_name: gambit-ui-demo`,
    `slug: ${slug}`,
    `epoch_ms: ${epochMs}`,
    `headless: ${String(headless)}`,
    `executable_path: ${String(executablePath ?? "auto")}`,
    `base_dir: ${latestDir}`,
  ].join("\n");
  await Deno.writeTextFile(path.join(latestDir, "index.txt"), index + "\n");

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

  try {
    if (hostBridge) {
      const wsEndpoint = await startHostBridgeChrome({ headless });
      console.log("[gambit-demo] host bridge ws:", wsEndpoint);
      browser = await chromium.connectOverCDP(wsEndpoint);
    } else {
      browser = await chromium.launch({
        headless,
        executablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--window-size=1280,720",
        ],
      });
    }

    const existingContexts = browser.contexts();
    const ctx = existingContexts[0] ||
      await browser.newContext({ viewport: { width: 1280, height: 720 } });
    context = ctx;

    const existingPages = ctx.pages();
    const pg = existingPages[0] || await ctx.newPage();
    page = pg;

    if (recordVideo) {
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
      await videoSession.send("Page.startScreencast", {
        format: "png",
        everyNthFrame: 1,
        quality: 80,
      });
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
    let sessionId: string | null = null;

    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".top-nav", { timeout: 30_000 });
    await wait(600);
    await screenshot(page, screenshotsDir, "01-test-bot");

    const initialMessage = page.locator(
      '[data-testid="testbot-initial-message"]',
    );
    if (await initialMessage.count()) {
      await initialMessage.fill("Hi! Please help me schedule an appointment.");
    }

    const runButton = page.locator('[data-testid="testbot-run"]');
    if (await runButton.count()) {
      await runButton.click();
      await wait(1200);
      await screenshot(page, screenshotsDir, "02-test-bot-running");

      const sessionLabel = page.locator(
        'code[data-testid="testbot-session-id"]',
      );
      try {
        await sessionLabel.waitFor({ timeout: 20_000 });
        sessionId = (await sessionLabel.textContent())?.trim() || null;
        await screenshot(page, screenshotsDir, "03-test-bot-session-created");
      } catch (_) {
        // ignore missing session
      }

      const stopButton = page.locator('[data-testid="testbot-stop"]');
      if (await stopButton.count()) {
        await stopButton.click().catch(() => {});
      }
    }

    await page.locator('[data-testid="nav-calibrate"]').click();
    await page.waitForURL(/\/calibrate(?:$|\/)/, { timeout: 15_000 });
    await page.waitForSelector(".calibrate-shell h1", { timeout: 10_000 });
    await wait(800);
    await screenshot(page, screenshotsDir, "04-calibrate");

    if (sessionId) {
      await page.goto(
        `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/debug`,
        {
          waitUntil: "domcontentloaded",
        },
      );
    } else {
      await page.locator('[data-testid="nav-debug"]').click();
    }
    await page.waitForURL(/\/debug$/, { timeout: 15_000 });
    await page.waitForSelector('textarea[data-testid="debug-message-input"]', {
      timeout: 10_000,
    });
    await wait(500);
    await screenshot(page, screenshotsDir, "05-debug");

    const shouldInteract = (Deno.env.get("GAMBIT_DEMO_INTERACT_DEBUG") || "")
      .toLowerCase().trim() === "true";
    if (shouldInteract) {
      try {
        const debugInput = page.locator(
          'textarea[data-testid="debug-message-input"]',
        );
        await debugInput.fill("Hello! Can you summarize what this deck does?");
        await wait(300);
        await page.locator('[data-testid="debug-send"]').click();
        await wait(1200);
        await screenshot(page, screenshotsDir, "06-debug-after-send");
      } catch (error) {
        console.warn("[gambit-demo] debug interaction failed:", error);
        await screenshot(page, screenshotsDir, "06-debug-interaction-failed");
      }
    }

    if (shouldWaitForExit()) {
      console.log("[gambit-demo] waiting; press Enter to finish recording.");
      const buffer = new Uint8Array(1);
      await Deno.stdin.read(buffer);
    }
  } finally {
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
      await exportVideo(framesDir, latestDir);
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

if (import.meta.main) {
  await main();
}
