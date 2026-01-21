+++
area_owner = "engineering"
authority = "policy"
lifecycle = "beta"
scope = "Area"
+++

# Gambit Internal Docs Structure

This folder houses execution docs for Gambit coworkers. It follows PARA and
supports fast internal decision-making without leaking unfinished work.

## Metadata Front Matter (Required)

Every internal doc should begin with TOML front matter. The metadata is used to
clarify intent, authority, and lifecycle so coworkers (and AI helpers) can
decide how to act on the doc.

```
+++
area_owner = "<area-slug>"
authority = "policy | decision | spec | status | retrospective"
lifecycle = "hack | alpha | beta | prod | deprecated"
scope = "Area | Project | Feature | Initiative"
+++
```

### Field definitions

area_owner

- The owning area slug (not a coworker) that is responsible for keeping this doc
  accurate. This keeps ownership anchored to ongoing responsibilities.
- Usage: set to the folder name under `docs/internal/areas/`.
- Example: `area_owner = "engineering"` maps to
  `docs/internal/areas/engineering/`.

authority

- How binding the doc is. It communicates whether the doc is guidance, a
  decision, a spec, a status update, or a retrospective.
- Values:
  - policy: durable guidance or standards.
  - decision: a recorded choice with rationale and direction.
  - spec: a concrete plan or requirements for implementation.
  - status: progress update, current state, or checkpoint.
  - retrospective: learning after execution.

lifecycle

- How mature or stable the content is. It signals whether the doc is exploratory
  or ready for production use.
- Values:
  - hack: early, exploratory notes.
  - alpha: early draft, useful but incomplete.
  - beta: mostly stable, still evolving.
  - prod: stable and relied upon.
  - deprecated: no longer current; retained for history.

scope

- What kind of work the doc represents. It helps readers locate the doc in the
  PARA structure and know what to expect.
- Values:
  - Area: ongoing responsibility or function.
  - Project: time-bound mission with an end state.
  - Feature: scoped deliverable inside a project.
  - Initiative: cross-cutting effort that may span multiple projects or areas.

## Structure

- `projects/` – Active initiatives with explicit outcomes and milestone dates.
  - Use `YYYY-MM-<slug>` (month-level) for ordering and durability.
  - Use day-level `YYYY-MM-DD-<slug>` only for short-lived or time-sensitive
    projects.
- `areas/` – Ongoing responsibilities, rituals, or cross-team cadences without a
  fixed end date.
  - Each area should include:
    - `README.md` – purpose and success measures.
    - `cadence/` – agendas, notes, and rituals.
    - `playbooks/` – strategy and guidance for how the area operates.
    - `culture/` – historical notes and artifacts that capture how the area
      works (values, norms, origin stories).
- `resources/` – Research notes, runbooks, investigation threads, templates, or
  reusable references.
  - `research/` – experiments, investigations, and benchmarks.
  - `runbooks/` – operational playbooks and procedures.
  - `templates/` – reusable doc templates.
  - `references/` – stable definitions or reference material.
- `archive/` – Completed or deprecated memos retained for context.
- `posts/` – Internal digests that summarize PARA updates.

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
- Reference [`../external/posts/`](../external/posts/README.md) entries when a
  memo drives a public launch or announcement so we have a bidirectional trail.
- Capture memo-layer digests under [`posts/`](./posts/README.md) when you need a
  lightweight update without editing every project or area doc.
