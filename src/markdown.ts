import { extract } from "@std/front-matter/any";
import * as path from "@std/path";
import {
  MAX_TOOL_NAME_LENGTH,
  RESERVED_TOOL_PREFIX,
  TOOL_NAME_PATTERN,
} from "./constants.ts";
import { isCardDefinition } from "./definitions.ts";
import { loadCard } from "./loader.ts";
import { mergeZodObjects } from "./schema.ts";
import type {
  ActionDefinition,
  DeckDefinition,
  LoadedCard,
  LoadedDeck,
} from "./types.ts";
import type { ZodTypeAny } from "zod";

type ParsedFrontmatter = Record<string, unknown>;

function toFileUrl(p: string): string {
  const abs = path.resolve(p);
  return path.toFileUrl(abs).href;
}

async function maybeLoadSchema(
  schemaPath: unknown,
  basePath: string,
): Promise<ZodTypeAny | undefined> {
  if (!schemaPath || typeof schemaPath !== "string") return undefined;
  const resolved = path.resolve(path.dirname(basePath), schemaPath);
  const mod = await import(toFileUrl(resolved));
  return mod.default as ZodTypeAny;
}

function normalizeActions(
  actions: unknown,
  basePath: string,
): ActionDefinition[] {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((a) => a && typeof a === "object")
    .map((a) => {
      const rec = a as Record<string, unknown>;
      const name = String(rec.name ?? "").trim();
      const p = String(rec.path ?? "").trim();
      if (!name || !p) {
        throw new Error("Action must include name and path");
      }
      return {
        name,
        path: path.resolve(path.dirname(basePath), p),
        description: typeof rec.description === "string"
          ? rec.description
          : undefined,
        label: typeof rec.label === "string" ? rec.label : undefined,
      };
    });
}

function extractEmbedsFromBody(body: string): string[] {
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  const embeds: string[] = [];
  let match;
  while ((match = regex.exec(body)) !== null) {
    embeds.push(match[1]);
  }
  return embeds;
}

export async function loadMarkdownCard(
  filePath: string,
  parentPath?: string,
  stack: string[] = [],
): Promise<LoadedCard> {
  const resolved = parentPath
    ? path.resolve(path.dirname(parentPath), filePath)
    : path.resolve(filePath);
  if (stack.includes(resolved)) {
    throw new Error(
      `Card/embed cycle detected: ${[...stack, resolved].join(" -> ")}`,
    );
  }
  const nextStack = [...stack, resolved];
  const raw = await Deno.readTextFile(resolved);
  const { attrs, body } = extract(raw) as {
    attrs: ParsedFrontmatter;
    body: string;
  };
  const candidate = attrs as unknown;
  if (isCardDefinition(candidate)) {
    // treat attrs as ts-shaped card
  }
  if ((candidate as { handlers?: unknown }).handlers) {
    throw new Error(
      `Card at ${resolved} cannot declare handlers (deck-only)`,
    );
  }
  const actions = normalizeActions(
    (attrs as { actions?: unknown }).actions,
    resolved,
  );
  actions.forEach((a) => {
    if (a.name.startsWith(RESERVED_TOOL_PREFIX)) {
      throw new Error(`Action name ${a.name} is reserved`);
    }
    if (
      !TOOL_NAME_PATTERN.test(a.name) || a.name.length > MAX_TOOL_NAME_LENGTH
    ) {
      throw new Error(
        `Action name ${a.name} must match ${TOOL_NAME_PATTERN} and be <= ${MAX_TOOL_NAME_LENGTH} characters`,
      );
    }
  });
  const inputFragment = await maybeLoadSchema(
    (attrs as { inputSchema?: unknown }).inputSchema,
    resolved,
  );
  const outputFragment = await maybeLoadSchema(
    (attrs as { outputSchema?: unknown }).outputSchema,
    resolved,
  );
  const embeds = extractEmbedsFromBody(body).concat(
    Array.isArray((attrs as { embeds?: unknown }).embeds)
      ? (attrs as { embeds?: string[] }).embeds ?? []
      : [],
  );
  const embeddedCards: LoadedCard[] = [];
  for (const embed of embeds) {
    const card = await loadCard(embed, resolved, nextStack);
    embeddedCards.push(card);
  }

  return {
    kind: "gambit.card",
    path: resolved,
    body: body.trim(),
    actions,
    embeds,
    cards: embeddedCards,
    inputFragment,
    outputFragment,
  };
}

