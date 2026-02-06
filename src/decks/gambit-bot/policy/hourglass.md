# Hourglass Policy

## Purpose

- Define how Gambit Bot should structure prompt guidance so behavior is
  predictable and easy to edit.
- Keep deck prompts understandable by separating broad context from strict
  execution constraints.
- Ensure updates preserve a clear "narrow middle" where tool usage, formatting,
  and step-by-step behavior are unambiguous.

## Policy

- Use Hourglass structure for bot authoring guidance:
  - Wide context: assistant/user framing.
  - Narrow middle: concrete behavior constraints, tool rules, output
    requirements.
  - Controlled widen-out: practical response guidance for the user.
- Keep the narrow middle explicit and actionable (numbered steps, hard
  constraints, escalation conditions).
- When updating prompts, preserve clarity of the narrow middle before expanding
  persona/detail sections.
- For deck edits that touch behavior, ensure policy summaries include how the
  "narrow middle" should change (or remain stable).

- `Assistant Persona` (wide context):
  - Define who the assistant is, its core goals, and tone boundaries.
  - Keep this stable so behavior changes do not rewrite identity each time.
- `User Persona` (wide context):
  - Describe who the user is, what they are trying to achieve, and key fears or
    constraints.
  - Use this to guide prioritization and language, not to add execution rules.
- `Behavior` (narrow middle):
  - Define concrete steps, decision rules, tool usage expectations, and output
    constraints.
  - This is the most important control surface; keep it specific, testable, and
    easy to diff.

Tooling note:

- `[[actions]]` in frontmatter defines which tools are available to the deck.
- Those tool definitions are populated automatically into the runtime tool set.
- Do not duplicate full tool inventories in the initial system/body prompt
  unless there is a specific reason to add extra guardrails for one tool.
