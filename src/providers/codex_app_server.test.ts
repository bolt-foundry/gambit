import { assertEquals } from "@std/assert";
import {
  appServerRequestResultForTest,
  codexConfigArgsForTest,
  setCodexHostAuthBridgeForTests,
} from "./codex.ts";

Deno.test("codex app-server refresh host failures are returned as RPC errors", async () => {
  setCodexHostAuthBridgeForTests({
    readAuthTokens: () => {
      throw new Error("not expected");
    },
    refreshAuthTokens: () => {
      throw new SyntaxError("Unexpected end of JSON input");
    },
  });

  try {
    const response = await appServerRequestResultForTest({
      method: "account/chatgptAuthTokens/refresh",
      params: {
        previousAccountId: "acct-test",
        reason: "account/chatgptAuthTokens/refresh",
      },
    });

    assertEquals(response, {
      error: {
        code: -32000,
        message: "Unexpected end of JSON input",
      },
    });
  } finally {
    setCodexHostAuthBridgeForTests(null);
  }
});

Deno.test("codex config can disable OpenAI websocket responses", () => {
  const previous = Deno.env.get("GAMBIT_CODEX_DISABLE_WEBSOCKETS");
  Deno.env.set("GAMBIT_CODEX_DISABLE_WEBSOCKETS", "1");

  try {
    const args = codexConfigArgsForTest({ cwd: "/workspace" });

    assertEquals(
      args.includes("model_providers.openai.supports_websockets=false"),
      true,
    );
  } finally {
    if (previous === undefined) {
      Deno.env.delete("GAMBIT_CODEX_DISABLE_WEBSOCKETS");
    } else {
      Deno.env.set("GAMBIT_CODEX_DISABLE_WEBSOCKETS", previous);
    }
  }
});
