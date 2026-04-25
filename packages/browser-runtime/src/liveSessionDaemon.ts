import { ensureDir } from "@std/fs";
import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { chromium } from "playwright-core";
import type {
  Browser,
  BrowserContext,
  CDPSession,
  Frame,
  Page,
} from "playwright-core";
import { exportVideo } from "./capture.ts";
import { getDefaultBrowserBaseUrl } from "./appTargets.ts";
import {
  getDemoFrameRate,
  getDemoInterpolationMode,
  getDemoOutputFrameRate,
  getDemoViewport,
  getDemoWindowSize,
  getExecutablePath,
  getHostBridgeUrl,
  getIframeShellPath,
  getMediaRecorderTitle,
  shouldUseSmoothMouse,
  shouldUseSmoothType,
} from "./config.ts";
import {
  moveMouseToLocator,
  typeIntoLocator,
} from "./automation/interaction.ts";
import { getDemoPaths, prepareDemoPaths } from "./runner.ts";
import { attachPageLogHandlers, getDemoTarget } from "./runnerHelpers.ts";
import {
  type BrowserLiveSessionCommand,
  type BrowserLiveSessionMetadata,
  normalizeBrowserLiveSessionName,
  patchBrowserLiveSessionMetadata,
  writeBrowserLiveSessionMetadata,
} from "./liveControl.ts";
import { screenshot, toSlug } from "./utils.ts";

type LiveDaemonArgs = ReturnType<typeof parseArgs> & {
  session?: string;
  port?: string;
  url?: string;
  headless?: boolean;
  "show-browser"?: boolean;
  "no-host-bridge"?: boolean;
  "storage-state"?: string;
};

type RecordingState = {
  active: boolean;
  session?: CDPSession;
  framesDir?: string;
  latestDir?: string;
  outputPath?: string;
  pendingWrites: Set<Promise<void>>;
  frameSeq: number;
};

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers,
    },
  });
}

export function resolveInitialLiveUrl(url?: string): string {
  return url || getDefaultBrowserBaseUrl();
}

async function startHostBridgeChrome(opts: {
  headless: boolean;
  windowSize?: { width: number; height: number } | null;
}): Promise<{ wsEndpoint: string; instanceId?: string }> {
  const baseUrl = getHostBridgeUrl();
  const payload: Record<string, unknown> = {
    headless: opts.headless,
  };
  if (opts.windowSize) {
    payload.windowWidth = opts.windowSize.width;
    payload.windowHeight = opts.windowSize.height;
  }
  payload.autoGrantMedia = true;
  payload.allowScreenCapture = true;
  payload.autoSelectTabCaptureSourceByTitle = getMediaRecorderTitle();
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
  const data = await res.json() as { wsEndpoint?: string; instanceId?: string };
  if (!data.wsEndpoint) {
    throw new Error("host-bridge start did not return wsEndpoint");
  }
  const wsEndpoint =
    data.wsEndpoint.startsWith("ws://") && baseUrl.startsWith("https://")
      ? `wss://${data.wsEndpoint.slice("ws://".length)}`
      : data.wsEndpoint;
  return { wsEndpoint, instanceId: data.instanceId };
}

