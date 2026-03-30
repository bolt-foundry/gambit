import { assertEquals } from "@std/assert";
import {
  type AssistantKickoffRunState,
  runAwaitsAssistantKickoff,
} from "./test_tab_start_gate.ts";

function run(
  overrides: Partial<AssistantKickoffRunState> = {},
): AssistantKickoffRunState {
  return {
    status: "IDLE",
    startedAt: null,
    finishedAt: null,
    outputItemCount: 0,
    ...overrides,
  };
}

Deno.test("runAwaitsAssistantKickoff returns true for missing run", () => {
  assertEquals(runAwaitsAssistantKickoff(null), true);
});

Deno.test("runAwaitsAssistantKickoff returns true for idle run with no output", () => {
  assertEquals(runAwaitsAssistantKickoff(run()), true);
});

Deno.test("runAwaitsAssistantKickoff returns false after run starts", () => {
  assertEquals(
    runAwaitsAssistantKickoff(
      run({ startedAt: "2026-03-06T00:00:00.000Z", status: "RUNNING" }),
    ),
    false,
  );
});

Deno.test("runAwaitsAssistantKickoff returns false for terminal-empty runs", () => {
  assertEquals(
    runAwaitsAssistantKickoff(run({ status: "COMPLETED", outputItemCount: 0 })),
    false,
  );
});

Deno.test("runAwaitsAssistantKickoff returns false when output items exist", () => {
  assertEquals(
    runAwaitsAssistantKickoff(run({ outputItemCount: 1 })),
    false,
  );
});
