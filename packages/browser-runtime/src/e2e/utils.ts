import {
  type BrowserAppTargetName,
  resolveBrowserAppTargetOverride,
} from "@bolt-foundry/browser-runtime/src/appTargets.ts";
import {
  type BrowserRuntimeMode,
  runBrowserScenario,
} from "@bolt-foundry/browser-runtime/src/browserRuntime.ts";
import {
  getDemoBaseUrl,
  getDemoPort,
  getIframeShellPath,
  useHostBridge,
} from "@bolt-foundry/browser-runtime/src/config.ts";
import {
  getDemoPaths,
  prepareDemoPaths,
} from "@bolt-foundry/browser-runtime/src/runner.ts";
import type { DemoScenarioContext } from "@bolt-foundry/browser-runtime/src/runnerTypes.ts";
import type { BrowserGraphqlMockOptions } from "@bolt-foundry/browser-runtime/src/graphqlMocks.ts";
import {
  startProxyServerOnly,
  startServer,
  stopManagedDevTarget,
  stopProxyServerOnly,
  stopServer,
} from "@bolt-foundry/browser-runtime/src/server.ts";
import { bfmonoRoot } from "@bolt-foundry/browser-runtime/src/paths.ts";
import { toSlug } from "@bolt-foundry/browser-runtime/src/utils.ts";

export type E2eServerOptions = {
  appTarget?: BrowserAppTargetName;
  cwd?: string;
  command?: (targetPort: number) => Array<string>;
  port?: number;
  targetPort?: number;
  readyPattern?: RegExp;
};

function findAvailablePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

function normalizePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1) {
    return withSlash.replace(/\/+$/, "");
  }
  return withSlash;
}

function isPortAvailable(port: number): boolean {
  try {
    const listener = Deno.listen({ hostname: "0.0.0.0", port });
    listener.close();
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.AddrInUse) return false;
    throw error;
  }
}

async function ensureHarnessPortAvailable(
  port: number,
  target?: BrowserAppTargetName,
): Promise<void> {
  if (isPortAvailable(port)) return;
  if (port === 8000) {
    await stopManagedDevTarget(target);
  }
  if (isPortAvailable(port)) return;
  throw new Error(
    `[gambit-e2e] port ${port} is already in use; stop the service before running e2e.`,
  );
}

