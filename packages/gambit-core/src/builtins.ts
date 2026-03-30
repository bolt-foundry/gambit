import * as path from "@std/path";

const SNIPPETS_PREFIX = "gambit://snippets/";
const SCHEMAS_PREFIX = "gambit://schemas/";

const SNIPPETS_BASE_URL = new URL("../snippets/", import.meta.url);
const SCHEMAS_BASE_URL = new URL("../schemas/", import.meta.url);

const LEGACY_SCHEMA_WARNINGS = new Set<string>();
const LEGACY_SCHEMA_CONTEXT_WARNINGS = new Set<string>();
const logger = console;

function resolveFromBase(base: URL, relative: string): string {
  return path.fromFileUrl(new URL(relative, base));
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
  if (relative.startsWith("contexts/")) {
    if (!LEGACY_SCHEMA_CONTEXT_WARNINGS.has(target)) {
      LEGACY_SCHEMA_CONTEXT_WARNINGS.add(target);
      logger.warn(
        `[gambit] "${target}" is deprecated; use gambit://schemas/graders/${relative} instead.`,
      );
    }
    relative = `graders/${relative}`;
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
