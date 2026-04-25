import * as path from "@std/path";
import { ensureDir } from "@std/fs";
import { getLogger } from "./logger.ts";
import {
  type BrowserAppTargetName,
  buildManagedDevCommand,
  getManagedDevModeForServerMode,
} from "./appTargets.ts";
import {
  getHostBridgeUrl,
  isIframeShellPath,
  type ViewportSize,
} from "./config.ts";
import { iframeShellPath } from "./paths.ts";

const logger = getLogger(import.meta);

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

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function findAvailablePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpReady(
  port: number,
  opts?: { timeoutMs?: number; accept404?: boolean },
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, {
        method: "GET",
      });
      if (response.ok || (opts?.accept404 && response.status === 404)) {
        await response.body?.cancel().catch(() => {});
        return true;
      }
      await response.body?.cancel().catch(() => {});
    } catch {
      // keep polling until timeout
    }
    await wait(250);
  }
  return false;
}

function isIframeShellRequest(url: URL): boolean {
  return isIframeShellPath(url.pathname);
}

function isWebSocketRequest(request: Request): boolean {
  const upgrade = request.headers.get("upgrade");
  return upgrade?.toLowerCase() === "websocket";
}

function buildTargetUrl(requestUrl: URL, targetBase: URL): URL {
  const targetUrl = new URL(targetBase.toString());
  targetUrl.pathname = requestUrl.pathname;
  targetUrl.search = requestUrl.search;
  return targetUrl;
}

function filterProxyHeaders(headers: Headers): Headers {
  const filtered = new Headers();
  for (const [key, value] of headers) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    filtered.set(key, value);
  }
  return filtered;
}

function proxyWebSocket(
  request: Request,
  targetBase: URL,
): Response {
  const { socket, response } = Deno.upgradeWebSocket(request);
  const targetUrl = new URL(request.url);
  targetUrl.protocol = targetBase.protocol === "https:" ? "wss:" : "ws:";
  targetUrl.host = targetBase.host;

  const backend = new WebSocket(targetUrl);
  const pending: Array<string | ArrayBuffer | Blob> = [];

  const flushPending = () => {
    while (pending.length && backend.readyState === WebSocket.OPEN) {
      backend.send(pending.shift()!);
    }
  };

  socket.onmessage = (event) => {
    if (backend.readyState === WebSocket.OPEN) {
      backend.send(event.data);
    } else {
      pending.push(event.data);
    }
  };

  backend.onopen = () => {
    flushPending();
  };
  backend.onmessage = (event) => {
    socket.send(event.data);
  };

  const closeBoth = (code?: number, reason?: string) => {
    try {
      socket.close(code, reason);
    } catch (_) {
      // ignore
    }
    try {
      backend.close(code, reason);
    } catch (_) {
      // ignore
    }
  };

  socket.onerror = () => closeBoth();
  backend.onerror = () => closeBoth();
  socket.onclose = (event) => closeBoth(event.code, event.reason);
  backend.onclose = (event) => closeBoth(event.code, event.reason);

  return response;
}

async function proxyHttp(request: Request, targetBase: URL): Promise<Response> {
  const requestUrl = new URL(request.url);
  const targetUrl = buildTargetUrl(requestUrl, targetBase);
  const headers = filterProxyHeaders(request.headers);

  const proxyRequest = new Request(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  });

  const upstream = await fetch(proxyRequest);
  const responseHeaders = filterProxyHeaders(upstream.headers);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

