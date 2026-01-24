import * as path from "@std/path";
import { loadDeck } from "@bolt-foundry/gambit-core";
import type { ModelAliasResolver } from "../project_config.ts";

const logger = console;
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

type ModelProviderKey = "ollama" | "openrouter";

type ModelsListResponse = {
  data?: Array<{ id?: string }>;
};

type DeckModelInfo = {
  original: string;
  provider: ModelProviderKey;
  name: string;
};

type DeckRef = { path: string };

type LoadedCard = {
  actionDecks?: Array<DeckRef>;
  testDecks?: Array<DeckRef>;
  graderDecks?: Array<DeckRef>;
  cards?: Array<LoadedCard>;
};

type LoadedDeck = {
  path: string;
  modelParams?: { model?: string };
  handlers?: {
    onError?: DeckRef;
    onBusy?: DeckRef;
    onIdle?: DeckRef;
    onInterval?: DeckRef;
  };
  actionDecks?: Array<DeckRef>;
  testDecks?: Array<DeckRef>;
  graderDecks?: Array<DeckRef>;
  cards?: Array<LoadedCard>;
};

function resolveModelProvider(model: string): DeckModelInfo {
  if (model.startsWith("ollama/")) {
    return {
      original: model,
      provider: "ollama",
      name: model.slice("ollama/".length),
    };
  }
  if (model.startsWith("openrouter/")) {
    return {
      original: model,
      provider: "openrouter",
      name: model.slice("openrouter/".length),
    };
  }
  return {
    original: model,
    provider: "openrouter",
    name: model,
  };
}

function collectCardDeckRefs(card: LoadedCard): Array<string> {
  const refs: Array<string> = [];
  if (card.actionDecks?.length) {
    refs.push(...card.actionDecks.map((deck) => deck.path));
  }
  if (card.testDecks?.length) {
    refs.push(...card.testDecks.map((deck) => deck.path));
  }
  if (card.graderDecks?.length) {
    refs.push(...card.graderDecks.map((deck) => deck.path));
  }
  if (card.cards?.length) {
    for (const child of card.cards) {
      refs.push(...collectCardDeckRefs(child));
    }
  }
  return refs;
}

function collectDeckRefs(deck: LoadedDeck): Array<string> {
  const refs: Array<string> = [];
  if (deck.handlers) {
    if (deck.handlers.onError?.path) refs.push(deck.handlers.onError.path);
    if (deck.handlers.onBusy?.path) refs.push(deck.handlers.onBusy.path);
    if (deck.handlers.onIdle?.path) refs.push(deck.handlers.onIdle.path);
    if (deck.handlers.onInterval?.path) {
      refs.push(deck.handlers.onInterval.path);
    }
  }
  if (deck.actionDecks?.length) {
    refs.push(...deck.actionDecks.map((d) => d.path));
  }
  if (deck.testDecks?.length) {
    refs.push(...deck.testDecks.map((d) => d.path));
  }
  if (deck.graderDecks?.length) {
    refs.push(...deck.graderDecks.map((d) => d.path));
  }
  if (deck.cards?.length) {
    for (const card of deck.cards) {
      refs.push(...collectCardDeckRefs(card));
    }
  }
  return refs;
}

async function collectDeckModels(
  rootDeckPath: string,
  resolver?: ModelAliasResolver,
): Promise<{ models: Set<string>; missingAliases: Set<string> }> {
  const resolvedRoot = path.resolve(rootDeckPath);
  const seenDecks = new Set<string>();
  const models = new Set<string>();
  const missingAliases = new Set<string>();
  const queue: Array<string> = [resolvedRoot];

  while (queue.length > 0) {
    const deckPath = queue.shift();
    if (!deckPath) continue;
    if (seenDecks.has(deckPath)) continue;
    const deck = await loadDeck(deckPath);
    seenDecks.add(deck.path);
    if (deck.modelParams?.model) {
      const resolution = resolver
        ? resolver(deck.modelParams.model)
        : { model: deck.modelParams.model, applied: false };
      if (resolution.missingAlias && deck.modelParams.model) {
        missingAliases.add(deck.modelParams.model);
      }
      if (resolution.model) {
        models.add(resolution.model);
      }
    }
    const refs = collectDeckRefs(deck);
    for (const ref of refs) {
      if (!seenDecks.has(ref)) {
        queue.push(ref);
      }
    }
  }

  return { models, missingAliases };
}

