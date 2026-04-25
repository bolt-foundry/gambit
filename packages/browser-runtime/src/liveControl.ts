import { ensureDir } from "@std/fs";
import * as path from "@std/path";
import {
  type BrowserRuntimeProfileOverrides,
  getBrowserRuntimeEnvPatch,
  getBrowserRuntimeProfile,
} from "./browserRuntime.ts";
import { getHostBridgeUrl } from "./config.ts";
import { getDemoPaths } from "./runner.ts";
import { toSlug, wait } from "./utils.ts";

export type BrowserLiveSessionCommand =
  | {
    type: "open";
    url: string;
  }
  | {
    type: "eval";
    expression: string;
  }
  | {
    type: "mouse-move";
    x?: number;
    y?: number;
    selector?: string;
  }
  | {
    type: "click";
    x?: number;
    y?: number;
    selector?: string;
  }
  | {
    type: "type";
    text: string;
    selector?: string;
    clear?: boolean;
  }
  | {
    type: "scroll";
    selector?: string;
    deltaX?: number;
    deltaY?: number;
  }
  | {
    type: "screenshot";
    label?: string;
  }
  | {
    type: "record-start";
  }
  | {
    type: "record-stop";
  }
  | {
    type: "stop";
  };

export type BrowserLiveSessionCommandResult = {
  ok: true;
  session: BrowserLiveSessionMetadata;
  result?: unknown;
};

export type BrowserLiveSessionStartOptions = {
  name?: string;
  url?: string;
  headless?: boolean;
  useHostBridge?: boolean;
  profileOverrides?: BrowserRuntimeProfileOverrides;
  storageStatePath?: string;
};

export type BrowserLiveSessionMetadata = {
  sessionName: string;
  sessionSlug: string;
  pid: number;
  port: number;
  apiBaseUrl: string;
  startedAt: string;
  updatedAt: string;
  status: "starting" | "running" | "stopping" | "stopped" | "error";
  mode: "live";
  useHostBridge: boolean;
  headless: boolean;
  smoothMouse: boolean;
  smoothType: boolean;
  keepBrowserOpen: boolean;
  artifactRoot: string;
  latestDir: string;
  logsDir: string;
  screenshotsDir: string;
  currentUrl?: string;
  recordingActive: boolean;
  hostBridgeInstanceId?: string;
  lastRecordingPath?: string;
  lastScreenshotPath?: string;
  error?: string;
};

type LiveSessionMetadataPatch = Partial<BrowserLiveSessionMetadata>;

function getLiveControlRoot(): string {
  const paths = getDemoPaths("browser-live-root");
  return path.join(paths.artifactRoot, "browser-live");
}

export function normalizeBrowserLiveSessionName(name?: string): string {
  return toSlug(name?.trim() || "default");
}

export function getBrowserLiveSessionMetadataPath(name?: string): string {
  const sessionName = normalizeBrowserLiveSessionName(name);
  return path.join(getLiveControlRoot(), `${sessionName}.json`);
}

export async function readBrowserLiveSessionMetadata(
  name?: string,
): Promise<BrowserLiveSessionMetadata | null> {
  const metadataPath = getBrowserLiveSessionMetadataPath(name);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await Deno.readTextFile(metadataPath);
      return JSON.parse(raw) as BrowserLiveSessionMetadata;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      if (error instanceof SyntaxError && attempt === 0) {
        await wait(10);
        continue;
      }
      throw error;
    }
  }
  return null;
}

