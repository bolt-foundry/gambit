import { load as loadDotenv } from "@std/dotenv";
import * as path from "@std/path";
import { startTui } from "../tui.ts";
import { loadDeck } from "@bolt-foundry/gambit-core";
import {
  createOllamaProvider,
  fetchOllamaTags,
  OLLAMA_PREFIX,
} from "../providers/ollama.ts";
import { createOpenRouterProvider } from "../providers/openrouter.ts";
import { ensureDirectory, ensureOpenRouterEnv } from "./scaffold_utils.ts";

const logger = console;

const DEFAULT_PROJECT_DIR = "gambit";
const INIT_ROOT_ENV = "GAMBIT_INIT_ROOT";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

type InitOptions = {
  interactive?: boolean;
};

export async function handleInitCommand(
  targetPath?: string,
  opts: InitOptions = {},
) {
  const normalizedTarget = targetPath?.trim();
  const projectPath = normalizedTarget && normalizedTarget.length > 0
    ? normalizedTarget
    : DEFAULT_PROJECT_DIR;
  const rootDir = path.resolve(Deno.cwd(), projectPath);
  await ensureDirectory(rootDir);

  const rootDeckPath = path.join(rootDir, "root.deck.md");
  const testDeckPath = path.join(rootDir, "tests", "first.test.deck.md");
  if (await exists(rootDeckPath) || await exists(testDeckPath)) {
    logger.error(
      "Init output files already exist. Remove them or choose a new target.",
    );
    Deno.exit(1);
  }

  const envPath = path.join(rootDir, ".env");
  const initDeckPath = resolveInitDeckPath();
  const initDeck = await loadDeck(initDeckPath);
  const initModel = initDeck.modelParams?.model;
  const ollamaBaseURL = Deno.env.get("OLLAMA_BASE_URL") ?? undefined;
  const openRouterBaseURL = Deno.env.get("OPENROUTER_BASE_URL") ??
    DEFAULT_OPENROUTER_BASE_URL;
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  const ollamaCandidates = extractOllamaCandidates(initModel);
  let ollamaReady = false;
  if (ollamaCandidates.length > 0) {
    try {
      const tags = await fetchOllamaTags(ollamaBaseURL);
      ollamaReady = ollamaCandidates.some((candidate) => tags.has(candidate));
    } catch {
      ollamaReady = false;
    }
  }
  if (!openRouterApiKey && !ollamaReady) {
    await ensureOpenRouterEnv(envPath);
    if (!Deno.env.get("OPENROUTER_API_KEY")) {
      try {
        await loadDotenv({ envPath, export: true });
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          throw err;
        }
      }
    }
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!apiKey && !ollamaReady) {
    logger.error(
      "OPENROUTER_API_KEY is required to run gambit init unless an Ollama model is available.",
    );
    Deno.exit(1);
  }

  Deno.env.set(INIT_ROOT_ENV, rootDir);

  if (opts.interactive === false) {
    return;
  }

  if (!Deno.stdin.isTerminal()) {
    logger.error("gambit init requires an interactive TTY.");
    Deno.exit(1);
  }

  const chatFallback = Deno.env.get("GAMBIT_CHAT_FALLBACK") === "1";
  const responsesMode = !chatFallback &&
    Deno.env.get("GAMBIT_RESPONSES_MODE") !== "0";
  const openRouterProvider = apiKey
    ? createOpenRouterProvider({
      apiKey,
      baseURL: openRouterBaseURL ?? undefined,
      enableResponses: !chatFallback &&
        Deno.env.get("GAMBIT_OPENROUTER_RESPONSES") !== "0",
    })
    : null;
  const ollamaProvider = createOllamaProvider({
    apiKey: Deno.env.get("OLLAMA_API_KEY")?.trim() || undefined,
    baseURL: ollamaBaseURL,
  });
  const provider = buildInitProvider({
    openRouterApiKey: apiKey,
    openRouterProvider,
    ollamaProvider,
    ollamaBaseURL,
  });

  let initialSystemMessage: string | undefined;
  if (Array.isArray(initModel) && typeof provider.resolveModel === "function") {
    try {
      const resolved = await provider.resolveModel({ model: initModel });
      const primary = initModel[0];
      if (resolved.model && primary && resolved.model !== primary) {
        initialSystemMessage =
          `Using model ${resolved.model} (fallback from ${primary}).`;
      }
    } catch {
      // Ignore resolution failures; runtime will surface if needed.
    }
  }

  await startTui({
    deckPath: initDeckPath,
    model: undefined,
    modelForce: undefined,
    modelProvider: provider,
    responsesMode,
    initialSystemMessage,
  });
}