export async function loadMarkdownDeck(
  filePath: string,
  parentPath?: string,
): Promise<LoadedDeck> {
  const resolved = parentPath
    ? path.resolve(path.dirname(parentPath), filePath)
    : path.resolve(filePath);
  const raw = await Deno.readTextFile(resolved);
  const { attrs, body } = extract(raw) as {
    attrs: ParsedFrontmatter;
    body: string;
  };
  const deckAttrs = attrs as { deck?: DeckDefinition } & DeckDefinition;
  const deckMeta: Partial<DeckDefinition> =
    (deckAttrs.deck ?? deckAttrs) as DeckDefinition;

  const actions = normalizeActions(
    (deckMeta as unknown as { actions?: unknown }).actions,
    resolved,
  );
  actions.forEach((a) => {
    if (a.name.startsWith(RESERVED_TOOL_PREFIX)) {
      throw new Error(`Action name ${a.name} is reserved`);
    }
    if (
      !TOOL_NAME_PATTERN.test(a.name) || a.name.length > MAX_TOOL_NAME_LENGTH
    ) {
      throw new Error(
        `Action name ${a.name} must match ${TOOL_NAME_PATTERN} and be <= ${MAX_TOOL_NAME_LENGTH} characters`,
      );
    }
  });

  const embeds = extractEmbedsFromBody(body).concat(deckMeta.embeds ?? []);

  const inputSchema = await maybeLoadSchema(
    (deckMeta as { inputSchema?: unknown }).inputSchema,
    resolved,
  );
  const outputSchema = await maybeLoadSchema(
    (deckMeta as { outputSchema?: unknown }).outputSchema,
    resolved,
  );

  const cards: LoadedCard[] = [];
  for (const embed of embeds) {
    const card = await loadCard(embed, resolved, [resolved]);
    cards.push(card);
  }
  const allCards = flattenCards(cards);

  const mergedActions: Record<string, ActionDefinition> = {};
  for (const card of allCards) {
    for (const action of card.actions ?? []) {
      mergedActions[action.name] = action;
    }
  }
  for (const action of actions) {
    mergedActions[action.name] = action;
  }

  let mergedInputSchema = inputSchema;
  let mergedOutputSchema = outputSchema;
  for (const card of allCards) {
    mergedInputSchema = mergeZodObjects(
      mergedInputSchema,
      card.inputFragment,
    );
    mergedOutputSchema = mergeZodObjects(
      mergedOutputSchema,
      card.outputFragment,
    );
  }

  const handlers = deckMeta.handlers
    ? {
      onError: deckMeta.handlers.onError
        ? {
          ...deckMeta.handlers.onError,
          path: path.resolve(
            path.dirname(resolved),
            deckMeta.handlers.onError.path,
          ),
        }
        : undefined,
      onPing: deckMeta.handlers.onPing
        ? {
          ...deckMeta.handlers.onPing,
          path: path.resolve(
            path.dirname(resolved),
            deckMeta.handlers.onPing.path,
          ),
        }
        : undefined,
    }
    : undefined;

  return {
    kind: "gambit.deck",
    path: resolved,
    body: body.trim(),
    actions: Object.values(mergedActions),
    cards: allCards,
    embeds,
    label: deckMeta.label,
    modelParams: deckMeta.modelParams,
    guardrails: deckMeta.guardrails,
    inputSchema: mergedInputSchema,
    outputSchema: mergedOutputSchema,
    handlers,
  };
}

export function isMarkdownFile(filePath: string): boolean {
  return filePath.endsWith(".md");
}

function flattenCards(cards: LoadedCard[]): LoadedCard[] {
  const flat: LoadedCard[] = [];
  for (const card of cards) {
    flat.push(card);
    const nested = (card as { cards?: LoadedCard[] }).cards ?? [];
    if (nested.length) flat.push(...flattenCards(nested));
  }
  return flat;
}
