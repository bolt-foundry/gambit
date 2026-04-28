import { assert, assertEquals, assertRejects } from "@std/assert";
import * as path from "@std/path";
import { chatCompletionsWithDeck } from "../mod.ts";
import { logger as openaiLogger } from "./openai_compat.ts";
import type {
  ModelProvider,
  ResponseItem,
  ToolDefinition,
} from "@bolt-foundry/gambit-core";

function modImportPath() {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const modPath = path.resolve(here, "..", "mod.ts");
  return path.toFileUrl(modPath).href;
}

function coreModImportPath() {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const modPath = path.resolve(
    here,
    "..",
    "packages",
    "gambit-core",
    "mod.ts",
  );
  return path.toFileUrl(modPath).href;
}

async function writeTempDeck(dir: string, filename: string, contents: string) {
  const target = path.join(dir, filename);
  await Deno.writeTextFile(target, contents);
  return target;
}

function modelResponse(output: Array<ResponseItem>) {
  return Promise.resolve({
    id: "test-response",
    object: "response" as const,
    status: "completed" as const,
    output,
  });
}

function assistantText(text: string): ResponseItem {
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

Deno.test("chatCompletionsWithDeck returns an OpenAI-shaped response", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "root.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      label: "root",
      modelParams: { model: "ignored" },
      body: "You are concise.",
    });
    `,
  );

  let sawSystem = false;
  const provider: ModelProvider = {
    responses(input) {
      sawSystem = input.request.input.some((item) =>
        item.type === "message" && item.role === "system" &&
        item.content.some((part) => part.text.includes("You are concise."))
      );
      return modelResponse([assistantText("ok")]);
    },
  };

  const resp = await chatCompletionsWithDeck({
    deckPath,
    request: {
      model: "test-model",
      messages: [{ role: "user", content: "hi" }],
    },
    modelProvider: provider,
  });

  assertEquals(resp.object, "chat.completion");
  assertEquals(resp.choices[0].message.role, "assistant");
  assertEquals(resp.choices[0].message.content, "ok");
  assertEquals(resp.choices[0].finish_reason, "stop");
  assertEquals(sawSystem, true);
  assert(resp.gambit?.messages?.length);
});

Deno.test("chatCompletionsWithDeck warns on mismatched system message and still applies deck system", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "root.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      label: "root",
      modelParams: { model: "ignored" },
      body: "Deck system prompt.",
    });
    `,
  );

  let warned = false;
  const origWarn = openaiLogger.warn;
  openaiLogger.warn = () => {
    warned = true;
  };
  try {
    let sawDeckSystem = false;
    const provider: ModelProvider = {
      responses(input) {
        const systemMessages = input.request.input.filter((item) =>
          item.type === "message" && item.role === "system"
        );
        sawDeckSystem = systemMessages.some((item) =>
          item.type === "message" &&
          item.content.some((part) => part.text === "Deck system prompt.")
        );
        return modelResponse([assistantText("ok")]);
      },
    };

    await chatCompletionsWithDeck({
      deckPath,
      request: {
        model: "test-model",
        messages: [
          { role: "system", content: "User system prompt." },
          { role: "user", content: "hi" },
        ],
      },
      modelProvider: provider,
    });

    assertEquals(warned, true);
    assertEquals(sawDeckSystem, true);
  } finally {
    openaiLogger.warn = origWarn;
  }
});

Deno.test("chatCompletionsWithDeck executes deck tool calls and continues", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const childPath = await writeTempDeck(
    dir,
    "child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      label: "child",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.string(),
      run(ctx) {
        return "child:" + ctx.input.text;
      }
    });
    `,
  );

  const parentPath = await writeTempDeck(
    dir,
    "parent.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      label: "parent",
      modelParams: { model: "ignored" },
      body: "Call the child tool once, then respond.",
      actionDecks: [{ name: "child", path: "${childPath}" }],
    });
    `,
  );

  let callCount = 0;
  let secondCallSawToolResult = false;
  let secondCallSawFunctionCall = false;
  const provider: ModelProvider = {
    responses(input) {
      callCount++;
      if (callCount === 1) {
        return modelResponse([{
          type: "function_call",
          call_id: "call-1",
          name: "child",
          arguments: '{"text":"hi"}',
        }]);
      }
      secondCallSawFunctionCall = input.request.input.some((item) =>
        item.type === "function_call" && item.call_id === "call-1" &&
        item.name === "child" && item.arguments === '{"text":"hi"}'
      );
      secondCallSawToolResult = input.request.input.some((item) =>
        item.type === "function_call_output" &&
        item.call_id === "call-1" &&
        item.output === "child:hi"
      );
      return modelResponse([assistantText("done")]);
    },
  };

  const resp = await chatCompletionsWithDeck({
    deckPath: parentPath,
    request: {
      model: "test-model",
      messages: [{ role: "user", content: "go" }],
    },
    modelProvider: provider,
  });

  assertEquals(callCount, 2);
  assertEquals(secondCallSawFunctionCall, true);
  assertEquals(secondCallSawToolResult, true);
  assertEquals(resp.choices[0].message.content, "done");
  assertEquals(resp.choices[0].finish_reason, "stop");
});

