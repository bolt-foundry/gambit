import { assertEquals } from "@std/assert";
import {
  getBrowserAppTargetBaseUrl,
  getDefaultBrowserBaseUrl,
} from "./appTargets.ts";

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

Deno.test("getDefaultBrowserBaseUrl prefers workspace bflocal hostnames", () => {
  const baseUrl = withEnv({
    WORKSPACE: "shipmore",
    WORKSPACE_ID: undefined,
    HOSTNAME: undefined,
  }, () => getDefaultBrowserBaseUrl());

  assertEquals(baseUrl, "https://shipmore.boltfoundry.bflocal");
});

Deno.test("getDefaultBrowserBaseUrl uses HOSTNAME when explicit workspace env is absent", () => {
  const baseUrl = withEnv({
    WORKSPACE: undefined,
    WORKSPACE_ID: undefined,
    HOSTNAME: "shipmore.boltfoundry.bflocal",
  }, () => getDefaultBrowserBaseUrl());

  assertEquals(baseUrl, "https://shipmore.boltfoundry.bflocal");
});

Deno.test("getDefaultBrowserBaseUrl ignores non-workspace HOSTNAME values", () => {
  const baseUrl = withEnv({
    WORKSPACE: undefined,
    WORKSPACE_ID: undefined,
    HOSTNAME: "ci-runner-42",
  }, () => getDefaultBrowserBaseUrl());

  assertEquals(baseUrl, "http://127.0.0.1:8000");
});

Deno.test("getBrowserAppTargetBaseUrl keeps explicit ports on localhost", () => {
  const baseUrl = withEnv({
    WORKSPACE: "shipmore",
    WORKSPACE_ID: undefined,
    HOSTNAME: undefined,
  }, () => getBrowserAppTargetBaseUrl("boltfoundry-com", 43123));

  assertEquals(baseUrl, "http://127.0.0.1:43123");
});

Deno.test("getBrowserAppTargetBaseUrl accepts bfdesktop", () => {
  const baseUrl = withEnv({
    WORKSPACE: "shipmore",
    WORKSPACE_ID: undefined,
    HOSTNAME: undefined,
  }, () => getBrowserAppTargetBaseUrl("bfdesktop", 41234));

  assertEquals(baseUrl, "http://127.0.0.1:41234");
});
