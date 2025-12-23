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
  ActionDeckDefinition,
  DeckDefinition,
  GraderDeckDefinition,
  LoadedCard,
  LoadedDeck,
  TestDeckDefinition,
} from "./types.ts";
import type { ZodTypeAny } from "zod";

const logger = console;

type ParsedFrontmatter = Record<string, unknown>;
const RESPOND_MARKER = "gambit://respond";
const INIT_MARKER = "gambit://init";

const INIT_TEXT = `
You will automatically receive a \`${GAMBIT_TOOL_INIT}\` tool result at the start that provides run/context info.
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

type DeckRef = {
  path: string;
  label?: string;
  description?: string;
  id?: string;
};

function normalizeDeckRefs<T extends DeckRef>(
  refs: unknown,
  basePath: string,
): Array<T> {
  if (!Array.isArray(refs)) return [];
  return refs
    .filter((a) => a && typeof a === "object")
    .map((a) => {
      const rec = a as Record<string, unknown>;
      const p = String(rec.path ?? "").trim();
      if (!p) {
        throw new Error("Deck reference must include a path");
      }
      const normalized: Record<string, unknown> = { ...rec };
      normalized.path = path.resolve(path.dirname(basePath), p);
      if (typeof rec.description !== "string") delete normalized.description;
      if (typeof rec.label !== "string") delete normalized.label;
      if (typeof rec.id !== "string") delete normalized.id;
      return normalized as T;
    });
}

function normalizeActionDecks(
  entries: unknown,
  basePath: string,
): Array<ActionDeckDefinition> {
  return normalizeDeckRefs<ActionDeckDefinition>(entries, basePath).map(
    (entry) => {
      const name = "name" in entry ? String(entry.name ?? "").trim() : "";
      if (!name) {
        throw new Error(`Action deck must include a name (${basePath})`);
      }
      return { ...entry, name };
    },
  );
}

async function expandEmbedsInBody(args: {
  body: string;
  resolvedPath: string;
  stack: Array<string>;
}): Promise<{
  body: string;
  embeds: Array<LoadedCard>;
  respond: boolean;
  initHint: boolean;
}> {
  const { body, resolvedPath, stack } = args;
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  const embeds: Array<LoadedCard> = [];
  let respond = false;
  let initHint = false;
  let out = "";
  let lastIndex = 0;

  for (const match of body.matchAll(regex)) {
    const matchIndex = match.index ?? 0;
    const target = match[1];
    out += body.slice(lastIndex, matchIndex);
    if (target === RESPOND_MARKER) {
      respond = true;
      out += RESPOND_TEXT;
    } else if (target === INIT_MARKER) {
      initHint = true;
      out += INIT_TEXT;
    } else {
      const card = await loadCard(target, resolvedPath, stack);
      embeds.push(card);
      if (card.body) out += card.body;
    }
    lastIndex = matchIndex + match[0].length;
  }

  out += body.slice(lastIndex);

  return { body: out, embeds, respond, initHint };
}

export async function loadMarkdownCard(
  filePath: string,
  parentPath?: string,
  stack: Array<string> = [],
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
  let attrs: ParsedFrontmatter;
  let body: string;
  try {
    const parsed = extract(raw) as { attrs: ParsedFrontmatter; body: string };
    attrs = parsed.attrs;
    body = parsed.body;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse front matter in ${resolved}: ${message}`);
  }
  const candidate = attrs as unknown;
  if (isCardDefinition(candidate)) {
    // treat attrs as ts-shaped card
  }
  if ((candidate as { handlers?: unknown }).handlers) {
    throw new Error(
      `Card at ${resolved} cannot declare handlers (deck-only)`,
    );
  }
  const hasNewActionField = (attrs as { actionDecks?: unknown }).actionDecks;
  const legacyActions = (attrs as { actions?: unknown }).actions;
  const actionDecks = normalizeActionDecks(
    hasNewActionField ?? legacyActions,
    resolved,
  );
  if (!hasNewActionField && legacyActions) {
    logger.warn(
      `[gambit] card at ${resolved} uses deprecated "actions"; rename to "actionDecks"`,
    );
  }
  actionDecks.forEach((a) => {
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
  const replaced = await expandEmbedsInBody({
    body,
    resolvedPath: resolved,
    stack: nextStack,
  });
  const cleanedBody = replaced.body;
  const embeddedCards = replaced.embeds;

  return {
    kind: "gambit.card",
    path: resolved,
    body: cleanedBody.trim(),
    actionDecks,
    actions: actionDecks,
    testDecks: normalizeDeckRefs<TestDeckDefinition>(
      (attrs as { testDecks?: unknown }).testDecks,
      resolved,
    ),
    graderDecks: normalizeDeckRefs<GraderDeckDefinition>(
      (attrs as { graderDecks?: unknown }).graderDecks,
      resolved,
    ),
    cards: embeddedCards,
    inputFragment,
    outputFragment,
    respond: replaced.respond,
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
  let attrs: ParsedFrontmatter;
  let body: string;
  try {
    const parsed = extract(raw) as { attrs: ParsedFrontmatter; body: string };
    attrs = parsed.attrs;
    body = parsed.body;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse front matter in ${resolved}: ${message}`);
  }
  const deckAttrs = attrs as { deck?: DeckDefinition } & DeckDefinition;
  const deckMeta: Partial<DeckDefinition> =
    (deckAttrs.deck ?? deckAttrs) as DeckDefinition;

  const hasNewActionDecks = (deckMeta as {
    actionDecks?: unknown;
  }).actionDecks;
  const legacyDeckActions = (deckMeta as { actions?: unknown }).actions;
  const actionDecks = normalizeActionDecks(
    hasNewActionDecks ?? legacyDeckActions,
    resolved,
  );
  if (!hasNewActionDecks && legacyDeckActions) {
    logger.warn(
      `[gambit] deck at ${resolved} uses deprecated "actions"; rename to "actionDecks"`,
    );
  }
  actionDecks.forEach((a) => {
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

  const replaced = await expandEmbedsInBody({
    body,
    resolvedPath: resolved,
    stack: [resolved],
  });
  const cards = replaced.embeds;

  const inputSchema = await maybeLoadSchema(
    (deckMeta as { inputSchema?: unknown }).inputSchema,
    resolved,
  );
  const outputSchema = await maybeLoadSchema(
    (deckMeta as { outputSchema?: unknown }).outputSchema,
    resolved,
  );

  const allCards = flattenCards(cards);
  const cleanedBody = replaced.body;

  const mergedActions: Record<string, ActionDeckDefinition> = {};
  for (const card of allCards) {
    for (const action of card.actionDecks ?? []) {
      mergedActions[action.name] = action;
    }
  }
  for (const action of actionDecks) {
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

  const intervalAlias = deckMeta.handlers?.onInterval;
  const onBusy = normalizeHandler(
    deckMeta.handlers?.onBusy ?? intervalAlias,
    intervalAlias ? "onInterval" : "onBusy",
  );
  if (!deckMeta.handlers?.onBusy && intervalAlias) {
    logger.warn(
      `[gambit] handlers.onInterval is deprecated; use handlers.onBusy (${resolved})`,
    );
  }
  const onIdle = normalizeHandler(deckMeta.handlers?.onIdle, "onIdle");

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
      onBusy,
      onIdle,
    }
    : undefined;

  const mergedActionDecks = Object.values(mergedActions);

  return {
    kind: "gambit.deck",
    path: resolved,
    body: cleanedBody.trim(),
    actionDecks: mergedActionDecks,
    actions: mergedActionDecks,
    testDecks: normalizeDeckRefs<TestDeckDefinition>(
      (deckMeta as { testDecks?: unknown }).testDecks,
      resolved,
    ),
    graderDecks: normalizeDeckRefs<GraderDeckDefinition>(
      (deckMeta as { graderDecks?: unknown }).graderDecks,
      resolved,
    ),
    cards: allCards,
    label: deckMeta.label,
    modelParams: deckMeta.modelParams,
    guardrails: deckMeta.guardrails,
    inputSchema: mergedInputSchema,
    outputSchema: mergedOutputSchema,
    handlers,
    respond: replaced.respond || allCards.some((c) => c.respond),
    inlineEmbeds: true,
  };
}

export function isMarkdownFile(filePath: string): boolean {
  return filePath.endsWith(".md");
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
