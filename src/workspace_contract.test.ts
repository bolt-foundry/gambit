import { assertEquals } from "@std/assert";
import {
  buildWorkspacePath,
  parseWorkspaceRoute,
} from "@bolt-foundry/gambit-simulator/src/workspace_contract.ts";

Deno.test("buildWorkspacePath supports run-addressed test and grade routes", () => {
  assertEquals(
    buildWorkspacePath("test", "ws_1", { runId: "run_1" }),
    "/workspaces/ws_1/test/run_1",
  );
  assertEquals(
    buildWorkspacePath("grade", "ws_1", { runId: "grade_1" }),
    "/workspaces/ws_1/grade/grade_1",
  );
  assertEquals(
    buildWorkspacePath("debug", "ws_1", { runId: "ignored" }),
    "/workspaces/ws_1/debug",
  );
  assertEquals(
    buildWorkspacePath("verify", "ws_1"),
    "/workspaces/ws_1/verify",
  );
});

Deno.test("parseWorkspaceRoute parses run-addressed test and grade routes", () => {
  assertEquals(parseWorkspaceRoute("/workspaces/ws_1/test/run_1"), {
    workspaceId: "ws_1",
    tab: "test",
    isNew: false,
    testRunId: "run_1",
    gradeRunId: undefined,
  });
  assertEquals(parseWorkspaceRoute("/workspaces/ws_1/grade/grade_1"), {
    workspaceId: "ws_1",
    tab: "grade",
    isNew: false,
    testRunId: undefined,
    gradeRunId: "grade_1",
  });
  assertEquals(parseWorkspaceRoute("/workspaces/ws_1/verify"), {
    workspaceId: "ws_1",
    tab: "verify",
    isNew: false,
    testRunId: undefined,
    gradeRunId: undefined,
  });
});

Deno.test("parseWorkspaceRoute rejects unsupported route combinations", () => {
  assertEquals(parseWorkspaceRoute("/workspaces/ws_1/debug/run_1"), null);
  assertEquals(parseWorkspaceRoute("/workspaces/new/test/run_1"), null);
  assertEquals(parseWorkspaceRoute("/workspaces/ws_1/verify/run_1"), null);
});
