import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import { TextLineStream } from "@std/streams/text-line-stream";
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
    `import { z } from "npm:zod";
export default {
  kind: "gambit.deck",
  contextSchema: z.object({ query: z.string().optional() }),
  responseSchema: z.object({
    status: z.number(),
    payload: z.object({ query: z.string().nullable() }),
  }),
  run: (ctx) => ({
    status: 200,
    payload: { query: typeof ctx.input.query === "string" ? ctx.input.query : null },
  }),
};
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

const leakTolerantTest = (name: string, fn: () => Promise<void> | void) =>
  Deno.test({
    name,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: () => withMcpEnvLock(async () => await fn()),
  });

let mcpEnvLock: Promise<void> = Promise.resolve();
async function withMcpEnvLock<T>(fn: () => Promise<T>): Promise<T> {
  const prior = mcpEnvLock;
  let release = () => {};
  mcpEnvLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prior;
  try {
    return await fn();
  } finally {
    release();
  }
}

leakTolerantTest(
  "mcp server negotiates initialize protocol version",
  async () => {
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
      },
    });
    const result = (response as {
      result?: {
        protocolVersion?: string;
      };
    }).result;
    assertEquals(result?.protocolVersion, "2025-06-18");
  },
);

leakTolerantTest(
  "mcp server errors tools/list when root deck env is missing",
  async () => {
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
  },
);

leakTolerantTest(
  "mcp server writes debug tool catalog log when enabled",
  async () => {
    const fixture = await createRootDeckFixture();
    const logPath = path.join(fixture.dir, "gambit-mcp-debug.log");
    const previousRootDeck = Deno.env.get("GAMBIT_MCP_ROOT_DECK_PATH");
    const previousDebug = Deno.env.get(
      "WORKLOOP_CHIEF_RUNTIME_DEBUG_MCP",
    );
    const previousLogPath = Deno.env.get("GAMBIT_MCP_DEBUG_LOG_PATH");
    Deno.env.set("GAMBIT_MCP_ROOT_DECK_PATH", fixture.rootDeckPath);
    Deno.env.set("WORKLOOP_CHIEF_RUNTIME_DEBUG_MCP", "1");
    Deno.env.set("GAMBIT_MCP_DEBUG_LOG_PATH", logPath);
    try {
      const response = await handleMcpRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });
      const result =
        (response as { result?: { tools?: Array<{ name: string }> } })
          .result;
      assert(result);
      assertEquals(
        result?.tools?.map((tool) => tool.name),
        ["lookup", "external_only"],
      );
      const logText = await Deno.readTextFile(logPath);
      assert(logText.includes('"event":"tools/list"'));
      assert(logText.includes('"lookup"'));
      assert(logText.includes('"external_only"'));
    } finally {
      if (previousRootDeck === undefined) {
        Deno.env.delete("GAMBIT_MCP_ROOT_DECK_PATH");
      } else {
        Deno.env.set("GAMBIT_MCP_ROOT_DECK_PATH", previousRootDeck);
      }
      if (previousDebug === undefined) {
        Deno.env.delete("WORKLOOP_CHIEF_RUNTIME_DEBUG_MCP");
      } else {
        Deno.env.set(
          "WORKLOOP_CHIEF_RUNTIME_DEBUG_MCP",
          previousDebug,
        );
      }
      if (previousLogPath === undefined) {
        Deno.env.delete("GAMBIT_MCP_DEBUG_LOG_PATH");
      } else {
        Deno.env.set("GAMBIT_MCP_DEBUG_LOG_PATH", previousLogPath);
      }
      await Deno.remove(fixture.dir, { recursive: true }).catch(() => {});
    }
  },
);

leakTolerantTest(
  "mcp server derives tool surface from configured root deck",
  async () => {
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
          tools?: Array<{
            name: string;
            inputSchema?: {
              type?: string;
              properties?: Record<string, { type?: string }>;
            };
          }>;
        };
      }).result;
      const names = (payload?.tools ?? []).map((tool) => tool.name).sort();
      assertEquals(names, ["external_only", "lookup"]);
      const lookup = (payload?.tools ?? []).find((tool) =>
        tool.name === "lookup"
      );
      assert(lookup);
      assert(lookup.inputSchema);
      assertEquals(lookup.inputSchema.type, "object");
      assertEquals(lookup.inputSchema.properties?.query?.type, "string");
    } finally {
      if (previous === undefined) {
        Deno.env.delete("GAMBIT_MCP_ROOT_DECK_PATH");
      } else {
        Deno.env.set("GAMBIT_MCP_ROOT_DECK_PATH", previous);
      }
      await Deno.remove(dir, { recursive: true });
    }
  },
);

leakTolerantTest(
  "mcp server executes action tool from configured root deck",
  async () => {
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
  },
);

leakTolerantTest(
  "mcp server returns explicit error when calling external-only tool",
  async () => {
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
  },
);

leakTolerantTest(
  "mcp server forwards external-only tool through configured bridge",
  async () => {
    const { dir, rootDeckPath } = await createRootDeckFixture();
    const socketDir = await Deno.makeTempDir();
    const socketPath = path.join(socketDir, "external-tool.sock");
    const listener = Deno.listen({ transport: "unix", path: socketPath });
    let closed = false;
    const acceptLoop = (async () => {
      while (!closed) {
        let conn: Deno.Conn | null = null;
        try {
          conn = await listener.accept();
          const reader = conn.readable
            .pipeThrough(new TextDecoderStream())
            .pipeThrough(new TextLineStream())
            .getReader();
          const { value } = await reader.read();
          reader.releaseLock();
          const request = JSON.parse(value ?? "{}") as {
            args?: { query?: string };
            name?: string;
          };
          const writer = conn.writable.getWriter();
          await writer.write(
            new TextEncoder().encode(
              `${
                JSON.stringify({
                  isError: false,
                  text: JSON.stringify({
                    status: 200,
                    payload: {
                      name: request.name,
                      query: request.args?.query ?? null,
                    },
                  }),
                })
              }\n`,
            ),
          );
          await writer.close();
        } catch {
          if (!closed) throw new Error("external tool bridge failed");
        } finally {
          try {
            conn?.close();
          } catch {
            // ignore close failure
          }
        }
      }
    })();
    const previousRootDeck = Deno.env.get("GAMBIT_MCP_ROOT_DECK_PATH");
    const previousBridge = Deno.env.get("GAMBIT_EXTERNAL_TOOL_BRIDGE");
    try {
      Deno.env.set("GAMBIT_MCP_ROOT_DECK_PATH", rootDeckPath);
      Deno.env.set("GAMBIT_EXTERNAL_TOOL_BRIDGE", socketPath);
      const response = await handleMcpRequest({
        jsonrpc: "2.0",
        id: 5,
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
      assertEquals(result?.isError, false);
      const text = result?.content?.[0]?.text ?? "";
      assertEquals(text.includes('"status":200'), true);
      assertEquals(text.includes('"name":"external_only"'), true);
      assertEquals(text.includes('"query":"hello"'), true);
    } finally {
      if (previousRootDeck === undefined) {
        Deno.env.delete("GAMBIT_MCP_ROOT_DECK_PATH");
      } else {
        Deno.env.set("GAMBIT_MCP_ROOT_DECK_PATH", previousRootDeck);
      }
      if (previousBridge === undefined) {
        Deno.env.delete("GAMBIT_EXTERNAL_TOOL_BRIDGE");
      } else {
        Deno.env.set("GAMBIT_EXTERNAL_TOOL_BRIDGE", previousBridge);
      }
      closed = true;
      listener.close();
      await acceptLoop.catch(() => undefined);
      await Deno.remove(dir, { recursive: true });
      await Deno.remove(socketDir, { recursive: true });
    }
  },
);
