import * as path from "@std/path";
import { RESERVED_TOOL_PREFIX } from "./constants.ts";
import { isCardDefinition, isDeckDefinition } from "./definitions.ts";
import type {
  ActionDefinition,
  CardDefinition,
  DeckDefinition,
  LoadedCard,
  LoadedDeck,
} from "./types.ts";

function toFileUrl(p: string): string {
  const abs = path.resolve(p);
  return path.toFileUrl(abs).href;
}

function normalizeActions(
  actions: DeckDefinition["actions"] | CardDefinition["actions"],
): ActionDefinition[] {
  if (!actions) return [];
  return actions.map((a) => ({
    name: a.name,
    path: a.path,
    description: a.description,
    activity: a.activity,
  }));
}

function checkReserved(action: ActionDefinition) {
  if (action.name.startsWith(RESERVED_TOOL_PREFIX)) {
    throw new Error(
      `Action name ${action.name} is reserved (prefix ${RESERVED_TOOL_PREFIX})`,
    );
  }
}

export async function loadCard(
  cardPath: string,
  parentPath?: string,
): Promise<LoadedCard> {
  const resolved = parentPath
    ? path.resolve(path.dirname(parentPath), cardPath)
    : path.resolve(cardPath);
  const mod = await import(toFileUrl(resolved));
  const card = mod.default;
  if (!isCardDefinition(card)) {
    throw new Error(`Card at ${resolved} did not export a valid card definition`);
  }
  const actions = normalizeActions(card.actions);
  actions.forEach(checkReserved);
  return { ...card, actions, path: resolved };
}

export async function loadDeck(
  deckPath: string,
  parentPath?: string,
): Promise<LoadedDeck> {
  const resolved = parentPath
    ? path.resolve(path.dirname(parentPath), deckPath)
    : path.resolve(deckPath);
  const mod = await import(toFileUrl(resolved));
  const deck = mod.default;
  if (!isDeckDefinition(deck)) {
    throw new Error(`Deck at ${resolved} did not export a valid deck definition`);
  }

  const cardPaths = deck.embeds ?? [];
  const cards: LoadedCard[] = [];
  for (const cardPath of cardPaths) {
    const loaded = await loadCard(cardPath, resolved);
    cards.push(loaded);
  }

  const mergedActions: Record<string, ActionDefinition> = {};
  for (const card of cards) {
    for (const action of card.actions ?? []) {
      checkReserved(action);
      mergedActions[action.name] = action;
    }
  }
  for (const action of normalizeActions(deck.actions)) {
    checkReserved(action);
    mergedActions[action.name] = action;
  }

  const actions = Object.values(mergedActions);

  const executor = typeof mod.run === "function"
    ? mod.run
    : typeof mod.execute === "function"
    ? mod.execute
    : undefined;

  return {
    ...deck,
    path: resolved,
    cards,
    actions,
    executor,
  };
}
