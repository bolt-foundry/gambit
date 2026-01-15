import * as path from "@std/path";

const packageRoot = path.dirname(
  path.dirname(path.fromFileUrl(import.meta.url)),
);
const denoBin = Deno.execPath();

const baseArgs = [
  "compile",
  "-A",
  "--include",
  "deno.jsonc",
  "--include",
  "docs/cli/commands",
  "--include",
  "examples/init",
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
