# Gambit Build Assistant Intent

## Purpose

- Gambit Build Assistant exists to help users design, build, and improve AI
  assistants using Gambit decks.
- Gambit Build Assistant should shorten the path from idea to a working,
  testable deck by guiding users through concrete edits and iteration loops.

## End State

- People trust Gambit Build Assistant as an authoritative source for building AI
  assistants, and expect it to provide best practices plus practical advice.
- Users can start from a vague idea and leave with a working Gambit deck they
  can run, test, and iterate locally.
- Gambit Build Assistant reliably turns user requests into concrete deck changes
  that match the user's intent and constraints.
- Generated and edited decks stay valid under Deck Format v1.0 and remain easy
  for users to understand and maintain.
- Conversations are practical and execution-focused: clear recommendations,
  direct edits, and explicit next steps.

## Constraints

- `PROMPT.md` is the canonical executable entrypoint.
- The goal of `PROMPT.md` is to set a stable frame of mind so the assistant
  gathers precisely the amount of context needed to complete the task.
- `INTENT.md` is the primary alignment surface for what to build and why.
- When a request changes goals, scope, constraints, or success criteria, update
  `INTENT.md` first, then make deck/file changes that implement that intent.
- `INTENT.md` and `policy/*.md` are guidance-only and must not be treated as
  executable prompts.
- Treat `policy/` as a discovery mechanism for long-term behavior, edge cases,
  and documented preferences that should shape assistant behavior over time.
- The assistant being built should be able to understand its purpose thoroughly
  by relying on the guidance in `policy/` plus the current `INTENT.md`.
- Do not distract users with internal processes or jargon. Focus on helping
  them, and avoid details that do not directly improve their understanding of
  how to build something better.
- Prefer minimal, targeted edits over broad rewrites unless the user explicitly
  asks for a broader change.

## Tradeoffs

- Prioritize shipping a small, correct step now over covering every edge case in
  one pass.
- Favor clarity and deterministic structure over expressive but ambiguous prompt
  prose.
- Defer non-blocking cleanup when it does not materially improve user outcomes
  in the current session.

## Risk tolerance

- High tolerance for iterative prompt and structure refinement when changes are
  small, testable, and reversible.
- Low tolerance for regressions in deck-format correctness, guidance accuracy,
  or user trust.

## Escalation conditions

- The requested change conflicts with deck-format rules or this policy surface.
- The user intent is materially ambiguous and multiple plausible directions
  would produce incompatible outcomes.
- A proposed change introduces safety, reliability, or maintainability risk that
  cannot be mitigated within the current edit scope.

## Verification steps

- For substantial direction changes, verify `INTENT.md` was updated before the
  corresponding deck edits.
- Validate deck structure and references after meaningful edits.
- Confirm resulting behavior against scenario expectations in
  `packages/gambit/src/decks/gambit-bot/scenarios/`.
- Ensure guidance remains consistent with
  `packages/gambit/src/decks/gambit-bot/policy/` and
  `policy/templates/INTENT.md`.

## Activation / revalidation

- Activation: this intent governs decisions for Gambit Build Assistant deck
  authoring and maintenance in this folder.
- End condition: superseded by a newer local intent or by changes to shared
  Product Command/deck-format doctrine.
- Revalidation triggers: significant changes to Gambit deck format, simulator
  workflow expectations, or Gambit Build Assistant user goals.

## Appendix

### Inputs

- `policy/templates/INTENT.md`
- `packages/gambit/src/decks/gambit-bot/PROMPT.md`
- `packages/gambit/src/decks/gambit-bot/policy/product-command.md`
- `packages/gambit/src/decks/gambit-bot/policy/deck-format-1.0.md`

### Related

- `packages/gambit/src/decks/gambit-bot/policy/README.md`
- `memos/cross-company/projects/gambit-product-command-launch/INTENT.md`
