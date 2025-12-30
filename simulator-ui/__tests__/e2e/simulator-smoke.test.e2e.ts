#!/usr/bin/env -S deno test -A

import { createE2eTestContext } from "./utils/mod.ts";

Deno.test("gambit simulator smoke", async (t) => {
  await using ctx = await createE2eTestContext(t.name);

  await t.step("open simulator UI", async () => {
    await ctx.navigate("/");
  });

  await t.step("basic checks + screenshot", async () => {
    const hasRoot = await ctx.exists("#root");
    if (!hasRoot) throw new Error("expected #root to exist");
    const hasBundle = await ctx.exists('script[type="module"]');
    if (!hasBundle) throw new Error("expected bundle script to exist");
    await ctx.screenshot("simulator-home");
  });
});
