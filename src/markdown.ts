import { extract } from "@std/front-matter/any";
import * as path from "@std/path";
import {
  GAMBIT_TOOL_INIT,
  GAMBIT_TOOL_RESPOND,
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
const RESPOND_MARKER = "gambit://respond";
const INIT_MARKER = "gambit://init";

const INIT_TEXT = `
You will automatically receive a \`${GAMBIT_TOOL_INIT}\` tool result at the start that provides run/context info. Do not call this tool yourself; use the provided context.
`.trim();

const RESPOND_TEXT = `
When you are done, call the \`${GAMBIT_TOOL_RESPOND}\` tool with a JSON object that includes your \`payload\` (validated output) and optional \`status\`/ \`message\`/ \`code\`/ \`meta\`. Do not end with normal assistant text; always finish by calling \`${GAMBIT_TOOL_RESPOND}\`.
`.trim();

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

function replaceEmbedMarkers(
  body: string,
): { cleaned: string; embeds: string[]; respond: boolean; initHint: boolean } {
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  const embeds: string[] = [];
  let respond = false;
  let initHint = false;
  const cleaned = body.replace(regex, (_m, p1: string) => {
    if (p1 === RESPOND_MARKER) {
      respond = true;
      return RESPOND_TEXT;
    }
    if (p1 === INIT_MARKER) {
      initHint = true;
      return INIT_TEXT;
    }
    embeds.push(p1);
    return "";
  });
  return { cleaned, embeds, respond, initHint };
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
    if (
      a.name.startsWith(RESERVED_TOOL_PREFIX) &&
      a.name !== GAMBIT_TOOL_INIT &&
      a.name !== GAMBIT_TOOL_RESPOND
    ) {
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
  const replaced = replaceEmbedMarkers(body);
  const embeds = replaced.embeds.concat(
    Array.isArray((attrs as { embeds?: unknown }).embeds)
      ? (attrs as { embeds?: string[] }).embeds ?? []
      : [],
  );
  const cleanedBody = replaced.cleaned;
  const embeddedCards: LoadedCard[] = [];
  for (const embed of embeds) {
    const card = await loadCard(embed, resolved, nextStack);
    embeddedCards.push(card);
  }

  return {
    kind: "gambit.card",
    path: resolved,
    body: cleanedBody.trim(),
    actions,
    embeds,
    cards: embeddedCards,
    inputFragment,
    outputFragment,
    syntheticTools: replaced.respond ? { respond: true } : undefined,
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
    if (
      a.name.startsWith(RESERVED_TOOL_PREFIX) &&
      a.name !== GAMBIT_TOOL_INIT &&
      a.name !== GAMBIT_TOOL_RESPOND
    ) {
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

  const replaced = replaceEmbedMarkers(body);
  const embeds = replaced.embeds.concat(deckMeta.embeds ?? []);

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
  const cleanedBody = replaced.cleaned;

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
      onInterval: deckMeta.handlers.onInterval
        ? {
          ...deckMeta.handlers.onInterval,
          path: path.resolve(
            path.dirname(resolved),
            deckMeta.handlers.onInterval.path,
          ),
        }
        : undefined,
    }
    : undefined;

  return {
    kind: "gambit.deck",
    path: resolved,
    body: cleanedBody.trim(),
    actions: Object.values(mergedActions),
    cards: allCards,
    embeds,
    label: deckMeta.label,
    modelParams: deckMeta.modelParams,
    guardrails: deckMeta.guardrails,
    inputSchema: mergedInputSchema,
    outputSchema: mergedOutputSchema,
    handlers,
    syntheticTools: {
      ...deckMeta.syntheticTools,
      respond: deckMeta.syntheticTools?.respond ||
        replaced.respond ||
        allCards.some((c) => c.syntheticTools?.respond),
    },
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
