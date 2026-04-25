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
  body = "Smoke deck.",
  extraFrontmatter = "",
): Promise<string> {
  const deckPath = path.join(dir, "root.deck.md");
  const verbosityLine = verbosity ? `verbosity = "${verbosity}"\n` : "";
  const frontmatterSuffix = extraFrontmatter ? `${extraFrontmatter}\n` : "";
  const contents = `+++
label = "codex smoke"

[modelParams]
model = "${model}"
${verbosityLine}+++

${body}
`;
  const finalContents = contents.replace(
    `${verbosityLine}+++\n\n`,
    `${verbosityLine}${frontmatterSuffix}+++\n\n`,
  );
  await Deno.writeTextFile(deckPath, finalContents);
  return deckPath;
}

async function writeMockCodexBin(dir: string): Promise<{
  binPath: string;
  argsLogPath: string;
  requestLogPath: string;
}> {
  const binPath = path.join(dir, "mock-codex.sh");
  const argsLogPath = path.join(dir, "codex-args.log");
  const requestLogPath = path.join(dir, "codex-requests.log");
  const script = `#!/usr/bin/env bash
set -euo pipefail
if [ -z "\${CODEX_ARGS_LOG:-}" ]; then
  echo "missing CODEX_ARGS_LOG" >&2
  exit 1
fi
if [ -z "\${CODEX_REQUESTS_LOG:-}" ]; then
  echo "missing CODEX_REQUESTS_LOG" >&2
  exit 1
fi
printf '%s\n' "$@" > "$CODEX_ARGS_LOG"
extract_id() {
  printf '%s\\n' "$1" | sed -nE 's/.*"id":("[^"]*"|[0-9]+).*/\\1/p'
}
while IFS= read -r line; do
  printf '%s\\n' "$line" >> "$CODEX_REQUESTS_LOG"
  case "$line" in
    *'"method":"initialize"'*)
      id="$(extract_id "$line")"
      printf '{"id":%s,"result":{"capabilities":{"experimentalApi":true}}}\\n' "$id"
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"thread/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":%s,"result":{"thread":{"id":"thread-smoke"}}}\\n' "$id"
      ;;
    *'"method":"thread/resume"'*)
      id="$(extract_id "$line")"
      printf '{"id":%s,"result":{"thread":{"id":"thread-smoke"}}}\\n' "$id"
      ;;
    *'"method":"turn/start"'*)
      id="$(extract_id "$line")"
      printf '{"id":%s,"result":{"turn":{"id":"turn-smoke","status":"inProgress","items":[],"error":null}}}\\n' "$id"
      printf '{"method":"item/completed","params":{"threadId":"thread-smoke","turnId":"turn-smoke","item":{"type":"agentMessage","id":"msg_1","text":"ok","phase":null,"memoryCitation":null}}}\\n'
      printf '{"method":"turn/completed","params":{"threadId":"thread-smoke","turn":{"id":"turn-smoke","status":"completed","items":[],"error":null,"startedAt":0,"completedAt":0,"durationMs":1}}}\\n'
      ;;
  esac
done
`;
  await Deno.writeTextFile(binPath, script);
  await Deno.chmod(binPath, 0o755);
  return { binPath, argsLogPath, requestLogPath };
}

async function runCheck(
  deckPath: string,
  env?: Record<string, string>,
  extraArgs: Array<string> = [],
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const args = await denoRunArgs(["check", deckPath, ...extraArgs]);
  const command = new Deno.Command(Deno.execPath(), {
    args,
    env,
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

async function writeMockCodexLoginBin(dir: string): Promise<string> {
  const binPath = path.join(dir, "mock-codex-login.sh");
  const script = `#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ge 2 ] && [ "$1" = "login" ] && [ "$2" = "status" ]; then
  echo "Logged in (mock)"
  exit 0
fi
echo "unsupported mock invocation" >&2
exit 1
`;
  await Deno.writeTextFile(binPath, script);
  await Deno.chmod(binPath, 0o755);
  return binPath;
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
  requestLogPath: string;
  cwd?: string;
  command?: "run" | "repl";
  extraArgs?: Array<string>;
}): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  argsLog: string;
  requestLog: string;
}> {
  const args = await denoRunArgs([
    input.command ?? "run",
    input.deckPath,
    "--message",
    "hi",
    ...(input.extraArgs ?? []),
  ]);
  const command = new Deno.Command(Deno.execPath(), {
    args,
    cwd: input.cwd,
    env: {
      GAMBIT_CODEX_BIN: input.codexBinPath,
      GAMBIT_CODEX_DISABLE_MCP: "1",
      CODEX_ARGS_LOG: input.argsLogPath,
      CODEX_REQUESTS_LOG: input.requestLogPath,
    },
    stdout: "piped",
    stderr: "piped",
  });
  const out = await command.output();
  let argsLog = "";
  let requestLog = "";
  try {
    argsLog = await Deno.readTextFile(input.argsLogPath);
  } catch {
    // no-op for failure assertions
  }
  try {
    requestLog = await Deno.readTextFile(input.requestLogPath);
  } catch {
    // no-op for failure assertions
  }
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
    argsLog,
    requestLog,
  };
}

Deno.test({
  name: "cli smoke: check passes with codex-cli/default",
  permissions: { read: true, write: true, run: true, env: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "codex-cli/default");
  const mockCodexBin = await writeMockCodexLoginBin(dir);
  const result = await runCheck(deckPath, { GAMBIT_CODEX_BIN: mockCodexBin });
  assertEquals(
    result.code,
    0,
    formatCommandDiagnostics("check codex-cli/default", result),
  );
});

