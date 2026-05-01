import { assertEquals } from "@std/assert";
import {
  appServerRequestResultForTest,
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
