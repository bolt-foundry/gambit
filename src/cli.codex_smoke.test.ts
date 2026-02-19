import { assertEquals } from "@std/assert";
import * as path from "@std/path";

function cliPath(): string {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  return path.join(here, "cli.ts");
}

function repoRootPath(): string {
  const srcDir = path.dirname(path.fromFileUrl(import.meta.url));
  return path.dirname(srcDir);
}

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

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

async function denoRunArgs(cliArgs: Array<string>): Promise<Array<string>> {
  const args = ["run", "-A"];
  const configPath = await resolveRepoDenoConfigPath();
  if (configPath) {
    args.push("--config", configPath);
  }
  args.push(cliPath(), ...cliArgs);
  return args;
}

function formatCommandDiagnostics(
  label: string,
  result: CommandResult & { argsLog?: string },
): string {
  const stdout = result.stdout.trim().length > 0 ? result.stdout : "(empty)";
  const stderr = result.stderr.trim().length > 0 ? result.stderr : "(empty)";
  const parts = [
    `${label} failed`,
    `exit code: ${result.code}`,
    `stdout:\n${stdout}`,
    `stderr:\n${stderr}`,
  ];
  if (result.argsLog !== undefined) {
    const argsLog = result.argsLog.trim().length > 0
      ? result.argsLog
      : "(empty)";
    parts.push(`codex args:\n${argsLog}`);
  }
  return parts.join("\n\n");
}

async function writeDeck(
  dir: string,
  model: string,
  verbosity?: "low" | "medium" | "high",
): Promise<string> {
  const deckPath = path.join(dir, "root.deck.md");
  const verbosityLine = verbosity ? `verbosity = "${verbosity}"\n` : "";
  const contents = `+++
label = "codex smoke"

[modelParams]
model = "${model}"
${verbosityLine}+++

Smoke deck.
`;
  await Deno.writeTextFile(deckPath, contents);
  return deckPath;
}

async function writeMockCodexBin(dir: string): Promise<{
  binPath: string;
  argsLogPath: string;
}> {
  const binPath = path.join(dir, "mock-codex.sh");
  const argsLogPath = path.join(dir, "codex-args.log");
  const script = `#!/usr/bin/env bash
set -euo pipefail
if [ -z "\${CODEX_ARGS_LOG:-}" ]; then
  echo "missing CODEX_ARGS_LOG" >&2
  exit 1
fi
printf '%s\n' "$@" > "$CODEX_ARGS_LOG"
echo '{"type":"thread.started","thread_id":"thread-smoke"}'
echo '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}'
echo '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}'
`;
  await Deno.writeTextFile(binPath, script);
  await Deno.chmod(binPath, 0o755);
  return { binPath, argsLogPath };
}

