import * as path from "@std/path";
import { getHostBridgeUrl, type ViewportSize } from "./demo-config.ts";

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

function findAvailablePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
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

export async function stopServer(server: {
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

export async function stopBoltfoundryDevServer(): Promise<void> {
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

export async function startHostBridgeChrome(opts: {
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

export async function stopHostBridgeChrome(): Promise<void> {
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
