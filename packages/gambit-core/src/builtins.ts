import * as path from "@std/path";

const CARDS_PREFIX = "gambit://cards/";
const SNIPPETS_PREFIX = "gambit://snippets/";
const SCHEMAS_PREFIX = "gambit://schemas/";
const DECKS_PREFIX = "gambit://decks/";

const CARDS_BASE_URL = new URL("../cards/", import.meta.url);
const SNIPPETS_BASE_URL = new URL("../snippets/", import.meta.url);
const SCHEMAS_BASE_URL = new URL("../schemas/", import.meta.url);
const DECKS_BASE_URL = new URL("../decks/", import.meta.url);

const LEGACY_CARD_WARNINGS = new Set<string>();
const LEGACY_SCHEMA_WARNINGS = new Set<string>();
const LEGACY_DECK_WARNINGS = new Set<string>();
const logger = console;

function resolveFromBase(base: URL, relative: string): string {
  return path.fromFileUrl(new URL(relative, base));
}

export function resolveBuiltinCardPath(target: string): string | undefined {
  if (!target.startsWith(CARDS_PREFIX)) return undefined;
  if (!LEGACY_CARD_WARNINGS.has(target)) {
    LEGACY_CARD_WARNINGS.add(target);
    logger.warn(
      `[gambit] "${target}" is deprecated; use gambit://snippets instead.`,
    );
  }
  const relative = target.slice(CARDS_PREFIX.length);
  if (!relative) {
    throw new Error(`Invalid gambit card specifier: ${target}`);
  }
  return resolveFromBase(CARDS_BASE_URL, relative);
}

export function resolveBuiltinSnippetPath(target: string): string | undefined {
  if (!target.startsWith(SNIPPETS_PREFIX)) return undefined;
  const relative = target.slice(SNIPPETS_PREFIX.length);
  if (!relative) {
    throw new Error(`Invalid gambit snippet specifier: ${target}`);
  }
  return resolveFromBase(SNIPPETS_BASE_URL, relative);
}

export function resolveBuiltinSchemaPath(target: string): string | undefined {
  if (!target.startsWith(SCHEMAS_PREFIX)) return undefined;
  let relative = target.slice(SCHEMAS_PREFIX.length);
  if (!relative) {
    throw new Error(`Invalid gambit schema specifier: ${target}`);
  }
  if (relative.endsWith(".ts") && !relative.endsWith(".zod.ts")) {
    if (!LEGACY_SCHEMA_WARNINGS.has(target)) {
      LEGACY_SCHEMA_WARNINGS.add(target);
      logger.warn(
        `[gambit] "${target}" is deprecated; use .zod.ts schema URIs instead.`,
      );
    }
    relative = `${relative.slice(0, -3)}.zod.ts`;
  }
  return resolveFromBase(SCHEMAS_BASE_URL, relative);
}

export function resolveBuiltinDeckPath(target: string): string | undefined {
  if (!target.startsWith(DECKS_PREFIX)) return undefined;
  let relative = target.slice(DECKS_PREFIX.length);
  if (!relative) {
    throw new Error(`Invalid gambit deck specifier: ${target}`);
  }
  if (!relative.endsWith("/PROMPT.md")) {
    if (!LEGACY_DECK_WARNINGS.has(target)) {
      LEGACY_DECK_WARNINGS.add(target);
      logger.warn(
        `[gambit] "${target}" is deprecated; use gambit://decks/.../PROMPT.md instead.`,
      );
    }
    relative = `${relative.replace(/\/?$/, "/")}PROMPT.md`;
  }
  return resolveFromBase(DECKS_BASE_URL, relative);
}