Deno.test({
  name: "cli smoke: check --json emits structured diagnostics on failure",
  permissions: { read: true, write: true, run: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "codex/default");
  const result = await runCheck(deckPath, undefined, ["--json"]);
  assertEquals(
    result.code,
    1,
    formatCommandDiagnostics("check --json", result),
  );
  const payload = JSON.parse(result.stdout) as {
    ok?: boolean;
    failures?: Array<{ code?: string }>;
  };
  assertEquals(payload.ok, false);
  assertEquals(Array.isArray(payload.failures), true);
  assertEquals(payload.failures?.[0]?.code, "legacy_codex_prefix");
});

Deno.test({
  name: "cli smoke: init command is removed with migration guidance",
  permissions: { read: true, run: true },
}, async () => {
  const result = await runInit();
  assertEquals(result.code, 1, formatCommandDiagnostics("init", result));
  const combined = `${result.stdout}\n${result.stderr}`;
  assertEquals(combined.includes("gambit init"), true);
  assertEquals(combined.includes("gambit-simulator serve"), true);
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
  assertEquals(combined.includes("Legacy codex prefix is unsupported"), true);
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
      requestLogPath: mock.requestLogPath,
      cwd: dir,
    });
    assertEquals(
      defaultRun.code,
      0,
      formatCommandDiagnostics("run codex-cli/default", defaultRun),
    );
    assertEquals(defaultRun.argsLog.endsWith("\napp-server\n"), true);
    assertEquals(defaultRun.argsLog.includes('model_verbosity="high"'), true);
    assertEquals(defaultRun.argsLog.includes("project_doc_max_bytes="), false);
    assertEquals(
      defaultRun.argsLog.includes('developer_instructions="Smoke deck."'),
      true,
    );
    assertEquals(defaultRun.argsLog.includes("SYSTEM:\n"), false);
    assertEquals(
      defaultRun.requestLog.includes('"method":"thread/start"'),
      true,
    );
    assertEquals(defaultRun.requestLog.includes('"model":null'), true);
    assertEquals(
      defaultRun.requestLog.includes(
        '"input":[{"type":"text","text":"hi"}]',
      ),
      true,
    );

    const passthroughDeck = await writeDeck(
      dir,
      "codex-cli/gpt-5.2-codex",
      "high",
    );
    const passthroughRun = await runDeck({
      deckPath: passthroughDeck,
      codexBinPath: mock.binPath,
      argsLogPath: mock.argsLogPath,
      requestLogPath: mock.requestLogPath,
      cwd: dir,
    });
    assertEquals(
      passthroughRun.code,
      0,
      formatCommandDiagnostics("run codex-cli/gpt-5.2-codex", passthroughRun),
    );
    assertEquals(
      passthroughRun.argsLog.includes('model_verbosity="high"'),
      true,
    );
    assertEquals(
      passthroughRun.requestLog.includes('"method":"thread/start"'),
      true,
    );
    assertEquals(
      passthroughRun.requestLog.includes('"model":"gpt-5.2-codex"'),
      true,
    );

    const projectDocDeck = await writeDeck(
      dir,
      "codex-cli/default",
      undefined,
      "Smoke deck.",
      "additionalParams = { codex = { project_doc_max_bytes = 0 } }",
    );
    const projectDocRun = await runDeck({
      deckPath: projectDocDeck,
      codexBinPath: mock.binPath,
      argsLogPath: mock.argsLogPath,
      requestLogPath: mock.requestLogPath,
      cwd: dir,
    });
    assertEquals(
      projectDocRun.code,
      0,
      formatCommandDiagnostics(
        "run codex-cli/default project docs",
        projectDocRun,
      ),
    );
    assertEquals(
      projectDocRun.argsLog.includes("project_doc_max_bytes=0"),
      true,
    );
  } finally {
    await Deno.remove(dir, { recursive: true }).catch((err) => {
      if (err instanceof Deno.errors.NotFound) return;
      throw err;
    });
  }
});

Deno.test({
  name:
    "cli smoke: repl falls back to headless one-shot without a TTY when --message is provided",
  permissions: { read: true, write: true, run: true, env: true },
}, async () => {
  const rootTmpDir = path.join(Deno.cwd(), "tmp");
  await Deno.mkdir(rootTmpDir, { recursive: true });
  const dir = await Deno.makeTempDir({ dir: rootTmpDir });

  try {
    const mock = await writeMockCodexBin(dir);
    const deckPath = await writeDeck(dir, "codex-cli/default", "high");
    const replRun = await runDeck({
      command: "repl",
      deckPath,
      codexBinPath: mock.binPath,
      argsLogPath: mock.argsLogPath,
      requestLogPath: mock.requestLogPath,
      cwd: dir,
    });
    assertEquals(
      replRun.code,
      0,
      formatCommandDiagnostics("repl headless one-shot", replRun),
    );
    assertEquals(replRun.stdout.trim(), "ok");
  } finally {
    await Deno.remove(dir, { recursive: true }).catch((err) => {
      if (err instanceof Deno.errors.NotFound) return;
      throw err;
    });
  }
});

Deno.test({
  name: "cli smoke: repl without tty and without --message fails with guidance",
  permissions: { read: true, write: true, run: true },
}, async () => {
  const dir = await Deno.makeTempDir();
  const deckPath = await writeDeck(dir, "codex-cli/default");
  const args = await denoRunArgs(["repl", deckPath]);
  const command = new Deno.Command(Deno.execPath(), {
    args,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await command.output();
  const result = {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
  assertEquals(
    result.code,
    1,
    formatCommandDiagnostics("repl without tty", result),
  );
  const combined = `${result.stdout}\n${result.stderr}`;
  assertEquals(combined.includes("requires an interactive TTY"), true);
  assertEquals(combined.includes("Use `gambit run"), true);
});
