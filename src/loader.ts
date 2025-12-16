import * as path from "@std/path";
import {
  GAMBIT_TOOL_INIT,
  GAMBIT_TOOL_RESPOND,
  MAX_TOOL_NAME_LENGTH,
  RESERVED_TOOL_PREFIX,
  TOOL_NAME_PATTERN,
} from "./constants.ts";
import { isCardDefinition, isDeckDefinition } from "./definitions.ts";
import { mergeZodObjects } from "./schema.ts";
import {
  isMarkdownFile,
  loadMarkdownCard,
  loadMarkdownDeck,
} from "./markdown.ts";
import type {
  ActionDefinition,
  CardDefinition,
  DeckDefinition,
  LoadedCard,
  LoadedDeck,
} from "./types.ts";

const logger = console;

function toFileUrl(p: string): string {
  const abs = path.resolve(p);
  return path.toFileUrl(abs).href;
}

function normalizeActions(
  actions: DeckDefinition["actions"] | CardDefinition["actions"],
  basePath?: string,
): Array<ActionDefinition> {
  if (!actions) return [];
  return actions.map((a) => ({
    name: a.name,
    path: basePath ? path.resolve(path.dirname(basePath), a.path) : a.path,
    description: a.description,
    label: (a as { label?: string }).label,
  }));
}

function checkReserved(action: ActionDefinition) {
  if (
    action.name.startsWith(RESERVED_TOOL_PREFIX) &&
    action.name !== GAMBIT_TOOL_INIT &&
    action.name !== GAMBIT_TOOL_RESPOND
  ) {
    throw new Error(
      `Action name ${action.name} is reserved (prefix ${RESERVED_TOOL_PREFIX})`,
    );
  }
  if (
    !TOOL_NAME_PATTERN.test(action.name) ||
    action.name.length > MAX_TOOL_NAME_LENGTH
  ) {
    throw new Error(
      `Action name ${action.name} must match ${TOOL_NAME_PATTERN} and be <= ${MAX_TOOL_NAME_LENGTH} characters`,
    );
  }
}

async function loadCardInternal(
  cardPath: string,
  parentPath?: string,
  stack: Array<string> = [],
): Promise<LoadedCard> {
  const resolved = parentPath
    ? path.resolve(path.dirname(parentPath), cardPath)
    : path.resolve(cardPath);

  if (stack.includes(resolved)) {
    throw new Error(
      `Card/embed cycle detected: ${[...stack, resolved].join(" -> ")}`,
    );
  }
  const nextStack = [...stack, resolved];

  const mod = await import(toFileUrl(resolved));
  const card = mod.default;
  if (!isCardDefinition(card)) {
    throw new Error(
      `Card at ${resolved} did not export a valid card definition`,
    );
  }
  if ((card as { handlers?: unknown }).handlers) {
    throw new Error(`Card at ${resolved} cannot declare handlers (deck-only)`);
  }
  const cardLabel = card.label;

  const embeds = card.embeds ?? [];
  const embeddedCards: Array<LoadedCard> = [];
  for (const embed of embeds) {
    const loaded = await loadCard(embed, resolved, nextStack);
    embeddedCards.push(loaded);
  }

  const actions = normalizeActions(card.actions, resolved);
  actions.forEach(checkReserved);
  const { label: _l, ...rest } = card as CardDefinition;
  return {
    ...rest,
    label: cardLabel,
    actions,
    path: resolved,
    cards: embeddedCards,
  };
}

export async function loadCard(
  cardPath: string,
  parentPath?: string,
  stack: Array<string> = [],
): Promise<LoadedCard> {
  if (isMarkdownFile(cardPath)) {
    return await loadMarkdownCard(cardPath, parentPath, stack);
  }
  return await loadCardInternal(cardPath, parentPath, stack);
}

export async function loadDeck(
  deckPath: string,
  parentPath?: string,
): Promise<LoadedDeck> {
  if (isMarkdownFile(deckPath)) {
    return await loadMarkdownDeck(deckPath, parentPath);
  }

  const resolved = parentPath
    ? path.resolve(path.dirname(parentPath), deckPath)
    : path.resolve(deckPath);
  const mod = await import(toFileUrl(resolved));
  const deck = mod.default;
  if (!isDeckDefinition(deck)) {
    throw new Error(
      `Deck at ${resolved} did not export a valid deck definition`,
    );
  }

  const deckLabel = deck.label;

  const cardPaths = deck.embeds ?? [];
  const cards: Array<LoadedCard> = [];
  for (const cardPath of cardPaths) {
    const loaded = await loadCard(cardPath, resolved, [resolved]);
    cards.push(loaded);
  }

  const mergedActions: Record<string, ActionDefinition> = {};
  const allCards = flattenCards(cards);
  for (const card of allCards) {
    for (const action of card.actions ?? []) {
      checkReserved(action);
      mergedActions[action.name] = action;
    }
  }
  for (const action of normalizeActions(deck.actions, resolved)) {
    checkReserved(action);
    mergedActions[action.name] = action;
  }

  const actions = Object.values(mergedActions);

  let inputSchema = deck.inputSchema;
  let outputSchema = deck.outputSchema;
  for (const card of allCards) {
    inputSchema = mergeZodObjects(inputSchema, card.inputFragment);
    outputSchema = mergeZodObjects(outputSchema, card.outputFragment);
  }

  const executor = typeof deck.run === "function"
    ? deck.run
    : typeof deck.execute === "function"
    ? deck.execute
    : undefined;

  const normalizeHandler = <
    T extends { path: string; repeatMs?: number; intervalMs?: number },
  >(
    cfg: T | undefined,
    kind: "onBusy" | "onIdle" | "onInterval",
  ) => {
    if (!cfg) return undefined;
    const repeatMs = cfg.repeatMs ?? cfg.intervalMs;
    if (cfg.intervalMs !== undefined && cfg.repeatMs === undefined) {
      logger.warn(
        `[gambit] handlers.${kind}.intervalMs is deprecated; use repeatMs (${resolved})`,
      );
    }
    return {
      ...cfg,
      repeatMs,
      path: path.resolve(path.dirname(resolved), cfg.path),
    };
  };

  const intervalAlias = deck.handlers?.onInterval;
  const onBusy = normalizeHandler(
    deck.handlers?.onBusy ?? intervalAlias,
    intervalAlias ? "onInterval" : "onBusy",
  );
  if (!deck.handlers?.onBusy && intervalAlias) {
    logger.warn(
      `[gambit] handlers.onInterval is deprecated; use handlers.onBusy (${resolved})`,
    );
  }
  const onIdle = normalizeHandler(deck.handlers?.onIdle, "onIdle");

  const handlers = deck.handlers
    ? {
      onError: deck.handlers.onError
        ? {
          ...deck.handlers.onError,
          path: path.resolve(
            path.dirname(resolved),
            deck.handlers.onError.path,
          ),
        }
        : undefined,
      onBusy,
      onIdle,
    }
    : undefined;

  const { label: _l, ...rest } = deck as DeckDefinition;

  return {
    ...rest,
    label: deckLabel,
    path: resolved,
    cards: allCards,
    actions,
    inputSchema,
    outputSchema,
    executor,
    handlers,
    syntheticTools: deck.syntheticTools,
  };
}

function flattenCards(cards: Array<LoadedCard>): Array<LoadedCard> {
  const flat: Array<LoadedCard> = [];
  for (const card of cards) {
    flat.push(card);
    const nested = (card as { cards?: Array<LoadedCard> }).cards ?? [];
    if (nested.length) flat.push(...flattenCards(nested));
  }
  return flat;
}
