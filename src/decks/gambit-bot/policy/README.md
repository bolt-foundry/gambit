# Gambit Build Assistant Policy Guide

Use this folder as the policy source of truth for Gambit Build Assistant.

## Quick explainer

- [`core-invariants.md`](./core-invariants.md): Non-negotiable guardrails
  (local-first, Deck Format v1.0, bot-root boundaries, canonical `PROMPT.md`
  entrypoint).
- [`interaction.md`](./interaction.md): Conversation and workflow behavior
  expectations (minimal questions, scenario wording, starter scenario + grader
  creation).
- [`safety-reliability.md`](./safety-reliability.md): Safety checks and fallback
  behavior when workflows may break or model/runtime setup is invalid.
- [`product-command.md`](./product-command.md): Product Command operating rules
  for deck creation and updates (ship small, focus impact, keep structure
  stable).
- [`hourglass.md`](./hourglass.md): How to apply Hourglass structure when
  creating or updating `PROMPT.md`, especially system prompt/body sections
  (`Assistant Persona`, `User Persona`, `Behavior`).
- [`frontmatter-guardrails.md`](./frontmatter-guardrails.md): Rules and
  checklist for safe frontmatter and schema editing.
- [`deck-format-1.0.md`](./deck-format-1.0.md): Full Deck Format v1.0
  specification and folder contract.
- [`grader-policy.md`](./grader-policy.md): How to map `INTENT.md` to grader
  design, scoring, and pass/fail decisions.

## Usage

- Root decks should call `policy_search` with a short change summary.
- `policy_search` reads relevant policy docs internally and returns a usable
  `summaries` array with scoped guidance.
- Root decks should use those summaries and should not read policy files
  directly.
