import * as path from "@std/path";

const CARDS_PREFIX = "gambit://cards/";
const SCHEMAS_PREFIX = "gambit://schemas/";

const CARDS_BASE_URL = new URL("../cards/", import.meta.url);
const SCHEMAS_BASE_URL = new URL("../schemas/", import.meta.url);

function resolveFromBase(base: URL, relative: string): string {
  return path.fromFileUrl(new URL(relative, base));
}

export function resolveBuiltinCardPath(target: string): string | undefined {
  if (!target.startsWith(CARDS_PREFIX)) return undefined;
  const relative = target.slice(CARDS_PREFIX.length);
  if (!relative) {
    throw new Error(`Invalid gambit card specifier: ${target}`);
  }
  return resolveFromBase(CARDS_BASE_URL, relative);
}

export function resolveBuiltinSchemaPath(target: string): string | undefined {
  if (!target.startsWith(SCHEMAS_PREFIX)) return undefined;
  const relative = target.slice(SCHEMAS_PREFIX.length);
  if (!relative) {
    throw new Error(`Invalid gambit schema specifier: ${target}`);
  }
  return resolveFromBase(SCHEMAS_BASE_URL, relative);
}
