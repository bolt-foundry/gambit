import { assertEquals, assertFalse, assertStrictEquals } from "@std/assert";
import {
  createBrowserGraphqlMockRegistry,
  getBrowserRuntimeEnvPatch,
  getBrowserRuntimeProfile,
  getBrowserTempEnvPatch,
  usesNestedNixShellTempDir,
  withBrowserRuntimeProfile,
} from "./browserRuntime.ts";

function withEnvPatch(
  env: Record<string, string | undefined>,
  fn: () => void,
): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}

Deno.test("getBrowserRuntimeProfile returns expected mode defaults", () => {
  const demo = getBrowserRuntimeProfile("demo");
  const testProfile = getBrowserRuntimeProfile("test");
  const live = getBrowserRuntimeProfile("live");

  assertEquals(demo.browserProvider, "host-bridge");
  assertEquals(demo.recordVideo, true);
  assertEquals(demo.useMediaRecorder, true);
  assertEquals(testProfile.recordVideo, false);
  assertEquals(testProfile.useMediaRecorder, true);
  assertFalse(testProfile.chrome);
  assertEquals(live.keepBrowserOpen, true);
  assertEquals(live.useHostBridge, true);
  assertEquals(live.supportsBackgroundLiveControl, true);
});

Deno.test("getBrowserRuntimeEnvPatch mirrors mode profile", () => {
  const env = getBrowserRuntimeEnvPatch(getBrowserRuntimeProfile("test"));

  assertEquals(env.GAMBIT_BROWSER_PROVIDER, "host-bridge");
  assertEquals(env.GAMBIT_USE_HOST_BRIDGE, "true");
  assertEquals(env.GAMBIT_E2E_RECORD_VIDEO, "false");
  assertEquals(env.BF_E2E_RECORD_VIDEO, "false");
  assertEquals(env.GAMBIT_DEMO_MEDIARECORDER, "true");
  assertEquals(env.GAMBIT_DEMO_WAIT, "false");
  assertEquals(env.GAMBIT_DEMO_CHROME, "false");
  assertEquals(env.GAMBIT_DEMO_SUBTITLES, "false");
  assertEquals(env.GAMBIT_DEMO_SMOOTH_MOUSE, "false");
  assertEquals(env.GAMBIT_DEMO_SMOOTH_TYPE, "false");
  assertEquals(env.GAMBIT_BROWSER_RUNTIME_MODE, "test");
});

Deno.test("nested nix-shell temp detection distinguishes single and double nesting", () => {
  assertFalse(usesNestedNixShellTempDir(undefined));
  assertFalse(usesNestedNixShellTempDir("/home/codebot/tmp/nix-shell.outer"));
  assertEquals(
    usesNestedNixShellTempDir(
      "/home/codebot/tmp/nix-shell.outer/nix-shell.inner",
    ),
    true,
  );
});

Deno.test("getBrowserTempEnvPatch rewrites nested nix-shell temp vars", () => {
  const homeDir = Deno.makeTempDirSync({
    dir: "/tmp",
    prefix: "browser-temp-home-",
  });
  try {
    withEnvPatch(
      {
        HOME: homeDir,
        TMPDIR: `${homeDir}/tmp/nix-shell.outer/nix-shell.inner`,
        TMP: `${homeDir}/tmp/nix-shell.outer/nix-shell.inner`,
        TEMP: `${homeDir}/tmp/nix-shell.outer/nix-shell.inner`,
        TEMPDIR: `${homeDir}/tmp/nix-shell.outer/nix-shell.inner`,
        NIX_BUILD_TOP: `${homeDir}/tmp/nix-shell.outer/nix-shell.inner`,
      },
      () => {
        const env = getBrowserTempEnvPatch();

        assertEquals(env.TMPDIR?.includes("/nix-shell."), true);
        assertEquals(usesNestedNixShellTempDir(env.TMPDIR), false);
        assertEquals(env.TMP, env.TMPDIR);
        assertEquals(env.TEMP, env.TMPDIR);
        assertEquals(env.TEMPDIR, env.TMPDIR);
        assertEquals(env.NIX_BUILD_TOP, env.TMPDIR);
      },
    );
  } finally {
    Deno.removeSync(homeDir, { recursive: true });
  }
});

