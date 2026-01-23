# Gambit Init Onboarding – Project Index

## Overview

We are turning `gambit init` into a magical, interactive onboarding flow for
technical developers. The init chat should guide users to create their first bot
without writing code, producing `<target>/root.deck.md` and a test bot in
`<target>/tests/`, while keeping the experience opinionated, fast, and scoped.

- [memo.md](./memo.md) – mission-style brief (purpose, end state, constraints,
  tradeoffs).
- [decisions.md](./decisions.md) – running list of decisions made.
- [context.md](./context.md) – current behavior and code references.
- [non-goals.md](./non-goals.md) – explicit v1 non-goals.
- [risks.md](./risks.md) – known risks to watch.
- [phases.md](./phases.md) – short delivery checkpoints.
- [features/](./features/README.md) – feature-level memos.

## Final status (2026-01-23)

- Shipped an alpha `gambit init` flow with an interactive init chat, scoped
  init-only file tools, and no-overwrite output guards.
- Validated end-to-end with a real OpenRouter key; outputs are written under the
  target directory.
- Follow-ups captured in the post for optional polish (auto-end behavior,
  path-scoping tests).
