+++
scope = "Project"
authority = "spec"
lifecycle = "beta"
area_owner = "engineering"
+++

# Phase 0 - Terminology and Namespace Cleanup

Owner: engineering\
Date: 2026-01-16\
Status: complete (core + scaffolds)

## Purpose

Reduce "init" overload and align deck I/O terminology with the Open Responses
mental model before the core swap.

## End state

- Decks use `contextSchema` and `responseSchema` as the primary names.
- `inputSchema`/`outputSchema` remain as deprecated aliases with warnings.
- Legacy `gambit://init`/`respond`/`end` markers expand with warnings and point
  to `gambit://cards/*` replacements.
- Docs and scaffolds use the new schema terms and card URIs.

## Entry criteria

- [x] Agreement on the naming change and deprecation timeline.
- [x] Open Responses v1 contract approved.

## Exit criteria

- [x] Loader and markdown parsing accept both schema names.
- [x] Deprecation warnings in place for `inputSchema`/`outputSchema`.
- [x] Legacy `gambit://init`/`respond`/`end` markers expand with warnings.
- [x] Docs and scaffolds updated to the new terms.

## Checklist

- [x] Add `contextSchema`/`responseSchema` to deck/card types and loaders.
- [x] Decide whether to alias `inputFragment`/`outputFragment` to new names.
- [x] Expand legacy `gambit://init`/`respond`/`end` markers with warnings.
- [x] Update runtime/renderer validation messages to prefer new terms.
- [x] Update docs, templates, and scaffolds to new names and URIs.
- [ ] Provide a codemod or migration script for deck repositories (deferred).

## Tests and validation

- [x] Markdown loader tests for legacy marker aliasing.
- [x] Loader tests for schema aliasing.
- [x] Runtime tests to ensure validation errors use new terms.
- [x] `bft precommit` passes.

## Flags and toggles

- None planned for this phase.

## Stop conditions

- CI failures or regressions in deck loading.
- Confusion in docs or templates that breaks existing workflows.

## Notes and updates

- 2026-01-16: Phase doc created.
- 2026-01-21: Phase complete; schema/marker aliases and built-in cards/schemas
  landed.
