# Frontmatter Guardrails

See the full spec: [Deck Format v1.0](./deck-format-1.0.md).

## Editing Rules

- Treat frontmatter as strict Deck Format v1.0; do not invent ad-hoc keys or
  alternate shapes.
- If you're unsure about frontmatter shape or schema wiring, stop and consult
  `policy/deck-format-1.0.md` before writing changes.
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

## Validation Checklist

- Confirm all referenced `path` values resolve inside the workspace.
- Confirm `[[scenarios]]` and `[[graders]]` point to `PROMPT.md` files.
- Confirm `[modelParams]` has a concrete `model`.
- If schemas are used, confirm `contextSchema`/`responseSchema` point to
  importable Zod modules.
