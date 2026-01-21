+++
scope = "Project"
authority = "spec"
lifecycle = "beta"
area_owner = "engineering"
+++

# Gambit Open Responses Spike Backout

Owner: engineering\
Date: 2026-01-20\
Scope: Gambit CLI/runtime refactor rollback to unblock `--context`/`--init` and
restore a green build.

## Purpose

- Reverse the Open Responses spike (`268463da4218`, `017b2fe527bf`,
  `3aea4c25006f`, `6ca1992985e3`) that landed without coverage and broke the
  CLI/runtime contract.
- Re-stabilize the published `@bolt-foundry/gambit` 0.8 line so teams can keep
  shipping decks/tests while we redesign the migration with proper tests.

## End State

- Sapling backouts for the four commits have landed, leaving the
  runtime/provider/state code identical to the pre-spike chat-compatible
  version.
- `deno task ci` inside `packages/gambit` passes locally, and we have a manual
  smoke test for both `--init` and `--context`.
- A patch release (target `0.8.2`) is prepared with changelog + version bumps so
  downstream users stop ingesting the regression.
- Follow-up issue filed to re-scope the Open Responses migration with an
  incremental plan + test coverage.

## Constraints

- No extra feature work or opportunistic cleanup while reverting; the priority
  is speed and correctness.
- Use Sapling backout workflow from
  `docs/internal/resources/engineering/runbooks/sapling-daily-workflow.md`; do
  not rewrite history on main.
- Keep public artifacts limited to the minimum (version bump, changelog, release
  helper files). No doc rewrites beyond noting the backout in release notes.
- Ensure both `--context` and legacy `--init` switches behave identically
  post-revert before tagging a release.

## Tradeoffs

- Rolling back forfeits the in-progress Open Responses architecture, but buys us
  a stable CLI/UI immediately.
- We accept duplicative work later (re-landing the migration) in exchange for
  eliminating production risk now.
- Shipping a hotfix release means temporarily delaying other queued Gambit
  changes so CI time is focused on this fix.

## Allowed Changes

- `sl backout -r <hash>` commits for each refactor in reverse order, plus any
  mechanical merges required for clean application.
- Minimal edits to `packages/gambit/deno.jsonc`,
  `packages/gambit-core/deno.json`, `packages/gambit/CHANGELOG.md`, and release
  helper metadata to publish 0.8.2.
- Updates to docs/posts limited to announcing the rollback in the changelog
  entry; no broader product narrative changes.
- CI/test fixes strictly scoped to the revert (for example, deleting newly added
  expectations that depended on Open Responses types).

## Risk Tolerance

- Low. Failing fast is preferred over attempting partial fixes. If any backout
  introduces conflicts or unexpected cascades, stop and reassess with the team.
- Do not merge if `deno task ci` or the manual CLI smoke test fails; stability
  is the gate for promoting the revert.

## Stop Conditions

- Backout hits an irreversible conflict (for example, dependencies from
  unrelated commits). Pause and coordinate before attempting manual
  reconstruction.
- Tests fail in ways unrelated to the reverted stack, implying other
  regressions; escalate instead of force-merging.
- The `--context`/`--init` smoke test still fails after the revert. At that
  point, halt and debug before continuing with release prep.
