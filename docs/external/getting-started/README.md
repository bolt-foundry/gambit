# Getting Started

Use this page to get a fast path from install to your first native Gambit agent,
then to the scenario generation, scenario validation, and grader loop that
catches behavior regressions.

## Quickstart path

1. Run the demo to generate example agent definitions and configs:
   - `npx @bolt-foundry/gambit demo`
2. Run a native Gambit agent definition in the terminal:
   - `npx @bolt-foundry/gambit run gambit/hello.deck.md --context '"Gambit"'`
3. Open the debug UI to inspect traces:
   - `npx @bolt-foundry/gambit-simulator serve gambit/hello.deck.md --port 8000`
   - Visit `http://localhost:8000/debug`
4. Add a scenario for behavior you care about, check that it is a useful test,
   then grade the saved session:
   - `npx @bolt-foundry/gambit scenario <root-deck> --test-deck <persona-deck> --grade <grader-deck> --state .gambit/scenario.json --trace .gambit/scenario.jsonl`

## What you just set up

- A native Gambit agent path: Gambit owns the agent definition, local run,
  trace, scenario, and grader.
- A regression path: the same scenario and grader command can run in CI as a
  behavior check.
- A scenario-quality path: generated or hand-authored scenarios can be reviewed
  for realism, coverage, difficulty, grounding, duplication, and expected
  outcome clarity before they become regression data.
- A bring-your-own-framework path: for Mastra, LangGraph, OpenAI, or custom
  code, keep the production agent where it is and use Gambit scenarios, graders,
  traces, and reproduction inputs around the behavior that matters.

## Learn by doing

- Author a simple native Gambit agent: `../guides/authoring.md`
- Explore working examples: `../examples/`