function resolveInitDeckPath(): string {
  const url = new URL("../decks/gambit-init.deck.md", import.meta.url);
  if (url.protocol !== "file:") {
    throw new Error("Unable to resolve init deck path.");
  }
  return path.fromFileUrl(url);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await Deno.stat(filePath);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

function extractOllamaCandidates(
  model: string | Array<string> | undefined,
): Array<string> {
  if (!model) return [];
  const entries = Array.isArray(model) ? model : [model];
  return entries
    .filter((entry): entry is string =>
      typeof entry === "string" && entry.startsWith(OLLAMA_PREFIX)
    )
    .map((entry) => entry.slice(OLLAMA_PREFIX.length))
    .filter((entry) => entry.trim().length > 0);
}

function buildInitProvider(opts: {
  openRouterApiKey?: string;
  openRouterProvider: ReturnType<typeof createOpenRouterProvider> | null;
  ollamaProvider: ReturnType<typeof createOllamaProvider>;
  ollamaBaseURL?: string;
}): import("@bolt-foundry/gambit-core").ModelProvider {
  const openRouterProvider = opts.openRouterProvider;
  const openRouterResponses = openRouterProvider?.responses;
  const resolveModelChoice = async (
    model: string | Array<string>,
  ): Promise<string> => {
    const entries = Array.isArray(model) ? model : [model];
    for (const entry of entries) {
      if (typeof entry !== "string" || !entry.trim()) continue;
      if (entry.startsWith(OLLAMA_PREFIX)) {
        const modelName = entry.slice(OLLAMA_PREFIX.length);
        if (modelName) {
          try {
            const tags = await fetchOllamaTags(opts.ollamaBaseURL);
            if (tags.has(modelName)) {
              return entry;
            }
          } catch {
            // ignore and try next candidate
          }
        }
        continue;
      }
      if (!entry.startsWith(OLLAMA_PREFIX)) {
        if (opts.openRouterApiKey) return entry;
      }
    }
    throw new Error(
      "No available model found for gambit init. Ensure Ollama is running or set OPENROUTER_API_KEY.",
    );
  };

  return {
    resolveModel: async ({ model, params }) => {
      if (Array.isArray(model)) {
        const resolved = await resolveModelChoice(model);
        return { model: resolved, params };
      }
      return { model: await resolveModelChoice(model), params };
    },
    responses: openRouterResponses
      ? async (input) => {
        const resolved = await resolveModelChoice(input.request.model);
        if (resolved.startsWith(OLLAMA_PREFIX)) {
          const modelName = resolved.slice(OLLAMA_PREFIX.length);
          const responses = opts.ollamaProvider.responses;
          if (!responses) {
            throw new Error("Ollama responses are not configured.");
          }
          return await responses({
            ...input,
            request: { ...input.request, model: modelName },
          });
        }
        return await openRouterResponses({
          ...input,
          request: { ...input.request, model: resolved },
        });
      }
      : undefined,
    chat: async (input) => {
      const resolved = await resolveModelChoice(input.model);
      if (resolved.startsWith(OLLAMA_PREFIX)) {
        const modelName = resolved.slice(OLLAMA_PREFIX.length);
        return await opts.ollamaProvider.chat({ ...input, model: modelName });
      }
      if (!openRouterProvider) {
        throw new Error(
          "OPENROUTER_API_KEY is required to run gambit init without Ollama.",
        );
      }
      return await openRouterProvider.chat({
        ...input,
        model: resolved,
      });
    },
  };
}
