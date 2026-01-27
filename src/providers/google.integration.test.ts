import { assert } from "@std/assert";
import { createGoogleProvider } from "./google.ts";
import { getEnvValue, shouldRunLiveTests } from "./live_test_utils.ts";

const apiKey = getEnvValue("GOOGLE_API_KEY", "GEMINI_API_KEY");
const model = getEnvValue("GAMBIT_LIVE_GOOGLE_MODEL") ??
  "google/gemini-1.5-flash";

Deno.test({
  name: "google live chat",
  ignore: !shouldRunLiveTests() || !apiKey,
  async fn() {
    const provider = createGoogleProvider({ apiKey: apiKey! });
    const result = await provider.chat({
      model,
      messages: [{ role: "user", content: "ping" }],
    });
    assert(result.message.content && result.message.content.length > 0);
  },
});
