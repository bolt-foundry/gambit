import { assert, assertEquals } from "@std/assert";
import { isographAppRoutes, matchRouteWithParams } from "./routing.ts";

Deno.test("routing matches workspace build route params", () => {
  const result = matchRouteWithParams(
    "/workspaces/ws-123/build?x=1",
    "/workspaces/:workspaceId/build",
  );
  assert(result.match);
  assertEquals(result.params.workspaceId, "ws-123");
  assertEquals(result.queryParams.x, "1");
});

Deno.test("routing matches workspace build file path params", () => {
  const result = matchRouteWithParams(
    "/workspaces/ws-123/build/scenarios/example.deck.md",
    "/workspaces/:workspaceId/build/:path*",
  );
  assert(result.match);
  assertEquals(result.params.workspaceId, "ws-123");
  assertEquals(result.params.path, "scenarios/example.deck.md");
});

Deno.test("routing includes canonical workspace paths", () => {
  assert(isographAppRoutes.has("/workspaces/:workspaceId/build"));
  assert(isographAppRoutes.has("/workspaces/:workspaceId/build/:path*"));
  assert(isographAppRoutes.has("/workspaces/:workspaceId/test"));
  assert(isographAppRoutes.has("/workspaces/:workspaceId/test/:testRunId"));
  assert(isographAppRoutes.has("/workspaces/:workspaceId/grade"));
  assert(isographAppRoutes.has("/workspaces/:workspaceId/grade/:gradeRunId"));
  assert(isographAppRoutes.has("/workspaces/:workspaceId/verify"));
  assert(isographAppRoutes.has("/workspaces/:workspaceId"));
  const legacyResult = matchRouteWithParams(
    "/workspaces/ws-legacy",
    "/workspaces/:workspaceId",
  );
  assert(legacyResult.match);
  assertEquals(legacyResult.params.workspaceId, "ws-legacy");
});

Deno.test("routing matches workspace test route params", () => {
  const noRun = matchRouteWithParams(
    "/workspaces/ws-123/test",
    "/workspaces/:workspaceId/test",
  );
  assert(noRun.match);
  assertEquals(noRun.params.workspaceId, "ws-123");

  const withRun = matchRouteWithParams(
    "/workspaces/ws-123/test/run-9",
    "/workspaces/:workspaceId/test/:testRunId",
  );
  assert(withRun.match);
  assertEquals(withRun.params.workspaceId, "ws-123");
  assertEquals(withRun.params.testRunId, "run-9");
});

Deno.test("routing matches workspace grade route params", () => {
  const noRun = matchRouteWithParams(
    "/workspaces/ws-123/grade",
    "/workspaces/:workspaceId/grade",
  );
  assert(noRun.match);
  assertEquals(noRun.params.workspaceId, "ws-123");

  const withRun = matchRouteWithParams(
    "/workspaces/ws-123/grade/run-9",
    "/workspaces/:workspaceId/grade/:gradeRunId",
  );
  assert(withRun.match);
  assertEquals(withRun.params.workspaceId, "ws-123");
  assertEquals(withRun.params.gradeRunId, "run-9");
});

Deno.test("routing matches workspace verify route params", () => {
  const verify = matchRouteWithParams(
    "/workspaces/ws-123/verify",
    "/workspaces/:workspaceId/verify",
  );
  assert(verify.match);
  assertEquals(verify.params.workspaceId, "ws-123");
});
