import * as path from "@std/path";
import {
  type BrowserAppTargetName,
  buildManagedDevCommand,
  getBrowserAppTargetBaseUrl,
  getManagedDevModeForServerMode,
} from "./appTargets.ts";
import {
  DEFAULT_READY_PATTERN,
  findAvailablePort,
  getBoltfoundryComAppRoot,
  SERVER_LOG_HEADER,
  SERVER_STOP_TIMEOUT_MS,
  waitForHttpReady,
} from "./browserTestContextShared.ts";

export type ServerSpawnOptions = {
  appTarget?: BrowserAppTargetName;
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

type CommandChild = ReturnType<Deno.Command["spawn"]>;

export type ServerProcessInfo = {
  process: CommandChild;
  status: Promise<Deno.CommandStatus>;
  stdoutTask?: Promise<void>;
  stderrTask?: Promise<void>;
};

export async function startEmbeddedServer(
  options: ServerSpawnOptions,
  logsDir: string,
  resolveBaseUrl: (rawBaseUrl: string) => string,
): Promise<{ baseUrl: string; server: ServerProcessInfo }> {
  const mode = options.mode ?? "production";
  const useHostBridgeAppTarget = options.appTarget &&
    Deno.env.get("GAMBIT_USE_HOST_BRIDGE") === "true";
  const port = options.port ??
    (useHostBridgeAppTarget ? 8000 : findAvailablePort());
  if (options.command && options.port === undefined) {
    throw new Error(
      "createBrowserTestContext: server.port must be provided when supplying a custom command.",
    );
  }
  if (options.appTarget && options.command) {
    throw new Error(
      "createBrowserTestContext: server.appTarget cannot be combined with a custom command.",
    );
  }

  const command = options.command
    ? [...options.command]
    : options.appTarget
    ? buildManagedDevCommand({
      target: options.appTarget,
      mode: getManagedDevModeForServerMode(mode),
      port,
    })
    : [
      "deno",
      "run",
      "--allow-env",
      "--allow-read",
      "--allow-write",
      "--allow-net",
      "apps/boltfoundry-com/server.tsx",
      "--mode",
      mode,
      "--port",
      String(port),
    ];

  const env = options.inheritEnv === false ? {} : { ...Deno.env.toObject() };
  if (env.BF_ENV === undefined) {
    env.BF_ENV = mode === "production" ? "production" : "development";
  }
  if (env.FORCE_DB_BACKEND === undefined) env.FORCE_DB_BACKEND = "sqlite";
  Object.assign(env, options.env ?? {});

  const logPath = path.join(
    logsDir,
    options.logFileName ?? "dev-server.log",
  );
  await Deno.writeTextFile(logPath, SERVER_LOG_HEADER, { create: true });

  const appendLog = async (prefix: string, chunk: string) => {
    const normalized = chunk.replace(/\r\n/g, "\n");
    if (!normalized.trim()) return;
    const payload = normalized.split("\n").filter(Boolean).map((line) =>
      `${new Date().toISOString()} [${prefix}] ${line}\n`
    ).join("");
    await Deno.writeTextFile(logPath, payload, { append: true });
  };

  if (!options.command && !options.appTarget && mode === "production") {
    const buildEnv = {
      ...env,
      NODE_ENV: "development",
      DENO_ENV: "development",
    };
    await appendLog(
      "stdout",
      "Building production-like assets with React dev diagnostics...",
    );
    const buildResult = await new Deno.Command("deno", {
      args: [
        "run",
        "-A",
        "--node-modules-dir",
        "npm:vite",
        "build",
        "--mode",
        "development",
        "--minify",
        "false",
        "--sourcemap",
      ],
      cwd: getBoltfoundryComAppRoot(),
      stdout: "piped",
      stderr: "piped",
      env: buildEnv,
    }).output();
    await appendLog("stdout", new TextDecoder().decode(buildResult.stdout));
    await appendLog("stderr", new TextDecoder().decode(buildResult.stderr));
    if (!buildResult.success) {
      throw new Error(
        `Embedded production asset build failed (code ${buildResult.code})`,
      );
    }
    await appendLog("stdout", "Build completed successfully");
  }

  const child = new Deno.Command(command[0], {
    args: command.slice(1),
    cwd: options.cwd,
    stdout: "piped",
    stderr: "piped",
    env,
  }).spawn();

  const decoder = new TextDecoder();
  const readyPattern = options.readyPattern ?? DEFAULT_READY_PATTERN;
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
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    throw error;
  });

  const pump = async (
    stream: ReadableStream<Uint8Array> | null,
    prefix: "stdout" | "stderr",
  ) => {
    if (!stream) return;
    const reader = stream.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        const chunk = decoder.decode(value);
        readinessBuffer = `${readinessBuffer}${chunk}`.slice(-4096);
        if (!readyResolved && readyPattern.test(readinessBuffer)) {
          readyResolve?.();
        }
        await appendLog(prefix, chunk);
      }
    } finally {
      reader.releaseLock();
    }
  };

  const stdoutTask = pump(child.stdout, "stdout");
  const stderrTask = pump(child.stderr, "stderr");

  const timeoutMs = options.startupTimeoutMs ?? 30_000;
  const timeoutId = setTimeout(() => {
    if (!readyResolved) {
      readyReject?.(
        new Error(
          `Timed out waiting for embedded server to start after ${timeoutMs} ms`,
        ),
      );
    }
  }, timeoutMs);

  const appTargetReadinessTask = options.appTarget
    ? (async () => {
      const ready = await waitForHttpReady(port, {
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
    clearTimeout(timeoutId);
    try {
      child.kill("SIGTERM");
    } catch {
      // Ignore cleanup errors while handling startup failure.
    }
    await statusPromise.catch(() => {});
    await Promise.allSettled(
      [stdoutTask, stderrTask, appTargetReadinessTask].filter(Boolean),
    );
    throw error;
  }
  clearTimeout(timeoutId);

  await Promise.allSettled([appTargetReadinessTask].filter(Boolean));
  const rawBaseUrl = options.appTarget
    ? getBrowserAppTargetBaseUrl(
      options.appTarget,
      useHostBridgeAppTarget && options.port === undefined ? undefined : port,
    )
    : `http://127.0.0.1:${port}`;
  return {
    baseUrl: resolveBaseUrl(rawBaseUrl),
    server: {
      process: child,
      status: statusPromise,
      stdoutTask,
      stderrTask,
    },
  };
}

export async function stopEmbeddedServer(
  server: ServerProcessInfo,
): Promise<void> {
  const { process, status, stdoutTask, stderrTask } = server;
  try {
    process.kill("SIGTERM");
  } catch {
    // Process may already be gone.
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const stopTimeout = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), SERVER_STOP_TIMEOUT_MS);
  });
  const result = await Promise.race([
    status.then(() => "exited" as const).catch(() => "exited" as const),
    stopTimeout,
  ]);
  if (timeoutId !== undefined) clearTimeout(timeoutId);
  if (result === "timeout") {
    try {
      process.kill("SIGKILL");
    } catch {
      // Process may already be gone.
    }
    await status.catch(() => {});
  }
  await Promise.allSettled([stdoutTask, stderrTask].filter(Boolean));
}