async function stopHostBridgeChrome(instanceId?: string): Promise<void> {
  if (!instanceId) {
    throw new Error("Missing host bridge instanceId for stop.");
  }
  const res = await fetch(`${getHostBridgeUrl()}/browser/debugger/stop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instanceId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `host bridge stop failed (${res.status})`);
  }
}

async function getHostBridgeChromeStatus(instanceId?: string): Promise<{
  running: boolean;
}> {
  const url = new URL(`${getHostBridgeUrl()}/browser/debugger/status`);
  if (instanceId) {
    url.searchParams.set("instanceId", instanceId);
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`host bridge status failed (${res.status})`);
  }
  return await res.json() as { running: boolean };
}

async function resolveControlTarget(page: Page): Promise<Page | Frame> {
  try {
    return await getDemoTarget(page, page.url().includes(getIframeShellPath()));
  } catch {
    const frameHandle = await page.$("#demo-frame");
    const frame = await frameHandle?.contentFrame();
    return frame ?? page;
  }
}

function validateCoordinateCommand(
  command: Extract<
    BrowserLiveSessionCommand,
    { type: "mouse-move" | "click" }
  >,
): void {
  const hasCoords = typeof command.x === "number" &&
    typeof command.y === "number";
  if (!command.selector && !hasCoords) {
    throw new Error("Provide either --selector or both --x and --y.");
  }
}

async function applyCommand(
  command: BrowserLiveSessionCommand,
  state: {
    page: Page;
    metadata: BrowserLiveSessionMetadata;
    paths: ReturnType<typeof getDemoPaths>;
    recording: RecordingState;
    mousePosition: { x: number; y: number } | null;
  },
): Promise<{ session: BrowserLiveSessionMetadata; result?: unknown }> {
  const { page, paths, recording } = state;
  const target = await resolveControlTarget(page);

  if (command.type === "open") {
    await page.goto(command.url, { waitUntil: "domcontentloaded" });
    const session = await patchBrowserLiveSessionMetadata(
      state.metadata.sessionName,
      {
        currentUrl: page.url(),
      },
    ) as BrowserLiveSessionMetadata;
    return { session };
  }

  if (command.type === "eval") {
    const result = await target.evaluate(
      (expression) => {
        const evaluator = new Function(`return (${expression});`);
        return evaluator();
      },
      command.expression,
    );
    const session = await patchBrowserLiveSessionMetadata(
      state.metadata.sessionName,
      {
        currentUrl: page.url(),
      },
    ) as BrowserLiveSessionMetadata;
    return { session, result };
  }

  if (command.type === "mouse-move") {
    validateCoordinateCommand(command);
    if (command.selector) {
      await moveMouseToLocator(page, target.locator(command.selector));
    } else {
      await page.mouse.move(command.x!, command.y!);
      state.mousePosition = { x: command.x!, y: command.y! };
    }
    const session = await patchBrowserLiveSessionMetadata(
      state.metadata.sessionName,
      {
        currentUrl: page.url(),
      },
    ) as BrowserLiveSessionMetadata;
    return { session };
  }

  if (command.type === "click") {
    validateCoordinateCommand(command);
    if (command.selector) {
      const locator = target.locator(command.selector);
      if (shouldUseSmoothMouse()) {
        await moveMouseToLocator(page, locator);
      }
      await locator.click();
    } else {
      await page.mouse.click(command.x!, command.y!);
      state.mousePosition = { x: command.x!, y: command.y! };
    }
    const session = await patchBrowserLiveSessionMetadata(
      state.metadata.sessionName,
      {
        currentUrl: page.url(),
      },
    ) as BrowserLiveSessionMetadata;
    return { session };
  }

  if (command.type === "type") {
    if (command.selector) {
      await typeIntoLocator(target.locator(command.selector), command.text, {
        clear: command.clear,
        delayMs: shouldUseSmoothType() ? undefined : 0,
      });
    } else {
      await page.keyboard.type(command.text, {
        delay: shouldUseSmoothType() ? 20 : 0,
      });
    }
    const session = await patchBrowserLiveSessionMetadata(
      state.metadata.sessionName,
      {
        currentUrl: page.url(),
      },
    ) as BrowserLiveSessionMetadata;
    return { session };
  }

  if (command.type === "scroll") {
    const deltaX = typeof command.deltaX === "number" ? command.deltaX : 0;
    const deltaY = typeof command.deltaY === "number" ? command.deltaY : 0;
    if (command.selector) {
      await target.locator(command.selector).evaluate(
        (element, delta) => {
          element.scrollBy(delta.x, delta.y);
        },
        { x: deltaX, y: deltaY },
      );
    } else {
      await page.mouse.wheel(deltaX, deltaY);
    }
    const session = await patchBrowserLiveSessionMetadata(
      state.metadata.sessionName,
      {
        currentUrl: page.url(),
      },
    ) as BrowserLiveSessionMetadata;
    return { session };
  }

  if (command.type === "screenshot") {
    const label = toSlug(command.label || `live-${Date.now()}`);
    const shotPath = await screenshot(page, paths.screenshotsDir, label);
    const session = await patchBrowserLiveSessionMetadata(
      state.metadata.sessionName,
      {
        currentUrl: page.url(),
        lastScreenshotPath: shotPath,
      },
    ) as BrowserLiveSessionMetadata;
    return { session };
  }

  if (command.type === "record-start") {
    if (recording.active) {
      throw new Error("Recording is already active.");
    }
    const stamp = `${Date.now()}`;
    const recordingLatestDir = path.join(paths.latestDir, "recordings", stamp);
    const recordingFramesDir = path.join(recordingLatestDir, "frames");
    await ensureDir(recordingFramesDir);

    const cdp = await page.context().newCDPSession(page);
    recording.active = true;
    recording.session = cdp;
    recording.pendingWrites.clear();
    recording.frameSeq = 0;
    recording.framesDir = recordingFramesDir;
    recording.latestDir = recordingLatestDir;
    recording.outputPath = path.join(recordingLatestDir, "video.mp4");

    cdp.on(
      "Page.screencastFrame",
      (event: { data: string; sessionId: number }) => {
        const seq = ++recording.frameSeq;
        const filename = `frame-${seq.toString().padStart(6, "0")}.png`;
        const filepath = path.join(recordingFramesDir, filename);
        const writePromise = Deno.writeFile(
          filepath,
          Uint8Array.from(atob(event.data), (char) => char.charCodeAt(0)),
        );
        recording.pendingWrites.add(writePromise);
        writePromise.finally(() =>
          recording.pendingWrites.delete(writePromise)
        );
        void cdp.send("Page.screencastFrameAck", {
          sessionId: event.sessionId,
        });
      },
    );
    await cdp.send("Page.enable");
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
    screencastOptions.maxFrameRate = getDemoFrameRate();
    await cdp.send("Page.startScreencast", screencastOptions);
    const session = await patchBrowserLiveSessionMetadata(
      state.metadata.sessionName,
      {
        recordingActive: true,
        currentUrl: page.url(),
      },
    ) as BrowserLiveSessionMetadata;
    return { session };
  }

  if (command.type === "record-stop") {
    if (
      !recording.active || !recording.session || !recording.framesDir ||
      !recording.latestDir
    ) {
      throw new Error("Recording is not active.");
    }
    await recording.session.send("Page.stopScreencast");
    await Promise.allSettled([...recording.pendingWrites]);
    await recording.session.detach().catch(() => {});
    await exportVideo(
      recording.framesDir,
      recording.latestDir,
      getDemoOutputFrameRate(getDemoFrameRate()),
      getDemoInterpolationMode(),
    );
    recording.active = false;
    recording.session = undefined;
    recording.framesDir = undefined;
    recording.latestDir = undefined;
    const outputPath = recording.outputPath;
    recording.outputPath = undefined;
    const session = await patchBrowserLiveSessionMetadata(
      state.metadata.sessionName,
      {
        recordingActive: false,
        currentUrl: page.url(),
        lastRecordingPath: outputPath,
      },
    ) as BrowserLiveSessionMetadata;
    return { session };
  }

  if (command.type === "stop") {
    await patchBrowserLiveSessionMetadata(state.metadata.sessionName, {
      status: "stopping",
    });
    return {
      session: {
        ...state.metadata,
        status: "stopping",
        updatedAt: new Date().toISOString(),
      },
    };
  }

  return { session: state.metadata };
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    string: ["session", "port", "url", "storage-state"],
    boolean: ["headless", "show-browser", "no-host-bridge"],
  }) as LiveDaemonArgs;
  const sessionName = normalizeBrowserLiveSessionName(args.session);
  const port = Number(args.port);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("Missing or invalid --port for live session daemon.");
  }
  const useHostBridge = !args["no-host-bridge"];
  const headless = args["show-browser"] ? false : (args.headless ?? true);
  const paths = getDemoPaths(`browser-live-${sessionName}`);
  await prepareDemoPaths(paths);
  const abort = new AbortController();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  const metadata: BrowserLiveSessionMetadata = {
    sessionName,
    sessionSlug: sessionName,
    pid: Deno.pid,
    port,
    apiBaseUrl: `http://127.0.0.1:${port}`,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "starting",
    mode: "live",
    useHostBridge,
    headless,
    smoothMouse: shouldUseSmoothMouse(),
    smoothType: shouldUseSmoothType(),
    keepBrowserOpen: true,
    artifactRoot: paths.artifactRoot,
    latestDir: paths.latestDir,
    logsDir: paths.logsDir,
    screenshotsDir: paths.screenshotsDir,
    recordingActive: false,
    currentUrl: args.url,
  };
  await writeBrowserLiveSessionMetadata(metadata);

  const recording: RecordingState = {
    active: false,
    pendingWrites: new Set(),
    frameSeq: 0,
  };

  try {
    const requestedViewport = getDemoViewport();
    const windowSize = getDemoWindowSize(requestedViewport);
    if (useHostBridge) {
      const hostBridge = await startHostBridgeChrome({ headless, windowSize });
      metadata.hostBridgeInstanceId = hostBridge.instanceId;
      await writeBrowserLiveSessionMetadata(metadata);
      browser = await chromium.connectOverCDP(hostBridge.wsEndpoint);
    } else {
      const launchArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-quic",
        "--disable-http3",
        "--disable-features=AsyncDns,DnsOverHttps,UseDnsHttpsSvcb,UseDnsHttpsSvcbAlpn",
      ];
      if (windowSize) {
        launchArgs.push(
          `--window-size=${windowSize.width},${windowSize.height}`,
        );
      }
      browser = await chromium.launch({
        headless,
        executablePath: getExecutablePath(),
        args: launchArgs,
      });
    }

    context = browser.contexts()[0] || await browser.newContext({
      ...(requestedViewport ? { viewport: requestedViewport } : {}),
      ...(args["storage-state"] ? { storageState: args["storage-state"] } : {}),
    });
    page = context.pages()[0] || await context.newPage();
    attachPageLogHandlers(page, paths.logsDir, true);
    if (requestedViewport) {
      await page.setViewportSize(requestedViewport).catch(() => {});
    }
    await page.goto(resolveInitialLiveUrl(args.url), {
      waitUntil: "domcontentloaded",
    });

    const runningMetadata = await patchBrowserLiveSessionMetadata(sessionName, {
      status: "running",
      currentUrl: page.url(),
    });
    if (!runningMetadata) {
      throw new Error("Failed to update live session metadata after startup.");
    }

    const state = {
      page,
      metadata: runningMetadata,
      paths,
      recording,
      mousePosition: null as { x: number; y: number } | null,
    };

    const server = Deno.serve(
      {
        hostname: "127.0.0.1",
        port,
        signal: abort.signal,
      },
      async (request) => {
        const url = new URL(request.url);
        if (request.method === "GET" && url.pathname === "/status") {
          const latest = await patchBrowserLiveSessionMetadata(sessionName, {
            currentUrl: state.page.url(),
            recordingActive: state.recording.active,
          });
          return json(latest ?? state.metadata);
        }
        if (request.method === "POST" && url.pathname === "/command") {
          const command = await request.json() as BrowserLiveSessionCommand;
          try {
            const next = await applyCommand(command, state);
            state.metadata = next.session;
            if (command.type === "stop") {
              abort.abort();
            }
            return json({
              ok: true,
              session: next.session,
              result: next.result,
            });
          } catch (error) {
            const message = error instanceof Error
              ? error.message
              : String(error);
            await patchBrowserLiveSessionMetadata(sessionName, {
              error: message,
            });
            return json({ ok: false, error: message }, { status: 400 });
          }
        }
        return json({ ok: false, error: "Not found" }, { status: 404 });
      },
    );

    await server.finished;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchBrowserLiveSessionMetadata(sessionName, {
      status: "error",
      error: message,
    });
    throw error;
  } finally {
    let teardownError: Error | null = null;
    try {
      if (
        recording.active && recording.session && recording.framesDir &&
        recording.latestDir
      ) {
        await recording.session.send("Page.stopScreencast").catch(() => {});
        await Promise.allSettled([...recording.pendingWrites]);
        await recording.session.detach().catch(() => {});
        await exportVideo(
          recording.framesDir,
          recording.latestDir,
          getDemoOutputFrameRate(getDemoFrameRate()),
          getDemoInterpolationMode(),
        );
      }
    } catch {
      // ignore record-stop teardown failures
    }
    const hostBridgeInstanceId = metadata.hostBridgeInstanceId;
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (useHostBridge) {
      try {
        await stopHostBridgeChrome(hostBridgeInstanceId);
        const status = await getHostBridgeChromeStatus(hostBridgeInstanceId);
        if (status.running) {
          teardownError = new Error(
            "Host bridge reported the browser is still running.",
          );
        }
      } catch (error) {
        teardownError = error instanceof Error
          ? error
          : new Error(String(error));
      }
      if (teardownError) {
        await patchBrowserLiveSessionMetadata(sessionName, {
          error: teardownError.message,
        });
      }
    }
  }
}

if (import.meta.main) {
  await main();
}
