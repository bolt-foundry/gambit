+++
[release]
since = "fd93f8898e9a4a7210b44a75a7f5bde463374356"
+++

# Changelog

## Unreleased (v0.8.5)

- TBD

## v0.8.5-rc.1

- feat(gambit): remove `gambit init`; onboarding now routes through
  `gambit serve`
- feat(gambit): add `createDefaultedRuntime` and defaulted `runDeck` wrapper
  with CLI-equivalent provider/model routing for library callers
- refactor(gambit): route CLI runtime/provider setup through shared
  `default_runtime` construction path
- feat(demo-runner): migrate demo test-deck prompt generation to Gambit default
  runtime wrapper (no hardwired OpenRouter provider)
- docs(gambit): add migration guidance for `runDeck` wrapper and `runDeckCore`
  replacement mapping

## v0.8.3

- fix(gambit): include CLI docs/reference files in binary builds
- chore(infra): run the Gambit compile check during `bft gambit:release`

## v0.8.2

- chore(gambit): release 0.8.1
- revert(gambit): back out Open Responses runtime
- fix(gambit): resolve gambit-core include paths
- docs(gambit): add ABOUT files and move public posts
- docs(gambit): split external docs and align readmes
- docs(gambit): add ABOUT/README pairs for doc hubs
- Phase 0: rename deck schema terms
- feat(gambit-core): add Open Responses v1 types
- feat(gambit): add OpenRouter responses adapter and flag
- test(gambit): add OpenRouter provider conformance coverage
- docs(gambit): document responses flag and Phase 2 progress
- test(gambit): fix lint in OpenRouter provider tests
- fix(gambit): preserve response parts and validate tool schemas
- feat(gambit): add responses mode for runtime/state
- fix(gambit): preserve optional tool args in responses schemas
- fix(gambit): avoid coercing non-type tool schemas
- fix(gambit): only normalize object tool schemas
- test(gambit): add responses CLI smoke coverage
- docs(gambit): expand phase 4 checklist
- docs(gambit): note phase 4 test-bot validation
- docs(gambit): note 0.8.2 release plan
- docs(gambit): expand phase 5 checklist
- chore(gambit): set 0.8.2-dev version
- chore(gambit-core): align version to 0.8.2-dev
- fix(gambit): widen context tool name set types
- [gambit] update simpsons explainer example
- [gambit] extract Test Bot page and shared helpers
- [gambit] test bot page updates
- [gambit] refactor headers/nav, add Button component
- fix(gambit-core): treat empty responses output as empty string
- chore(gambit): align grader models and schemas
- docs(gambit): align openresponses migration status
- refactor(gambit): move chat compat out of core
- refactor(gambit): move chat compat out of core
- fix(simulator-ui): stabilize test bot nav handlers
- chore(simulator-ui): bundle favicon for distribution
- refactor(simulator-ui): extract calibrate page
- feat(simulator-ui): standardize simulator page layout
- docs(gambit): defer phase 5 and move migration tracker
- docs(docs): align docs structure and links
- docs(gambit): add internal project and post docs
- docs reorg
- feat(gambit): wire init chat flow and init-only tools
- feat(simulator-ui): add icon system and grader UI polish
- refactor(simulator-ui): rename calibrate route to grade
- refactor(simulator-ui): rename test bot labels to test
- refactor(simulator-ui): drop copy ref button
- refactor(simulator-ui): drop reference sample overlays
- refactor(simulator-ui): simplify raw input details
- refactor(simulator-ui): remove session metadata display
- docs(gambit): update simulator links for test/grade
- feat(simulator-ui): make run header toggleable with icon cue
- fix(simulator-ui): normalize color tokens
- chore(simulator-ui): add "+" to positive scores
- feat(simulator-ui): add status badge component
- feat(simulator-ui): refine calibrate summary cards
- feat(simulator-ui): refine tool call display
- fix(simulator-ui): format json consistently
- nits(simulator-ui): small tweaks
- docs(gambit): document Gambit-first strategy shift
- feat(gambit): add ollama provider routing
- feat(gambit): auto-pull missing ollama models
- feat(gambit): add model availability check
- infra: add obsidian bft command and fix gambit check mocks
- fix(gambit): include handler decks in model check
- feat(gambit): add gambit.toml model aliases
- feat(gambit): default responses mode with chat fallback
- fix(gambit): publish scaffolds for jsr demo/init commands

## v0.8.1

- fix(gambit): include gambit-core cards/schemas in compiled binary

## v0.8.0

- chore(gambit): prepare 0.8.0 changelog

## 0.7.0 — Show HN launch
