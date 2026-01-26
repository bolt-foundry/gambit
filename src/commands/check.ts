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

type DeckModelSpec = {
  candidates: Array<string>;
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
  modelParams?: { model?: string | Array<string> };
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
): Promise<{ specs: Array<DeckModelSpec>; missingAliases: Set<string> }> {
  const resolvedRoot = path.resolve(rootDeckPath);
  const seenDecks = new Set<string>();
  const specs: Array<DeckModelSpec> = [];
  const missingAliases = new Set<string>();
  const queue: Array<string> = [resolvedRoot];

  while (queue.length > 0) {
    const deckPath = queue.shift();
    if (!deckPath) continue;
    if (seenDecks.has(deckPath)) continue;
    const deck = await loadDeck(deckPath);
    seenDecks.add(deck.path);
    if (deck.modelParams?.model) {
      const candidates = expandModelCandidates(
        deck.modelParams.model,
        resolver,
        missingAliases,
      );
      if (candidates.length > 0) {
        specs.push({ candidates });
      }
    }
    const refs = collectDeckRefs(deck);
    for (const ref of refs) {
      if (!seenDecks.has(ref)) {
        queue.push(ref);
      }
    }
  }

  return { specs, missingAliases };
}

function expandModelCandidates(
  model: string | Array<string>,
  resolver: ModelAliasResolver | undefined,
  missingAliases: Set<string>,
): Array<string> {
  const entries = Array.isArray(model) ? model : [model];
  const candidates: Array<string> = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    const resolution = resolver
      ? resolver(entry)
      : { model: entry, applied: false };
    if (resolution.missingAlias) {
      missingAliases.add(entry);
    }
    if (resolution.applied) {
      const resolvedModel = resolution.model;
      if (Array.isArray(resolvedModel)) {
        for (const candidate of resolvedModel) {
          if (typeof candidate === "string" && candidate.trim()) {
            candidates.push(candidate);
          }
        }
      } else if (typeof resolvedModel === "string" && resolvedModel.trim()) {
        candidates.push(resolvedModel);
      }
    } else {
      candidates.push(entry);
    }
  }
  return candidates;
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
  if (collected.specs.length === 0) {
    logger.log("No explicit models found in deck tree.");
    return;
  }

  const grouped = new Map<ModelProviderKey, Array<DeckModelInfo>>();
  for (const spec of collected.specs) {
    for (const candidate of spec.candidates) {
      const resolved = resolveModelProvider(candidate);
      const entry = grouped.get(resolved.provider) ?? [];
      entry.push(resolved);
      grouped.set(resolved.provider, entry);
    }
  }

  const availableByProvider = new Map<ModelProviderKey, Set<string>>();
  for (const [provider] of grouped.entries()) {
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
    availableByProvider.set(provider, available);
  }

  const missingSpecs: Array<string> = [];
  for (const spec of collected.specs) {
    const candidates = spec.candidates;
    const found = candidates.some((candidate) => {
      const resolved = resolveModelProvider(candidate);
      const available = availableByProvider.get(resolved.provider);
      if (!available) return false;
      return available.has(resolved.name) || available.has(resolved.original);
    });
    if (!found) {
      missingSpecs.push(candidates.join(" | "));
    }
  }

  if (missingSpecs.length > 0) {
    const lines = ["Missing models detected:"];
    for (const spec of missingSpecs) {
      lines.push(`- ${spec}`);
    }
    throw new Error(lines.join("\n"));
  }

  logger.log("All referenced models are available.");
}
