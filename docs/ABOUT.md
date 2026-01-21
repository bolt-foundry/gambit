+++
area_owner = "engineering"
authority = "policy"
lifecycle = "beta"
scope = "Area"
+++

# Gambit Docs Structure

This folder is the source of truth for Gambit documentation. We keep a clear
separation between internal execution docs and external user-facing docs so
teams can move fast internally without leaking unfinished work.

## Structure

- `internal/` – execution, decisions, and learning for coworkers.
- `external/` – polished docs for users, developers, and partners.
  - `external/posts/` – public updates and launch notes.

Information flows one way by default: internal → external.

## README vs ABOUT

- `README.md` files are for coworker orientation and context about the folder’s
  contents.
- `ABOUT.md` files explain structure, metadata conventions, and rules.

## Metadata

Internal docs require TOML front matter at the top of each file. The canonical
schema lives in `internal/ABOUT.md`.

External docs may adopt TOML front matter later once the schema is defined.
