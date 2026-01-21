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
const coreSchemas = normalizePath(path.join(coreRel, "schemas"));

const baseArgs = [
  "compile",
  "-A",
  "--include",
  "deno.jsonc",
  "--include",
  "docs/cli/commands",
  "--include",
  coreCards,
  "--include",
  coreSchemas,
  "--include",
  "scaffolds",
  "--include",
  "simulator-ui/dist",
];

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
