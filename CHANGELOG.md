+++
[release]
since = "f05d0cfc7e3d566a802d63a4c0ba1c2682b73a5a"
+++

# Changelog

## Unreleased (v0.8.6)

- TBD

## v0.8.6-rc.5

- TBD

## v0.8.6-rc.4

- chore(gambit): cut 0.8.6-rc.3 release
- chore(nix): update flake lock files
- fix(simulator-ui): preserve isograph routes without blanking
- fix(gambit): persist workspace deck state in sqlite
- refactor(gambit): quarantine legacy api routes
- refactor(gambit): extract simulator response and ui handlers
- refactor(gambit): split simulator server into workspace modules
- test(gambit): add feedback refresh repro to isograph test demo
- fix(gambit): synthesize scenario openresponses messages from state
- test(gambit): verify scenario openresponses projection for chat providers
- feat(simulator-ui): add deterministic test-tab openresponses demo
- docs(gambit): add test feedback graphql authority intent
- feat(gambit): add graphql test feedback persistence
- feat(simulator-ui): move test feedback authority into isograph
- test(gambit): verify graphql-owned test feedback refresh
- refactor(gambit): normalize scenario service Maybe types

## v0.8.6-rc.3

- chore(gambit): cut 0.8.6-rc.2
- fix(gambit-simulator): make sessions and workbench nav icon-only
- feat(gambit): persist build chat provider and surface Claude login status
- fix(gambit): honor workbench build chat provider on server routes
- refactor(gambit): extract build chat provider server module
- feat(gambit-core): define openresponses run-event v0 contract
- feat(gambit): persist and query openresponses run events
- test(gambit): cover run-event replay, idempotency, and graphql events
- feat(gambit): back openresponses run events with workspace sqlite
- test(gambit): cover sqlite bootstrap and legacy run-event backfill
- feat(gambit-graphql): read openresponse output from canonical run events
- test(gambit-graphql): cover canonical output-items and openresponse live
  stream
- feat(gambit): emit canonical input.item run events for build/test chat
- test(gambit): cover canonical input.item replay and graphql output/event
  behavior
- fix(gambit): remove transcript fallback paths from openresponse runtime
- test(gambit): cover assistant-start terminal-empty run gate
- feat(gambit): persist openresponse output items in sqlite
- fix(gambit): persist response trace events from scenario state updates
- fix(gambit): isolate build runtime authority from scenario state
- test(gambit): cover build/scenario openresponses run-id isolation
- fix(gambit-graphql): remove stray braces after output-item materializer
  removal
- fix(gambit/providers): normalize codex and claude stream events for core
- fix(gambit): enforce canonical sqlite openresponses projections
- fix(gambit): project response.reasoning events into output reasoning items
- fix(gambit): prevent response replay duplication and idempotency collisions
- fix(gambit): harden response trace persistence and replay test stability
- fix(gambit): scope run-event idempotency and return committed sequences
- fix(gambit-ci): avoid publish dry-run type skew false positives
- GBENG-89 fix
- fix(simulator-ui): align isograph navbar title centering with legacy layout
- fix(simulator-ui): restore isograph docs nav and drawer behavior
- fix(gambit-simulator-ui): switch workspace delete to Isograph mutation
- fix(simulator-ui): restore workbench chat controls and enforce non-null output
  fields
- fix(simulator-ui): restore isograph drawer controls and docs-first nav
- docs(gambit): align package README and examples paths

## v0.8.6-rc.2

- chore(gambit): cut 0.8.6-rc.1 release
- isograph spike
- isomore
- fix(simulator-ui): stabilize isograph workspace shell across tab navigation
- Update test-tab demo runner for /isograph and current test UI selectors
- Make test-tab demo resilient to flaky scenario propagation
- lints and such
- test(gambit): disable leak sanitizers in flaky integration suites
- fix(simulator-ui): apply dark mode theme on isograph routes
- fix(lint): recognize useeffect-setstate ignores in gambit simulator UI
- chore(lint): unblock workspace by file-level gambit ignores
- feat(gambit): add grade GraphQL backend contract and operations
- feat(gambit-ui): wire isograph grade tab routes, page, and actions
- chore(gambit-ui): regenerate isograph artifacts for grade tab
- chore(gambit-demo): keep non-mutation waits under 10s in grade tab demo
- fix(gambit-demo): seed grade tab demo with test fixture root deck
- fix(gambit-demo): add default grader to shared test fixture
- refactor(simulator-ui): split isograph grade tab into container and
  presentational view
- refactor(simulator-ui): share legacy grade tab shell between legacy and
  isograph
- chore(simulator-ui): remove unused grade tab view extension prop
- refactor(simulator-ui): reuse legacy grade runs header across legacy and
  isograph
- refactor(simulator-ui): share legacy grade runner and center panels across
  legacy and isograph
