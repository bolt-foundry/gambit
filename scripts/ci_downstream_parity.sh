#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAMBIT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${GAMBIT_DIR}"

cleanup() {
  rm -f deno.ci.json deno.entrypoint.lock
}
trap cleanup EXIT

echo "Preparing deno.ci.json"
deno eval --ext=ts -q '
  import { parse } from "jsr:@std/jsonc@1";
  const exists = async (path) => {
    try {
      await Deno.stat(path);
      return true;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return false;
      }
      throw err;
    }
  };
  const findPath = async (candidates, label) => {
    for (const candidate of candidates) {
      if (await exists(candidate)) {
        return candidate;
      }
    }
    throw new Error(
      `Unable to find ${label} at: ${candidates.join(", ")}`,
    );
  };
  const gambitPath = await findPath(
    [
      "packages/gambit/deno.jsonc",
      "packages/gambit/deno.json",
      "deno.jsonc",
      "deno.json",
    ],
    "gambit deno.json(c)",
  );
  const corePath = await findPath(
    [
      "packages/gambit-core/deno.json",
      "packages/gambit/packages/gambit-core/deno.json",
    ],
    "gambit-core deno.json",
  );
  const gambit = parse(await Deno.readTextFile(gambitPath));
  const core = parse(await Deno.readTextFile(corePath));
  const unstable = new Set(Array.isArray(gambit.unstable) ? gambit.unstable : []);
  for (const flag of [
    "worker-options",
    "temporal",
    "net",
    "bundle",
    "webgpu",
  ]) {
    unstable.add(flag);
  }
  gambit.unstable = [...unstable];
  const exportsMap = core.exports ?? {};
  const coreDir = corePath.includes("/")
    ? corePath.slice(0, corePath.lastIndexOf("/"))
    : ".";
  const localImports = {};
  for (const [key, value] of Object.entries(exportsMap)) {
    if (typeof value !== "string") continue;
    const suffix = key === "." ? "" : key.startsWith("./")
      ? key.slice(1)
      : key;
    const spec = `@bolt-foundry/gambit-core${suffix}`;
    const rel = value.startsWith("./") ? value.slice(2) : value;
    localImports[spec] = `./${coreDir}/${rel}`;
  }
  gambit.imports = { ...(gambit.imports ?? {}), ...localImports };
  await Deno.writeTextFile(
    "deno.ci.json",
    JSON.stringify(gambit, null, 2) + "\n",
  );
'

echo "Lint"
deno lint --config deno.ci.json

echo "Guard bfmono imports"
deno run -A --config deno.ci.json --lock=deno.lock --frozen scripts/guard-bfmono-imports.ts

echo "Format check"
deno fmt --config deno.ci.json --check

echo "Type check"
deno check --config deno.ci.json --lock=deno.lock --frozen --all mod.ts

echo "Test"
deno test --config deno.ci.json --lock=deno.lock --frozen -A --ignore=simulator-ui/__tests__/e2e

echo "Install CLI deps (entrypoint only)"
bash -euo pipefail -c '
  rm -f deno.entrypoint.lock
  deno install --entrypoint --config deno.ci.json --lock=deno.entrypoint.lock --frozen=false --no-prompt src/cli.ts
'
