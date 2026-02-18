import { assert } from "@std/assert";
import { printCommandUsage, printShortUsage, printUsage } from "./cli_args.ts";

function captureConsoleLog(fn: () => void): string {
  // deno-lint-ignore no-console
  const original = console.log;
  const lines: Array<string> = [];
  // deno-lint-ignore no-console
  console.log = (...args: Array<unknown>) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    fn();
  } finally {
    // deno-lint-ignore no-console
    console.log = original;
  }
  return lines.join("\n");
}

Deno.test({
  name: "CLI help output renders short usage",
  permissions: { read: true },
}, () => {
  const output = captureConsoleLog(() => {
    printShortUsage();
  });
  assert(output.includes("gambit <command> [options]"));
  assert(output.includes("gambit help <command>"));
  assert(output.includes("bot       Run the Gambit bot assistant"));
  assert(output.includes("run       Run a deck once"));
  assert(output.includes("scenario  Run a scenario loop with a persona deck"));
  assert(!output.includes("init"));
  assert(!output.includes("export    Export a bundle from state"));
});

Deno.test({
  name: "CLI help output renders verbose usage",
  permissions: { read: true },
}, () => {
  const output = captureConsoleLog(() => {
    printUsage();
  });
  assert(output.includes("Details:"));
  assert(output.includes("Usage:\n  gambit run"));
  assert(output.includes("--state <file>"));
});

Deno.test({
  name: "CLI help output renders command usage",
  permissions: { read: true },
}, () => {
  const output = captureConsoleLog(() => {
    printCommandUsage("run");
  });
  assert(output.includes("Usage:\n  gambit run"));
  assert(output.includes("Runs a deck once and exits."));
});
