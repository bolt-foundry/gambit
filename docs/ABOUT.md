+++
area_owner = "engineering"
authority = "policy"
lifecycle = "beta"
scope = "Area"
+++

# Gambit Docs Structure

This docs tree is split by intent:

- **Internal**: execution, decisions, and learning for coworkers.
  [`./internal/`](./internal/README.md)
- **External**: polished, user-facing docs for adoption and usage.
  [`./external/`](./external/README.md)
  - `external/posts/` – public updates and launch notes.

Information flows one way by default: internal → external. Internal material is
allowed to be messy; external docs should be stable and user-focused.

## README vs ABOUT

- `README.md` files are for coworker orientation and context about the folder’s
  contents.
- `ABOUT.md` files explain structure, metadata conventions, and rules.

## Metadata

Internal docs require TOML front matter at the top of each file. The canonical
schema lives in `internal/ABOUT.md`.

External docs may adopt TOML front matter later once the schema is defined.
