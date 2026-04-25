// deno-lint-ignore-file no-console
import { parseArgs } from "@std/cli/parse-args";
import {
  type BrowserRuntimeMode,
  getBrowserRuntimeEnvPatch,
  getBrowserRuntimeProfile,
  getBrowserTempEnvPatch,
  usesNestedNixShellTempDir,
} from "./browserRuntime.ts";
import {
  getBrowserLiveSessionApiStatus,
  getBrowserLiveSessionStatus,
  normalizeBrowserLiveSessionName,
  readBrowserLiveSessionMetadata,
  sendBrowserLiveSessionCommand,
  sendBrowserLiveSessionCommandWithResult,
  stopBrowserLiveSession,
} from "./liveControl.ts";
import {
  BROWSER_APP_TARGET_ENV,
  getDefaultBrowserBaseUrl,
} from "./appTargets.ts";

type BrowserLiveTaskArgs = ReturnType<typeof parseArgs> & {
  app?: string;
  "browser-provider"?: string;
  name?: string;
  selector?: string;
  x?: string;
  y?: string;
  port?: string;
  "log-file"?: string;
  help?: boolean;
  "no-host-bridge"?: boolean;
  headless?: boolean;
  "show-browser"?: boolean;
  clear?: boolean;
  foreground?: boolean;
  "no-log"?: boolean;
};

type BrowserModeTaskArgs = ReturnType<typeof parseArgs> & {
  app?: string;
  "browser-provider"?: string;
  help?: boolean;
  "no-host-bridge"?: boolean;
  "show-browser"?: boolean;
  "no-video"?: boolean;
  production?: boolean;
  url?: string;
  all?: boolean;
};

type BrowserLiveSentinel = {
  sessionName: string;
  pid?: number;
  port: number;
  logPath?: string;
  startedAt: string;
};

export type BrowserCliManagedAppTarget = {
  resolve(raw?: string): string | null;
  start(target: string): Promise<number>;
  getBaseUrl(target: string): string;
  description?: string;
};

export type BrowserCliConfig = {
  commandName?: string;
  demoFlows?: ReadonlyMap<string, string>;
  testFlows?: ReadonlyMap<string, string>;
  managedAppTarget?: BrowserCliManagedAppTarget;
  output?: (message: string) => void;
  error?: (message: string) => void;
  runCommand?: (
    args: Array<string>,
    cwd: string,
    env: Record<string, string>,
  ) => Promise<number>;
  selfCommand?: (args: Array<string>) => Array<string>;
  liveDaemonPath?: string;
};

type BrowserCliResolvedConfig = {
  commandName: string;
  demoFlows: ReadonlyMap<string, string>;
  testFlows: ReadonlyMap<string, string>;
  managedAppTarget?: BrowserCliManagedAppTarget;
  output: (message: string) => void;
  error: (message: string) => void;
  runCommand: (
    args: Array<string>,
    cwd: string,
    env: Record<string, string>,
  ) => Promise<number>;
  selfCommand: (args: Array<string>) => Array<string>;
  liveDaemonPath: string;
};

function defaultOutput(message: string): void {
  console.log(message);
}

function defaultError(message: string): void {
  console.error(message);
}

