import { assertEquals } from "@std/assert";
import {
  createGeminiProvider,
  toGambitToolCalls,
  toGoogleContent,
} from "./gemini.ts";
import type { ModelMessage } from "../types.ts";

Deno.test("toGoogleContent maps messages correctly", () => {
  const gambitMessages: ModelMessage[] = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello there." },
    {
      role: "assistant",
      content: "I will call a tool.",
      tool_calls: [{
        id: "call1",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"SF"}' },
      }],
    },
    {
      role: "tool",
      tool_call_id: "call1",
      name: "get_weather",
      content: "75 degrees",
    },
  ];

  const googleContent = toGoogleContent(gambitMessages);

  // System message should be ignored
  assertEquals(googleContent.length, 3);

  // User message
  assertEquals(googleContent[0].role, "user");
  assertEquals(googleContent[0].parts, [{ text: "Hello there." }]);

  // Assistant message with tool call
  assertEquals(googleContent[1].role, "model");
  assertEquals(googleContent[1].parts[0], { text: "I will call a tool." });
  assertEquals(googleContent[1].parts[1], {
    functionCall: { name: "get_weather", args: { city: "SF" } },
  });

  // Tool response message
  assertEquals(googleContent[2].role, "function");
  assertEquals(googleContent[2].parts[0], {
    functionResponse: {
      name: "get_weather",
      response: { name: "get_weather", content: "75 degrees" },
    },
  });
});

Deno.test("toGambitToolCalls maps tool calls correctly", () => {
  const googleResponse = {
    response: {
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "search_web",
              args: { query: "Deno" },
            },
          }],
        },
      }],
    },
  };

  const gambitToolCalls = toGambitToolCalls(googleResponse);
  assertEquals(gambitToolCalls?.length, 1);
  assertEquals(gambitToolCalls?.[0].type, "function");
  assertEquals(gambitToolCalls?.[0].function.name, "search_web");
  assertEquals(gambitToolCalls?.[0].function.arguments, '{"query":"Deno"}');
});

Deno.test("createGeminiProvider uses mock client", async () => {
  let sawModel = "";
  const mockChatSession = {
    sendMessage: () => {
      return Promise.resolve({
        response: {
          text: () => "mock response",
          candidates: [{
            content: { parts: [{ text: "mock response" }] },
          }],
        },
      });
    },
  };

  const mockModel = {
    startChat: () => mockChatSession,
  };

  const mockClient = {
    getGenerativeModel: (params: { model: string }) => {
      sawModel = params.model;
      return mockModel;
    },
  };

  const provider = createGeminiProvider({
    apiKey: "test-key",
    client: mockClient as any,
  });

  const result = await provider.chat({
    model: "gemini-pro",
    messages: [{ role: "user", content: "test" }],
  });

  assertEquals(sawModel, "gemini-pro");
  assertEquals(result.message.content, "mock response");
});
