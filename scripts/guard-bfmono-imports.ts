import { extname, resolve } from "@std/path";

const FORBIDDEN = "@bfmono/";
const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);
const SKIP_DIRS = new Set([
  ".git",
  ".deno",
  ".deno-cache",
  "node_modules",
  "dist",
  "build",
  "vendor",
  "thirdParty",
  "__generated__",
  "__isograph",
  "coverage",
  "tmp",
]);
const SKIP_PATH_SUFFIXES = [
  "scripts/guard-bfmono-imports.ts",
];

type Violation = {
  path: string;
  line: number;
  snippet: string;
};

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

async function findRoots(): Promise<Array<string>> {
  const roots: Array<string> = [];

  const hasGambit = await exists("packages/gambit/deno.jsonc") ||
    await exists("packages/gambit/deno.json");

  if (hasGambit) {
    roots.push("packages/gambit");
  } else if (await exists("deno.jsonc") || await exists("deno.json")) {
    roots.push(".");
  }

  if (roots.length === 0) {
    throw new Error("Unable to locate gambit deno.json(c) in this repo.");
  }

  const coreCandidates = [
    "packages/gambit/packages/gambit-core",
    "packages/gambit-core",
    "../gambit-core",
  ];
  for (const candidate of coreCandidates) {
    if (await exists(candidate)) {
      roots.push(candidate);
    }
  }

  return Array.from(new Set(roots));
}

function shouldScanFile(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return EXTENSIONS.has(extension);
}

function shouldSkipFile(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return SKIP_PATH_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = dir === "." ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      yield* walk(path);
      continue;
    }
    if (entry.isFile && shouldScanFile(path) && !shouldSkipFile(path)) {
      yield path;
    }
  }
}

const roots = await findRoots();
const seen = new Set<string>();
const violations: Array<Violation> = [];

for (const root of roots) {
  for await (const filePath of walk(root)) {
    const absolutePath = resolve(filePath);
    if (seen.has(absolutePath)) {
      continue;
    }
    seen.add(absolutePath);

    const contents = await Deno.readTextFile(filePath);
    if (!contents.includes(FORBIDDEN)) {
      continue;
    }

    const lines = contents.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.includes(FORBIDDEN)) {
        violations.push({
          path: filePath,
          line: i + 1,
          snippet: line.trim(),
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Found forbidden @bfmono imports in gambit packages:");
  for (const violation of violations) {
    console.error(
      `- ${violation.path}:${violation.line}: ${violation.snippet}`,
    );
  }
  Deno.exit(1);
}

console.log("No @bfmono imports found in gambit packages.");
