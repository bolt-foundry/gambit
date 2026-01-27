import { assert } from "@std/assert";
import { createOpenRouterProvider } from "./openrouter.ts";
import { getEnvValue, shouldRunLiveTests } from "./live_test_utils.ts";

const apiKey = getEnvValue("OPENROUTER_API_KEY");
const model = getEnvValue("GAMBIT_LIVE_OPENROUTER_MODEL") ??
  "openrouter/openai/gpt-4o-mini";

Deno.test({
  name: "openrouter live chat",
  ignore: !shouldRunLiveTests() || !apiKey,
  async fn() {
    const provider = createOpenRouterProvider({ apiKey: apiKey! });
    const result = await provider.chat({
      model,
      messages: [{ role: "user", content: "ping" }],
    });
    assert(result.message.content && result.message.content.length > 0);
  },
});