async function fetchProviderModels(opts: {
  baseURL: string;
  apiKey?: string;
  provider: ModelProviderKey;
}): Promise<Set<string>> {
  const base = opts.baseURL.endsWith("/") ? opts.baseURL : `${opts.baseURL}/`;
  const modelsUrl = new URL("./models", base);
  const headers: HeadersInit = {};
  if (opts.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`;
  }
  const response = await fetch(modelsUrl, { headers });
  if (!response.ok) {
    if ((response.status === 401 || response.status === 403) && !opts.apiKey) {
      throw new Error(
        `Missing API key for ${opts.provider}; set ${
          opts.provider === "openrouter"
            ? "OPENROUTER_API_KEY"
            : "OLLAMA_API_KEY"
        }.`,
      );
    }
    throw new Error(
      `Failed to list ${opts.provider} models (${response.status} ${response.statusText}).`,
    );
  }
  const json = (await response.json()) as ModelsListResponse;
  const ids = new Set<string>();
  for (const entry of json.data ?? []) {
    if (!entry?.id) continue;
    ids.add(entry.id);
    if (opts.provider === "openrouter") {
      ids.add(`openrouter/${entry.id}`);
    }
    if (opts.provider === "ollama") {
      ids.add(`ollama/${entry.id}`);
    }
  }
  return ids;
}

export async function handleCheckCommand(opts: {
  deckPath: string;
  openRouterApiKey?: string;
  openRouterBaseURL?: string;
  ollamaApiKey?: string;
  ollamaBaseURL?: string;
  modelResolver?: ModelAliasResolver;
}) {
  const collected = await collectDeckModels(opts.deckPath, opts.modelResolver);
  if (collected.missingAliases.size > 0) {
    const missing = Array.from(collected.missingAliases).join(", ");
    throw new Error(
      `Unknown model aliases: ${missing}. Define them in gambit.toml or update the deck.`,
    );
  }
  if (collected.models.size === 0) {
    logger.log("No explicit models found in deck tree.");
    return;
  }

  const resolved = Array.from(collected.models, resolveModelProvider);
  const grouped = new Map<ModelProviderKey, Array<DeckModelInfo>>();
  for (const model of resolved) {
    const entry = grouped.get(model.provider) ?? [];
    entry.push(model);
    grouped.set(model.provider, entry);
  }

  const missingByProvider = new Map<ModelProviderKey, Array<string>>();
  for (const [provider, modelsList] of grouped.entries()) {
    const baseURL = provider === "openrouter"
      ? opts.openRouterBaseURL ?? DEFAULT_OPENROUTER_BASE_URL
      : opts.ollamaBaseURL ?? DEFAULT_OLLAMA_BASE_URL;
    const apiKey = provider === "openrouter"
      ? opts.openRouterApiKey
      : opts.ollamaApiKey;
    const available = await fetchProviderModels({
      baseURL,
      apiKey,
      provider,
    });
    for (const model of modelsList) {
      if (!available.has(model.name) && !available.has(model.original)) {
        const missing = missingByProvider.get(provider) ?? [];
        missing.push(model.original);
        missingByProvider.set(provider, missing);
      }
    }
  }

  if (missingByProvider.size > 0) {
    const lines = ["Missing models detected:"];
    for (const [provider, modelsList] of missingByProvider.entries()) {
      lines.push(`- ${provider}: ${modelsList.join(", ")}`);
    }
    throw new Error(lines.join("\n"));
  }

  logger.log("All referenced models are available.");
}
