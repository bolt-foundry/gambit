export type BrowserAppTargetName =
  | "boltfoundry-com"
  | "bfdesktop"
  | "gambit-serve";

export type ManagedDevMode = "dev" | "ssr";

function sanitizeWorkspaceSlug(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const sanitized = raw.trim()
    .replace(/\.boltfoundry\.bflocal$/i, "")
    .replace(/^\.+|\.+$/g, "");
  return sanitized.length > 0 ? sanitized : undefined;
}

function sanitizeWorkspaceHostname(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().endsWith(".boltfoundry.bflocal")) {
    return undefined;
  }
  return sanitizeWorkspaceSlug(trimmed);
}

function getWorkspaceSlug(): string | undefined {
  const fromWorkspaceEnv = sanitizeWorkspaceSlug(Deno.env.get("WORKSPACE"));
  if (fromWorkspaceEnv) return fromWorkspaceEnv;

  const fromWorkspaceIdEnv = sanitizeWorkspaceSlug(
    Deno.env.get("WORKSPACE_ID"),
  );
  if (fromWorkspaceIdEnv) return fromWorkspaceIdEnv;

  const fromHostnameEnv = sanitizeWorkspaceHostname(Deno.env.get("HOSTNAME"));
  if (fromHostnameEnv) return fromHostnameEnv;

  try {
    const fromSystem = sanitizeWorkspaceHostname(Deno.hostname());
    if (fromSystem) return fromSystem;
  } catch {
    // Ignore hostname lookup failures and fall back below.
  }
  return undefined;
}

export function getDefaultBrowserBaseUrl(): string {
  const workspaceSlug = getWorkspaceSlug();
  if (!workspaceSlug) return "http://127.0.0.1:8000";
  return `https://${workspaceSlug}.boltfoundry.bflocal`;
}

const APP_TARGETS = {
  "boltfoundry-com": {},
  "bfdesktop": {},
  "gambit-serve": {},
} as const satisfies Record<
  BrowserAppTargetName,
  Record<string, never>
>;

export const BROWSER_APP_TARGET_ENV = "BF_BROWSER_APP_TARGET";

export function isBrowserAppTargetName(
  value: string,
): value is BrowserAppTargetName {
  return value in APP_TARGETS;
}

export function parseBrowserAppTargetName(
  value?: string | null,
): BrowserAppTargetName | null {
  if (!value) return null;
  return isBrowserAppTargetName(value) ? value : null;
}

export function resolveBrowserAppTargetOverride(): BrowserAppTargetName | null {
  return parseBrowserAppTargetName(Deno.env.get(BROWSER_APP_TARGET_ENV));
}

export function getBrowserAppTargetBaseUrl(
  target: BrowserAppTargetName,
  port?: number,
): string {
  if (typeof port === "number") {
    return `http://127.0.0.1:${port}`;
  }
  if (!(target in APP_TARGETS)) {
    throw new Error(`Unknown browser app target: ${target}`);
  }
  return getDefaultBrowserBaseUrl();
}

export function getManagedDevModeForServerMode(
  mode: "development" | "production",
): ManagedDevMode {
  return mode === "production" ? "ssr" : "dev";
}

export function buildManagedDevCommand(opts: {
  target: BrowserAppTargetName;
  mode: ManagedDevMode;
  port: number;
  extraArgs?: Array<string>;
}): Array<string> {
  return [
    "bft",
    "dev",
    opts.target,
    "--mode",
    opts.mode,
    "--foreground",
    "--no-open",
    "--no-log",
    "--port",
    String(opts.port),
    ...(opts.extraArgs ?? []),
  ];
}
