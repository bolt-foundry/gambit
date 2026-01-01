import * as path from "@std/path";
import {
  BUILTIN_TOOL_NAME_SET,
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
  ActionDeckDefinition,
  CardDefinition,
  DeckDefinition,
  GraderDeckDefinition,
  LoadedCard,
  LoadedDeck,
  TestDeckDefinition,
} from "./types.ts";

const logger = console;

function toFileUrl(p: string): string {
  const abs = path.resolve(p);
  return path.toFileUrl(abs).href;
}

function normalizeActionDecks(
  actions:
    | DeckDefinition["actionDecks"]
    | CardDefinition["actionDecks"]
    | DeckDefinition["actions"]
    | CardDefinition["actions"],
  basePath?: string,
): Array<ActionDeckDefinition> {
  if (!actions) return [];
  return actions.map((a) => ({
    ...a,
    path: basePath ? path.resolve(path.dirname(basePath), a.path) : a.path,
  }));
}

function normalizeCompanionDecks<T extends { path: string }>(
  decks:
    | ReadonlyArray<T>
    | DeckDefinition["testDecks"]
    | DeckDefinition["graderDecks"]
    | CardDefinition["testDecks"]
    | CardDefinition["graderDecks"],
  basePath?: string,
): Array<T> {
  if (!decks) return [];
  return decks.map((deck) => ({
    ...deck,
    path: basePath
      ? path.resolve(path.dirname(basePath), deck.path)
      : deck.path,
  })) as Array<T>;
}

function checkReserved(action: ActionDeckDefinition) {
  if (
    action.name.startsWith(RESERVED_TOOL_PREFIX) &&
    !BUILTIN_TOOL_NAME_SET.has(action.name)
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

  const actionDecks = normalizeActionDecks(
    card.actionDecks ?? card.actions,
    resolved,
  );
  if (!card.actionDecks && card.actions?.length) {
    logger.warn(
      `[gambit] card at ${resolved} uses deprecated "actions"; rename to "actionDecks"`,
    );
  }
  const testDecks = normalizeCompanionDecks<TestDeckDefinition>(
    card.testDecks,
    resolved,
  );
  const graderDecks = normalizeCompanionDecks<GraderDeckDefinition>(
    card.graderDecks,
    resolved,
  );
  actionDecks.forEach(checkReserved);
  const { label: _l, ...rest } = card as CardDefinition;
  return {
    ...rest,
    label: cardLabel,
    actionDecks,
    actions: actionDecks,
    testDecks,
    graderDecks,
    path: resolved,
    cards: [],
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

  const cards: Array<LoadedCard> = [];

  const mergedActions: Record<string, ActionDeckDefinition> = {};
  const allCards = flattenCards(cards);
  for (const card of allCards) {
    for (const action of card.actionDecks ?? []) {
      checkReserved(action);
      mergedActions[action.name] = action;
    }
  }
  const deckActionDecks = deck.actionDecks ?? deck.actions;
  if (!deck.actionDecks && deck.actions?.length) {
    logger.warn(
      `[gambit] deck at ${resolved} uses deprecated "actions"; rename to "actionDecks"`,
    );
  }
  for (const action of normalizeActionDecks(deckActionDecks, resolved)) {
    checkReserved(action);
    mergedActions[action.name] = action;
  }

  const actionDecks = Object.values(mergedActions);

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
    actionDecks,
    actions: actionDecks,
    testDecks: normalizeCompanionDecks<TestDeckDefinition>(
      deck.testDecks,
      resolved,
    ),
    graderDecks: normalizeCompanionDecks<GraderDeckDefinition>(
      deck.graderDecks,
      resolved,
    ),
    inputSchema,
    outputSchema,
    executor,
    handlers,
    respond: deck.respond,
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
