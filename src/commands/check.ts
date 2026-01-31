import * as path from "@std/path";
import { loadDeck } from "@molt-foundry/gambit-core";
import type { ModelAliasResolver } from "../project_config.ts";
import { GOOGLE_PREFIX } from "../providers/google.ts";
import { fetchOllamaTags, OLLAMA_PREFIX } from "../providers/ollama.ts";
import { OPENROUTER_PREFIX } from "../providers/openrouter.ts";
import type { ProviderKey } from "../providers/router.ts";

const logger = console;
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

export async function handleCheckCommand(opts: {
  deckPath: string;
  modelResolver?: ModelAliasResolver;
  fallbackProvider?: ProviderKey | null;
  checkOnline?: boolean;
  openRouterApiKey?: string;
  googleApiKey?: string;
  ollamaBaseURL?: string;
}) {
  const effectiveFallbackProvider = opts.fallbackProvider === undefined
    ? "openrouter"
    : opts.fallbackProvider;
  const shouldCheckRemote = Boolean(opts.checkOnline);
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
  const uniqueModels = new Set<string>();
  for (const spec of collected.specs) {
    spec.candidates.forEach((candidate) => uniqueModels.add(candidate));
  }
  const skippedRemote = new Set<string>();
  const failures: Array<string> = [];
  let ollamaTags: Promise<Set<string>> | null = null;

  const getOllamaTags = async (): Promise<Set<string>> => {
    if (!ollamaTags) {
      ollamaTags = fetchOllamaTags(opts.ollamaBaseURL);
    }
    return await ollamaTags;
  };

  const parseProvider = (model: string): {
    providerKey?: ProviderKey;
    strippedModel: string;
  } => {
    if (model.startsWith(OPENROUTER_PREFIX)) {
      return {
        providerKey: "openrouter",
        strippedModel: model.slice(OPENROUTER_PREFIX.length),
      };
    }
    if (model.startsWith(OLLAMA_PREFIX)) {
      return {
        providerKey: "ollama",
        strippedModel: model.slice(OLLAMA_PREFIX.length),
      };
    }
    if (model.startsWith(GOOGLE_PREFIX)) {
      return {
        providerKey: "google",
        strippedModel: model.slice(GOOGLE_PREFIX.length),
      };
    }
    return { strippedModel: model };
  };

  const checkCandidate = async (candidate: string): Promise<{
    available: boolean;
    skipped?: boolean;
  }> => {
    const parsed = parseProvider(candidate);
    const prefixed = Boolean(parsed.providerKey);
    let providerKey = parsed.providerKey;
    let resolvedModel = parsed.strippedModel;
    if (!providerKey) {
      if (effectiveFallbackProvider === null) {
        failures.push(`${candidate} (no fallback provider configured)`);
        return { available: false };
      }
      providerKey = effectiveFallbackProvider;
      resolvedModel = candidate;
    }

    if (providerKey === "ollama") {
      if (!resolvedModel.trim()) {
        failures.push(`${candidate} (ollama: missing model name)`);
        return { available: false };
      }
      try {
        const tags = await getOllamaTags();
        if (!tags.has(resolvedModel)) {
          failures.push(`${candidate} (ollama: model not installed)`);
          return { available: false };
        }
        return { available: true };
      } catch (err) {
        failures.push(
          `${candidate} (ollama: ${(err as Error).message})`,
        );
        return { available: false };
      }
    }

    if (providerKey === "openrouter") {
      if (!resolvedModel.trim()) {
        failures.push(`${candidate} (openrouter: missing model name)`);
        return { available: false };
      }
      if (!shouldCheckRemote) {
        skippedRemote.add(candidate);
        return { available: true, skipped: true };
      }
      if (!opts.openRouterApiKey) {
        failures.push(`${candidate} (openrouter: OPENROUTER_API_KEY not set)`);
        return { available: false };
      }
      return { available: true };
    }

    if (providerKey === "google") {
      if (!resolvedModel.trim()) {
        failures.push(`${candidate} (google: missing model name)`);
        return { available: false };
      }
      if (!shouldCheckRemote) {
        skippedRemote.add(candidate);
        return { available: true, skipped: true };
      }
      if (opts.googleApiKey) {
        return { available: true };
      }
      if (
        prefixed && effectiveFallbackProvider === "openrouter" &&
        opts.openRouterApiKey
      ) {
        return { available: true };
      }
      failures.push(`${candidate} (google: GOOGLE_API_KEY not set)`);
      return { available: false };
    }

    failures.push(`${candidate} (unknown provider)`);
    return { available: false };
  };

  for (const spec of collected.specs) {
    for (const candidate of spec.candidates) {
      await checkCandidate(candidate);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Model availability check failed: ${failures.join("; ")}`);
  }

  logger.log(
    `Checked ${collected.specs.length} deck(s); ${uniqueModels.size} model(s) resolved.`,
  );
  if (!shouldCheckRemote && skippedRemote.size > 0) {
    logger.log(
      `Skipped remote availability checks for ${skippedRemote.size} model(s). Use --online to verify remote providers.`,
    );
  }
}