Deno.test("withBrowserRuntimeProfile applies and restores env", async () => {
  const key = "GAMBIT_DEMO_WAIT";
  const original = Deno.env.get(key);
  Deno.env.set(key, "sentinel");

  await withBrowserRuntimeProfile("live", (profile) => {
    assertEquals(profile.mode, "live");
    assertEquals(Deno.env.get(key), "true");
    return Promise.resolve();
  });

  assertEquals(Deno.env.get(key), "sentinel");

  if (original === undefined) {
    Deno.env.delete(key);
  } else {
    Deno.env.set(key, original);
  }
});

Deno.test("getBrowserRuntimeProfile respects explicit env overrides", () => {
  const previousProvider = Deno.env.get("GAMBIT_BROWSER_PROVIDER");
  const previousRecordVideo = Deno.env.get("BF_E2E_RECORD_VIDEO");

  Deno.env.set("GAMBIT_BROWSER_PROVIDER", "local-system");
  Deno.env.set("BF_E2E_RECORD_VIDEO", "false");

  try {
    const profile = getBrowserRuntimeProfile("demo");
    assertEquals(profile.browserProvider, "local-system");
    assertEquals(profile.useHostBridge, false);
    assertEquals(profile.recordVideo, false);
  } finally {
    if (previousProvider === undefined) {
      Deno.env.delete("GAMBIT_BROWSER_PROVIDER");
    } else {
      Deno.env.set("GAMBIT_BROWSER_PROVIDER", previousProvider);
    }
    if (previousRecordVideo === undefined) {
      Deno.env.delete("BF_E2E_RECORD_VIDEO");
    } else {
      Deno.env.set("BF_E2E_RECORD_VIDEO", previousRecordVideo);
    }
  }
});

Deno.test("getBrowserRuntimeProfile lets call-site overrides beat env", () => {
  const previousProvider = Deno.env.get("GAMBIT_BROWSER_PROVIDER");

  Deno.env.set("GAMBIT_BROWSER_PROVIDER", "host-bridge");

  try {
    const profile = getBrowserRuntimeProfile("test", {
      browserProvider: "local-system",
    });
    assertEquals(profile.browserProvider, "local-system");
    assertEquals(profile.useHostBridge, false);
  } finally {
    if (previousProvider === undefined) {
      Deno.env.delete("GAMBIT_BROWSER_PROVIDER");
    } else {
      Deno.env.set("GAMBIT_BROWSER_PROVIDER", previousProvider);
    }
  }
});

Deno.test("getBrowserRuntimeProfile maps legacy useHostBridge overrides to providers", () => {
  assertEquals(
    getBrowserRuntimeProfile("test", { useHostBridge: false }).browserProvider,
    "local-system",
  );
  assertEquals(
    getBrowserRuntimeProfile("test", { useHostBridge: true }).browserProvider,
    "host-bridge",
  );
});

Deno.test("createBrowserGraphqlMockRegistry matches by operation or query", async () => {
  const operationResponse = new Response(JSON.stringify({ ok: "operation" }));
  const queryResponse = new Response(JSON.stringify({ ok: "query" }));
  const registry = createBrowserGraphqlMockRegistry([
    {
      operationName: "HomepageQuery",
      handler: () => operationResponse,
    },
    {
      queryIncludes: "gambitWorkspaces",
      handler: () => queryResponse,
    },
  ]);

  const matchedByOperation = await registry.handle({
    url: "/graphql",
    pathname: "/graphql",
    search: "",
    method: "POST",
    query: "query HomepageQuery { homepage }",
    operationName: "HomepageQuery",
  });
  const matchedByQuery = await registry.handle({
    url: "/graphql",
    pathname: "/graphql",
    search: "",
    method: "POST",
    query: "query { gambitWorkspaces { edges { cursor } } }",
  });
  const unmatched = await registry.handle({
    url: "/graphql",
    pathname: "/graphql",
    search: "",
    method: "POST",
    query: "query Unknown { node }",
  });

  assertStrictEquals(matchedByOperation, operationResponse);
  assertStrictEquals(matchedByQuery, queryResponse);
  assertStrictEquals(unmatched, undefined);
});
