import * as path from "@std/path";
import { parse } from "@std/jsonc";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import {
  getSimulatorIsographEnvironment,
  type SimulatorGraphqlOperations,
} from "./server_isograph_environment.ts";
import {
  createServerRedirectResponse,
  getRedirectFromEntrypoint,
} from "./simulator_redirect_handler.ts";
import { AppRoot } from "../simulator-ui/src/AppRoot.tsx";
import {
  isographAppRoutes as simulatorIsographAppRoutes,
  matchRouteWithParams as matchSimulatorRouteWithParams,
} from "../simulator-ui/src/routing.ts";
import { globalStyles } from "../simulator-ui/src/styles.ts";

type ReadWorkspaceFiles = Parameters<typeof getSimulatorIsographEnvironment>[0];

type SimulatorLogger = {
  log: (...args: Array<unknown>) => void;
  warn: (...args: Array<unknown>) => void;
};

const moduleLocation = (() => {
  const directoryFromUrl = (url?: string): string | undefined => {
    if (!url || !url.startsWith("file:")) return undefined;
    return path.dirname(path.fromFileUrl(url));
  };
  try {
    const resolved = import.meta.resolve("./server_simulator_ui.ts");
    const fromResolved = directoryFromUrl(resolved);
    if (fromResolved) return { dir: fromResolved, isLocal: true };
  } catch {
    // ignore resolution failures and try other strategies
  }
  const fromMeta = directoryFromUrl(import.meta.url);
  if (fromMeta) return { dir: fromMeta, isLocal: true };
  return { dir: Deno.cwd(), isLocal: false };
})();
const moduleDir = moduleLocation.dir;
const simulatorBundleUrl = (() => {
  try {
    return import.meta.resolve("../simulator-ui/dist/bundle.js");
  } catch {
    return undefined;
  }
})();
const simulatorBundleSourceMapUrl = (() => {
  try {
    return import.meta.resolve("../simulator-ui/dist/bundle.js.map");
  } catch {
    return undefined;
  }
})();
let cachedRemoteBundle: Uint8Array | null = null;
let cachedRemoteBundleSourceMap: Uint8Array | null = null;
const simulatorBundlePath = path.resolve(
  moduleDir,
  "..",
  "simulator-ui",
  "dist",
  "bundle.js",
);
const simulatorBundleSourceMapPath = path.resolve(
  moduleDir,
  "..",
  "simulator-ui",
  "dist",
  "bundle.js.map",
);
const simulatorFaviconDistPath = path.resolve(
  moduleDir,
  "..",
  "simulator-ui",
  "dist",
  "favicon.ico",
);
const simulatorFaviconSrcPath = path.resolve(
  moduleDir,
  "..",
  "simulator-ui",
  "src",
  "favicon.ico",
);
const gambitVersion = (() => {
  const envVersion = Deno.env.get("GAMBIT_VERSION")?.trim();
  if (envVersion) return envVersion;
  const readVersion = (configPath: string): string | null => {
    try {
      const text = Deno.readTextFileSync(configPath);
      const data = parse(text) as { version?: string };
      const version = typeof data.version === "string"
        ? data.version.trim()
        : "";
      return version || null;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  };
  const candidates = [
    path.resolve(moduleDir, "..", "deno.jsonc"),
    path.resolve(moduleDir, "..", "deno.json"),
  ];
  for (const candidate of candidates) {
    const version = readVersion(candidate);
    if (version) return version;
  }
  return "unknown";
})();

const readEnvBoolean = (name: string, defaultValue: boolean): boolean => {
  const raw = Deno.env.get(name);
  if (raw === undefined) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "1" || normalized === "true" || normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }
  if (
    normalized === "0" || normalized === "false" || normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return defaultValue;
};

function hasReactBundle(): boolean {
  try {
    const stat = Deno.statSync(simulatorBundlePath);
    return stat.isFile;
  } catch {
    return false;
  }
}

function hasReactBundleSourceMap(): boolean {
  try {
    const stat = Deno.statSync(simulatorBundleSourceMapPath);
    return stat.isFile;
  } catch {
    return false;
  }
}

function newestMtimeInDir(dirPath: string): number | undefined {
  const stack: Array<string> = [dirPath];
  let newest: number | undefined = undefined;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: Array<Deno.DirEntry>;
    try {
      entries = Array.from(Deno.readDirSync(current));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile) continue;
      try {
        const stat = Deno.statSync(entryPath);
        if (!stat.isFile) continue;
        const mtime = stat.mtime?.getTime();
        if (typeof mtime !== "number") continue;
        newest = newest === undefined ? mtime : Math.max(newest, mtime);
      } catch {
        continue;
      }
    }
  }
  return newest;
}