async function defaultRunCommand(
  args: Array<string>,
  cwd: string,
  env: Record<string, string>,
): Promise<number> {
  const command = new Deno.Command(args[0], {
    args: args.slice(1),
    cwd,
    env: {
      ...Deno.env.toObject(),
      ...env,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await command.output();
  return code;
}

function defaultSelfCommand(args: Array<string>): Array<string> {
  const entrypointPath = new URL("./browserCliMain.ts", import.meta.url)
    .pathname;
  return ["deno", "run", "-A", entrypointPath, ...args];
}

function resolveConfig(config?: BrowserCliConfig): BrowserCliResolvedConfig {
  return {
    commandName: config?.commandName ?? "bft-browser",
    demoFlows: config?.demoFlows ?? new Map(),
    testFlows: config?.testFlows ?? new Map(),
    managedAppTarget: config?.managedAppTarget,
    output: config?.output ?? defaultOutput,
    error: config?.error ?? defaultError,
    runCommand: config?.runCommand ?? defaultRunCommand,
    selfCommand: config?.selfCommand ?? defaultSelfCommand,
    liveDaemonPath: config?.liveDaemonPath ??
      new URL("./liveSessionDaemon.ts", import.meta.url).pathname,
  };
}

function isHelpArg(arg?: string): boolean {
  return arg === "--help" || arg === "-h" || arg === "help";
}

function parseLiveArgs(rawArgs: Array<string>): BrowserLiveTaskArgs {
  return parseArgs(rawArgs, {
    string: [
      "app",
      "browser-provider",
      "name",
      "selector",
      "x",
      "y",
      "port",
      "log-file",
    ],
    boolean: [
      "help",
      "no-host-bridge",
      "headless",
      "show-browser",
      "clear",
      "foreground",
      "no-log",
    ],
  }) as BrowserLiveTaskArgs;
}

function parseModeArgs(rawArgs: Array<string>): BrowserModeTaskArgs {
  return parseArgs(rawArgs, {
    string: ["app", "browser-provider", "url"],
    boolean: [
      "all",
      "help",
      "no-host-bridge",
      "show-browser",
      "no-video",
      "production",
    ],
  }) as BrowserModeTaskArgs;
}

function formatFlowList(
  title: string,
  flows: ReadonlyMap<string, string>,
): string {
  if (flows.size === 0) return "";
  return [
    `${title}:`,
    ...Array.from(flows.keys()).map((name) => `  ${name}`),
    "",
  ].join("\n");
}

function formatUsage(config: BrowserCliResolvedConfig): string {
  const cmd = config.commandName;
  const managedAppText = config.managedAppTarget
    ? `  --app <target>       ${
      config.managedAppTarget.description ??
        "Start and open a managed app target"
    }\n`
    : "";
  const genericExamples = [
    `${cmd} demo ./path/to/demo.ts`,
    `${cmd} test ./path/to/spec.e2e.ts`,
    `${cmd} live start https://example.com --no-host-bridge`,
    `${cmd} live click --selector 'a'`,
    `${cmd} live screenshot homepage`,
    `${cmd} live stop`,
  ];
  const flowExamples = [
    config.demoFlows.size > 0
      ? `${cmd} demo ${config.demoFlows.keys().next().value}`
      : "",
    config.testFlows.size > 0
      ? `${cmd} test ${config.testFlows.keys().next().value}`
      : "",
    config.testFlows.size > 1 ? `${cmd} test --all` : "",
  ].filter(Boolean);

  return `
Usage:
  ${cmd} demo <flow-or-script> [options]
  ${cmd} demo --all [options]
  ${cmd} test <flow-or-test> [options]
  ${cmd} test --all [options]
  ${cmd} live start [url] [options]
  ${cmd} live status [options]
  ${cmd} live open <url> [options]
  ${cmd} live mouse move (--selector <selector> | --x <x> --y <y>) [options]
  ${cmd} live click (--selector <selector> | --x <x> --y <y>) [options]
  ${cmd} live type [--selector <selector>] <text> [options]
  ${cmd} live eval <expression> [options]
  ${cmd} live screenshot [label] [options]
  ${cmd} live record <start|stop> [options]
  ${cmd} live stop [options]

${formatFlowList("Demo flows", config.demoFlows)}${
    formatFlowList("Test flows", config.testFlows)
  }Live start options:
  --foreground         Run the live session in the current terminal
  --port <port>        Bind the live-control API to a specific port
  --log-file <path>    Write background logs to a custom file
  --no-log             Discard background logs
${managedAppText}  --show-browser       Run headed instead of headless

Demo/test options:
${managedAppText}  --browser-provider <provider>
                      Choose one of: host-bridge, local-system, playwright-managed
  --no-host-bridge     Use local Chromium instead of the host bridge
  --show-browser       Run headed instead of headless
  --no-video           Disable video recording
  --url <url>          Test mode only: target an explicit base URL
  --production         Test mode only: use production-mode app serving

Examples:
  ${[...genericExamples, ...flowExamples].join("\n  ")}
`.trim();
}

function resolveDemoTarget(
  raw: string | undefined,
  config: BrowserCliResolvedConfig,
): string | null {
  if (!raw) return null;
  return config.demoFlows.get(raw) ?? raw;
}

function resolveTestTarget(
  raw: string | undefined,
  config: BrowserCliResolvedConfig,
): string | null {
  if (!raw) return null;
  return config.testFlows.get(raw) ?? raw;
}

function buildModeEnv(mode: BrowserRuntimeMode): Record<string, string> {
  return Object.fromEntries(
    Object.entries(getBrowserRuntimeEnvPatch(getBrowserRuntimeProfile(mode)))
      .filter((entry): entry is [string, string] =>
        typeof entry[1] === "string"
      ),
  );
}

function buildModeExecutionEnv(
  mode: Extract<BrowserRuntimeMode, "demo" | "test" | "live">,
  parsed: BrowserModeTaskArgs,
  config: BrowserCliResolvedConfig,
): Record<string, string> {
  const appTarget = config.managedAppTarget?.resolve(parsed.app) ?? null;
  const browserProvider = parsed["browser-provider"]?.trim() ||
    (parsed["no-host-bridge"] ? "local-system" : undefined);
  const env: Record<string, string> = {
    ...buildModeEnv(mode),
    ...(appTarget ? { [BROWSER_APP_TARGET_ENV]: appTarget } : {}),
    ...(browserProvider ? { GAMBIT_BROWSER_PROVIDER: browserProvider } : {}),
    ...(parsed["no-host-bridge"] ? { GAMBIT_USE_HOST_BRIDGE: "false" } : {}),
    BF_E2E_SHOW_BROWSER: parsed["show-browser"] ? "true" : "false",
    GAMBIT_E2E_SHOW_BROWSER: parsed["show-browser"] ? "true" : "false",
  };

  if (mode === "test") {
    env.BF_E2E_DISABLE_PRETTY_URL = "true";
    env.BF_E2E_BOLTFOUNDRY_COM_URL = parsed.url?.trim().replace(/\/+$/, "") ||
      (appTarget && config.managedAppTarget
        ? config.managedAppTarget.getBaseUrl(appTarget)
        : getDefaultBrowserBaseUrl());
    if (parsed.production) {
      env.BF_ENV = "production";
    } else if (!Deno.env.get("BF_ENV")) {
      env.BF_ENV = "development";
    }
  }

  if (parsed["no-video"]) {
    env.BF_E2E_RECORD_VIDEO = "false";
    env.GAMBIT_E2E_RECORD_VIDEO = "false";
  }

  return {
    ...env,
    ...Object.fromEntries(
      Object.entries(getBrowserTempEnvPatch()).filter((
        entry,
      ): entry is [string, string] => typeof entry[1] === "string"),
    ),
  };
}

async function ensureManagedBrowserAppTarget(
  target: string,
  config: BrowserCliResolvedConfig,
): Promise<number> {
  config.output(
    `[${config.commandName}] starting managed app target '${target}'`,
  );
  return await config.managedAppTarget!.start(target);
}

function getAllDemoEntries(
  config: BrowserCliResolvedConfig,
): Array<[string, string]> {
  return Array.from(config.demoFlows.entries());
}

function getAllTestTargets(
  config: BrowserCliResolvedConfig,
): Array<string> {
  return Array.from(new Set(config.testFlows.values()));
}

async function runDemoTarget(
  target: string,
  env: Record<string, string>,
  config: BrowserCliResolvedConfig,
): Promise<number> {
  config.output(`[${config.commandName} demo] ${target}`);
  return await config.runCommand(
    ["deno", "run", "-A", target],
    Deno.cwd(),
    env,
  );
}

async function runAllDemos(
  env: Record<string, string>,
  config: BrowserCliResolvedConfig,
): Promise<number> {
  const entries = getAllDemoEntries(config);
  if (entries.length === 0) {
    config.error("No demo aliases are configured for --all.");
    return 1;
  }
  for (const [name, target] of entries) {
    config.output(`[${config.commandName} demo --all] ${name}`);
    const code = await runDemoTarget(target, env, config);
    if (code !== 0) return code;
  }
  return 0;
}

async function runBrowserTests(
  targets: Array<string>,
  env: Record<string, string>,
  config: BrowserCliResolvedConfig,
): Promise<number> {
  config.output(
    `[${config.commandName} test] ${
      targets.length === 1 ? targets[0] : `--all (${targets.length} targets)`
    }`,
  );
  return await config.runCommand(
    ["deno", "test", "-A", ...targets],
    Deno.cwd(),
    env,
  );
}

function browserLiveSentinelPathFor(sessionName: string): string {
  return `tmp/browser-live-${sessionName}.json`;
}

async function persistBrowserLiveSentinel(
  sentinel: BrowserLiveSentinel,
): Promise<void> {
  await Deno.mkdir("tmp", { recursive: true });
  await Deno.writeTextFile(
    browserLiveSentinelPathFor(sentinel.sessionName),
    JSON.stringify(sentinel, null, 2) + "\n",
  );
}

async function readBrowserLiveSentinel(
  sessionName: string,
): Promise<BrowserLiveSentinel | null> {
  try {
    const raw = await Deno.readTextFile(
      browserLiveSentinelPathFor(sessionName),
    );
    return JSON.parse(raw) as BrowserLiveSentinel;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

async function removeBrowserLiveSentinel(sessionName: string): Promise<void> {
  await Deno.remove(browserLiveSentinelPathFor(sessionName)).catch(() => {});
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findAvailablePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

function buildLiveDaemonArgs(
  opts: {
    sessionName: string;
    port: number;
    url?: string;
    noHostBridge: boolean;
    showBrowser: boolean;
  },
  config: BrowserCliResolvedConfig,
): Array<string> {
  const args = [
    "deno",
    "run",
    "-A",
    config.liveDaemonPath,
    "--session",
    opts.sessionName,
    "--port",
    String(opts.port),
  ];
  if (opts.url) {
    args.push("--url", opts.url);
  }
  if (opts.noHostBridge) {
    args.push("--no-host-bridge");
  }
  if (opts.showBrowser) {
    args.push("--show-browser");
  } else {
    args.push("--headless");
  }
  return args;
}

export function resolveLiveShowBrowser(opts: {
  noHostBridge?: boolean;
  showBrowser?: boolean;
  headless?: boolean;
}): boolean {
  if (opts.headless === true) {
    return false;
  }
  if (opts.showBrowser === true) {
    return true;
  }
  return opts.noHostBridge !== true;
}

async function waitForBrowserLiveSessionReady(
  sessionName: string,
  opts?: { timeoutMs?: number },
): Promise<Awaited<ReturnType<typeof getBrowserLiveSessionApiStatus>> | null> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const attempts = Math.ceil(timeoutMs / 500);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const metadata = await readBrowserLiveSessionMetadata(sessionName);
    if (metadata?.status === "error") {
      throw new Error(
        metadata.error ?? "Live browser session failed to start.",
      );
    }
    const status = await getBrowserLiveSessionApiStatus(sessionName).catch(() =>
      null
    );
    if (status?.status === "running") {
      return status;
    }
    await sleep(500);
  }
  return null;
}

async function startBrowserLiveForeground(
  opts: {
    sessionName: string;
    port: number;
    url?: string;
    noHostBridge: boolean;
    showBrowser: boolean;
  },
  config: BrowserCliResolvedConfig,
): Promise<number> {
  const env = {
    ...buildModeEnv("live"),
    ...Object.fromEntries(
      Object.entries(getBrowserTempEnvPatch()).filter((
        entry,
      ): entry is [string, string] => typeof entry[1] === "string"),
    ),
  };
  const args = buildLiveDaemonArgs(opts, config);
  return await config.runCommand(args, Deno.cwd(), env);
}

async function startBrowserLiveBackground(
  opts: {
    sessionName: string;
    port: number;
    url?: string;
    noHostBridge: boolean;
    showBrowser: boolean;
    logPath?: string;
    noLog?: boolean;
  },
  config: BrowserCliResolvedConfig,
): Promise<number> {
  const existing = await getBrowserLiveSessionStatus(opts.sessionName);
  if (
    existing && existing.status !== "stopped" && existing.status !== "error"
  ) {
    config.error(
      `Live browser session '${opts.sessionName}' is already running on port ${existing.port}.`,
    );
    return 1;
  }
  await removeBrowserLiveSentinel(opts.sessionName);

  const logPath = opts.noLog
    ? "/dev/null"
    : (opts.logPath && opts.logPath.length > 0
      ? opts.logPath
      : `tmp/browser-live-${opts.sessionName}.log`);
  if (!opts.noLog) {
    await Deno.mkdir("tmp", { recursive: true });
  }

  const commandArgs = config.selfCommand([
    "live",
    "start",
    "--foreground",
    "--name",
    opts.sessionName,
    "--port",
    String(opts.port),
    ...(opts.url ? [opts.url] : []),
    ...(opts.noHostBridge ? ["--no-host-bridge"] : []),
    ...(opts.showBrowser ? ["--show-browser"] : []),
  ]);
  const backgroundCommand = `nohup setsid ${
    commandArgs.map(shellQuote).join(" ")
  } > ${shellQuote(logPath)} 2>&1 &`;
  const result = new Deno.Command("sh", {
    args: ["-c", backgroundCommand],
    env: {
      ...buildModeEnv("live"),
      ...Object.fromEntries(
        Object.entries(getBrowserTempEnvPatch()).filter((
          entry,
        ): entry is [string, string] => typeof entry[1] === "string"),
      ),
    },
  }).outputSync();
  if (!result.success) {
    config.error("Failed to start live browser session in background.");
    return 1;
  }

  config.output(`Starting live browser session '${opts.sessionName}'...`);
  const status = await waitForBrowserLiveSessionReady(opts.sessionName);
  if (!status) {
    config.error(
      `Live browser session failed to become ready. Check ${logPath} for details.`,
    );
    return 1;
  }

  await persistBrowserLiveSentinel({
    sessionName: opts.sessionName,
    pid: status.pid,
    port: status.port,
    logPath: opts.noLog ? undefined : logPath,
    startedAt: status.startedAt,
  });
  config.output(formatSessionStatus(status));
  if (!opts.noLog) {
    config.output(`logs: ${logPath}`);
  }
  config.output(
    `Use '${config.commandName} live stop --name ${opts.sessionName}' to stop it.`,
  );
  return 0;
}

function formatSessionStatus(
  session: Awaited<ReturnType<typeof getBrowserLiveSessionStatus>>,
): string {
  if (!session) return "No live browser session is running.";
  return [
    `session: ${session.sessionName}`,
    `status: ${session.status}`,
    `port: ${session.port}`,
    `url: ${session.currentUrl ?? "about:blank"}`,
    `recording: ${session.recordingActive ? "active" : "off"}`,
    `artifacts: ${session.latestDir}`,
  ].join("\n");
}

async function handleBrowserLiveCommand(
  rawArgs: Array<string>,
  config: BrowserCliResolvedConfig,
): Promise<number> {
  const [action, ...rest] = rawArgs;
  const parsed = parseLiveArgs(rest);
  const sessionName = normalizeBrowserLiveSessionName(parsed.name);
  const appTarget = config.managedAppTarget?.resolve(parsed.app) ?? null;
  const requestedLiveProvider = parsed["browser-provider"]?.trim();
  const useHostBridge = requestedLiveProvider === "host-bridge"
    ? true
    : parsed["no-host-bridge"] === true
    ? false
    : false;

  if (!action || isHelpArg(action) || parsed.help) {
    config.output(formatUsage(config));
    return 0;
  }

  if (parsed.app && !config.managedAppTarget) {
    config.error("--app is not supported by this browser CLI.");
    return 1;
  }

  if (parsed.app && !appTarget) {
    config.error(`Unknown app target: ${parsed.app}`);
    return 1;
  }

  if (action === "start") {
    if (appTarget && parsed._[0]) {
      config.error("Use either a URL or --app for live start, not both.");
      return 1;
    }
    let url = parsed._[0] ? String(parsed._[0]) : undefined;
    if (appTarget) {
      const code = await ensureManagedBrowserAppTarget(appTarget, config);
      if (code !== 0) return code;
      url = config.managedAppTarget!.getBaseUrl(appTarget);
    }
    const existing = await getBrowserLiveSessionStatus(sessionName);
    if (existing?.status === "stopped" || existing?.status === "error") {
      await stopBrowserLiveSession(sessionName).catch(() => {});
      await removeBrowserLiveSentinel(sessionName);
    }
    const port = parsed.port ? Number(parsed.port) : findAvailablePort();
    if (!Number.isFinite(port) || port <= 0) {
      config.error(`Invalid port: ${parsed.port}`);
      return 1;
    }
    const showBrowser = resolveLiveShowBrowser({
      noHostBridge: !useHostBridge,
      showBrowser: parsed["show-browser"],
      headless: parsed.headless,
    });
    if (parsed.foreground) {
      return await startBrowserLiveForeground({
        sessionName,
        port,
        url,
        noHostBridge: !useHostBridge,
        showBrowser,
      }, config);
    }
    return await startBrowserLiveBackground({
      sessionName,
      port,
      url,
      noHostBridge: !useHostBridge,
      showBrowser,
      logPath: parsed["log-file"],
      noLog: parsed["no-log"] === true,
    }, config);
  }

  if (action === "status") {
    config.output(
      formatSessionStatus(await getBrowserLiveSessionStatus(sessionName)),
    );
    return 0;
  }

  if (action === "open") {
    const url = parsed._[0] ? String(parsed._[0]) : undefined;
    if (!url) {
      config.error("Missing URL for live open.");
      return 1;
    }
    const session = await sendBrowserLiveSessionCommand(sessionName, {
      type: "open",
      url,
    });
    config.output(formatSessionStatus(session));
    return 0;
  }

  if (action === "mouse" && parsed._[0] === "move") {
    const x = parsed.x !== undefined ? Number(parsed.x) : undefined;
    const y = parsed.y !== undefined ? Number(parsed.y) : undefined;
    const session = await sendBrowserLiveSessionCommand(sessionName, {
      type: "mouse-move",
      selector: parsed.selector,
      x,
      y,
    });
    config.output(formatSessionStatus(session));
    return 0;
  }

  if (action === "click") {
    const x = parsed.x !== undefined ? Number(parsed.x) : undefined;
    const y = parsed.y !== undefined ? Number(parsed.y) : undefined;
    const session = await sendBrowserLiveSessionCommand(sessionName, {
      type: "click",
      selector: parsed.selector,
      x,
      y,
    });
    config.output(formatSessionStatus(session));
    return 0;
  }

  if (action === "type") {
    const text = parsed._[0] ? String(parsed._[0]) : "";
    if (!text) {
      config.error("Missing text for live type.");
      return 1;
    }
    const session = await sendBrowserLiveSessionCommand(sessionName, {
      type: "type",
      selector: parsed.selector,
      text,
      clear: parsed.clear,
    });
    config.output(formatSessionStatus(session));
    return 0;
  }

  if (action === "eval") {
    const expression = parsed._.map(String).join(" ").trim();
    if (!expression) {
      config.error("Missing expression for live eval.");
      return 1;
    }
    const result = await sendBrowserLiveSessionCommandWithResult(sessionName, {
      type: "eval",
      expression,
    });
    config.output(formatSessionStatus(result.session));
    config.output("");
    config.output("result:");
    config.output(
      typeof result.result === "undefined"
        ? "undefined"
        : JSON.stringify(result.result, null, 2),
    );
    return 0;
  }

  if (action === "screenshot") {
    const label = parsed._[0] ? String(parsed._[0]) : undefined;
    const session = await sendBrowserLiveSessionCommand(sessionName, {
      type: "screenshot",
      label,
    });
    config.output(formatSessionStatus(session));
    return 0;
  }

  if (action === "record") {
    const op = parsed._[0] ? String(parsed._[0]) : "";
    if (op !== "start" && op !== "stop") {
      config.error(
        `Use '${config.commandName} live record start' or '... stop'.`,
      );
      return 1;
    }
    const session = await sendBrowserLiveSessionCommand(sessionName, {
      type: op === "start" ? "record-start" : "record-stop",
    });
    config.output(formatSessionStatus(session));
    return 0;
  }

  if (action === "stop") {
    const sentinel = await readBrowserLiveSentinel(sessionName);
    const metadata = await readBrowserLiveSessionMetadata(sessionName);
    await stopBrowserLiveSession(sessionName);
    if (!metadata && sentinel?.pid) {
      try {
        Deno.kill(sentinel.pid, "SIGTERM");
      } catch {
        // Ignore stale sentinel pids.
      }
    }
    await removeBrowserLiveSentinel(sessionName);
    config.output(`Stopped live browser session '${sessionName}'.`);
    return 0;
  }

  config.error(`Unknown live browser action: ${action}`);
  config.output(formatUsage(config));
  return 1;
}

async function runDemo(
  rawArgs: Array<string>,
  config: BrowserCliResolvedConfig,
): Promise<number> {
  const parsed = parseModeArgs(rawArgs);
  if (isHelpArg(rawArgs[0]) || parsed.help) {
    config.output(formatUsage(config));
    return 0;
  }
  const targetArg = parsed._[0] ? String(parsed._[0]) : undefined;
  if (parsed.all && targetArg) {
    config.error("Use either a specific demo target or --all, not both.");
    return 1;
  }
  if (parsed.app && !config.managedAppTarget) {
    config.error("--app is not supported by this browser CLI.");
    return 1;
  }
  if (parsed.app && !config.managedAppTarget?.resolve(parsed.app)) {
    config.error(`Unknown app target: ${parsed.app}`);
    return 1;
  }
  const env = buildModeExecutionEnv("demo", parsed, config);
  if (parsed.all) {
    return await runAllDemos(env, config);
  }
  const target = resolveDemoTarget(targetArg, config);
  if (!target) {
    config.error("Missing demo flow or script.");
    config.output(formatUsage(config));
    return 1;
  }
  return await runDemoTarget(target, env, config);
}

async function runTest(
  rawArgs: Array<string>,
  config: BrowserCliResolvedConfig,
): Promise<number> {
  const parsed = parseModeArgs(rawArgs);
  if (isHelpArg(rawArgs[0]) || parsed.help) {
    config.output(formatUsage(config));
    return 0;
  }
  const targetArg = parsed._[0] ? String(parsed._[0]) : undefined;
  if (parsed.all && targetArg) {
    config.error("Use either a specific test target or --all, not both.");
    return 1;
  }
  if (parsed.app && !config.managedAppTarget) {
    config.error("--app is not supported by this browser CLI.");
    return 1;
  }
  if (parsed.app && !config.managedAppTarget?.resolve(parsed.app)) {
    config.error(`Unknown app target: ${parsed.app}`);
    return 1;
  }
  if (parsed.app && parsed.url) {
    config.error("Use either --url or --app for test mode, not both.");
    return 1;
  }
  const env = buildModeExecutionEnv("test", parsed, config);
  if (parsed.all) {
    const targets = getAllTestTargets(config);
    if (targets.length === 0) {
      config.error("No test aliases are configured for --all.");
      return 1;
    }
    return await runBrowserTests(targets, env, config);
  }
  const target = resolveTestTarget(targetArg, config);
  if (!target) {
    config.error("Missing test flow or test path.");
    config.output(formatUsage(config));
    return 1;
  }
  return await runBrowserTests([target], env, config);
}

export async function runBrowserCli(
  rawArgs: Array<string>,
  config?: BrowserCliConfig,
): Promise<number> {
  const resolvedConfig = resolveConfig(config);
  const [modeArg, ...rest] = rawArgs;

  if (!modeArg || isHelpArg(modeArg)) {
    resolvedConfig.output(formatUsage(resolvedConfig));
    return 0;
  }

  if (modeArg === "demo") {
    return await runDemo(rest, resolvedConfig);
  }

  if (modeArg === "test") {
    return await runTest(rest, resolvedConfig);
  }

  if (modeArg === "live") {
    return await handleBrowserLiveCommand(rest, resolvedConfig);
  }

  resolvedConfig.error(`Unknown browser mode: ${modeArg}`);
  resolvedConfig.output(formatUsage(resolvedConfig));
  return 1;
}

export function getBrowserCliUsage(config?: BrowserCliConfig): string {
  return formatUsage(resolveConfig(config));
}

export { usesNestedNixShellTempDir };
