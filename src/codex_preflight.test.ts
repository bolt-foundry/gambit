import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  CODEX_HOST_AUTH_BUNDLE_ENV,
  LEGACY_CODEX_HOST_AUTH_BUNDLE_ENV,
} from "./codex_auth.ts";
import {
  MINIMUM_SUPPORTED_CODEX_CLI_VERSION,
  readCodexLoginStatus,
} from "./codex_preflight.ts";
import {
  RUNTIME_HOST_SERVICE_SOCKET_ENV,
  RUNTIME_HOST_SERVICE_TOKEN_ENV,
} from "./runtime_host_service.ts";

const SUPPORTED_FAKE_CODEX_VERSION = MINIMUM_SUPPORTED_CODEX_CLI_VERSION;
const UNSUPPORTED_FAKE_CODEX_VERSION = "0.120.0";

function fakeCodexVersionBlock(version = SUPPORTED_FAKE_CODEX_VERSION): string {
  return `if [ "\${1:-}" = "--version" ]; then
  printf 'codex-cli ${version}\\n'
  exit 0
fi
`;
}

Deno.test("codex preflight uses app-server account state when host auth bundle is present", async () => {
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const priorBundle = Deno.env.get(CODEX_HOST_AUTH_BUNDLE_ENV);
  const root = await Deno.makeTempDir({
    prefix: "codex-preflight-app-server-",
  });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu
${fakeCodexVersionBlock()}

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

mode=""
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
done

[ "$mode" = "app-server" ] || exit 64

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"account/login/start"'*)
      printf '%s' "$line" | grep '"params":{' >/dev/null
      printf '%s' "$line" | grep '"type":"chatgptAuthTokens"' >/dev/null
      printf '%s' "$line" | grep '"accessToken":"preflight-access-token"' >/dev/null
      printf '%s' "$line" | grep '"chatgptAccountId":"acct-preflight"' >/dev/null
      printf '%s' "$line" | grep '"params":{"account":' >/dev/null && exit 61
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"account":{"id":"acct-preflight"}}}\\n' "$id"
      ;;
    *'"method":"account/read"'*)
      printf '%s' "$line" | grep '"type":"chatgptAuthTokens"' >/dev/null
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"account":{"id":"acct-preflight","planType":"pro"},"requiresOpenaiAuth":false}}\\n' "$id"
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  Deno.env.set(
    CODEX_HOST_AUTH_BUNDLE_ENV,
    JSON.stringify({
      accessToken: "preflight-access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      chatgptAccountId: "acct-preflight",
      chatgptPlanType: "pro",
      lastRefresh: "2026-04-17T00:00:00Z",
    }),
  );

  try {
    const status = await readCodexLoginStatus();
    assertEquals(status.codexLoggedIn, true);
    assertEquals(
      status.codexLoginStatus,
      "Codex account ready via app-server external auth (account=acct-preflight plan=pro).",
    );
  } finally {
    if (priorBin == null) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    if (priorBundle == null) {
      Deno.env.delete(CODEX_HOST_AUTH_BUNDLE_ENV);
    } else {
      Deno.env.set(CODEX_HOST_AUTH_BUNDLE_ENV, priorBundle);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex preflight responds to app-server refresh RPCs before account/read completes", async () => {
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const priorBundle = Deno.env.get(CODEX_HOST_AUTH_BUNDLE_ENV);
  const priorHostServiceSocket = Deno.env.get(RUNTIME_HOST_SERVICE_SOCKET_ENV);
  const priorHostServiceToken = Deno.env.get(RUNTIME_HOST_SERVICE_TOKEN_ENV);
  const root = await Deno.makeTempDir({
    prefix: "codex-preflight-refresh-rpc-",
  });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu
${fakeCodexVersionBlock()}

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

mode=""
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
done

[ "$mode" = "app-server" ] || exit 64

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"account/login/start"'*)
      printf '%s' "$line" | grep '"params":{' >/dev/null
      printf '%s' "$line" | grep '"type":"chatgptAuthTokens"' >/dev/null
      printf '%s' "$line" | grep '"accessToken":"preflight-access-token"' >/dev/null
      printf '%s' "$line" | grep '"chatgptAccountId":"acct-preflight"' >/dev/null
      printf '%s' "$line" | grep '"params":{"account":' >/dev/null && exit 61
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"account":{"id":"acct-preflight"}}}\\n' "$id"
      ;;
    *'"method":"account/read"'*)
      printf '%s' "$line" | grep '"type":"chatgptAuthTokens"' >/dev/null
      id="$(extract_id "$line")"
      printf '{"id":"refresh-1","method":"account/chatgptAuthTokens/refresh","params":{"previousAccountId":"acct-preflight","reason":"preflight-refresh"}}\\n'
      IFS= read -r refresh_response || exit 65
      printf '%s' "$refresh_response" | grep '"id":"refresh-1"' >/dev/null
      printf '%s' "$refresh_response" | grep '"chatgptAccountId":"acct-preflight"' >/dev/null
      printf '%s' "$refresh_response" | grep '"type":"chatgptAuthTokens"' >/dev/null
      printf '%s' "$refresh_response" | grep '"result"' >/dev/null
      printf '{"id":"%s","result":{"account":{"id":"acct-preflight","planType":"pro"},"requiresOpenaiAuth":false}}\\n' "$id"
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  Deno.env.set(RUNTIME_HOST_SERVICE_SOCKET_ENV, join(root, "missing.sock"));
  Deno.env.delete(RUNTIME_HOST_SERVICE_TOKEN_ENV);
  Deno.env.set(
    CODEX_HOST_AUTH_BUNDLE_ENV,
    JSON.stringify({
      accessToken: "preflight-access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      chatgptAccountId: "acct-preflight",
      chatgptPlanType: "pro",
      lastRefresh: "2026-04-17T00:00:00Z",
    }),
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          access_token: "refreshed-access-token",
          refresh_token: "refreshed-refresh-token",
          id_token: "id-token",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

  try {
    const status = await readCodexLoginStatus();
    assertEquals(status.codexLoggedIn, true);
    assertStringIncludes(
      status.codexLoginStatus,
      "Codex account ready via app-server external auth",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (priorBin == null) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    if (priorBundle == null) {
      Deno.env.delete(CODEX_HOST_AUTH_BUNDLE_ENV);
    } else {
      Deno.env.set(CODEX_HOST_AUTH_BUNDLE_ENV, priorBundle);
    }
    if (priorHostServiceSocket == null) {
      Deno.env.delete(RUNTIME_HOST_SERVICE_SOCKET_ENV);
    } else {
      Deno.env.set(RUNTIME_HOST_SERVICE_SOCKET_ENV, priorHostServiceSocket);
    }
    if (priorHostServiceToken == null) {
      Deno.env.delete(RUNTIME_HOST_SERVICE_TOKEN_ENV);
    } else {
      Deno.env.set(RUNTIME_HOST_SERVICE_TOKEN_ENV, priorHostServiceToken);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex preflight treats host auth bootstrap as ready even when account/read still reports requires auth", async () => {
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const priorBundle = Deno.env.get(CODEX_HOST_AUTH_BUNDLE_ENV);
  const root = await Deno.makeTempDir({
    prefix: "codex-preflight-requires-auth-",
  });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu
${fakeCodexVersionBlock()}

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

mode=""
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
done

[ "$mode" = "app-server" ] || exit 64

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"account/login/start"'*)
      printf '%s' "$line" | grep '"params":{' >/dev/null
      printf '%s' "$line" | grep '"type":"chatgptAuthTokens"' >/dev/null
      printf '%s' "$line" | grep '"accessToken":"preflight-access-token"' >/dev/null
      printf '%s' "$line" | grep '"chatgptAccountId":"acct-preflight"' >/dev/null
      printf '%s' "$line" | grep '"params":{"account":' >/dev/null && exit 61
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"account":{"id":"acct-preflight"}}}\\n' "$id"
      ;;
    *'"method":"account/read"'*)
      printf '%s' "$line" | grep '"type":"chatgptAuthTokens"' >/dev/null
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"account":{"id":"acct-preflight","planType":"pro"},"requiresOpenaiAuth":true}}\\n' "$id"
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  Deno.env.set(
    CODEX_HOST_AUTH_BUNDLE_ENV,
    JSON.stringify({
      accessToken: "preflight-access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      chatgptAccountId: "acct-preflight",
      chatgptPlanType: "pro",
      lastRefresh: "2026-04-17T00:00:00Z",
    }),
  );

  try {
    const status = await readCodexLoginStatus();
    assertEquals(status.codexLoggedIn, true);
    assertEquals(
      status.codexLoginStatus,
      "Codex host auth bundle is present and account bootstrap is available (account=acct-preflight plan=pro); account/read still reports requiresOpenaiAuth.",
    );
  } finally {
    if (priorBin == null) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    if (priorBundle == null) {
      Deno.env.delete(CODEX_HOST_AUTH_BUNDLE_ENV);
    } else {
      Deno.env.set(CODEX_HOST_AUTH_BUNDLE_ENV, priorBundle);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex preflight does not mark login ready when account/read requires auth and returns no account id", async () => {
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const priorBundle = Deno.env.get(CODEX_HOST_AUTH_BUNDLE_ENV);
  const root = await Deno.makeTempDir({
    prefix: "codex-preflight-requires-auth-no-account-",
  });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu
${fakeCodexVersionBlock()}

extract_id() {
  printf '%s\\n' "$1" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p'
}

mode=""
for arg in "$@"; do
  if [ "$arg" = "app-server" ]; then
    mode="app-server"
  fi
done

[ "$mode" = "app-server" ] || exit 64

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"account/login/start"'*)
      printf '%s' "$line" | grep '"params":{' >/dev/null
      printf '%s' "$line" | grep '"type":"chatgptAuthTokens"' >/dev/null
      printf '%s' "$line" | grep '"accessToken":"preflight-access-token"' >/dev/null
      printf '%s' "$line" | grep '"chatgptAccountId":"acct-preflight"' >/dev/null
      printf '%s' "$line" | grep '"params":{"account":' >/dev/null && exit 61
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"account":{"id":"acct-preflight"}}}\\n' "$id"
      ;;
    *'"method":"account/read"'*)
      printf '%s' "$line" | grep '"type":"chatgptAuthTokens"' >/dev/null
      id="$(extract_id "$line")"
      printf '{"id":"%s","result":{"account":{"planType":"pro"},"requiresOpenaiAuth":true}}\\n' "$id"
      ;;
  esac
