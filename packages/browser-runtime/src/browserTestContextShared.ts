// deno-lint-ignore-file no-console
import { ensureDir } from "@std/fs";
import * as path from "@std/path";
import { boltfoundryComAppRoot, sharedBftE2eRoot } from "./paths.ts";

export function isIgnorableCloseError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err);
  return /Protocol error .*Target\.closeTarget|ConnectionClosedError|Connection closed/i
    .test(msg);
}

export function isTransientActionError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err);
  return /detached|Target closed|Connection closed|Execution context was destroyed|Cannot find context|Frame was detached/i
    .test(msg);
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function getDefaultArtifactRoot(): string {
  return sharedBftE2eRoot;
}

export function getBoltfoundryComAppRoot(): string {
  return boltfoundryComAppRoot;
}

export async function saveScreenshot(
  page: { screenshot(opts: { path: string }): Promise<unknown> },
  label: string,
  runBaseDir: string,
  artifactRoot: string,
): Promise<string> {
  const screenshotsDir = path.join(runBaseDir, "screenshots");
  const latestDir = path.join(artifactRoot, "latest-artifacts");
  await ensureDir(screenshotsDir);
  await ensureDir(latestDir);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const filename = `${ts}_${safeLabel}.png`;
  const filePath = path.join(screenshotsDir, filename);
  try {
    await page.screenshot({ path: filePath as `${string}.png` });
    await Deno.copyFile(filePath, path.join(latestDir, `${safeLabel}.png`));
    return filePath;
  } catch (error) {
    if ((Deno.env.get("BF_E2E_VERBOSE_SCREENSHOT_ERRORS") || "") === "true") {
      console.warn("[browser-test] failed to save screenshot:", error);
    }
    return "";
  }
}

export function findAvailablePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

export function localSystemBrowserError(): Error {
  return new Error(
    "createBrowserTestContext: browserProvider=local-system requires a system browser executable. Set BF_E2E_PLAYWRIGHT_EXECUTABLE_PATH or install chromium/google-chrome-stable in a standard system location.",
  );
}

export const DEFAULT_READY_PATTERN =
  /server running at http:\/\/(?:127\.0\.0\.1|localhost):\d+/i;
export const SERVER_LOG_HEADER = [
  "# browser test embedded server",
  `# started: ${new Date().toISOString()}`,
].join("\n") + "\n";
export const SERVER_STOP_TIMEOUT_MS = 10_000;
export const CLEANUP_STEP_TIMEOUT_MS = 5_000;

export async function killDanglingChromiumProcesses() {
  for (
    const pattern of [
      "libexec/chromium/chromium",
      "chrome_crashpad_handler",
    ]
  ) {
    try {
      const command = new Deno.Command("pkill", {
        args: ["-f", pattern],
        stdout: "null",
        stderr: "piped",
      });
      const { code } = await command.output();
      if (code !== 0 && code !== 1) {
        console.warn(`[browser-test] pkill returned ${code} for ${pattern}`);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.warn(`[browser-test] pkill failed for ${pattern}:`, error);
      }
    }
  }
}

export async function waitForHttpReady(
  port: number,
  opts?: { timeoutMs?: number; accept404?: boolean },
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
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

export async function runCleanupStepWithTimeout(
  label: string,
  fn: () => Promise<void>,
  timeoutMs = CLEANUP_STEP_TIMEOUT_MS,
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const result = await Promise.race([
    fn().then(() => "done" as const),
    timeout,
  ]);
  if (timeoutId !== undefined) clearTimeout(timeoutId);
  if (result === "timeout") {
    console.warn(
      `[browser-test] cleanup step timed out after ${timeoutMs}ms: ${label}`,
    );
  }
}
