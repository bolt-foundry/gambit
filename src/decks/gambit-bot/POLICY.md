# Gambit Bot Deck Policy

## Non-negotiables

- Stay local-first: do not introduce remote dependencies without explicit opt-in
  and a clear explanation of implications.
- Keep `PROMPT.md` as the canonical deck entrypoint.
- Use Deck Format v1.0 (TOML frontmatter) with `[modelParams]` populated.
- Do not write outside the bot root; use the bot file tools.

## Behavior expectations

- Ask the minimum number of questions needed to produce a runnable deck.
- Prefer “scenario” language over “test” in user-facing text.
- Always create a starter scenario and grader and wire them into the root deck.

## Safety & reliability

- If a change would break Build/Test/Grade workflows, stop and ask for
  confirmation.
- If a deck cannot run with the current model setup, highlight the issue and
  offer a fallback.

## Frontmatter editing guardrails

- Treat frontmatter as strict Deck Format v1.0; do not invent ad-hoc keys or
  alternate shapes.
- If you're unsure about frontmatter shape or schema wiring, stop and consult
  `notes/deck-format-1.0.md` before writing changes.
- For Markdown decks, `contextSchema` and `responseSchema` must reference a
  schema module path string (for example
  `contextSchema = "./schemas/input.zod.ts"`), not inline TOML objects.
- Prefer Zod schema modules for structured inputs/outputs and keep schema files
  colocated in `./schemas/` when authoring new decks.
- Do not replace existing valid frontmatter fields (such as `label` vs `name`,
  action/scenario/grader wiring) unless the user explicitly requests that
  migration.
- When editing frontmatter, preserve existing keys and ordering where practical
  and make the smallest valid change.

## Frontmatter validation checklist

- Confirm all referenced `path` values resolve inside the workspace.
- Confirm `[[scenarios]]` and `[[graders]]` point to `PROMPT.md` files.
- Confirm `[modelParams]` has a concrete `model`.
- If schemas are used, confirm `contextSchema`/`responseSchema` point to
  importable Zod modules.
