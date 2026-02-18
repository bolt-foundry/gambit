import { assertEquals, assertThrows } from "@std/assert";
import { isKnownCommand, parseCliArgs } from "./cli_args.ts";

Deno.test("bare allow-read flag does not consume positional deck path", () => {
  const args = parseCliArgs(["repl", "--allow-read", "deck.ts"]);
  assertEquals(args.cmd, "repl");
  assertEquals(args.deckPath, "deck.ts");
  assertEquals(args.allowRead, true);
});

Deno.test("allow-read with explicit equals value keeps positional deck path", () => {
  const args = parseCliArgs([
    "run",
    "--allow-read=./data,./fixtures",
    "deck.ts",
  ]);
  assertEquals(args.cmd, "run");
  assertEquals(args.deckPath, "deck.ts");
  assertEquals(args.allowRead, ["./data", "./fixtures"]);
});

Deno.test("bare allow-run flag does not consume positional deck path", () => {
  const args = parseCliArgs(["run", "--allow-run", "deck.ts"]);
  assertEquals(args.cmd, "run");
  assertEquals(args.deckPath, "deck.ts");
  assertEquals(args.allowRun, true);
});

Deno.test(
  "permission-like option values are not treated as permission overrides",
  () => {
    const args = parseCliArgs([
      "run",
      "deck.ts",
      "--message",
      "--allow-all",
      "--context",
      "--no-sandbox",
    ]);
    assertEquals(args.cmd, "run");
    assertEquals(args.deckPath, "deck.ts");
    assertEquals(args.message, "--allow-all");
    assertEquals(args.context, "--no-sandbox");
    assertEquals(args.allowAll, undefined);
    assertEquals(args.workerSandbox, undefined);
  },
);

Deno.test("parseCliArgs parses canonical worker flags", () => {
  const enabled = parseCliArgs(["run", "root.deck.md", "--worker-sandbox"]);
  assertEquals(enabled.workerSandbox, true);
  assertEquals(enabled.legacyExec, undefined);

  const disabled = parseCliArgs([
    "run",
    "root.deck.md",
    "--no-worker-sandbox",
  ]);
  assertEquals(disabled.workerSandbox, false);
  assertEquals(disabled.legacyExec, undefined);
});

Deno.test("parseCliArgs parses legacy exec rollback flag", () => {
  const args = parseCliArgs(["run", "root.deck.md", "--legacy-exec"]);
  assertEquals(args.workerSandbox, false);
  assertEquals(args.legacyExec, true);
});

Deno.test("parseCliArgs supports sandbox aliases", () => {
  const args = parseCliArgs(["run", "root.deck.md", "--sandbox"]);
  assertEquals(args.workerSandbox, true);
});

Deno.test("parseCliArgs parses serve artifact flag", () => {
  const args = parseCliArgs([
    "serve",
    "--artifact",
    "./artifacts/session.tar.gz",
  ]);
  assertEquals(args.cmd, "serve");
  assertEquals(args.deckPath, undefined);
  assertEquals(args.artifactPath, "./artifacts/session.tar.gz");
});

Deno.test("parseCliArgs rejects conflicting worker flags", () => {
  assertThrows(
    () =>
      parseCliArgs([
        "run",
        "root.deck.md",
        "--worker-sandbox",
        "--legacy-exec",
      ]),
    Error,
    "Conflicting worker execution flags",
  );
});

Deno.test("CLI command registry exposes scenario and not test-bot", () => {
  assertEquals(isKnownCommand("scenario"), true);
  assertEquals(isKnownCommand("init"), false);
  assertEquals(isKnownCommand("test-bot"), false);
});
