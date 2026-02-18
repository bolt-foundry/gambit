import { assertEquals } from "@std/assert";
import * as path from "@std/path";
import { handleMcpRequest } from "./mcp_server.ts";

async function createRootDeckFixture(): Promise<{
  dir: string;
  rootDeckPath: string;
}> {
  const dir = await Deno.makeTempDir();
  const actionDir = path.join(dir, "actions");
  await Deno.mkdir(actionDir, { recursive: true });
  await Deno.writeTextFile(
    path.join(dir, "actions", "lookup.deck.ts"),
    `import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";
export default defineDeck({
  contextSchema: z.object({ query: z.string().optional() }),
  responseSchema: z.object({
    status: z.number(),
    payload: z.object({ query: z.string().nullable() }),
  }),
  run: (ctx) => ({
    status: 200,
    payload: { query: typeof ctx.input.query === "string" ? ctx.input.query : null },
  }),
});
`,
  );
  await Deno.writeTextFile(
    path.join(dir, "tool_input.zod.ts"),
    `import { z } from "npm:zod";
export default z.object({ query: z.string() });
`,
  );
  await Deno.writeTextFile(
    path.join(dir, "tool_output.zod.ts"),
    `import { z } from "npm:zod";
export default z.object({ query: z.string().nullable() });
`,
  );
  await Deno.writeTextFile(
    path.join(dir, "PROMPT.md"),
    `+++
label = "root"

[[actions]]
name = "lookup"
execute = "./actions/lookup.deck.ts"
description = "Lookup action."
contextSchema = "./tool_input.zod.ts"
responseSchema = "./tool_output.zod.ts"

[[tools]]
name = "lookup"
description = "Shadowed external lookup."
inputSchema = "./tool_input.zod.ts"

[[tools]]
name = "external_only"
description = "External-only tool."
inputSchema = "./tool_input.zod.ts"
+++
Root deck.
`,
  );
  return { dir, rootDeckPath: path.join(dir, "PROMPT.md") };
}

Deno.test("mcp server errors tools/list when root deck env is missing", async () => {
  const previous = Deno.env.get("GAMBIT_MCP_ROOT_DECK_PATH");
  Deno.env.delete("GAMBIT_MCP_ROOT_DECK_PATH");
  try {
    const result = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const error = (result as {
      error?: { message?: string; data?: { message?: string } };
    }).error;
    assertEquals(error?.message, "MCP tool catalog unavailable");
    assertEquals(
      (error?.data?.message ?? "").includes("GAMBIT_MCP_ROOT_DECK_PATH"),
      true,
    );
  } finally {
    if (previous === undefined) {
      Deno.env.delete("GAMBIT_MCP_ROOT_DECK_PATH");
    } else {
      Deno.env.set("GAMBIT_MCP_ROOT_DECK_PATH", previous);
    }
  }
});

Deno.test("mcp server derives tool surface from configured root deck", async () => {
  const { dir, rootDeckPath } = await createRootDeckFixture();
  const previous = Deno.env.get("GAMBIT_MCP_ROOT_DECK_PATH");
  try {
    Deno.env.set("GAMBIT_MCP_ROOT_DECK_PATH", rootDeckPath);
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const payload = (response as {
      result?: {
        tools?: Array<{ name: string }>;
      };
    }).result;
    const names = (payload?.tools ?? []).map((tool) => tool.name).sort();
    assertEquals(names, ["external_only", "lookup"]);
  } finally {
    if (previous === undefined) {
      Deno.env.delete("GAMBIT_MCP_ROOT_DECK_PATH");
    } else {
      Deno.env.set("GAMBIT_MCP_ROOT_DECK_PATH", previous);
    }
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("mcp server executes action tool from configured root deck", async () => {
  const { dir, rootDeckPath } = await createRootDeckFixture();
  const previous = Deno.env.get("GAMBIT_MCP_ROOT_DECK_PATH");
  try {
    Deno.env.set("GAMBIT_MCP_ROOT_DECK_PATH", rootDeckPath);
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "lookup",
        arguments: { query: "hello" },
      },
    });
    const result = (response as {
      result?: {
        isError?: boolean;
        content?: Array<{ text?: string }>;
      };
    }).result;
    assertEquals(result?.isError, false);
    const text = result?.content?.[0]?.text ?? "";
    assertEquals(text.includes('"status": 200'), true);
    assertEquals(text.includes('"query": "hello"'), true);
  } finally {
    if (previous === undefined) {
      Deno.env.delete("GAMBIT_MCP_ROOT_DECK_PATH");
    } else {
      Deno.env.set("GAMBIT_MCP_ROOT_DECK_PATH", previous);
    }
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("mcp server returns explicit error when calling external-only tool", async () => {
  const { dir, rootDeckPath } = await createRootDeckFixture();
  const previous = Deno.env.get("GAMBIT_MCP_ROOT_DECK_PATH");
  try {
    Deno.env.set("GAMBIT_MCP_ROOT_DECK_PATH", rootDeckPath);
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "external_only",
        arguments: { query: "hello" },
      },
    });
    const result = (response as {
      result?: {
        isError?: boolean;
        content?: Array<{ text?: string }>;
      };
    }).result;
    assertEquals(result?.isError, true);
    const text = result?.content?.[0]?.text ?? "";
    assertEquals(text.includes("unsupported_external_tool"), true);
  } finally {
    if (previous === undefined) {
      Deno.env.delete("GAMBIT_MCP_ROOT_DECK_PATH");
    } else {
      Deno.env.set("GAMBIT_MCP_ROOT_DECK_PATH", previous);
    }
    await Deno.remove(dir, { recursive: true });
  }
});
