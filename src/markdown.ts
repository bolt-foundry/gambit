import { extract } from "@std/front-matter/any";
import * as path from "@std/path";
import {
  MAX_TOOL_NAME_LENGTH,
  RESERVED_TOOL_PREFIX,
  TOOL_NAME_PATTERN,
} from "./constants.ts";
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
): Promise<LoadedCard> {
  const resolved = parentPath
    ? path.resolve(path.dirname(parentPath), filePath)
    : path.resolve(filePath);
  const raw = await Deno.readTextFile(resolved);
  const { attrs, body } = extract(raw) as {
    attrs: ParsedFrontmatter;
    body: string;
  };
  const candidate = attrs as unknown;
  if (isCardDefinition(candidate)) {
    // treat attrs as ts-shaped card
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
    const card = await loadCard(embed, resolved);
    cards.push(card);
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
      onSuspense: deckMeta.handlers.onSuspense
        ? {
          ...deckMeta.handlers.onSuspense,
          path: path.resolve(
            path.dirname(resolved),
            deckMeta.handlers.onSuspense.path,
          ),
        }
        : undefined,
    }
    : undefined;

  return {
    kind: "gambit.deck",
    path: resolved,
    body: body.trim(),
    actions,
    cards,
    embeds,
    label: deckMeta.label,
    modelParams: deckMeta.modelParams,
    guardrails: deckMeta.guardrails,
    inputSchema,
    outputSchema,
    handlers,
  };
}

export function isMarkdownFile(filePath: string): boolean {
  return filePath.endsWith(".md");
}