function isReactBundleStale(): boolean {
  try {
    const bundleStat = Deno.statSync(simulatorBundlePath);
    if (!bundleStat.isFile) return false;
    const bundleTime = bundleStat.mtime?.getTime();
    if (typeof bundleTime !== "number") {
      return false;
    }
    const srcRoot = path.resolve(moduleDir, "..", "simulator-ui", "src");
    const newestSource = newestMtimeInDir(srcRoot);
    if (typeof newestSource !== "number") return false;
    return newestSource > bundleTime;
  } catch {
    return false;
  }
}

export function shouldAdvertiseSourceMap(): boolean {
  if (hasReactBundleSourceMap()) return true;
  if (!simulatorBundleSourceMapUrl) return false;
  return !simulatorBundleSourceMapUrl.startsWith("file:");
}

export async function readReactBundle(): Promise<Uint8Array | null> {
  try {
    return await Deno.readFile(simulatorBundlePath);
  } catch {
    return await readRemoteBundle(simulatorBundleUrl, "bundle");
  }
}

export async function readReactBundleSourceMap(): Promise<Uint8Array | null> {
  try {
    return await Deno.readFile(simulatorBundleSourceMapPath);
  } catch {
    return await readRemoteBundle(simulatorBundleSourceMapUrl, "map");
  }
}

export async function canServeReactBundle(): Promise<boolean> {
  if (hasReactBundle()) return true;
  return (await readRemoteBundle(simulatorBundleUrl, "bundle")) !== null;
}

async function readRemoteBundle(
  url: string | undefined,
  kind: "bundle" | "map",
): Promise<Uint8Array | null> {
  if (!url || url.startsWith("file:")) return null;
  const cached = kind === "bundle"
    ? cachedRemoteBundle
    : cachedRemoteBundleSourceMap;
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    if (kind === "bundle") {
      cachedRemoteBundle = data;
    } else {
      cachedRemoteBundleSourceMap = data;
    }
    return data;
  } catch {
    return null;
  }
}