export async function writeBrowserLiveSessionMetadata(
  metadata: BrowserLiveSessionMetadata,
): Promise<void> {
  const metadataPath = getBrowserLiveSessionMetadataPath(metadata.sessionName);
  const tempPath = `${metadataPath}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  await ensureDir(path.dirname(metadataPath));
  await Deno.writeTextFile(
    tempPath,
    JSON.stringify(
      { ...metadata, updatedAt: new Date().toISOString() },
      null,
      2,
    ) + "\n",
  );
  await Deno.rename(tempPath, metadataPath);
}

export async function patchBrowserLiveSessionMetadata(
  name: string,
  patch: LiveSessionMetadataPatch,
): Promise<BrowserLiveSessionMetadata | null> {
  const current = await readBrowserLiveSessionMetadata(name);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeBrowserLiveSessionMetadata(next);
  return next;
}

export async function deleteBrowserLiveSessionMetadata(
  name?: string,
): Promise<void> {
  await Deno.remove(getBrowserLiveSessionMetadataPath(name)).catch(() => {});
}

async function markBrowserLiveSessionError(
  metadata: BrowserLiveSessionMetadata,
  error: unknown,
): Promise<BrowserLiveSessionMetadata> {
  const message = error instanceof Error ? error.message : String(error);
  const next = {
    ...metadata,
    status: "error" as const,
    error: `Live browser session control API is unreachable: ${message}`,
    updatedAt: new Date().toISOString(),
  };
  await writeBrowserLiveSessionMetadata(next);
  return next;
}

function isSessionResponse(
  value: unknown,
): value is Record<string, unknown> & { ok: boolean } {
  return typeof value === "object" && value !== null && "ok" in value;
}

async function fetchBrowserLiveSessionApi<T>(
  metadata: BrowserLiveSessionMetadata,
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(
    `${metadata.apiBaseUrl}${pathname}`,
    init,
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isSessionResponse(body) && typeof body.error === "string"
      ? body.error
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function getBrowserLiveSessionApiStatus(
  name?: string,
): Promise<BrowserLiveSessionMetadata | null> {
  const metadata = await readBrowserLiveSessionMetadata(name);
  if (!metadata) return null;
  const status = await fetchBrowserLiveSessionApi<BrowserLiveSessionMetadata>(
    metadata,
    "/status",
  );
  await writeBrowserLiveSessionMetadata(status);
  return status;
}

export async function getBrowserLiveSessionStatus(
  name?: string,
): Promise<BrowserLiveSessionMetadata | null> {
  const metadata = await readBrowserLiveSessionMetadata(name);
  if (!metadata) return null;
  try {
    const status = await fetchBrowserLiveSessionApi<BrowserLiveSessionMetadata>(
      metadata,
      "/status",
    );
    await writeBrowserLiveSessionMetadata(status);
    return status;
  } catch (error) {
    if (metadata.status === "running" || metadata.status === "starting") {
      return await markBrowserLiveSessionError(metadata, error);
    }
    return metadata;
  }
}

export async function sendBrowserLiveSessionCommand(
  name: string | undefined,
  command: BrowserLiveSessionCommand,
): Promise<BrowserLiveSessionMetadata> {
  const result = await sendBrowserLiveSessionCommandWithResult(name, command);
  return result.session;
}

export async function sendBrowserLiveSessionCommandWithResult(
  name: string | undefined,
  command: BrowserLiveSessionCommand,
): Promise<BrowserLiveSessionCommandResult> {
  const metadata = await readBrowserLiveSessionMetadata(name);
  if (!metadata) {
    throw new Error(
      `No live browser session named '${
        normalizeBrowserLiveSessionName(name)
      }' is running.`,
    );
  }
  let result: BrowserLiveSessionCommandResult;
  try {
    result = await fetchBrowserLiveSessionApi<
      BrowserLiveSessionCommandResult
    >(
      metadata,
      "/command",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      },
    );
  } catch (error) {
    const stale =
      metadata.status === "running" || metadata.status === "starting"
        ? await markBrowserLiveSessionError(metadata, error)
        : metadata;
    throw new Error(
      stale.error ??
        `Live browser session '${
          normalizeBrowserLiveSessionName(name)
        }' control API is unreachable.`,
    );
  }
  await writeBrowserLiveSessionMetadata(result.session);
  return result;
}

