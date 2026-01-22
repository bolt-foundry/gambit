+++
area_owner = "engineering"
authority = "policy"
lifecycle = "beta"
scope = "Area"
+++

# Gambit Internal Docs (Mission Command + PARA)

`docs/internal/` is where we keep living documentation for Gambit's product and
engineering work: project briefs, cadence notes, decision logs, and research
prep. Treat it as the coordination layer that feeds the rest of the docs folder.
Structure rules and metadata conventions live in `./ABOUT.md`.

Active internal folders:

- **projects/** – Active initiatives with explicit outcomes and milestone dates.
- **areas/** – Ongoing responsibilities, rituals, or cross-team cadences without
  a fixed end date.
- **resources/** – Research notes, runbooks, investigation threads, templates,
  or reusable references.
- **archive/** – Completed or deprecated memos retained for context.
- **posts/** – Internal digests that summarize PARA updates.

## Quick Start

- Create a folder under `projects/` for every active shipping effort. The folder
  list is our project dashboard, so only active work should live here.
- Use `areas/` for rolling docs that keep a function or program in sync (e.g.,
  launch readiness, doc triage, growth experiments).
- Park early research, spike notes, templates, or runbooks under `resources/`
  until they graduate into an area or project.
- When a project wraps, move the entire folder to `archive/` and add a short
  closing note so future readers know the outcome.

## Working Guidelines

- Append new dated updates instead of editing history wherever possible.
- Link to runbooks or reference docs in `../` once a process hardens so the memo
  can stay lightweight.
- Reference [`../posts/`](../posts/README.md) entries when a memo drives a
  public launch or announcement so we have a bidirectional trail.
- Capture memo-layer digests under [`posts/`](./posts/README.md) when you need a
  lightweight update without editing every project or area doc.
