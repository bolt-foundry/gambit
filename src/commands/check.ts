import * as path from "@std/path";
import { loadDeck } from "@bolt-foundry/gambit-core";
import {
  type CodexLoginStatus,
  readCodexLoginStatus,
} from "../codex_preflight.ts";
import type { ModelAliasResolver } from "../project_config.ts";
import { CODEX_PREFIX } from "../providers/codex.ts";
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

export type CheckFailure = {
  model: string;
  provider: string;
  code:
    | "unknown_model_alias"
    | "legacy_codex_prefix"
    | "missing_fallback_provider"
    | "missing_model_name"
    | "model_not_installed"
    | "missing_api_key"
    | "not_logged_in"
    | "provider_error"
    | "unknown_provider";
  message: string;
};

export type CheckReport = {
  ok: boolean;
  decksChecked: number;
  modelsResolved: number;
  remoteChecksEnabled: boolean;
  skippedRemoteModels: Array<string>;
  failures: Array<CheckFailure>;
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
  codexLoginStatusChecker?: () => Promise<CodexLoginStatus>;
  json?: boolean;
}): Promise<CheckReport> {
  const failures: Array<CheckFailure> = [];
  const addFailure = (
    model: string,
    provider: string,
    code: CheckFailure["code"],
    message: string,
  ) => failures.push({ model, provider, code, message });

  const effectiveFallbackProvider = opts.fallbackProvider === undefined
    ? "openrouter"
    : opts.fallbackProvider;
  const shouldCheckRemote = Boolean(opts.checkOnline);
  const collected = await collectDeckModels(opts.deckPath, opts.modelResolver);

  for (const alias of Array.from(collected.missingAliases)) {
    addFailure(
      alias,
      "alias",
      "unknown_model_alias",
      `Unknown model alias "${alias}". Define it in gambit.toml or update the deck.`,
    );
  }

  const uniqueModels = new Set<string>();
  for (const spec of collected.specs) {
    spec.candidates.forEach((candidate) => uniqueModels.add(candidate));
  }
  const skippedRemote = new Set<string>();
  let ollamaTags: Promise<Set<string>> | null = null;
  let codexStatus: Promise<CodexLoginStatus> | null = null;

  const getCodexLoginStatus = async (): Promise<CodexLoginStatus> => {
    if (!codexStatus) {
      const checker = opts.codexLoginStatusChecker ?? readCodexLoginStatus;
      codexStatus = checker();
    }
    return await codexStatus;
  };

  const getOllamaTags = async (): Promise<Set<string>> => {
    if (!ollamaTags) {
      ollamaTags = fetchOllamaTags(opts.ollamaBaseURL);
    }
    return await ollamaTags;
  };

  const parseProvider = (model: string): {
    providerKey?: ProviderKey;
    strippedModel: string;
    legacyCodex?: boolean;
  } => {
    if (model.trim() === "codex-cli") {
      return {
        providerKey: "codex-cli",
        strippedModel: "default",
      };
    }
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
    if (model.startsWith(CODEX_PREFIX)) {
      return {
        providerKey: "codex-cli",
        strippedModel: model.slice(CODEX_PREFIX.length),
      };
    }
    if (model === "codex" || model.startsWith("codex/")) {
      return { strippedModel: model, legacyCodex: true };
    }
    return { strippedModel: model };
  };

  const checkCandidate = async (candidate: string): Promise<void> => {
    const parsed = parseProvider(candidate);
    if (parsed.legacyCodex) {
      addFailure(
        candidate,
        "codex-cli",
        "legacy_codex_prefix",
        "Legacy codex prefix is unsupported; use codex-cli/default or codex-cli/<model>.",
      );
      return;
    }
    const prefixed = Boolean(parsed.providerKey);
    let providerKey = parsed.providerKey;
    let resolvedModel = parsed.strippedModel;
    if (!providerKey) {
      if (effectiveFallbackProvider === null) {
        addFailure(
          candidate,
          "fallback",
          "missing_fallback_provider",
          "No fallback provider configured for unprefixed model.",
        );
        return;
      }
      providerKey = effectiveFallbackProvider;
      resolvedModel = candidate;
    }

    if (providerKey === "ollama") {
      if (!resolvedModel.trim()) {
        addFailure(
          candidate,
          "ollama",
          "missing_model_name",
          "Missing model name for ollama provider.",
        );
        return;
      }
      try {
        const tags = await getOllamaTags();
        if (!tags.has(resolvedModel)) {
          addFailure(
            candidate,
            "ollama",
            "model_not_installed",
            `Model "${resolvedModel}" is not installed in ollama.`,
          );
          return;
        }
      } catch (err) {
        addFailure(
          candidate,
          "ollama",
          "provider_error",
          (err as Error).message,
        );
      }
      return;
    }

    if (providerKey === "openrouter") {
      if (!resolvedModel.trim()) {
        addFailure(
          candidate,
          "openrouter",
          "missing_model_name",
          "Missing model name for openrouter provider.",
        );
        return;
      }
      if (!shouldCheckRemote) {
        skippedRemote.add(candidate);
        return;
      }
      if (!opts.openRouterApiKey) {
        addFailure(
          candidate,
          "openrouter",
          "missing_api_key",
          "OPENROUTER_API_KEY is not set.",
        );
      }
      return;
    }

    if (providerKey === "google") {
      if (!resolvedModel.trim()) {
        addFailure(
          candidate,
          "google",
          "missing_model_name",
          "Missing model name for google provider.",
        );
        return;
      }
      if (!shouldCheckRemote) {
        skippedRemote.add(candidate);
        return;
      }
      if (opts.googleApiKey) {
        return;
      }
      if (
        prefixed && effectiveFallbackProvider === "openrouter" &&
        opts.openRouterApiKey
      ) {
        return;
      }
      addFailure(
        candidate,
        "google",
        "missing_api_key",
        "GOOGLE_API_KEY is not set.",
      );
      return;
    }

    if (providerKey === "codex-cli") {
      if (!resolvedModel.trim()) {
        addFailure(
          candidate,
          "codex-cli",
          "missing_model_name",
          "Missing model name for codex-cli provider.",
        );
        return;
      }
      const login = await getCodexLoginStatus();
      if (!login.codexLoggedIn) {
        addFailure(
          candidate,
          "codex-cli",
          "not_logged_in",
          login.codexLoginStatus,
        );
      }
      return;
    }

    addFailure(candidate, "unknown", "unknown_provider", "Unknown provider.");
  };

  for (const spec of collected.specs) {
    for (const candidate of spec.candidates) {
      await checkCandidate(candidate);
    }
  }

  const report: CheckReport = {
    ok: failures.length === 0,
    decksChecked: collected.specs.length,
    modelsResolved: uniqueModels.size,
    remoteChecksEnabled: shouldCheckRemote,
    skippedRemoteModels: Array.from(skippedRemote).sort(),
    failures,
  };

  if (!report.ok && !opts.json) {
    const failureText = report.failures.map((failure) =>
      `${failure.model} (${failure.provider}: ${failure.message})`
    ).join("; ");
    throw new Error(`Model availability check failed: ${failureText}`);
  }

  if (!opts.json) {
    if (collected.specs.length === 0) {
      logger.log("No explicit models found in deck tree.");
    } else {
      logger.log(
        `Checked ${collected.specs.length} deck(s); ${uniqueModels.size} model(s) resolved.`,
      );
    }
    if (!shouldCheckRemote && skippedRemote.size > 0) {
      logger.log(
        `Skipped remote availability checks for ${skippedRemote.size} model(s). Use --online to verify remote providers.`,
      );
    }
  }

  return report;
}
