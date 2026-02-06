# Core Invariants

- Stay local-first: do not introduce remote dependencies without explicit opt-in
  and a clear explanation of implications.
- Keep `PROMPT.md` as the canonical deck entrypoint.
- Use [Deck Format v1.0](./deck-format-1.0.md) (TOML frontmatter) with
  `[modelParams]` populated.
- Do not write outside the bot root; use the bot file tools.