function startProxyServer(opts: {
  port: number;
  targetBaseUrl: string;
}): {
  server: ReturnType<typeof Deno.serve>;
  abort: AbortController;
  baseUrl: string;
} {
  const abort = new AbortController();
  let shuttingDown = false;
  abort.signal.addEventListener("abort", () => {
    shuttingDown = true;
  }, { once: true });
  const targetBase = new URL(opts.targetBaseUrl);
  const server = Deno.serve(
    {
      hostname: "127.0.0.1",
      port: opts.port,
      signal: abort.signal,
    },
    async (request) => {
      const requestUrl = new URL(request.url);
      if (isIframeShellRequest(requestUrl)) {
        try {
          const html = await Deno.readTextFile(iframeShellPath);
          return new Response(html, {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : String(error);
          return new Response(
            `Demo harness unavailable: ${message}`,
            { status: 500 },
          );
        }
      }

      if (isWebSocketRequest(request)) {
        return proxyWebSocket(request, targetBase);
      }

      try {
        return await proxyHttp(request, targetBase);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!shuttingDown && !abort.signal.aborted) {
          logger.warn(
            `[gambit-demo] proxy request failed (${request.method} ${requestUrl.pathname}): ${message}`,
          );
        }
        return new Response(
          shuttingDown || abort.signal.aborted
            ? "Demo proxy shutting down"
            : `Demo proxy upstream error: ${message}`,
          { status: shuttingDown || abort.signal.aborted ? 503 : 502 },
        );
      }
    },
  );

  return {
    server,
    abort,
    baseUrl: `http://127.0.0.1:${opts.port}`,
  };
}

export function startProxyServerOnly(opts: {
  port: number;
  targetBaseUrl: string;
}): {
  port: number;
  baseUrl: string;
  previousBaseUrl?: string | null;
  proxy: {
    server: ReturnType<typeof Deno.serve>;
    abort: AbortController;
  };
} {
  const proxy = startProxyServer(opts);
  const previousBaseUrl = Deno.env.get("GAMBIT_E2E_URL");
  Deno.env.set("GAMBIT_E2E_URL", proxy.baseUrl);
  return {
    port: opts.port,
    baseUrl: proxy.baseUrl,
    previousBaseUrl,
    proxy: {
      server: proxy.server,
      abort: proxy.abort,
    },
  };
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

export async function startServer(opts: {
  logsDir: string;
  cwd: string;
  appTarget?: BrowserAppTargetName;
  command?: Array<string>;
  readyPattern?: RegExp;
  port?: number;
  targetPort?: number;
  proxy?: boolean;
}): Promise<{
  process: ReturnType<Deno.Command["spawn"]>;
  status: Promise<Deno.CommandStatus>;
  stdoutTask?: Promise<void>;
  stderrTask?: Promise<void>;
  port: number;
  baseUrl: string;
  logPath: string;
  previousBaseUrl?: string | null;
  targetPort: number;
  targetBaseUrl: string;
  proxy?: {
    server: ReturnType<typeof Deno.serve>;
    abort: AbortController;
  };
}> {
  const port = opts.port ?? findAvailablePort();
  const targetPort = opts.targetPort ?? findAvailablePort();
  const useProxy = opts.proxy !== false;
  if (opts.appTarget && opts.command) {
    throw new Error("startServer: appTarget cannot be combined with command.");
  }
  const command = opts.command
    ? [...opts.command]
    : opts.appTarget
    ? buildManagedDevCommand({
      target: opts.appTarget,
      mode: getManagedDevModeForServerMode("development"),
      port: targetPort,
    })
    : [
      ...DEFAULT_SERVER_COMMAND,
      "--port",
      String(targetPort),
    ];

  const logPath = path.join(opts.logsDir, "dev-server.log");
  const header = [
    "# gambit demo embedded dev server",
    `# started: ${new Date().toISOString()}`,
  ].join("\n") + "\n";
  await ensureDir(opts.logsDir);
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
  const appTargetReadinessTask = opts.appTarget
    ? (async () => {
      const ready = await waitForHttpReady(targetPort, {
        timeoutMs,
        accept404: true,
      });
      if (ready && !readyResolved) {
        readyResolve?.();
      }
    })()
    : null;

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
      [stdoutTask, stderrTask, appTargetReadinessTask].filter(Boolean) as Array<
        Promise<unknown>
      >,
    );
    throw error;
  }

  clearTimeout(timeout);
  await Promise.allSettled(
    [appTargetReadinessTask].filter(Boolean) as Array<Promise<unknown>>,
  );

  const targetBaseUrl = `http://127.0.0.1:${targetPort}`;
  const proxy = useProxy
    ? startProxyServer({ port, targetBaseUrl })
    : undefined;
  const baseUrl = proxy ? proxy.baseUrl : targetBaseUrl;
  const previousBaseUrl = useProxy ? Deno.env.get("GAMBIT_E2E_URL") : null;
  if (useProxy) {
    Deno.env.set("GAMBIT_E2E_URL", baseUrl);
  }

  return {
    process: child,
    status: statusPromise,
    stdoutTask,
    stderrTask,
    port,
    baseUrl,
    logPath,
    previousBaseUrl,
    targetPort,
    targetBaseUrl,
    proxy,
  };
}

