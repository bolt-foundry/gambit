import { assertEquals } from "@std/assert";
import type { ModelProvider } from "../types.ts";
import { createDispatchingProvider } from "./dispatcher.ts";

Deno.test("dispatching provider routes to the correct provider based on prefix", async () => {
  let googleProviderCalled = false;
  const googleProvider: ModelProvider = {
    chat(input) {
      googleProviderCalled = true;
      assertEquals(input.model, "gemini-1.5-flash");
      return Promise.resolve({
        message: { role: "assistant", content: "from google" },
        finishReason: "stop",
      });
    },
  };

  let openRouterProviderCalled = false;
  const openRouterProvider: ModelProvider = {
    chat(input) {
      openRouterProviderCalled = true;
      assertEquals(input.model, "gpt-4");
      return Promise.resolve({
        message: { role: "assistant", content: "from openrouter" },
        finishReason: "stop",
      });
    },
  };

  const dispatcher = createDispatchingProvider({
    providers: [
      { prefix: "google/", provider: googleProvider },
    ],
    defaultProvider: openRouterProvider,
  });

  // Test routing to the google provider
  const googleResult = await dispatcher.chat({
    model: "google/gemini-1.5-flash",
    messages: [],
  });
  assertEquals(googleProviderCalled, true);
  assertEquals(openRouterProviderCalled, false);
  assertEquals(googleResult.message.content, "from google");

  // Reset flags
  googleProviderCalled = false;
  openRouterProviderCalled = false;

  // Test routing to the default provider
  const openRouterResult = await dispatcher.chat({
    model: "gpt-4",
    messages: [],
  });
  assertEquals(googleProviderCalled, false);
  assertEquals(openRouterProviderCalled, true);
  assertEquals(openRouterResult.message.content, "from openrouter");
});