async function runCheck(deckPath: string): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const args = await denoRunArgs(["check", deckPath]);
  const command = new Deno.Command(Deno.execPath(), {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await command.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

async function runInit(): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const args = await denoRunArgs(["init"]);
  const command = new Deno.Command(Deno.execPath(), {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await command.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

async function writeProjectConfig(
  dir: string,
  fallback: string,
): Promise<string> {
  const configPath = path.join(dir, "gambit.toml");
  const contents = `[providers]
fallback = "${fallback}"
`;
  await Deno.writeTextFile(configPath, contents);
  return configPath;
}

async function runDeck(input: {
  deckPath: string;
  codexBinPath: string;
  argsLogPath: string;
  cwd?: string;
}): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  argsLog: string;
}> {
  const args = await denoRunArgs(["run", input.deckPath, "--message", "hi"]);
  const command = new Deno.Command(Deno.execPath(), {
    args,
    cwd: input.cwd,
    env: {
      GAMBIT_CODEX_BIN: input.codexBinPath,
      GAMBIT_CODEX_DISABLE_MCP: "1",
      CODEX_ARGS_LOG: input.argsLogPath,
    },
    stdout: "piped",
    stderr: "piped",
  });
  const out = await command.output();
  let argsLog = "";
  try {
    argsLog = await Deno.readTextFile(input.argsLogPath);
  } catch {
    // no-op for failure assertions
  }
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
    argsLog,
  };
}

Deno.test({
  name: "cli smoke: check passes with codex-cli/default",
  permissions: { read: true, write: true, run: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "codex-cli/default");
  const result = await runCheck(deckPath);
  assertEquals(
    result.code,
    0,
    formatCommandDiagnostics("check codex-cli/default", result),
  );
});

Deno.test({
  name: "cli smoke: init command is removed with migration guidance",
  permissions: { read: true, run: true },
}, async () => {
  const result = await runInit();
  assertEquals(result.code, 1, formatCommandDiagnostics("init", result));
  const combined = `${result.stdout}\n${result.stderr}`;
  assertEquals(combined.includes("gambit init"), true);
  assertEquals(combined.includes("gambit serve"), true);
});

Deno.test({
  name: "cli smoke: check fails for legacy codex/default",
  permissions: { read: true, write: true, run: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "codex/default");
  const result = await runCheck(deckPath);
  assertEquals(
    result.code,
    1,
    formatCommandDiagnostics("check codex/default", result),
  );
  const combined = `${result.stdout}\n${result.stderr}`;
  assertEquals(combined.includes("legacy codex prefix is unsupported"), true);
});

Deno.test({
  name: 'cli smoke: check fails fast when providers.fallback is legacy "codex"',
  permissions: { read: true, write: true, run: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  await writeProjectConfig(dir, "codex");
  const deckPath = await writeDeck(dir, "llama3");
  const result = await runCheck(deckPath);
  assertEquals(
    result.code,
    1,
    formatCommandDiagnostics("check fallback=codex", result),
  );
  const combined = `${result.stdout}\n${result.stderr}`;
  assertEquals(
    combined.includes('providers.fallback "codex" is no longer supported'),
    true,
  );
});

Deno.test({
  name: "cli smoke: run maps model selection and verbosity for codex-cli",
  permissions: { read: true, write: true, run: true, env: true },
}, async () => {
  // Use workspace-backed temp dir to avoid /tmp mounts with noexec in CI.
  // Place it under ignored tmp/ and always clean up artifacts.
  const rootTmpDir = path.join(Deno.cwd(), "tmp");
  await Deno.mkdir(rootTmpDir, { recursive: true });
  const dir = await Deno.makeTempDir({ dir: rootTmpDir });

  try {
    const mock = await writeMockCodexBin(dir);

    const defaultDeck = await writeDeck(dir, "codex-cli/default", "high");
    const defaultRun = await runDeck({
      deckPath: defaultDeck,
      codexBinPath: mock.binPath,
      argsLogPath: mock.argsLogPath,
      cwd: dir,
    });
    assertEquals(
      defaultRun.code,
      0,
      formatCommandDiagnostics("run codex-cli/default", defaultRun),
    );
    assertEquals(defaultRun.argsLog.includes("\n-m\n"), false);
    assertEquals(defaultRun.argsLog.includes('model_verbosity="high"'), true);

    const passthroughDeck = await writeDeck(
      dir,
      "codex-cli/gpt-5.2-codex",
      "high",
    );
    const passthroughRun = await runDeck({
      deckPath: passthroughDeck,
      codexBinPath: mock.binPath,
      argsLogPath: mock.argsLogPath,
      cwd: dir,
    });
    assertEquals(
      passthroughRun.code,
      0,
      formatCommandDiagnostics("run codex-cli/gpt-5.2-codex", passthroughRun),
    );
    assertEquals(
      passthroughRun.argsLog.includes("\n-m\ngpt-5.2-codex\n"),
      true,
    );
    assertEquals(
      passthroughRun.argsLog.includes('model_verbosity="high"'),
      true,
    );
  } finally {
    await Deno.remove(dir, { recursive: true }).catch((err) => {
      if (err instanceof Deno.errors.NotFound) return;
      throw err;
    });
  }
});
