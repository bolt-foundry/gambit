import * as path from "@std/path";

const packageRoot = path.dirname(
  path.dirname(path.fromFileUrl(import.meta.url)),
);
const denoBin = Deno.execPath();

const normalizePath = (value: string) => value.replaceAll("\\", "/");

const coreDirCandidates = [
  path.resolve(packageRoot, "..", "gambit-core"),
  path.resolve(packageRoot, "packages", "gambit-core"),
];

const resolveCoreDir = async (): Promise<string> => {
  for (const candidate of coreDirCandidates) {
    try {
      await Deno.stat(candidate);
      return candidate;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `Unable to find gambit-core; looked in ${coreDirCandidates.join(", ")}`,
  );
};

const coreDir = await resolveCoreDir();
const coreRel = normalizePath(path.relative(packageRoot, coreDir));
const coreCards = normalizePath(path.join(coreRel, "cards"));
const coreSnippets = normalizePath(path.join(coreRel, "snippets"));
const coreSchemas = normalizePath(path.join(coreRel, "schemas"));
const coreDecks = normalizePath(path.join(coreRel, "decks"));
const coreRuntimeWorker = normalizePath(
  path.join(coreRel, "src", "runtime_worker.ts"),
);
const coreRuntimeOrchestrationWorker = normalizePath(
  path.join(coreRel, "src", "runtime_orchestration_worker.ts"),
);

const docIncludeCandidates = [
  "docs/cli/commands",
  "docs/external/reference/cli/commands",
];

const docIncludes: string[] = [];
for (const relPath of docIncludeCandidates) {
  try {
    await Deno.stat(path.join(packageRoot, relPath));
    docIncludes.push(relPath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) continue;
    throw err;
  }
}

const includeCandidates = [
  "deno.jsonc",
  ...docIncludes,
  coreCards,
  coreSnippets,
  coreSchemas,
  coreDecks,
  coreRuntimeWorker,
  coreRuntimeOrchestrationWorker,
  "src/decks",
  "scaffolds",
];

const includePaths: string[] = [];
for (const includePath of includeCandidates) {
  try {
    await Deno.stat(path.join(packageRoot, includePath));
    includePaths.push(includePath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) continue;
    throw err;
  }
}

const baseArgs = includePaths.flatMap((includePath) => [
  "--include",
  includePath,
]);

baseArgs.unshift("compile", "-A");

const extraArgs = Deno.args.filter((arg) => arg !== "--");
const hasOutput = extraArgs.some((arg, idx) =>
  arg === "--output" || arg === "-o" || arg.startsWith("--output=") ||
  (arg === "-o" && idx + 1 < extraArgs.length)
);
if (!hasOutput) {
  extraArgs.push("--output", "dist/gambit");
}

const cmd = new Deno.Command(denoBin, {
  args: [...baseArgs, ...extraArgs, "src/cli.ts"],
  cwd: packageRoot,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const result = await cmd.spawn().status;
Deno.exit(result.code);