export async function runE2e(
  testName: string,
  scenario: (ctx: DemoScenarioContext) => Promise<void>,
  opts?: {
    mode?: BrowserRuntimeMode;
    slug?: string;
    baseUrl?: string;
    server?: E2eServerOptions;
    iframePath?: string;
    iframeTargetPath?: string;
    iframeQuery?: string;
    skipAutomation?: boolean;
    graphqlMocks?: BrowserGraphqlMockOptions;
    prepare?: (paths: ReturnType<typeof getDemoPaths>) => Promise<void> | void;
  },
): Promise<void> {
  const slug = opts?.slug ?? toSlug(testName);
  const paths = getDemoPaths(slug);
  await prepareDemoPaths(paths);
  if (opts?.prepare) {
    await opts.prepare(paths);
  }

  const hostBridge = useHostBridge();
  let embeddedServer: Awaited<ReturnType<typeof startServer>> | null = null;
  let proxyServer: ReturnType<typeof startProxyServerOnly> | null = null;
  const previousDemoPath = Deno.env.get("GAMBIT_DEMO_PATH");
  const previousIframePath = Deno.env.get("GAMBIT_DEMO_IFRAME_PATH");
  const previousSkipAutomation = Deno.env.get("GAMBIT_DEMO_SKIP_AUTOMATION");
  const previousDemoQuery = Deno.env.get("GAMBIT_DEMO_QUERY");

  try {
    const baseUrl = await (async () => {
      const harnessPort = opts?.server?.port ?? 8000;
      const requestedAppTarget = opts?.server?.appTarget ??
        resolveBrowserAppTargetOverride();
      await ensureHarnessPortAvailable(
        harnessPort,
        requestedAppTarget ?? undefined,
      );
      const wantsEmbedded = Boolean(
        requestedAppTarget ||
          opts?.server?.command ||
          opts?.server?.cwd ||
          opts?.server?.readyPattern ||
          opts?.server?.targetPort,
      );

      if (opts?.baseUrl && !wantsEmbedded) {
        const proxy = startProxyServerOnly({
          port: harnessPort,
          targetBaseUrl: opts.baseUrl,
        });
        proxyServer = proxy;
        return proxy.baseUrl;
      }

      if (!wantsEmbedded && hostBridge) {
        const base = getDemoBaseUrl(true);
        if (!base) {
          throw new Error("Missing demo base URL for host bridge mode");
        }
        const proxy = startProxyServerOnly({
          port: harnessPort,
          targetBaseUrl: base,
        });
        proxyServer = proxy;
        return proxy.baseUrl;
      }

      const cwd = opts?.server?.cwd ?? bfmonoRoot;
      const envTargetPort = getDemoPort(false);
      const targetPort = opts?.server?.targetPort ??
        (envTargetPort ?? findAvailablePort());
      const command = !requestedAppTarget && opts?.server?.command
        ? opts.server.command(targetPort)
        : undefined;
      const server = await startServer({
        appTarget: requestedAppTarget ?? undefined,
        logsDir: paths.logsDir,
        cwd,
        port: harnessPort,
        targetPort,
        command,
        readyPattern: opts?.server?.readyPattern,
      });
      embeddedServer = server;
      return server.baseUrl;
    })();

    const iframePath = normalizePath(
      opts?.iframePath ??
        Deno.env.get("GAMBIT_E2E_IFRAME_PATH") ??
        getIframeShellPath(),
    );
    const iframeTargetPath = normalizePath(
      opts?.iframeTargetPath ??
        Deno.env.get("GAMBIT_E2E_TARGET_PATH") ??
        "/workspaces/new/test",
    );
    const iframeQuery = opts?.iframeQuery ??
      Deno.env.get("GAMBIT_E2E_IFRAME_QUERY") ??
      `base={{BASE_URL_RAW}}&path=${iframeTargetPath}`;

    Deno.env.set("GAMBIT_DEMO_IFRAME_PATH", iframePath);
    Deno.env.set("GAMBIT_DEMO_PATH", iframePath);
    Deno.env.set("GAMBIT_DEMO_QUERY", iframeQuery);
    if (opts?.skipAutomation) {
      Deno.env.set("GAMBIT_DEMO_SKIP_AUTOMATION", "true");
    } else {
      Deno.env.delete("GAMBIT_DEMO_SKIP_AUTOMATION");
    }

    await runBrowserScenario(opts?.mode ?? "demo", scenario, {
      baseUrl,
      paths,
      slug,
      graphqlMocks: opts?.graphqlMocks,
    });
  } finally {
    if (previousDemoPath === undefined) {
      Deno.env.delete("GAMBIT_DEMO_PATH");
    } else {
      Deno.env.set("GAMBIT_DEMO_PATH", previousDemoPath);
    }
    if (previousIframePath === undefined) {
      Deno.env.delete("GAMBIT_DEMO_IFRAME_PATH");
    } else {
      Deno.env.set("GAMBIT_DEMO_IFRAME_PATH", previousIframePath);
    }
    if (previousSkipAutomation === undefined) {
      Deno.env.delete("GAMBIT_DEMO_SKIP_AUTOMATION");
    } else {
      Deno.env.set("GAMBIT_DEMO_SKIP_AUTOMATION", previousSkipAutomation);
    }
    if (previousDemoQuery === undefined) {
      Deno.env.delete("GAMBIT_DEMO_QUERY");
    } else {
      Deno.env.set("GAMBIT_DEMO_QUERY", previousDemoQuery);
    }
    if (embeddedServer) {
      await stopServer(embeddedServer).catch(() => {});
    }
    if (proxyServer) {
      await stopProxyServerOnly(proxyServer).catch(() => {});
    }
  }
}

export async function currentPath(
  target: { evaluate<T>(fn: () => T): Promise<T> },
): Promise<string> {
  return await target.evaluate(() => globalThis.location.pathname);
}

export async function waitForPath(
  demoTarget: { evaluate<T>(fn: () => T): Promise<T> },
  wait: (ms: number) => Promise<void>,
  predicate: (pathname: string) => boolean,
  timeoutMs = 10_000,
  debug?: { label?: string; logEveryMs?: number },
): Promise<string> {
  const encoder = new TextEncoder();
  const start = Date.now();
  let lastLog = start;
  let lastPathname = "";
  while (Date.now() - start < timeoutMs) {
    const pathname = await currentPath(demoTarget);
    lastPathname = pathname;
    if (predicate(pathname)) return pathname;
    if (debug?.logEveryMs && Date.now() - lastLog >= debug.logEveryMs) {
      const label = debug.label ? ` ${debug.label}` : "";
      Deno.stdout.writeSync(
        encoder.encode(`[e2e] waiting${label}: ${pathname}\n`),
      );
      lastLog = Date.now();
    }
    await wait(250);
  }
  const label = debug?.label ? ` (${debug.label})` : "";
  throw new Error(
    `Timed out waiting for expected URL${label}: ${lastPathname}`,
  );
}
