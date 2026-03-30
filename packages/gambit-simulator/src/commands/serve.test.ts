import { assertEquals, assertRejects } from "@std/assert";
import * as path from "@std/path";
import { handleServeCommand, resolveServeWorkspaceRoot } from "./serve.ts";

Deno.test("resolveServeWorkspaceRoot uses current working directory", () => {
  const cwd = "/tmp/my-project/nested";
  assertEquals(resolveServeWorkspaceRoot(cwd), path.resolve(cwd));
});

Deno.test("handleServeCommand rejects invalid provider", async () => {
  await assertRejects(
    () =>
      handleServeCommand({
        buildAssistantProvider: "claude",
        modelProvider: {} as never,
      }),
    Error,
    "Invalid --build-assistant-provider",
  );
});