export async function stopServer(server: {
  process: ReturnType<Deno.Command["spawn"]>;
  status: Promise<Deno.CommandStatus>;
  stdoutTask?: Promise<void>;
  stderrTask?: Promise<void>;
  previousBaseUrl?: string | null;
  proxy?: {
    server: ReturnType<typeof Deno.serve>;
    abort: AbortController;
  };
}): Promise<void> {
  if (server.proxy) {
    try {
      server.proxy.abort.abort();
    } catch (_) {
      // ignore
    }
    await server.proxy.server.finished.catch(() => {});
  }
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

  if (server.previousBaseUrl !== null && server.previousBaseUrl !== undefined) {
    Deno.env.set("GAMBIT_E2E_URL", server.previousBaseUrl);
  } else if (server.previousBaseUrl === undefined) {
    Deno.env.delete("GAMBIT_E2E_URL");
  }
}

export async function stopProxyServerOnly(server: {
  previousBaseUrl?: string | null;
  proxy: {
    server: ReturnType<typeof Deno.serve>;
    abort: AbortController;
  };
}): Promise<void> {
  try {
    server.proxy.abort.abort();
  } catch (_) {
    // ignore
  }
  await server.proxy.server.finished.catch(() => {});
  if (server.previousBaseUrl !== null && server.previousBaseUrl !== undefined) {
    Deno.env.set("GAMBIT_E2E_URL", server.previousBaseUrl);
  } else if (server.previousBaseUrl === undefined) {
    Deno.env.delete("GAMBIT_E2E_URL");
  }
}

export async function stopManagedDevTarget(
  target?: BrowserAppTargetName,
): Promise<void> {
  logger.info(
    `[gambit-demo] ensuring managed dev target${
      target ? ` '${target}'` : ""
    } is stopped for port 8000...`,
  );
  try {
    const result = await new Deno.Command("bft", {
      args: target ? ["dev", "stop", target] : ["dev", "stop"],
      stdout: "null",
      stderr: "piped",
    }).output();
    if (result.code === 0) {
      logger.info("[gambit-demo] managed dev target stopped.");
    } else {
      const stderr = new TextDecoder().decode(result.stderr).trim();
      logger.warn(
        `[gambit-demo] failed to stop managed dev target (code ${result.code})${
          stderr ? `: ${stderr}` : ""
        }`,
      );
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      logger.warn(
        "[gambit-demo] `bft` command not found; skipping managed dev shutdown.",
      );
    } else {
      logger.warn(
        "[gambit-demo] error while stopping managed dev target:",
        error,
      );
    }
  }
}

export async function stopBoltfoundryDevServer(): Promise<void> {
  await stopManagedDevTarget("boltfoundry-com");
}

export async function startHostBridgeChrome(opts: {
  headless: boolean;
  windowSize?: ViewportSize | null;
  muteAudio?: boolean;
  autoGrantMedia?: boolean;
  allowScreenCapture?: boolean;
  autoSelectTabCaptureSourceByTitle?: string | null;
}): Promise<string> {
  const baseUrl = getHostBridgeUrl();
  const payload: Record<string, unknown> = {
    headless: opts.headless,
  };
  if (opts.windowSize) {
    payload.windowWidth = opts.windowSize.width;
    payload.windowHeight = opts.windowSize.height;
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

export async function stopHostBridgeChrome(): Promise<void> {
  const baseUrl = getHostBridgeUrl();
  try {
    const res = await fetch(`${baseUrl}/browser/debugger/stop`, {
      method: "POST",
    });
    try {
      await res.body?.cancel();
    } catch {
      // ignore body cleanup failures
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn(
        `[gambit-demo] host bridge stop failed (${res.status}): ${
          text || res.statusText
        }`,
      );
    }
  } catch (error) {
    logger.warn("[gambit-demo] failed to stop host bridge chrome:", error);
  }
}
