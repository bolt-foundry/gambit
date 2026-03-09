import * as path from "@std/path";
import type { LoadedDeck } from "@bolt-foundry/gambit-core";
import type {
  AvailableGraderDeck,
  AvailableTestDeck,
  PersistedAssistantDeck,
  PersistedScenarioDeck,
  SchemaDescription,
  WorkspaceDeckState,
} from "./server_types.ts";

const slugify = (label: string): string => {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(
    /(^-|-$)+/g,
    "",
  );
};

const parseDeckMaxTurns = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > 200) return 200;
  return rounded;
};

export const toDeckLabel = (filePath: string): string => {
  const base = path.basename(filePath);
  return base
    .replace(/\.deck\.(md|ts)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim() || base;
};

export const toAvailableTestDeck = (
  deck: {
    id?: string;
    label?: string;
    description?: string;
    path: string;
    maxTurns?: unknown;
  },
  index: number,
): AvailableTestDeck => {
  const label = deck.label && typeof deck.label === "string"
    ? deck.label
    : toDeckLabel(deck.path);
  const id = deck.id && typeof deck.id === "string"
    ? deck.id
    : slugify(`${label || "test-deck"}-${index}`);
  const maxTurns = parseDeckMaxTurns(deck.maxTurns);
  return {
    id,
    label: label || id,
    description: typeof deck.description === "string"
      ? deck.description
      : undefined,
    path: deck.path,
    ...(maxTurns !== undefined ? { maxTurns } : {}),
  };
};

export const toAvailableGraderDeck = (
  deck: {
    id?: string;
    label?: string;
    description?: string;
    path: string;
  },
  index: number,
): AvailableGraderDeck => {
  const label = deck.label && typeof deck.label === "string"
    ? deck.label
    : toDeckLabel(deck.path);
  const id = deck.id && typeof deck.id === "string"
    ? deck.id
    : slugify(`${label || "grader-deck"}-${index}`);
  return {
    id,
    label: label || id,
    description: typeof deck.description === "string"
      ? deck.description
      : undefined,
    path: deck.path,
  };
};

export const summarizeDeckState = (
  deckState:
    | Pick<WorkspaceDeckState, "scenarioDecks" | "graderDecks">
    | null
    | undefined,
) => ({
  scenarioDeckCount: deckState?.scenarioDecks.length ?? 0,
  scenarioDeckPaths: (deckState?.scenarioDecks ?? []).slice(0, 12).map(
    (deck) => deck.path,
  ),
  graderDeckCount: deckState?.graderDecks.length ?? 0,
});

export const buildWorkspaceDeckStateFromLoadedDeck = async (args: {
  workspaceId: string;
  deck: LoadedDeck;
  buildPersistedAssistantDeck: (deck: LoadedDeck) => PersistedAssistantDeck;
  describeDeckInputSchemaFromPath: (
    deckPath: string,
  ) => Promise<SchemaDescription>;
}): Promise<WorkspaceDeckState> => {
  const scenarioDecks = await Promise.all(
    (args.deck.testDecks ?? []).map(async (scenarioDeck, index) => {
      const availableDeck = toAvailableTestDeck(scenarioDeck, index);
      const desc = await args.describeDeckInputSchemaFromPath(
        availableDeck.path,
      );
      return {
        ...availableDeck,
        inputSchema: desc.schema,
        defaults: desc.defaults,
        inputSchemaError: desc.error,
      } satisfies PersistedScenarioDeck;
    }),
  );
  return {
    workspaceId: args.workspaceId,
    rootDeckPath: args.deck.path,
    assistantDeck: args.buildPersistedAssistantDeck(args.deck),
    scenarioDecks,
    graderDecks: (args.deck.graderDecks ?? []).map(toAvailableGraderDeck),
    updatedAt: new Date().toISOString(),
  };
};

export const buildRootScenarioFallback = (
  deckState: WorkspaceDeckState,
): AvailableTestDeck => ({
  id: "root",
  label: toDeckLabel(deckState.assistantDeck.deck),
  description: "Root simulator deck",
  path: deckState.assistantDeck.deck,
});

export const resolveScenarioDeckFromState = (
  deckState: WorkspaceDeckState,
  identifier: string,
): PersistedScenarioDeck | undefined => {
  if (!identifier) return undefined;
  const normalizedIdentifier = path.resolve(identifier);
  return deckState.scenarioDecks.find((deck) =>
    deck.id === identifier || path.resolve(deck.path) === normalizedIdentifier
  );
};

export const resolveGraderDeckFromState = (
  deckState: WorkspaceDeckState,
  identifier: string,
): AvailableGraderDeck | undefined => {
  if (!identifier) return undefined;
  const normalizedIdentifier = path.resolve(identifier);
  return deckState.graderDecks.find((deck) =>
    deck.id === identifier || path.resolve(deck.path) === normalizedIdentifier
  );
};
