# Grader Intent: Right-Sized Context Gathering

## Purpose

- Grade one dimension only: whether Gambit Build Assistant gathers precisely the
  context needed to complete the task.

## End State

- This grader produces stable judgments about context-gathering quality across
  repeated runs on the same artifact.
- Scores clearly distinguish right-sized discovery from over-questioning or
  under-clarification.

## Constraints

- Scope is limited to context-gathering behavior for the graded artifact.
- Use `-3..3` scoring with `0` reserved for ineligible/ungradable artifacts.
- This grader does not score:
  - Tone, friendliness, or writing style.
  - Technical correctness of final code/content.
  - Tool-choice quality or execution style.

## Tradeoffs

- Prefer clarity and single-dimension precision over broad “overall quality”
  grading.
- Accept that this grader may miss other issues by design; those belong in
  separate graders.

## Risk tolerance

- Low tolerance for rubric ambiguity that causes score drift across repeated
  runs.
- Moderate tolerance for edge-case uncertainty when artifacts are incomplete, as
  long as `0` is used appropriately.

## Escalation conditions

- Repeated runs on the same artifact produce drastically different outcomes.
- The rubric starts mixing non-scope dimensions (tone, correctness, or tool
  strategy).
- Evidence is too weak to explain why scores were assigned.

## Verification steps

- Run grading multiple times on the same artifact and inspect variance.
- Confirm rationales cite concrete artifact evidence tied to context-gathering
  behavior.
- Confirm `0` is used only for truly ineligible/ungradable artifacts.

## Activation / revalidation

- Activation: active whenever right-sized context gathering is being evaluated.
- End condition: superseded by a newer grader intent for this same dimension.
- Revalidation triggers: repeated score drift, rubric boundary confusion, or
  changes to user preference around context-gathering strictness.

## Appendix

### Inputs

- `packages/gambit/src/decks/gambit-bot/INTENT.md`
- `packages/gambit/src/decks/gambit-bot/policy/grader-policy.md`

### Related

- `packages/gambit/src/decks/gambit-bot/graders/right_sized_context_gathering/PROMPT.md`
