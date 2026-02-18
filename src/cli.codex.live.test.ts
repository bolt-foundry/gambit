import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import {
  getEnvValue,
  shouldRunLiveTests,
} from "./providers/live_test_utils.ts";

function cliPath(): string {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  return path.join(here, "cli.ts");
}

function repoRootPath(): string {
  const srcDir = path.dirname(path.fromFileUrl(import.meta.url));
  return path.dirname(srcDir);
}

async function resolveRepoDenoConfigPath(): Promise<string | undefined> {
  const root = repoRootPath();
  for (const fileName of ["deno.ci.json", "deno.jsonc", "deno.json"]) {
    const candidate = path.join(root, fileName);
    try {
      const info = await Deno.stat(candidate);
      if (info.isFile) return candidate;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) continue;
      throw err;
    }
  }
  return undefined;
}

async function writeDeck(
  dir: string,
  model: string,
): Promise<string> {
  const deckPath = path.join(dir, "live-codex.deck.md");
  const contents = `+++
label = "live codex cli test"

[modelParams]
model = "${model}"
verbosity = "low"

[modelParams.reasoning]
effort = "minimal"
summary = "concise"
+++

Reply with one short word.
`;
  await Deno.writeTextFile(deckPath, contents);
  return deckPath;
}

function shouldRunLiveCodexTests(): boolean {
  return shouldRunLiveTests() &&
    Deno.env.get("GAMBIT_RUN_LIVE_CODEX_TESTS") === "1";
}

function buildLiveCodexEnv(): { model: string; env: Record<string, string> } {
  const model = getEnvValue("GAMBIT_LIVE_CODEX_MODEL") ?? "codex-cli/default";
  const codexBin = getEnvValue("GAMBIT_LIVE_CODEX_BIN") ??
    getEnvValue("GAMBIT_CODEX_BIN");
  const env: Record<string, string> = {
    GAMBIT_CODEX_DISABLE_MCP: "1",
  };
  if (codexBin) {
    env.GAMBIT_CODEX_BIN = codexBin;
  }
  return { model, env };
}

async function runLiveCliViaDeno(input: {
  deckPath: string;
  env: Record<string, string>;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  const configPath = await resolveRepoDenoConfigPath();
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      ...(configPath ? ["--config", configPath] : []),
      cliPath(),
      "run",
      input.deckPath,
      "--message",
      "Say pong.",
    ],
    env: input.env,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await command.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout).trim(),
    stderr: new TextDecoder().decode(out.stderr).trim(),
  };
}

async function compileCliBinary(outPath: string): Promise<void> {
  const configPath = await resolveRepoDenoConfigPath();
  const compile = new Deno.Command(Deno.execPath(), {
    args: [
      "compile",
      "-A",
      ...(configPath ? ["--config", configPath] : []),
      "-o",
      outPath,
      cliPath(),
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const out = await compile.output();
  const stderr = new TextDecoder().decode(out.stderr).trim();
  const stdout = new TextDecoder().decode(out.stdout).trim();
  assertEquals(
    out.code,
    0,
    `failed to compile gambit CLI binary (exit ${out.code}): ${
      stderr || stdout
    }`,
  );
}

async function runLiveCliViaCompiledBinary(input: {
  binaryPath: string;
  deckPath: string;
  env: Record<string, string>;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  const command = new Deno.Command(input.binaryPath, {
    args: ["run", input.deckPath, "--message", "Say pong."],
    env: input.env,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await command.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout).trim(),
    stderr: new TextDecoder().decode(out.stderr).trim(),
  };
}

Deno.test({
  name: "cli live: run uses real codex binary",
  ignore: !shouldRunLiveCodexTests(),
  permissions: { read: true, write: true, run: true, env: true },
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const { model, env } = buildLiveCodexEnv();
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, model);
  const out = await runLiveCliViaDeno({ deckPath, env });
  assertEquals(
    out.code,
    0,
    `live codex CLI run failed (exit ${out.code}): ${out.stderr || out.stdout}`,
  );
  assert(out.stdout.length > 0, "expected non-empty assistant output");
});

Deno.test({
  name: "cli live: compiled binary run uses real codex binary",
  ignore: !shouldRunLiveCodexTests() ||
    Deno.env.get("GAMBIT_RUN_LIVE_CODEX_COMPILED_TESTS") !== "1",
  permissions: { read: true, write: true, run: true, env: true },
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const { model, env } = buildLiveCodexEnv();
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, model);
  const binaryPath = path.join(dir, "gambit-live");
  await compileCliBinary(binaryPath);
  const out = await runLiveCliViaCompiledBinary({ binaryPath, deckPath, env });
  assertEquals(
    out.code,
    0,
    `live compiled gambit run failed (exit ${out.code}): ${
      out.stderr || out.stdout
    }`,
  );
  assert(out.stdout.length > 0, "expected non-empty assistant output");
});