- test(gambit-demo): exercise grade flag toggle and reason edit flow
- feat(gambit): add verify GraphQL schema and server operations
- feat(gambit): add Isograph Verify tab UI and typed client artifacts
- test(gambit): add verify demo and stabilize full demo flow
- docs(gambit): add verify-tab migration docs and parity checklist
- refactor(gambit-demo): reuse shared tab flows in full demo
- fix(gambit): run downstream CI parity checks in bfmono
- pin nix v
- fix(gambit): isolate gambit-core parity checks from bfmono workspace context
- fix(gambit): align parity check with in-repo gambit-core and load lint plugin
- fix(gambit): include simulator-ui in JSR publish scope
- ci(gambit): add publish dry-run to downstream parity suite
- fix(ci): restore gambit mirror auto-merge and gate binary dispatch by new tags
- fix(gambit-ci): run publish dry-run in isolated package copy
- fix(gambit-ci): rewrite core imports for isolated publish parity dry-run
- fix(gambit-publish): pin JSX runtime specifier for JSR canary publish
- fix(gambit): restore simulator-ui dnt react typecheck
- feat(gambit): add conversation session graphql lifecycle
- fix(gambit): prevent React type-only import rewrites from breaking npm build
- feat(gambit): unify verify backend execution model
- feat(gambit): migrate verify tab to scenario/repeat controls
- chore(gambit): regenerate verify isograph artifacts
- feat(gambit): restore full verify mutation cache payload
- fix(gambit): await scenario completion in verify batches
- fix(gambit): stream verify request progress during scenario generation
- fix(gambit): pipeline verify grading to reduce burst/pause stalls
- fix(gambit): honor verify concurrency with parallel scenario producers
- fix(gambit): address verify batch review feedback on worker wakeups
- chore(gambit): apply formatter output for verify follow-up code
- fix(simulator-ui): guard build chat debug localStorage access

## v0.8.6-rc.1

- fix(gambit): replace dynamic import.meta.resolve at runtime
- fix(gambit): handle non-file import.meta.url in jsr runtime paths
- feat(gambit): simplify Codex login flow and auto-configure sandbox
- feat(gambit): add codex preflight checks and yolo/json CLI paths
- docs(gambit): refresh command docs and codex env guidance
- fix(simulator-ui): improve listbox viewport positioning
- feat(simulator-ui): add dark mode toggle and cooler dark inputs
- feat(gambit): add claude code provider support for build chat runtime
- feat(gambit-serve): add --build-assistant-provider flag to set Claude or Codex
  defaults
- feat(gambit-ui): add selectable persisted build chat provider in workbench
- feat(gambit): stream Claude CLI events and enforce provider-model
  compatibility

## v0.8.5

- #4071: exclude `.codex` entries from Build file listing.
- #4073: include gambit-core snippets/decks/workers in compiled CLI assets and
  support non-file `import.meta.url` runtime initialization.

## v0.8.5-rc.12

- fix(gambit): add codex trust preflight for workbench chat

## v0.8.5-rc.11

- #4014: restructure FAQ deck and artifact paths.
- #4029: include response extension schemas in artifact export and default
  `serve --artifact` to the restored workspace.
- #4046: ship verify workflow updates (feature-flagged routing, consistency UI,
  deterministic fixture seeding, outlier/report controls and chips), harden
  calibrate persistence + status handling, tighten provider/serialization
  behavior, and move unbounded build timeout to explicit deck opt-in.
- #4048: default verify tab bootstrap flag to enabled.
- #4049: clamp deck-level `maxTurns` bounds in test run selection.
- #4053: add grader error chips to workbench chat.
- #4054: preserve shared references in safe session serialization.
- #4055: refactor simulator-ui routing to replace nested ternaries.
- #4057: align verify outlier chip semantics and display.
- #4060: improve verify report controls and harden concurrent calibrate
  persistence.
- #4061: align verify turn labels and stabilize initial run filtering.
- #4064: prevent simulator feedback reason text from being clobbered while
  editing.

## v0.8.5-rc.10

- #4004: add OpenResponses convergence runtime + extensions + async action
  semantics in gambit-core.
- #4004: retire synthetic respond/end docs and align deck authoring guidance.
- #4010: fix gambit-core npm runtime layouts to ship built-in snippets/decks.

## v0.8.5-rc.9

- TBD

## v0.8.5-rc.8

- chore(gambit): cut 0.8.5-rc.7
- Switch ci-gambit-core to run nix develop via step commands with a profile
  instead of custom shell overrides. This avoids both workflow-parse failures
  and literal path resolution failures.

## v0.8.5-rc.7

- chore(gambit): cut 0.8.5-rc.6
- fix(gambit-ci): stop using github.workspace in shell field
- fix(gambit): include `src/decks` assets in compiled CLI binaries

## v0.8.5-rc.6

- chore(gambit): cut 0.8.5-rc.5 and pin React to 19.2.4
- chore(repo): pin jsx-runtime imports to react 19.2.4
- refactor(gambit): Fix left drawer
- feat(gambit-simulator-ui): send scenario run errors to workbench chat
- refactor(gambit-simulator-ui): replace placeholders with reusable callout
- fix(gambit): validate explicit deck path and stabilize stop test
- feat(simulator-ui): use icon remove action for error context chip
- fix(gambit): invalidate build deck label cache on frontmatter changes
- feat(gambit): add workbench composer chip and chat flow updates

## v0.8.5-rc.5

- TBD

## v0.8.5-rc.4

- chore(infra): run `deno task build_npm` for gambit during `bft precommit`
- fix(gambit): ignore dnt TS2345 diagnostics from vendored `@std/fs` and
  `@std/toml` npm-compat sources

## v0.8.5-rc.3

- fix(gambit-release): support nested core path and cut 0.8.5-rc.2
- refactor(gambit-core): remove built-in exec tool from runtime
- fix(gambit-core): partition worker sandbox by runtime host
- test(gambit-core): add unsupported worker sandbox coverage
- docs(gambit-core): document worker sandbox host contract
- ci(gambit-core): gate npm compatibility in core CI

## v0.8.5-rc.2

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
