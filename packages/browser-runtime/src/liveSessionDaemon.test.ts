import { assertEquals } from "@std/assert";
import { resolveInitialLiveUrl } from "./liveSessionDaemon.ts";

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
  try {
    return fn();
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

Deno.test("resolveInitialLiveUrl prefers explicit urls", () => {
  const url = withEnv({
    WORKSPACE: "shipmore",
    WORKSPACE_ID: undefined,
    HOSTNAME: undefined,
  }, () => resolveInitialLiveUrl("https://example.com/path"));

  assertEquals(url, "https://example.com/path");
});

Deno.test("resolveInitialLiveUrl defaults to the workspace browser url", () => {
  const url = withEnv({
    WORKSPACE: "shipmore",
    WORKSPACE_ID: undefined,
    HOSTNAME: undefined,
  }, () => resolveInitialLiveUrl());

  assertEquals(url, "https://shipmore.boltfoundry.bflocal");
});
