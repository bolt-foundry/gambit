import type { CardDefinition, DeckDefinition } from "./types.ts";

export function defineDeck(def: Omit<DeckDefinition, "kind">): DeckDefinition {
  return { kind: "gambit.deck", ...def };
}

export function defineCard(def: Omit<CardDefinition, "kind">): CardDefinition {
  return { kind: "gambit.card", ...def };
}

export function isDeckDefinition(value: unknown): value is DeckDefinition {
  return Boolean(
    value && typeof value === "object" &&
      (value as { kind?: unknown }).kind === "gambit.deck",
  );
}

export function isCardDefinition(value: unknown): value is CardDefinition {
  return Boolean(
    value && typeof value === "object" &&
      (value as { kind?: unknown }).kind === "gambit.card",
  );
}
