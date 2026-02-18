import { walk } from "@std/fs";
import * as path from "@std/path";

const args = new Set(Deno.args);
const help = args.has("--help") || args.has("-h");
const dryRun = args.has("--dry-run");
const rootArg = Deno.args.find((arg) => !arg.startsWith("-"));
const rootDir = path.resolve(rootArg ?? Deno.cwd());

if (help) {
  console.log(`Usage: deno run -A scripts/migrate-schema-terms.ts [root]\n`);
  console.log("Options:");
  console.log("  --dry-run   Print changes without writing files");
  Deno.exit(0);
}

const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".vscode",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".next",
  ".cache",
  "vendor",
]);

const TARGET_EXTS = new Set([
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".toml",
  ".yaml",
  ".yml",
]);

const replacements: Array<[RegExp, string]> = [
  [/\binputSchema\b/g, "contextSchema"],
  [/\boutputSchema\b/g, "responseSchema"],
  [/\binputFragment\b/g, "contextFragment"],
  [/\boutputFragment\b/g, "responseFragment"],
  [/gambit:\/\/init\b/g, "gambit://snippets/context.md"],
  [/gambit:\/\/respond\b/g, "gambit://snippets/respond.md"],
  [/gambit:\/\/end\b/g, "gambit://snippets/end.md"],
];

const updated: Array<string> = [];

for await (const entry of walk(rootDir, { includeDirs: false })) {
  const rel = path.relative(rootDir, entry.path);
  const segments = rel.split(path.SEPARATOR);
  if (segments.some((segment) => SKIP_DIRS.has(segment))) continue;
  if (!TARGET_EXTS.has(path.extname(entry.path))) continue;

  let text: string;
  try {
    text = await Deno.readTextFile(entry.path);
  } catch {
    continue;
  }

  let next = text;
  for (const [pattern, replacement] of replacements) {
    next = next.replace(pattern, replacement);
  }

  if (next === text) continue;
  updated.push(rel);
  if (!dryRun) {
    await Deno.writeTextFile(entry.path, next);
  }
}

if (!updated.length) {
  console.log("No files needed updates.");
} else if (dryRun) {
  console.log(`Would update ${updated.length} files:`);
  updated.forEach((file) => console.log(`- ${file}`));
} else {
  console.log(`Updated ${updated.length} files:`);
  updated.forEach((file) => console.log(`- ${file}`));
}
