# Grader Policy

## Purpose

- Define practical best practices for creating high-quality graders aligned to
  `../INTENT.md`.
- Help teams judge grader quality using clear signals, not rigid
  one-size-fits-all rules.

## Policy

- `INTENT.md` is the primary alignment source for grader design.
- Prefer building graders from specific `INTENT.md` preferences/constraints over
  ad-hoc criteria.
- Graders should use Gambit built-in grader schemas.
- Graders are decks. They may use standard deck capabilities (including tool
  calls, internal monologue/reasoning traces, and other deck features) as needed
  to produce reliable judgments.
- Best practice: use a different model family for grading than for generation
  when practical (for example, Claude grading GPT output, or GPT grading Claude
  output) to reduce shared blind spots and accidental happy-path agreement.
- Prefer lower-opinion grading models (for example `openai/gpt-5.1-chat`) over
  tooling-heavy agent models (for example `codex-cli/gpt-5.1-codex`) when
  possible.
- Tooling-heavy agent models often carry built-in workflow preferences and
  orchestration behavior that can reduce grading determinism and increase cost,
  latency, and output variance.
- Prefer built-in contexts such as
  `gambit://schemas/graders/contexts/turn.zod.ts`,
  `gambit://schemas/graders/contexts/turn_tools.zod.ts`,
  `gambit://schemas/graders/contexts/conversation.zod.ts`, and
  `gambit://schemas/graders/contexts/conversation_tools.zod.ts`, with
  `gambit://schemas/graders/grader_output.zod.ts` for responses.
- Graders can evaluate turn-level, conversation-level, or other scoped run
  artifacts (for example a subdeck run) when represented through a compatible
  grader context.
- Tool-call data may be included as context, but graders should not score tool
  choice or execution style directly. Grade outcome success/failure against the
  task objective.
- Treat graders as input-to-output evaluators: given an input artifact, score
  the produced output against explicit criteria.
- A strong preference is single-dimension graders. Multi-dimension grading is
  usually lower quality unless used as a final summarization layer over prior
  grader outputs.

## Scoring Model

- Use a single score range of `-3..3` for grader outputs.
- `0` means a grade cannot be performed because the content is ineligible to
  grade.
- Suggested interpretation:
  - `+3`: clear success against criteria.
  - `+2`: strong outcome with minor gaps.
  - `+1`: partial success.
  - `0`: ineligible/ungradable content for this grader.
  - `-1`: weak outcome with meaningful issues.
  - `-2`: significant failure against criteria.
  - `-3`: clear failure.
- Example ungradable (`0`):
  - A turn-level grader expects an assistant response for a specific turn, but
    the artifact only contains setup logs/tool metadata and no assistant output
    for that turn.
- Score representation guidance:
  - `+1` to `+3`: this outcome is acceptable for production use for this
    criterion.
  - `-1` to `-3`: this outcome is not acceptable for production use for this
    criterion and requires fixes.
  - `0`: production acceptability cannot be determined for this criterion;
    gather a gradable artifact and re-run grading.

## Signals Of High Quality

- Grader intent is specific and concrete, not vague.
- Grader maps to a clear user preference, ideally tied to a specific `INTENT.md`
  line or section.
- Grader evaluates one primary dimension.
- Grader INTENT.md explicitly states what it is not scoring.
- Criteria are stable enough to support consistent judgments across repeated
  runs.
- Rationale explains why a score was produced in a way humans can audit.

## Signals Of Low Quality

- Intent is high-level and underspecified (for example "grade overall quality").
- Grader mixes multiple concerns in one score (for example conciseness + tone +
  correctness).
- Criteria drift between runs or depend on unstated assumptions.
- Repeated runs on the same artifact produce drastically different outcomes.
- Rationale is generic, opaque, or disconnected from evidence.
- Grader cannot be tied back to user preferences or `INTENT.md` guidance.

## High vs Low Examples

### Pair 1: Conciseness

- High-quality example:
  - Intent: grade conciseness only.
  - Scores whether the response length matches the user's preference for concise
    output.
  - Explicitly ignores tone and factual correctness.
- Low-quality example:
  - Intent: "grade concise, friendly, and correct responses".
  - Single score mixes brevity, tone, and correctness, making failure causes
    ambiguous.

### Pair 2: Tone

- High-quality example:
  - Intent: grade professional-neutral tone only.
  - Scores whether language style matches user preference.
  - Explicitly ignores response length.
- Low-quality example:
  - Intent: "grade overall response quality".
  - Rubric is vague and allows grader drift because tone is not isolated.

### Pair 3: Preference Match To Intent

- High-quality example:
  - Intent: grade whether output follows one specific preference from
    `INTENT.md`.
  - Uses that single preference as the primary decision boundary.
  - Explicitly ignores unrelated intent sections.
- Low-quality example:
  - Intent: grade alignment to the entire `INTENT.md` at once.
  - Broad multi-preference scoring hides which preference failed.

## Calibration Guidance

- Because variance is situational, run graders multiple times and inspect
  spread/drift before trusting a criterion.
- Keep sample artifacts that represent objective baseline expectations over
  time; format can be freeform initially.
- If repeated runs show unstable judgments, tighten grader intent and reduce
  dimension overlap.

## Reference Samples And Scaling

- Start with a small reference set of real samples (about 5) that represent
  clear baseline expectations for the grader.
- Use scenarios to generate an initial synthetic set (for example ~50 samples)
  and evaluate grader behavior across that set.
- Measure outcomes and variance before scaling further.
- Expand synthetic generation after baseline behavior is stable.
- Use spot-checking on larger sets to ensure quality does not drift as volume
  increases.

## Authoring Rules

- Each grader should have:
  - A clearly defined input artifact scope (turn, conversation, or specific run
    artifact) and expected output being graded.
  - Clear pass/fail or rubric criteria.
  - Explicit scoring scale.
  - Evidence expectations tied to transcript or tool-output facts.
- Prefer deterministic graders when rule checks can be encoded directly.
- Use LLM graders for synthesis judgments and nuanced behavioral checks.
- Keep grader prompts concise and avoid duplicate criteria across graders.

## Verification Loop

1. Update `INTENT.md` when direction changes.
2. Update or add graders mapped to changed intent sections where useful.
3. Run grading on representative scenarios (including repeated runs when
   variance matters).
4. Fix behavior or rubric drift before expanding scope.
