import * as path from "@std/path";
import {
  BUILTIN_TOOL_NAME_SET,
  MAX_TOOL_NAME_LENGTH,
  RESERVED_TOOL_PREFIX,
  TOOL_NAME_PATTERN,
} from "./constants.ts";
import { isCardDefinition, isDeckDefinition } from "./definitions.ts";
import {
  normalizePermissionDeclaration,
  type PermissionDeclarationInput,
} from "./permissions.ts";
import { mergeZodObjects } from "./schema.ts";
import {
  isMarkdownFile,
  loadMarkdownCard,
  loadMarkdownDeck,
} from "./markdown.ts";
import {
  resolveBuiltinCardPath,
  resolveBuiltinDeckPath,
  resolveBuiltinSnippetPath,
} from "./builtins.ts";
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
const LEGACY_SCHEMA_WARNINGS = new Set<string>();
const LEGACY_FRAGMENT_WARNINGS = new Set<string>();

function warnLegacySchema(
  resolvedPath: string,
  legacy: "inputSchema" | "outputSchema",
  replacement: "contextSchema" | "responseSchema",
) {
  const key = `${resolvedPath}:${legacy}`;
  if (LEGACY_SCHEMA_WARNINGS.has(key)) return;
  LEGACY_SCHEMA_WARNINGS.add(key);
  logger.warn(
    `[gambit] deck at ${resolvedPath} uses deprecated "${legacy}"; rename to "${replacement}"`,
  );
}

function warnLegacyFragment(
  resolvedPath: string,
  legacy: "inputFragment" | "outputFragment",
  replacement: "contextFragment" | "responseFragment",
) {
  const key = `${resolvedPath}:${legacy}`;
  if (LEGACY_FRAGMENT_WARNINGS.has(key)) return;
  LEGACY_FRAGMENT_WARNINGS.add(key);
  logger.warn(
    `[gambit] card at ${resolvedPath} uses deprecated "${legacy}"; rename to "${replacement}"`,
  );
}

function normalizeDeckSchemas(deck: DeckDefinition, resolvedPath: string): {
  contextSchema?: DeckDefinition["contextSchema"];
  responseSchema?: DeckDefinition["responseSchema"];
  inputSchema?: DeckDefinition["inputSchema"];
  outputSchema?: DeckDefinition["outputSchema"];
} {
  if (deck.inputSchema !== undefined) {
    warnLegacySchema(resolvedPath, "inputSchema", "contextSchema");
  }
  if (deck.outputSchema !== undefined) {
    warnLegacySchema(resolvedPath, "outputSchema", "responseSchema");
  }
  const contextSchema = deck.contextSchema ?? deck.inputSchema;
  const responseSchema = deck.responseSchema ?? deck.outputSchema;
  return {
    contextSchema,
    responseSchema,
    inputSchema: contextSchema,
    outputSchema: responseSchema,
  };
}

function normalizeCardFragments(card: CardDefinition, resolvedPath: string): {
  contextFragment?: CardDefinition["contextFragment"];
  responseFragment?: CardDefinition["responseFragment"];
  inputFragment?: CardDefinition["inputFragment"];
  outputFragment?: CardDefinition["outputFragment"];
} {
  if (card.inputFragment !== undefined) {
    warnLegacyFragment(resolvedPath, "inputFragment", "contextFragment");
  }
  if (card.outputFragment !== undefined) {
    warnLegacyFragment(resolvedPath, "outputFragment", "responseFragment");
  }
  const contextFragment = card.contextFragment ?? card.inputFragment;
  const responseFragment = card.responseFragment ?? card.outputFragment;
  return {
    contextFragment,
    responseFragment,
    inputFragment: contextFragment,
    outputFragment: responseFragment,
  };
}

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
    path: a.path.startsWith("gambit://") || !basePath
      ? a.path
      : path.resolve(path.dirname(basePath), a.path),
    permissions: normalizePermissionDeclaration(
      a.permissions,
      basePath ? path.dirname(basePath) : Deno.cwd(),
    ),
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
    path: deck.path.startsWith("gambit://") || !basePath
      ? deck.path
      : path.resolve(path.dirname(basePath), deck.path),
    permissions: normalizePermissionDeclaration(
      (deck as { permissions?: unknown }).permissions as
        | PermissionDeclarationInput
        | undefined,
      basePath ? path.dirname(basePath) : Deno.cwd(),
    ),
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
  const fragments = normalizeCardFragments(card, resolved);
  return {
    ...rest,
    label: cardLabel,
    actionDecks,
    actions: actionDecks,
    testDecks,
    graderDecks,
    path: resolved,
    cards: [],
    ...fragments,
    permissions: normalizePermissionDeclaration(
      card.permissions,
      path.dirname(resolved),
    ),
  };
}

export async function loadCard(
  cardPath: string,
  parentPath?: string,
  stack: Array<string> = [],
): Promise<LoadedCard> {
  const builtinPath = resolveBuiltinCardPath(cardPath);
  const snippetPath = resolveBuiltinSnippetPath(cardPath);
  const normalizedPath = snippetPath ?? builtinPath ?? cardPath;
  if (isMarkdownFile(normalizedPath)) {
    return await loadMarkdownCard(normalizedPath, parentPath, stack);
  }
  return await loadCardInternal(normalizedPath, parentPath, stack);
}

export async function loadDeck(
  deckPath: string,
  parentPath?: string,
): Promise<LoadedDeck> {
  const builtinDeck = resolveBuiltinDeckPath(deckPath);
  const normalizedDeckPath = builtinDeck ?? deckPath;
  const markdownParent = builtinDeck ? undefined : parentPath;
  if (isMarkdownFile(normalizedDeckPath)) {
    return await loadMarkdownDeck(normalizedDeckPath, markdownParent);
  }

  const resolved = markdownParent
    ? path.resolve(path.dirname(markdownParent), normalizedDeckPath)
    : path.resolve(normalizedDeckPath);
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

  const schemaAliases = normalizeDeckSchemas(deck, resolved);
  let inputSchema = schemaAliases.inputSchema;
  let outputSchema = schemaAliases.outputSchema;
  let contextSchema = schemaAliases.contextSchema;
  let responseSchema = schemaAliases.responseSchema;
  for (const card of allCards) {
    inputSchema = mergeZodObjects(inputSchema, card.inputFragment);
    outputSchema = mergeZodObjects(outputSchema, card.outputFragment);
    contextSchema = mergeZodObjects(contextSchema, card.contextFragment);
    responseSchema = mergeZodObjects(responseSchema, card.responseFragment);
  }
  inputSchema = contextSchema;
  outputSchema = responseSchema;

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
    contextSchema,
    responseSchema,
    inputSchema,
    outputSchema,
    executor,
    handlers,
    respond: deck.respond,
    permissions: normalizePermissionDeclaration(
      deck.permissions,
      path.dirname(resolved),
    ),
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
