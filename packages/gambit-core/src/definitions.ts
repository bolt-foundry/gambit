import type { CardDefinition, DeckDefinition } from "./types.ts";
import type { z } from "zod";

export function defineDeck<
  InputSchema extends z.ZodTypeAny,
  OutputSchema extends z.ZodTypeAny | undefined = undefined,
>(
  def:
    & Omit<
      DeckDefinition<z.infer<InputSchema>>,
      "kind" | "inputSchema" | "outputSchema"
    >
    & {
      inputSchema: InputSchema;
      outputSchema?: OutputSchema;
    },
): DeckDefinition<z.infer<InputSchema>>;
export function defineDeck(
  def: Omit<DeckDefinition, "kind">,
): DeckDefinition;
export function defineDeck(
  def: Omit<DeckDefinition, "kind">,
): DeckDefinition {
  return { kind: "gambit.deck", ...def } as DeckDefinition;
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
