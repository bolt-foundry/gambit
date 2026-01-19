# Gambit Posts

`docs/posts/` records notable moments: launches, decisions worth broadcasting,
and weekly/biweekly updates that summarize what changed. Each post should point
back to the memo or project folder that produced it so readers can dive into the
underlying work.

## When to write a post

- Shipping a feature or deck update that external stakeholders need to know
  about
- Wrapping a milestone or phase in `../internal/projects`
- Publishing insights from research that impact multiple teams
- Capturing a retro or "what changed" summary for a given week

## Format

Use dated filenames such as `2025-01-22-new-deck-runtime.md` so posts sort
chronologically. Inside each file:

1. Title + publish date
2. Summary/bullets of what changed
3. Links to the relevant memo(s), docs, or PRs
4. Next steps or calls to action if applicable

## Relationship to memos

Posts are snapshots; memos remain the living source of truth. When you finish a
project update or make a decision, add a short post that links to
`../internal/...` so teammates can skim history without digging through every
memo.

Looking for internal-only digests? Use
[`docs/internal/posts`](../internal/posts/README.md) to capture updates that
shouldn't ship as public docs yet.