Deno.test("chatCompletionsWithDeck returns external tool calls without executing", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const deckPath = await writeTempDeck(
    dir,
    "root.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      label: "root",
      modelParams: { model: "ignored" },
      body: "You may call tools.",
    });
    `,
  );

  const externalTool: ToolDefinition = {
    type: "function",
    function: {
      name: "external_tool",
      description: "External",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
    },
  };

  let calls = 0;
  const provider: ModelProvider = {
    responses() {
      calls++;
      return modelResponse([{
        type: "function_call",
        call_id: "ext-1",
        name: "external_tool",
        arguments: '{"x":1}',
      }]);
    },
  };

  const resp = await chatCompletionsWithDeck({
    deckPath,
    request: {
      model: "test-model",
      messages: [{ role: "user", content: "hi" }],
      tools: [externalTool],
    },
    modelProvider: provider,
  });

  assertEquals(calls, 1);
  assertEquals(resp.choices[0].finish_reason, "tool_calls");
  assertEquals(
    resp.choices[0].message.tool_calls?.[0]?.function.name,
    "external_tool",
  );
});

Deno.test("chatCompletionsWithDeck rejects tool name collisions", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = modImportPath();

  const childPath = await writeTempDeck(
    dir,
    "child.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      run() { return "ok"; }
    });
    `,
  );

  const deckPath = await writeTempDeck(
    dir,
    "root.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      label: "root",
      modelParams: { model: "ignored" },
      actionDecks: [{ name: "dup", path: "${childPath}" }],
    });
    `,
  );

  const provider: ModelProvider = {
    responses() {
      throw new Error("should not be called");
    },
  };

  await assertRejects(
    () =>
      chatCompletionsWithDeck({
        deckPath,
        request: {
          model: "test-model",
          messages: [{ role: "user", content: "hi" }],
          tools: [{
            type: "function",
            function: {
              name: "dup",
              parameters: { type: "object", properties: {} },
            },
          }],
        },
        modelProvider: provider,
      }),
    Error,
    "collision",
  );
});

Deno.test("chatCompletionsWithDeck action calls inherit root permission denials", async () => {
  const dir = await Deno.makeTempDir();
  const modHref = coreModImportPath();
  const deniedPath = path.join(dir, "blocked.txt");

  const childPath = await writeTempDeck(
    dir,
    "child-write.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    import { z } from "zod";
    export default defineDeck({
      inputSchema: z.object({}),
      outputSchema: z.string(),
      run: async () => {
        await Deno.writeTextFile(${JSON.stringify(deniedPath)}, "blocked");
        return "ok";
      }
    });
    `,
  );

  const parentPath = await writeTempDeck(
    dir,
    "parent.deck.ts",
    `
    import { defineDeck } from "${modHref}";
    export default defineDeck({
      label: "parent",
      modelParams: { model: "ignored" },
      actionDecks: [{ name: "child", path: "${childPath}" }],
    });
    `,
  );

  let pass = 0;
  let toolPayload = "";
  const provider: ModelProvider = {
    responses(input) {
      pass++;
      if (pass === 1) {
        return modelResponse([{
          type: "function_call",
          call_id: "call-1",
          name: "child",
          arguments: "{}",
        }]);
      }
      const outputItem = input.request.input.find((item) =>
        item.type === "function_call_output" && item.call_id === "call-1"
      );
      toolPayload = outputItem?.type === "function_call_output"
        ? outputItem.output
        : "";
      return modelResponse([assistantText("done")]);
    },
  };

  const response = await chatCompletionsWithDeck({
    deckPath: parentPath,
    request: {
      model: "test-model",
      messages: [{ role: "user", content: "go" }],
    },
    modelProvider: provider,
    workerSandbox: true,
    workspacePermissions: {
      read: true,
      write: false,
      run: false,
      net: false,
      env: false,
    },
    workspacePermissionsBaseDir: dir,
  });

  assertEquals(response.choices[0].message.content, "done");
  assert(toolPayload.includes('"error"'));
  assert(toolPayload.includes("allow-write"));
});
