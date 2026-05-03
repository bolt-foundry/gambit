import { assertEquals } from "@std/assert";
import {
  CODEX_HOST_AUTH_BUNDLE_ENV,
  readCodexAuthBundleFromEnv,
} from "./codex_auth.ts";

const TEST_BUNDLE = JSON.stringify({
  accessToken: "access-token",
  refreshToken: "refresh-token",
  idToken: "id-token",
  chatgptAccountId: "acct-auth-env",
  chatgptPlanType: "pro",
  lastRefresh: "2026-04-27T00:00:00Z",
});

function withRestoredAuthBundleEnv(fn: () => void) {
  const priorBundle = Deno.env.get(CODEX_HOST_AUTH_BUNDLE_ENV);
  try {
    Deno.env.delete(CODEX_HOST_AUTH_BUNDLE_ENV);
    fn();
  } finally {
    if (priorBundle === undefined) {
      Deno.env.delete(CODEX_HOST_AUTH_BUNDLE_ENV);
    } else {
      Deno.env.set(CODEX_HOST_AUTH_BUNDLE_ENV, priorBundle);
    }
  }
}

Deno.test("codex auth bundle env reads the Gambit auth bundle env", () => {
  withRestoredAuthBundleEnv(() => {
    Deno.env.set(CODEX_HOST_AUTH_BUNDLE_ENV, TEST_BUNDLE);

    const bundle = readCodexAuthBundleFromEnv();

    assertEquals(bundle?.chatgptAccountId, "acct-auth-env");
    assertEquals(bundle?.accessToken, "access-token");
  });
});