export function ensureSimulatorBundle(args: {
  autoBundle: boolean;
  bundlePlatform: "deno" | "browser";
  forceBundle: boolean;
  logger: SimulatorLogger;
  verbose?: boolean;
  wantsSourceMap: boolean;
}): void {
  const needsBundle = !hasReactBundle() ||
    (args.wantsSourceMap && !hasReactBundleSourceMap()) ||
    isReactBundleStale();
  const shouldAutoBundle = args.autoBundle && moduleLocation.isLocal &&
    (args.forceBundle || needsBundle);
  if (args.autoBundle && !moduleLocation.isLocal && args.verbose) {
    args.logger.log(
      "[sim] auto-bundle disabled for remote package; using packaged bundle.",
    );
  }
  if (args.autoBundle && moduleLocation.isLocal && !shouldAutoBundle) {
    args.logger.log("[sim] auto-bundle enabled; bundle already up to date.");
  }
  if (!shouldAutoBundle) return;

  args.logger.log(
    `[sim] auto-bundle enabled; rebuilding simulator UI (${
      args.forceBundle ? "forced" : "stale"
    })...`,
  );
  args.logger.log(
    `[sim] bundling simulator UI (${args.forceBundle ? "forced" : "stale"})...`,
  );
  try {
    const decode = new TextDecoder();
    const process = new Deno.Command("deno", {
      args: [
        "bundle",
        "--platform",
        args.bundlePlatform,
        ...(args.wantsSourceMap ? ["--sourcemap=external"] : []),
        "--output",
        "simulator-ui/dist/bundle.js",
        "simulator-ui/src/main.tsx",
      ],
      cwd: path.resolve(moduleDir, ".."),
      stdout: "piped",
      stderr: "piped",
    });
    const out = process.outputSync();
    if (!out.success) {
      const stderr = decode.decode(out.stderr).trim();
      const stdout = decode.decode(out.stdout).trim();
      const details = stderr || stdout || `exit ${out.code}`;
      throw new Error(
        `simulator UI bundle command failed (exit ${out.code}): ${details}`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (args.forceBundle) {
      throw new Error(`[sim] auto-bundle failed: ${message}`);
    }
    args.logger.warn(`[sim] auto-bundle failed: ${message}`);
  }
}

export async function handleSimulatorFaviconRequest(
  req: Request,
): Promise<Response | null> {
  const url = new URL(req.url);
  if (url.pathname !== "/favicon.ico") return null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  try {
    const data = await Deno.readFile(simulatorFaviconDistPath);
    return new Response(req.method === "HEAD" ? null : data, {
      headers: { "content-type": "image/x-icon" },
    });
  } catch {
    try {
      const data = await Deno.readFile(simulatorFaviconSrcPath);
      return new Response(req.method === "HEAD" ? null : data, {
        headers: { "content-type": "image/x-icon" },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }
}

export function handleSimulatorPathRedirect(pathname: string): Response | null {
  if (pathname === "/isograph" || pathname.startsWith("/isograph/")) {
    const strippedPath = pathname.slice("/isograph".length);
    const canonicalPath = strippedPath.length > 0 ? strippedPath : "/";
    const canonicalEntrypoint = Array.from(simulatorIsographAppRoutes).find(
      ([pattern]) =>
        matchSimulatorRouteWithParams(canonicalPath, pattern).match,
    )?.[1];
    if (!canonicalEntrypoint) return null;

    const globals = globalThis as typeof globalThis & {
      __GAMBIT_CURRENT_PATH__?: unknown;
    };
    const previousPath = globals.__GAMBIT_CURRENT_PATH__;
    globals.__GAMBIT_CURRENT_PATH__ = canonicalPath;
    try {
      const redirect = getRedirectFromEntrypoint(canonicalEntrypoint);
      return createServerRedirectResponse(redirect?.location ?? canonicalPath);
    } finally {
      if (previousPath === undefined) {
        delete globals.__GAMBIT_CURRENT_PATH__;
      } else {
        globals.__GAMBIT_CURRENT_PATH__ = previousPath;
      }
    }
  }

  const matchedEntrypoint = Array.from(simulatorIsographAppRoutes).find(
    ([pattern]) => matchSimulatorRouteWithParams(pathname, pattern).match,
  )?.[1];
  if (!matchedEntrypoint) return null;

  const globals = globalThis as typeof globalThis & {
    __GAMBIT_CURRENT_PATH__?: unknown;
  };
  const previousPath = globals.__GAMBIT_CURRENT_PATH__;
  globals.__GAMBIT_CURRENT_PATH__ = pathname;
  try {
    const redirect = getRedirectFromEntrypoint(matchedEntrypoint);
    return redirect ? createServerRedirectResponse(redirect.location) : null;
  } finally {
    if (previousPath === undefined) {
      delete globals.__GAMBIT_CURRENT_PATH__;
    } else {
      globals.__GAMBIT_CURRENT_PATH__ = previousPath;
    }
  }
}

export async function simulatorReactHtml(
  deckPath: string,
  deckLabel?: string,
  opts?: {
    workspaceId?: string | null;
    onboarding?: boolean;
    currentPath?: string;
  },
  readWorkspaceFiles?: ReadWorkspaceFiles,
  operations?: SimulatorGraphqlOperations,
): Promise<string> {
  const safeDeckPath = deckPath.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const safeDeckLabel =
    deckLabel?.replaceAll("<", "&lt;").replaceAll(">", "&gt;") ?? null;
  const buildTabEnabled = readEnvBoolean("GAMBIT_SIMULATOR_BUILD_TAB", true);
  const verifyTabEnabled = readEnvBoolean(
    "GAMBIT_SIMULATOR_VERIFY_TAB",
    true,
  );
  const chatAccordionEnabled = readEnvBoolean(
    "GAMBIT_SIMULATOR_CHAT_ACCORDION",
    false,
  );
  const buildStreamDebugEnabled = readEnvBoolean(
    "GAMBIT_SIMULATOR_BUILD_STREAM_DEBUG",
    false,
  );
  const workbenchChatTopActionsEnabled = readEnvBoolean(
    "GAMBIT_SIMULATOR_WORKBENCH_CHAT_TOP_ACTIONS",
    false,
  );
  const gambitDev = (() => {
    const raw = (Deno.env.get("GAMBIT_ENV") ?? Deno.env.get("NODE_ENV") ?? "")
      .trim()
      .toLowerCase();
    return raw === "development" || raw === "dev" || raw === "local";
  })();
  const bundleStamp = (() => {
    try {
      const stat = Deno.statSync(simulatorBundlePath);
      const mtime = stat.mtime?.getTime();
      return typeof mtime === "number" ? String(mtime) : "";
    } catch {
      return "";
    }
  })();
  const bundleUrl = bundleStamp
    ? `/ui/bundle.js?v=${bundleStamp}`
    : "/ui/bundle.js";
  const workspaceId = opts?.workspaceId ?? null;
  const workspaceOnboarding = Boolean(opts?.onboarding);
  const buildChatProvider = (() => {
    const raw = (Deno.env.get("GAMBIT_SIMULATOR_BUILD_CHAT_PROVIDER") ?? "")
      .trim()
      .toLowerCase();
    return raw === "claude-code-cli" ? "claude-code-cli" : "codex-cli";
  })();
  const currentPath = opts?.currentPath ?? "/";
  const serializeForScript = (value: unknown): string =>
    JSON.stringify(value)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");

  let rootMarkup = "";
  let isoPreloads: Record<string, unknown> = {};
  if (readWorkspaceFiles) {
    try {
      const globals = globalThis as typeof globalThis & {
        __GAMBIT_CURRENT_PATH__?: unknown;
        __GAMBIT_DECK_PATH__?: unknown;
        __GAMBIT_DECK_LABEL__?: unknown;
        __GAMBIT_VERSION__?: unknown;
        __GAMBIT_BUILD_TAB_ENABLED__?: unknown;
        __GAMBIT_VERIFY_TAB_ENABLED__?: unknown;
        __GAMBIT_CHAT_ACCORDION_ENABLED__?: unknown;
        __GAMBIT_WORKBENCH_CHAT_TOP_ACTIONS__?: unknown;
        __GAMBIT_WORKSPACE_ID__?: unknown;
        __GAMBIT_WORKSPACE_ONBOARDING__?: unknown;
        __GAMBIT_BUILD_STREAM_DEBUG__?: unknown;
        __GAMBIT_DEV__?: unknown;
      };
      const previousPath = globals.__GAMBIT_CURRENT_PATH__;
      const previousDeckPath = globals.__GAMBIT_DECK_PATH__;
      const previousDeckLabel = globals.__GAMBIT_DECK_LABEL__;
      const previousVersion = globals.__GAMBIT_VERSION__;
      const previousBuildTabEnabled = globals.__GAMBIT_BUILD_TAB_ENABLED__;
      const previousVerifyTabEnabled = globals.__GAMBIT_VERIFY_TAB_ENABLED__;
      const previousChatAccordionEnabled =
        globals.__GAMBIT_CHAT_ACCORDION_ENABLED__;
      const previousWorkbenchChatTopActions =
        globals.__GAMBIT_WORKBENCH_CHAT_TOP_ACTIONS__;
      const previousWorkspaceId = globals.__GAMBIT_WORKSPACE_ID__;
      const previousWorkspaceOnboarding =
        globals.__GAMBIT_WORKSPACE_ONBOARDING__;
      const previousBuildStreamDebug = globals.__GAMBIT_BUILD_STREAM_DEBUG__;
      const previousDev = globals.__GAMBIT_DEV__;
      globals.__GAMBIT_CURRENT_PATH__ = currentPath;
      globals.__GAMBIT_DECK_PATH__ = safeDeckPath;
      globals.__GAMBIT_DECK_LABEL__ = safeDeckLabel;
      globals.__GAMBIT_VERSION__ = gambitVersion;
      globals.__GAMBIT_BUILD_TAB_ENABLED__ = buildTabEnabled;
      globals.__GAMBIT_VERIFY_TAB_ENABLED__ = verifyTabEnabled;
      globals.__GAMBIT_CHAT_ACCORDION_ENABLED__ = chatAccordionEnabled;
      globals.__GAMBIT_WORKBENCH_CHAT_TOP_ACTIONS__ =
        workbenchChatTopActionsEnabled;
      globals.__GAMBIT_WORKSPACE_ID__ = workspaceId;
      globals.__GAMBIT_WORKSPACE_ONBOARDING__ = workspaceOnboarding;
      globals.__GAMBIT_BUILD_STREAM_DEBUG__ = buildStreamDebugEnabled;
      globals.__GAMBIT_DEV__ = gambitDev;
      try {
        const { environment, preloads } = getSimulatorIsographEnvironment(
          readWorkspaceFiles,
          operations,
        );
        const stream = await renderToReadableStream(
          createElement(AppRoot, { environment, initialPath: currentPath }),
        );
        if ("allReady" in stream && stream.allReady) {
          await stream.allReady;
        }
        rootMarkup = await new Response(stream).text();
        isoPreloads = preloads;
      } finally {
        if (previousPath === undefined) {
          delete globals.__GAMBIT_CURRENT_PATH__;
        } else {
          globals.__GAMBIT_CURRENT_PATH__ = previousPath;
        }
        if (previousDeckPath === undefined) {
          delete globals.__GAMBIT_DECK_PATH__;
        } else {
          globals.__GAMBIT_DECK_PATH__ = previousDeckPath;
        }
        if (previousDeckLabel === undefined) {
          delete globals.__GAMBIT_DECK_LABEL__;
        } else {
          globals.__GAMBIT_DECK_LABEL__ = previousDeckLabel;
        }
        if (previousVersion === undefined) {
          delete globals.__GAMBIT_VERSION__;
        } else {
          globals.__GAMBIT_VERSION__ = previousVersion;
        }
        if (previousBuildTabEnabled === undefined) {
          delete globals.__GAMBIT_BUILD_TAB_ENABLED__;
        } else {
          globals.__GAMBIT_BUILD_TAB_ENABLED__ = previousBuildTabEnabled;
        }
        if (previousVerifyTabEnabled === undefined) {
          delete globals.__GAMBIT_VERIFY_TAB_ENABLED__;
        } else {
          globals.__GAMBIT_VERIFY_TAB_ENABLED__ = previousVerifyTabEnabled;
        }
        if (previousChatAccordionEnabled === undefined) {
          delete globals.__GAMBIT_CHAT_ACCORDION_ENABLED__;
        } else {
          globals.__GAMBIT_CHAT_ACCORDION_ENABLED__ =
            previousChatAccordionEnabled;
        }
        if (previousWorkbenchChatTopActions === undefined) {
          delete globals.__GAMBIT_WORKBENCH_CHAT_TOP_ACTIONS__;
        } else {
          globals.__GAMBIT_WORKBENCH_CHAT_TOP_ACTIONS__ =
            previousWorkbenchChatTopActions;
        }
        if (previousWorkspaceId === undefined) {
          delete globals.__GAMBIT_WORKSPACE_ID__;
        } else {
          globals.__GAMBIT_WORKSPACE_ID__ = previousWorkspaceId;
        }
        if (previousWorkspaceOnboarding === undefined) {
          delete globals.__GAMBIT_WORKSPACE_ONBOARDING__;
        } else {
          globals.__GAMBIT_WORKSPACE_ONBOARDING__ = previousWorkspaceOnboarding;
        }
        if (previousBuildStreamDebug === undefined) {
          delete globals.__GAMBIT_BUILD_STREAM_DEBUG__;
        } else {
          globals.__GAMBIT_BUILD_STREAM_DEBUG__ = previousBuildStreamDebug;
        }
        if (previousDev === undefined) {
          delete globals.__GAMBIT_DEV__;
        } else {
          globals.__GAMBIT_DEV__ = previousDev;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rootMarkup =
        `<div style="padding:16px;font-family:ui-sans-serif,system-ui,sans-serif;color:#b91c1c">SSR error: ${
          message.replaceAll("<", "&lt;").replaceAll(">", "&gt;")
        }</div>`;
    }
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Gambit Debug</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
${globalStyles}
  </style>
</head>
<body>
  <div id="root">${rootMarkup}</div>
  <script>
    window.__GAMBIT_DECK_PATH__ = ${JSON.stringify(safeDeckPath)};
    window.__GAMBIT_DECK_LABEL__ = ${JSON.stringify(safeDeckLabel)};
    window.__GAMBIT_VERSION__ = ${JSON.stringify(gambitVersion)};
    window.__GAMBIT_BUILD_TAB_ENABLED__ = ${JSON.stringify(buildTabEnabled)};
    window.__GAMBIT_VERIFY_TAB_ENABLED__ = ${JSON.stringify(verifyTabEnabled)};
    window.__GAMBIT_CHAT_ACCORDION_ENABLED__ = ${
    JSON.stringify(
      chatAccordionEnabled,
    )
  };
    window.__GAMBIT_WORKBENCH_CHAT_TOP_ACTIONS__ = ${
    JSON.stringify(
      workbenchChatTopActionsEnabled,
    )
  };
    window.__GAMBIT_WORKSPACE_ID__ = ${JSON.stringify(workspaceId)};
    window.__GAMBIT_WORKSPACE_ONBOARDING__ = ${
    JSON.stringify(
      workspaceOnboarding,
    )
  };
    window.__GAMBIT_BUILD_STREAM_DEBUG__ = ${
    JSON.stringify(
      buildStreamDebugEnabled,
    )
  };
    window.__GAMBIT_BUILD_CHAT_PROVIDER__ = ${
    JSON.stringify(
      buildChatProvider,
    )
  };
    window.__GAMBIT_DEV__ = ${JSON.stringify(gambitDev)};
    window.__GAMBIT_CURRENT_PATH__ = ${JSON.stringify(currentPath)};
    window.__ISO_PRELOADED__ = ${serializeForScript(isoPreloads)};
  </script>
  <script type="module" src="${bundleUrl}"></script>
</body>
</html>`;
}
