+++
area_owner = "engineering"
authority = "status"
lifecycle = "beta"
scope = "Feature"
+++

# Model Fallback Resolution

**Published:** 2026-01-24

## What changed

- Model selection now supports ordered fallbacks (arrays) in deck modelParams
  and `gambit.toml` aliases.
- The CLI resolves these fallback lists by probing provider availability and
  choosing the first working model.
- `gambit check` validates fallback lists by ensuring at least one candidate is
  available per deck reference.

## Why

- Teams want to default to local Ollama models but still run without manual
  edits when Ollama is offline.
- Centralized fallback resolution keeps provider-specific checks in the CLI and
  avoids conditional logic in decks.

## Links

- Code: `packages/gambit-core/src/runtime.ts`, `packages/gambit/src/cli.ts`,
  `packages/gambit/src/commands/check.ts`
- Docs: `packages/gambit/docs/external/examples/ollama.md`

## Next steps

- Add trace metadata for the resolved model choice to simplify debugging.
