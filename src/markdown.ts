import { extract } from "@std/front-matter/any";
import * as path from "@std/path";
import { RESERVED_TOOL_PREFIX } from "./constants.ts";
import { isCardDefinition } from "./definitions.ts";
import { loadCard } from "./loader.ts";
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

function normalizeActions(actions: unknown): ActionDefinition[] {
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
        path: p,
        description: typeof rec.description === "string" ? rec.description : undefined,
        activity: typeof rec.activity === "string" ? rec.activity : undefined,
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
): Promise<LoadedCard> {
  const resolved = parentPath
    ? path.resolve(path.dirname(parentPath), filePath)
    : path.resolve(filePath);
  const raw = await Deno.readTextFile(resolved);
  const { attrs, body } = extract(raw) as { attrs: ParsedFrontmatter; body: string };
  const candidate = attrs as unknown;
  if (isCardDefinition(candidate)) {
    // treat attrs as ts-shaped card
  }
  const actions = normalizeActions((attrs as { actions?: unknown }).actions);
  actions.forEach((a) => {
    if (a.name.startsWith(RESERVED_TOOL_PREFIX)) {
      throw new Error(`Action name ${a.name} is reserved`);
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

  return {
    kind: "gambit.card",
    path: resolved,
    body: body.trim(),
    actions,
    embeds,
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
  const { attrs, body } = extract(raw) as { attrs: ParsedFrontmatter; body: string };
  const deckAttrs = attrs as { deck?: DeckDefinition } & DeckDefinition;
  const deckMeta: Partial<DeckDefinition> =
    (deckAttrs.deck ?? deckAttrs) as DeckDefinition;

  const actions = normalizeActions(
    (deckMeta as unknown as { actions?: unknown }).actions,
  );
  actions.forEach((a) => {
    if (a.name.startsWith(RESERVED_TOOL_PREFIX)) {
      throw new Error(`Action name ${a.name} is reserved`);
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
    const card = await loadCard(embed, resolved);
    cards.push(card);
  }

  return {
    kind: "gambit.deck",
    path: resolved,
    prompt: body.trim(),
    actions,
    cards,
    embeds,
    activity: deckMeta.activity,
    modelParams: deckMeta.modelParams,
    guardrails: deckMeta.guardrails,
    inputSchema,
    outputSchema,
    errorHandler: deckMeta.errorHandler,
    suspenseHandler: deckMeta.suspenseHandler,
    suspenseDelayMs: deckMeta.suspenseDelayMs,
  };
}

export function isMarkdownFile(filePath: string): boolean {
  return filePath.endsWith(".md");
}
