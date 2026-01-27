import { assert } from "@std/assert";
import { createOllamaProvider } from "./ollama.ts";
import { getEnvValue, shouldRunLiveTests } from "./live_test_utils.ts";

const baseURL = getEnvValue("OLLAMA_BASE_URL") ?? "http://localhost:11434/v1";
const model = getEnvValue("GAMBIT_LIVE_OLLAMA_MODEL") ?? "ollama/llama3";

Deno.test({
  name: "ollama live chat",
  ignore: !shouldRunLiveTests(),
  async fn() {
    const provider = createOllamaProvider({ baseURL });
    const resolvedModel = model.startsWith("ollama/")
      ? model.slice("ollama/".length)
      : model;
    const result = await provider.chat({
      model: resolvedModel,
      messages: [{ role: "user", content: "ping" }],
    });
    assert(result.message.content && result.message.content.length > 0);
  },
});
