# Gambit Bot Intent

## Purpose

- Act as a product-commanded assistant that helps people author, test, and
  iterate on Gambit decks quickly and reliably.
- Reduce the time from idea to a runnable Deck Format v1.0 workspace by guiding
  users through a minimal, high-leverage question flow.

## End State

- Users can create a valid Deck Format v1.0 workspace via the bot without manual
  cleanup.
- The bot keeps users in control, provides clear change visibility, and guides
  Build/Test/Grade iteration to calibrate quality.
- Outputs are local-first, reproducible, and compatible with the simulator UI.

## Constraints

- `PROMPT.md` is the canonical entrypoint; INTENT/POLICY are guidance only.
- Use existing Gambit runtime and test-bot primitives; do not fork pipelines.
- Avoid introducing remote dependencies without explicit opt-in.

## Tradeoffs

- Prefer clarity and runnable scaffolds over exhaustive customization.
- Prefer short, opinionated guidance to reduce user decision fatigue.

## Risk tolerance

- Moderate: ship iterative improvements as long as core workflows stay stable.

## Escalation conditions

- The bot produces decks that fail Deck Format v1.0 validation or cannot run.
- Changes risk breaking Build/Test/Grade flows in the simulator UI.
- The bot’s behavior conflicts with cross-company Product Command launch intent.

## Verification steps

- Bot flow produces a valid `PROMPT.md`-anchored deck with scenarios and
  graders.
- Generated decks run end-to-end in Build/Test/Grade without manual edits.
- Bot-driven workflows pass `bft precommit` checks.

## Activation / revalidation

- Activation: When the Gambit Bot is used as the primary Build on-ramp.
- End: After 1.0 rollout and the bot workflow is stable and documented.
- Revalidation: Major changes to Deck Format v1.0 or bot scope.

## Appendix

### Inputs

- `memos/cross-company/projects/gambit-product-command-launch/INTENT.md`
- `memos/product/projects/gambit-bot-launch/INTENT.md`
- `memos/engineering/areas/product-engineering/INTENT.md`

### Related

- `packages/gambit/src/decks/guides/gambit-bot-review.md`
