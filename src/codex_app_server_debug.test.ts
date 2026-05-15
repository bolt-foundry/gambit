import { assertEquals } from "@std/assert";
import {
  codexAppServerStderrDebugDetails,
  summarizeCodexAppServerDebugValue,
} from "./codex_app_server_debug.ts";

Deno.test("codex app-server stderr debug parses JSON lines before summarizing", () => {
  const details = codexAppServerStderrDebugDetails(
    JSON.stringify({
      timestamp: "2026-05-15T02:41:48.000Z",
      level: "DEBUG",
      target: "codex_core::client",
      fields: {
        message: "starting turn",
        authorization: "Bearer secret-token",
        prompt: "summarize this private prompt",
      },
    }),
  );

  assertEquals(summarizeCodexAppServerDebugValue(details), {
    json: {
      timestamp: "2026-05-15T02:41:48.000Z",
      level: "DEBUG",
      target: "codex_core::client",
      fields: {
        message: "starting turn",
        authorization: "<redacted len=19>",
        prompt: "<string len=29>",
      },
    },
  });
});

Deno.test("codex app-server stderr debug keeps non-JSON lines opaque", () => {
  const details = codexAppServerStderrDebugDetails(
    "plain stderr with a token-like value",
  );

  assertEquals(summarizeCodexAppServerDebugValue(details), {
    line: "<string len=36>",
  });
});
