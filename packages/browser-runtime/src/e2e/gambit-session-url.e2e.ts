import * as path from "@std/path";
import {
  runE2e,
  waitForPath,
} from "@bolt-foundry/browser-runtime/src/e2e/utils.ts";
import { bfmonoRoot } from "@bolt-foundry/browser-runtime/src/paths.ts";

function extractSessionId(pathname: string): string | null {
  const match = pathname.match(
    /^\/workspaces\/([^/]+)\/(test|grade)(?:\/[^/]+)?$/,
  );
  return match ? decodeURIComponent(match[1]) : null;
}

Deno.test("gambit simulator session url stays stable across tabs", async () => {
  const repoRoot = bfmonoRoot;
  const gambitPackageRoot = path.resolve(repoRoot, "packages", "gambit");

  await runE2e(
    "gambit simulator session url stays stable across tabs",
    async ({ demoTarget, wait }) => {
      // 1) Start on Test tab. Depending on persisted state, this may be
      // /workspaces/new/test or /workspaces/<workspaceId>/test.
      const initialPath = await waitForPath(
        demoTarget,
        wait,
        (pathname) => /^\/workspaces\/[^/]+\/test$/.test(pathname),
        10_000,
        { label: "initial test session", logEveryMs: 2_000 },
      );
      let initialSessionId = extractSessionId(initialPath);

      if (!initialSessionId) {
        throw new Error(
          `Expected active workspace id in initial test path: ${initialPath}`,
        );
      }

      if (initialSessionId === "new") {
        const mintedPath = await waitForPath(
          demoTarget,
          wait,
          (pathname) => {
            const next = extractSessionId(pathname);
            return Boolean(next && next !== "new");
          },
          10_000,
          { label: "workspace mint", logEveryMs: 2_000 },
        );
        initialSessionId = extractSessionId(mintedPath);
      }

      if (!initialSessionId || initialSessionId === "new") {
        throw new Error(
          "Simulator never replaced /workspaces/new/test with a workspace id.",
        );
      }

      // 2) Switch to Grade and back to Test: workspace id should stay stable.
      await demoTarget.locator('[data-testid="nav-grade"]').click();
      const gradePath = await waitForPath(
        demoTarget,
        wait,
        (pathname) => {
          const sessionId = extractSessionId(pathname);
          return Boolean(sessionId && sessionId !== "new");
        },
        10_000,
        { label: "grade tab", logEveryMs: 2_000 },
      );
      const gradeSessionId = extractSessionId(gradePath);
      if (gradeSessionId !== initialSessionId) {
        throw new Error(
          `Grade session id mismatch: ${gradeSessionId} vs ${initialSessionId}`,
        );
      }

      await demoTarget.locator('[data-testid="nav-test"]').click();
      const backToTestPath = await waitForPath(
        demoTarget,
        wait,
        (pathname) => {
          const sessionId = extractSessionId(pathname);
          return Boolean(sessionId && sessionId !== "new");
        },
        10_000,
        { label: "back to test tab", logEveryMs: 2_000 },
      );
      const backSessionId = extractSessionId(backToTestPath);
      if (backSessionId !== initialSessionId) {
        throw new Error(
          `Test session id mismatch: ${backSessionId} vs ${initialSessionId}`,
        );
      }
    },
    {
      slug: "gambit-session-url-browser-runtime",
      server: {
        cwd: gambitPackageRoot,
        command: (targetPort: number) => [
          "deno",
          "run",
          "-A",
          "src/cli.ts",
          "serve",
          "scaffolds/demo/examples/advanced/simpsons_explainer/root.deck.md",
          "--bundle",
          "--port",
          String(targetPort),
        ],
      },
    },
  );
});
