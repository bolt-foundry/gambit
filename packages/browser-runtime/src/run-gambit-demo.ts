#!/usr/bin/env -S deno run -A

import * as path from "@std/path";
import {
  demoTimeline,
} from "@bolt-foundry/gambit-simulator/simulator-ui/demo/gambit-ui-demo-timeline.ts";
import { runTimelineSteps } from "./automation/timeline.ts";
import { getDemoPort, useHostBridge } from "./config.ts";
import { bfmonoRoot } from "./paths.ts";
import { startServer, stopManagedDevTarget, stopServer } from "./server.ts";
import { getDemoPaths, prepareDemoPaths, runDemo } from "./runner.ts";

async function main(): Promise<void> {
  const paths = getDemoPaths();
  await prepareDemoPaths(paths);
  const gambitPackageRoot = path.resolve(
    bfmonoRoot,
    "packages",
    "gambit",
    "packages",
    "gambit-simulator",
  );
  const hostBridge = useHostBridge();
  const demoPort = getDemoPort(hostBridge);
  if (hostBridge && demoPort === 8000) {
    await stopManagedDevTarget();
  }
  let server: Awaited<ReturnType<typeof startServer>> | null = null;
  try {
    server = await startServer({
      logsDir: paths.logsDir,
      cwd: gambitPackageRoot,
      port: demoPort,
    });
    await runDemo(
      (ctx) => runTimelineSteps(ctx, demoTimeline),
      { baseUrl: server.baseUrl, paths },
    );
  } finally {
    if (server) {
      await stopServer(server).catch(() => {});
    }
  }
}

if (import.meta.main) {
  await main();
}
