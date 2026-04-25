import { assertEquals } from "@std/assert";
import { buildMcpDenoConfig } from "./mcp_deno_config.ts";

Deno.test("mcp deno config maps gambit core subpaths", () => {
  const config = buildMcpDenoConfig();

  assertEquals(
    typeof config.imports["@bolt-foundry/gambit-core"],
    "string",
  );
  assertEquals(
    typeof config.imports["@bolt-foundry/gambit-core/"],
    "string",
  );
  assertEquals(
    config.imports["@bolt-foundry/gambit-core/"]?.endsWith("/"),
    true,
  );
});
