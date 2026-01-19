# Docs Structure Alignment

**Date:** 2026-01-19 **Owner:** Codebot w/ Gambit + bfmono teams **Goal:** Align
Gambit’s documentation layout (public/internal/memos/posts) with bfmono
conventions so contributors don’t have to learn two mental models.

## Current state

### bfmono

- `docs/` – public/external references.
- `docs/internal/` – internal references, PARA folders
  (projects/areas/resources/archive), and posts.

### Gambit package

- `packages/gambit/docs/` – mixed reference docs (effectively public).
- `packages/gambit/docs/internal/` – PARA workspace
  (projects/areas/resources/archive + internal posts) that should mirror bfmono.
- `packages/gambit/docs/posts/` – public-style posts for gambit
  releases/updates.

## Problem

- Contributors expect the bfmono pattern (internal subfolder + memos + posts).
  Gambit’s current layout differs, so they pause to remember where internal-only
  info should live.
- Long-term we want Gambit docs to ship externally (npm/jsr, website). Having
  memos at repo-root rather than under an `internal/` namespace may make
  automation harder.

## Options

1. **Mirror bfmono exactly**
   - Move Gambit memos under the PARA folders in
     `packages/gambit/docs/internal/`.
   - Create `packages/gambit/docs/internal/` hub mirroring bfmono’s internal
     README/runbooks.
   - Keep `packages/gambit/docs/posts/` as public (maybe `/docs/posts`).
   - Pros: identical structure, no ambiguity. Cons: more nested paths (longer
     relative links), requires updating recent links.

2. **Keep memos top-level but add explicit internal/docs split** (no longer
   relevant now that we’ve moved under `docs/internal/`, but captured here for
   history).

3. **Status quo + better signage**
   - Leave folders where they are, add more readme context.
   - Pros: no churn. Cons: still inconsistent; question will resurface.

## Recommendation (proposal)

Adopt a single contract: **`/docs/` for public references and `docs/internal/`
for PARA + posts.**

- `/docs/` – anything we ship externally (reference guides, API docs).
- `/docs/posts/` – public launch/update posts; always link back to
  `docs/internal/...` entries for provenance.
- `docs/internal/` – PARA home:
  - `docs/internal/projects/`
  - `docs/internal/areas/`
  - `docs/internal/resources/`
  - `docs/internal/archive/`
- `docs/internal/posts/` – internal-only digests referencing PARA.

Using `docs/internal/` keeps bfmono’s existing root intact while giving Gambit a
matching structure.

## What has to change

### Gambit package

0. **Add a root `coworkers/` folder:** host Gambit “coworker” decks
   (task-specific bots) at `packages/gambit/coworkers/`, linked from the
   relevant internal project/area so they’re discoverable without cluttering
   docs.
1. **Add `docs/internal` root:** create
   `packages/gambit/docs/internal/README.md` to explain PARA and the internal
   posts feed.
2. **Move current memos:** relocate legacy folders into
   `packages/gambit/docs/internal/projects/` (same for areas/resources/archive).
3. **Relocate memo posts:** move legacy memo posts into
   `packages/gambit/docs/internal/posts/`.
4. **Future internal docs:** store runbooks/how-tos under
   `packages/gambit/docs/internal/resources/`.
5. **Update references and tooling:** `packages/gambit/docs/README.md`, public
   posts, scripts, and AGENTS must point to `../docs/internal/...` instead of
   the old memo paths.
6. **Website routing:** `/gambit/posts` pulls from
   `packages/gambit/docs/posts/`; an internal surface (if any) should read from
   `packages/gambit/docs/internal/posts/`.
7. **Cleanup:** remove the old `packages/gambit/memos/` folder after migration.

### bfmono

1. **Ensure PARA folder names are in place** (`docs/internal/projects`, `areas`,
   `resources`, `archive`).
2. **Move legacy `_posts` content to `docs/internal/posts/`.**
3. **Fold runbooks/writing** under `docs/internal/resources/` (or document how
   they map to PARA).
4. **Update `docs/internal/README.md`, AGENTS instructions, and scripts** to
   reference the new layout.
5. **Adjust tooling** (doc search, Sapling templates) that currently assume the
   previous directory names.

### Shared follow-ups

- Define a front-matter format for posts (title/date/related project/visibility)
  so loaders can filter public vs internal updates.
- Drop the numeric prefixes completely—use `projects/`, `areas/`, etc. for all
  internal paths.
- Plan link-update automation (e.g., script to rewrite legacy memo references).
- Confirm access-control story if internal posts appear on the website.
- Document how `coworkers/` decks relate to PARA (e.g., link each coworker from
  the owning project or area and vice versa).

## Next steps

1. Review PARA+posts plan with maintainers from both repos.
2. Inventory exact files/scripts that need edits (docs, AGENTS, runbooks,
   website loaders).
3. Prototype the move in Gambit (smaller surface) and validate tooling.
4. Apply the same structure in bfmono.
5. Update website routes + docs to reference the new paths once migrations are
   complete.

## Open questions

- Do we need internal docs beyond memos for the Gambit package? (e.g., release
  runbooks, engineering notebooks?)
- Should internal posts remain private or eventually surface (auth’d) on
  boltfoundry.com?
- How do we handle access control if we publish internal posts on the site?
- Do we keep numeric prefixes (`1-projects`) or drop them when adopting PARA
  everywhere?
