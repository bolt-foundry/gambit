++ area_owner = "engineering" authority = "status" lifecycle = "beta" scope =
"Feature" ++

# Model Aliases in `gambit.toml`

**Published:** 2026-01-24

## What changed

- `gambit.toml` now supports `[models.aliases]` entries so teams can name models
  (e.g., `randall`) once and reuse them across decks/CLI flags.
- The CLI automatically resolves aliases, merges default params, and warns when
  a deck references an undefined alias (including multi-model fallback lists).
- `gambit check` validates decks using the resolved models and fails fast if an
  alias is missing.
- Demo/init scaffolds include a starter alias plus docs describing how to route
  Ollama/OpenRouter targets through the new layer.
- `gambit.toml` now supports `[providers] fallback = "openrouter" | "none"` to
  control whether unprefixed models fall back to OpenRouter.

## Why

- We needed a single source of truth for per-project model choices so swapping
  providers (OpenRouter vs. Ollama) doesn't require editing every deck.
- Bundling default params at the alias level keeps temperature/context-size
  tuning consistent and auditable.
- Resolving aliases inside `gambit check` prevents subtle drift between deck
  references and provider availability.

## Links

- Code: `packages/gambit/src/project_config.ts`, `packages/gambit/src/cli.ts`,
  `packages/gambit/src/commands/check.ts`
- Docs: `packages/gambit/scaffolds/init/gambit.toml`,
  `packages/gambit/docs/external/examples/ollama.md`

## Next steps

- Encourage repo owners to define aliases for their canonical models before
  adding new decks.
- Extend `gambit check` with richer reporting (e.g., list resolved aliases) if
  teams need more visibility.
- Add opt-in live provider integration tests (set `GAMBIT_RUN_LIVE_TESTS=1` and
  provider API keys).
