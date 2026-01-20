import { assert, assertEquals, assertRejects } from "@std/assert";
import * as path from "@std/path";
import { chatCompletionsWithDeck } from "../mod.ts";
import { logger as openaiLogger } from "./openai_compat.ts";
import {
  messagesFromOpenResponseOutput,
  openResponseItemFromMessage,
} from "./openresponses.ts";
import type {
  JSONValue,
  ModelMessage,
  ModelProvider,
  OpenResponseInput,
  OpenResponseItem,
  ToolDefinition,
} from "./types.ts";

function modImportPath() {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const modPath = path.resolve(here, "..", "mod.ts");
  return path.toFileUrl(modPath).href;
}

async function writeTempDeck(dir: string, filename: string, contents: string) {
  const target = path.join(dir, filename);
  await Deno.writeTextFile(target, contents);
  return target;
}

type ChatHandlerInput = {
  model: string;
  messages: Array<ModelMessage>;
  tools?: Array<ToolDefinition>;
  stream?: boolean;
  onStreamText?: (chunk: string) => void;
  params?: Record<string, unknown>;
};

type ChatHandlerResult = {
  message: ModelMessage;
  finishReason: "stop" | "tool_calls" | "length";
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, JSONValue>;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

function normalizeResponseInput(
  input: OpenResponseInput,
): Array<OpenResponseItem> {
  if (typeof input === "string") {
    return [{ type: "message", role: "user", content: input }];
  }
  return input ?? [];
}

function createChatLikeProvider(
  handler: (
    input: ChatHandlerInput,
  ) => ChatHandlerResult | Promise<ChatHandlerResult>,
): ModelProvider {
  return {
    responses: async (input) => {
      const result = await handler({
        model: input.model,
        messages: messagesFromOpenResponseOutput(
          normalizeResponseInput(input.input),
        ),
        tools: input.tools,
        stream: input.stream,
        onStreamText: input.onStreamEvent
          ? (chunk) =>
            input.onStreamEvent?.({
              type: "response.output_text.delta",
              delta: chunk,
            })
          : undefined,
        params: input.params,
      });
      return {
        id: "resp-test",
        output: [openResponseItemFromMessage(result.message)],
        finishReason: result.finishReason,
        usage: result.usage,
      };
    },
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
  const provider = createChatLikeProvider((input) => {
    sawSystem = input.messages.some((m) =>
      m.role === "system" && m.content?.includes("You are concise.")
    );
    return {
      message: { role: "assistant", content: "ok" },
      finishReason: "stop",
    };
  });

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
    const provider = createChatLikeProvider((input) => {
      const systemMessages = input.messages.filter((m) => m.role === "system");
      sawDeckSystem = systemMessages.some((m) =>
        m.content === "Deck system prompt."
      );
      return {
        message: { role: "assistant", content: "ok" },
        finishReason: "stop",
      };
    });

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
  const provider = createChatLikeProvider((input) => {
    callCount++;
    if (callCount === 1) {
      return {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: { name: "child", arguments: '{"text":"hi"}' },
          }],
        },
        finishReason: "tool_calls",
        toolCalls: [{ id: "call-1", name: "child", args: { text: "hi" } }],
      };
    }
    secondCallSawToolResult = input.messages.some((m) =>
      m.role === "tool" && m.name === "child" &&
      m.tool_call_id === "call-1" &&
      m.content === "child:hi"
    );
    return {
      message: { role: "assistant", content: "done" },
      finishReason: "stop",
    };
  });

  const resp = await chatCompletionsWithDeck({
    deckPath: parentPath,
    request: {
      model: "test-model",
      messages: [{ role: "user", content: "go" }],
    },
    modelProvider: provider,
  });

  assertEquals(callCount, 2);
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
  const provider = createChatLikeProvider(() => {
    calls++;
    return {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "ext-1",
          type: "function",
          function: { name: "external_tool", arguments: '{"x":1}' },
        }],
      },
      finishReason: "tool_calls",
      toolCalls: [{ id: "ext-1", name: "external_tool", args: { x: 1 } }],
    };
  });

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

  const provider = createChatLikeProvider(() => {
    throw new Error("should not be called");
  });

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