export async function stopBrowserLiveSession(
  name?: string,
): Promise<void> {
  const sessionName = normalizeBrowserLiveSessionName(name);
  const metadata = await readBrowserLiveSessionMetadata(sessionName);
  if (!metadata) return;
  try {
    try {
      await sendBrowserLiveSessionCommand(sessionName, { type: "stop" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const looksLikeShutdownRace = message.includes("connection closed") ||
        message.includes("os error 111") ||
        message.includes("No live browser session");
      if (!looksLikeShutdownRace) {
        throw error;
      }
    }
    const deadlineMs = Date.now() + 10_000;
    while (Date.now() < deadlineMs) {
      if (metadata.useHostBridge && metadata.hostBridgeInstanceId) {
        const url = new URL(`${getHostBridgeUrl()}/browser/debugger/status`);
        url.searchParams.set("instanceId", metadata.hostBridgeInstanceId);
        const response = await fetch(url).catch(() => null);
        const body = response && response.ok
          ? await response.json().catch(() => null) as
            | { running?: boolean }
            | null
          : null;
        if (body?.running === false) {
          await deleteBrowserLiveSessionMetadata(sessionName);
          return;
        }
      } else {
        try {
          const result = await new Deno.Command("ps", {
            args: ["-p", String(metadata.pid)],
            stdout: "null",
            stderr: "null",
          }).output();
          if (result.code !== 0) {
            await deleteBrowserLiveSessionMetadata(sessionName);
            return;
          }
        } catch {
          await deleteBrowserLiveSessionMetadata(sessionName);
          return;
        }
      }
      await wait(250);
    }
    throw new Error(
      `Timed out waiting for live browser session '${sessionName}' to stop.`,
    );
  } catch (error) {
    try {
      Deno.kill(metadata.pid, "SIGTERM");
    } catch {
      // ignore stale processes
    }
    throw error;
  }
}

function findAvailablePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function startBrowserLiveSession(
  options: BrowserLiveSessionStartOptions = {},
): Promise<BrowserLiveSessionMetadata> {
  const sessionName = normalizeBrowserLiveSessionName(options.name);
  const existing = await readBrowserLiveSessionMetadata(sessionName);
  if (existing) {
    try {
      const status = await getBrowserLiveSessionStatus(sessionName);
      if (status && status.status !== "stopped" && status.status !== "error") {
        throw new Error(
          `Live browser session '${sessionName}' is already running on port ${status.port}.`,
        );
      }
      if (status?.status === "stopped" || status?.status === "error") {
        await deleteBrowserLiveSessionMetadata(sessionName);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("already running")) {
        throw error;
      }
      await deleteBrowserLiveSessionMetadata(sessionName);
    }
  }

  const port = findAvailablePort();
  const daemonPath = path.join(
    path.dirname(path.fromFileUrl(import.meta.url)),
    "liveSessionDaemon.ts",
  );
  const profile = getBrowserRuntimeProfile("live", options.profileOverrides);
  const envPatch = Object.fromEntries(
    Object.entries(getBrowserRuntimeEnvPatch(profile)).filter((entry) =>
      typeof entry[1] === "string"
    ),
  ) as Record<string, string>;
  const args = [
    "run",
    "-A",
    daemonPath,
    "--session",
    sessionName,
    "--port",
    String(port),
  ];
  if (options.url) {
    args.push("--url", options.url);
  }
  if (options.headless === true) {
    args.push("--headless");
  } else if (options.headless === false) {
    args.push("--show-browser");
  }
  if (options.useHostBridge === false) {
    args.push("--no-host-bridge");
  }
  if (options.storageStatePath) {
    args.push("--storage-state", options.storageStatePath);
  }

  await new Deno.Command("bash", {
    args: [
      "-lc",
      `nohup ${
        [Deno.execPath(), ...args].map(shellQuote).join(" ")
      } </dev/null >/dev/null 2>&1 &`,
    ],
    env: {
      ...Deno.env.toObject(),
      ...envPatch,
    },
  }).output();

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const metadata = await readBrowserLiveSessionMetadata(sessionName);
    if (metadata?.status === "running") {
      return metadata;
    }
    if (metadata?.status === "error") {
      throw new Error(
        metadata.error ?? "Live browser session failed to start.",
      );
    }
    await wait(250);
  }

  try {
    await stopBrowserLiveSession(sessionName);
  } catch {
    await deleteBrowserLiveSessionMetadata(sessionName);
  }
  throw new Error(
    `Timed out waiting for live browser session '${sessionName}' to start.`,
  );
}
