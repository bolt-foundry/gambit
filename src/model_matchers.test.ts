import { assertEquals } from "@std/assert";
import { createProviderMatchers } from "./model_matchers.ts";

const UNPREFIXED = "llama3";
const OPENROUTER = "openrouter/anthropic/claude-3-haiku";
const OLLAMA = "ollama/llama3";
const GOOGLE = "google/gemini-1.5-pro";

Deno.test("provider matchers respect fallback for unprefixed models", () => {
  const ollama = createProviderMatchers("ollama");
  assertEquals(ollama.matchesOllama(UNPREFIXED), true);
  assertEquals(ollama.matchesOpenRouter(UNPREFIXED), false);
  assertEquals(ollama.matchesGoogle(UNPREFIXED), false);

  const google = createProviderMatchers("google");
  assertEquals(google.matchesGoogle(UNPREFIXED), true);
  assertEquals(google.matchesOpenRouter(UNPREFIXED), false);
  assertEquals(google.matchesOllama(UNPREFIXED), false);

  const openrouter = createProviderMatchers("openrouter");
  assertEquals(openrouter.matchesOpenRouter(UNPREFIXED), true);
  assertEquals(openrouter.matchesOllama(UNPREFIXED), false);
  assertEquals(openrouter.matchesGoogle(UNPREFIXED), false);
});

Deno.test("provider matchers always honor explicit prefixes", () => {
  const matcher = createProviderMatchers("ollama");
  assertEquals(matcher.matchesOpenRouter(OPENROUTER), true);
  assertEquals(matcher.matchesOllama(OLLAMA), true);
  assertEquals(matcher.matchesGoogle(GOOGLE), true);
});

Deno.test("provider matchers do not claim unprefixed models when fallback is null", () => {
  const matcher = createProviderMatchers(null);
  assertEquals(matcher.matchesOpenRouter(UNPREFIXED), false);
  assertEquals(matcher.matchesOllama(UNPREFIXED), false);
  assertEquals(matcher.matchesGoogle(UNPREFIXED), false);
});