done
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  Deno.env.set(
    CODEX_HOST_AUTH_BUNDLE_ENV,
    JSON.stringify({
      accessToken: "preflight-access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      chatgptAccountId: "acct-preflight",
      chatgptPlanType: "pro",
      lastRefresh: "2026-04-17T00:00:00Z",
    }),
  );

  try {
    const status = await readCodexLoginStatus();
    assertEquals(status.codexLoggedIn, false);
    assertEquals(
      status.codexLoginStatus,
      'Codex host auth bundle is present but account/read still requires auth: {"chatgptAccountId":"acct-preflight","chatgptPlanType":"pro","hasAccessToken":true,"hasIdToken":true,"hasRefreshToken":true,"lastRefresh":"2026-04-17T00:00:00Z"}',
    );
  } finally {
    if (priorBin == null) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    if (priorBundle == null) {
      Deno.env.delete(CODEX_HOST_AUTH_BUNDLE_ENV);
    } else {
      Deno.env.set(CODEX_HOST_AUTH_BUNDLE_ENV, priorBundle);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex preflight falls back to login status when no host auth bundle is present", async () => {
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const priorBundle = Deno.env.get(CODEX_HOST_AUTH_BUNDLE_ENV);
  const priorLegacyBundle = Deno.env.get(LEGACY_CODEX_HOST_AUTH_BUNDLE_ENV);
  const root = await Deno.makeTempDir({ prefix: "codex-preflight-legacy-" });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu
${fakeCodexVersionBlock()}
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  printf 'Logged in legacy path\\n'
  exit 0
fi
exit 64
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  Deno.env.delete(CODEX_HOST_AUTH_BUNDLE_ENV);
  Deno.env.delete(LEGACY_CODEX_HOST_AUTH_BUNDLE_ENV);

  try {
    const status = await readCodexLoginStatus();
    assertEquals(status.codexLoggedIn, true);
    assertEquals(status.codexLoginStatus, "Logged in legacy path");
  } finally {
    if (priorBin == null) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    if (priorBundle == null) {
      Deno.env.delete(CODEX_HOST_AUTH_BUNDLE_ENV);
    } else {
      Deno.env.set(CODEX_HOST_AUTH_BUNDLE_ENV, priorBundle);
    }
    if (priorLegacyBundle == null) {
      Deno.env.delete(LEGACY_CODEX_HOST_AUTH_BUNDLE_ENV);
    } else {
      Deno.env.set(LEGACY_CODEX_HOST_AUTH_BUNDLE_ENV, priorLegacyBundle);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex preflight rejects unsupported codex cli versions before login checks", async () => {
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const priorBundle = Deno.env.get(CODEX_HOST_AUTH_BUNDLE_ENV);
  const priorLegacyBundle = Deno.env.get(LEGACY_CODEX_HOST_AUTH_BUNDLE_ENV);
  const root = await Deno.makeTempDir({
    prefix: "codex-preflight-unsupported-version-",
  });
  const fakeCodexPath = join(root, "fake-codex");

  await Deno.writeTextFile(
    fakeCodexPath,
    `#!/bin/sh
set -eu
${fakeCodexVersionBlock(UNSUPPORTED_FAKE_CODEX_VERSION)}
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  printf 'Logged in legacy path\\n'
  exit 0
fi
exit 64
`,
  );
  await Deno.chmod(fakeCodexPath, 0o755);

  Deno.env.set("GAMBIT_CODEX_BIN", fakeCodexPath);
  Deno.env.delete(CODEX_HOST_AUTH_BUNDLE_ENV);
  Deno.env.delete(LEGACY_CODEX_HOST_AUTH_BUNDLE_ENV);

  try {
    const status = await readCodexLoginStatus();
    assertEquals(status.codexLoggedIn, false);
    assertEquals(status.codexVersion, UNSUPPORTED_FAKE_CODEX_VERSION);
    assertEquals(status.codexVersionSupported, false);
    assertEquals(
      status.codexLoginStatus,
      `Codex CLI ${UNSUPPORTED_FAKE_CODEX_VERSION} is too old; require >= ${MINIMUM_SUPPORTED_CODEX_CLI_VERSION} for Gambit's app-server transport.`,
    );
  } finally {
    if (priorBin == null) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    if (priorBundle == null) {
      Deno.env.delete(CODEX_HOST_AUTH_BUNDLE_ENV);
    } else {
      Deno.env.set(CODEX_HOST_AUTH_BUNDLE_ENV, priorBundle);
    }
    if (priorLegacyBundle == null) {
      Deno.env.delete(LEGACY_CODEX_HOST_AUTH_BUNDLE_ENV);
    } else {
      Deno.env.set(LEGACY_CODEX_HOST_AUTH_BUNDLE_ENV, priorLegacyBundle);
    }
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("codex preflight returns a normal failure when host auth is present but Codex CLI is missing", async () => {
  const priorBin = Deno.env.get("GAMBIT_CODEX_BIN");
  const priorBundle = Deno.env.get(CODEX_HOST_AUTH_BUNDLE_ENV);

  Deno.env.set("GAMBIT_CODEX_BIN", "/definitely/missing/codex-binary");
  Deno.env.set(
    CODEX_HOST_AUTH_BUNDLE_ENV,
    JSON.stringify({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      chatgptAccountId: "acct-preflight",
      chatgptPlanType: "pro",
      lastRefresh: "2026-04-17T00:00:00Z",
    }),
  );

  try {
    const status = await readCodexLoginStatus();
    assertEquals(status.codexLoggedIn, false);
    assertEquals(status.codexLoginStatus, "Codex CLI not found in PATH.");
  } finally {
    if (priorBin == null) {
      Deno.env.delete("GAMBIT_CODEX_BIN");
    } else {
      Deno.env.set("GAMBIT_CODEX_BIN", priorBin);
    }
    if (priorBundle == null) {
      Deno.env.delete(CODEX_HOST_AUTH_BUNDLE_ENV);
    } else {
      Deno.env.set(CODEX_HOST_AUTH_BUNDLE_ENV, priorBundle);
    }
  }
});
