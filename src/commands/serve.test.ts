import { assertEquals } from "@std/assert";
import * as path from "@std/path";
import { resolveServeWorkspaceRoot } from "./serve.ts";

Deno.test("resolveServeWorkspaceRoot uses current working directory", () => {
  const cwd = "/tmp/my-project/nested";
  assertEquals(resolveServeWorkspaceRoot(cwd), path.resolve(cwd));
});
