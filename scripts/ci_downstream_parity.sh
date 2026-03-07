#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAMBIT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${GAMBIT_DIR}"

TMP_PUBLISH_ROOT=""

cleanup() {
  rm -f deno.ci.json deno.entrypoint.lock
  if [[ -n "${TMP_PUBLISH_ROOT}" ]]; then
    rm -rf "${TMP_PUBLISH_ROOT}"
  fi
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

CORE_DIR=""
for candidate in "packages/gambit-core" "packages/gambit/packages/gambit-core"; do
  if [[ -f "${candidate}/deno.json" ]]; then
    CORE_DIR="${candidate}"
    break
  fi
done
if [[ -z "${CORE_DIR}" ]]; then
  echo "Unable to find gambit-core directory." >&2
  exit 1
fi

echo "Lint (gambit-core)"
(
  cd "${CORE_DIR}"
  deno lint
)

echo "Format check (gambit-core)"
(
  cd "${CORE_DIR}"
  deno fmt --check
)

echo "Type check (gambit-core)"
(
  cd "${CORE_DIR}"
  deno check --all mod.ts
)

echo "Test (gambit-core)"
(
  cd "${CORE_DIR}"
  deno test --allow-all --unstable-worker-options
)

echo "Install CLI deps (entrypoint only)"
bash -euo pipefail -c '
  rm -f deno.entrypoint.lock
  deno install --entrypoint --config deno.ci.json --lock=deno.entrypoint.lock --frozen=false --no-prompt src/cli.ts
'

echo "Publish dry run (gambit, downstream parity)"
TMP_PUBLISH_ROOT="$(mktemp -d)"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude=".git" "${GAMBIT_DIR}/" "${TMP_PUBLISH_ROOT}/"
else
  tar -C "${GAMBIT_DIR}" -cf - . | tar -C "${TMP_PUBLISH_ROOT}" -xf -
fi
(
  cd "${TMP_PUBLISH_ROOT}"
  deno eval --ext=ts -q '
    import { parse } from "jsr:@std/jsonc@1";

    const configPath = await (async () => {
      for (const candidate of ["deno.jsonc", "deno.json"]) {
        try {
          await Deno.stat(candidate);
          return candidate;
        } catch (err) {
          if (!(err instanceof Deno.errors.NotFound)) {
            throw err;
          }
        }
      }
      throw new Error("Unable to find deno config for publish dry-run.");
    })();

    const config = parse(await Deno.readTextFile(configPath));
    const lockVersion = await (async () => {
      try {
        const lock = JSON.parse(await Deno.readTextFile("deno.lock"));
        const specifiers = lock?.specifiers;
        if (specifiers && typeof specifiers === "object") {
          const key = Object.keys(specifiers).find((entry) =>
            entry.startsWith("jsr:@bolt-foundry/gambit-core@")
          );
          if (key) {
            return key.slice("jsr:@bolt-foundry/gambit-core@".length);
          }
        }
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          throw err;
        }
      }
      return undefined;
    })();
    const version = lockVersion ?? String(config.version ?? "").trim().replace(/^v/, "");
    if (!version) {
      throw new Error(`${configPath} missing version and no lockfile core version found`);
    }

    const coreKey = "@bolt-foundry/gambit-core";
    const jsrPrefix = `jsr:@bolt-foundry/gambit-core@${version}`;
    const imports = config.imports ?? {};
    const rewritten = {};

    for (const [key, value] of Object.entries(imports)) {
      if (key === coreKey || key.startsWith(`${coreKey}/`)) {
        const suffix = key === coreKey ? "" : key.slice(coreKey.length);
        rewritten[key] = `${jsrPrefix}${suffix}`;
        continue;
      }
      rewritten[key] = value;
    }

    config.imports = rewritten;
    await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2) + "\n");
  '
  # Local/CI typecheck already runs earlier in this script against source-coordinated
  # gambit-core. Keep publish dry-run focused on package graph/publishability.
  deno publish --dry-run --allow-dirty --no-check
)
