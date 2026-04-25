import * as path from "@std/path";
import { createTestTabDemoFixture } from "@bolt-foundry/gambit-simulator/simulator-ui/__demos__/fixtures/test-tab-fixture.ts";
import { bfmonoRoot } from "@bolt-foundry/browser-runtime/src/paths.ts";
import { runE2e } from "@bolt-foundry/browser-runtime/src/e2e/utils.ts";

type IntentE2eOptions = {
  testName: string;
  slug: string;
  includeBrokenScenario?: boolean;
  useDistinctInputSchemas?: boolean;
  scenario: Parameters<typeof runE2e>[1];
};

async function withTempServeRoot(
  fn: (serveRoot: string) => Promise<void>,
): Promise<void> {
  const serveRoot = await Deno.makeTempDir({
    prefix: "gambit-intent-e2e-serve-root-",
  });
  try {
    await fn(serveRoot);
  } finally {
    await Deno.remove(serveRoot, { recursive: true }).catch(() => {});
  }
}

export async function runSimulatorIntentE2e(
  options: IntentE2eOptions,
): Promise<void> {
  const gambitSimulatorPackageRoot = path.resolve(
    bfmonoRoot,
    "packages",
    "gambit",
    "packages",
    "gambit-simulator",
  );
  const gambitSimulatorCliPath = path.join(
    gambitSimulatorPackageRoot,
    "src",
    "cli.ts",
  );

  await withTempServeRoot(async (serveRoot) => {
    const fixture = await createTestTabDemoFixture(serveRoot, {
      includeBrokenScenario: options.includeBrokenScenario ?? false,
      useDistinctInputSchemas: options.useDistinctInputSchemas ?? false,
    });

    await runE2e(
      options.testName,
      options.scenario,
      {
        mode: "test",
        slug: options.slug,
        iframeTargetPath: "/isograph",
        server: {
          cwd: serveRoot,
          command: (targetPort: number) => [
            "deno",
            "run",
            "-A",
            gambitSimulatorCliPath,
            "serve",
            fixture.rootDeckPath,
            "--yolo",
            "--bundle",
            "--sourcemap",
            "--port",
            String(targetPort),
          ],
        },
      },
    );
  });
}
