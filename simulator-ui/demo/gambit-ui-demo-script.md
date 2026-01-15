# Gambit demo scripts

Gambit is a framework for building LLM workflows in Markdown and code, then
running, debugging, and fixing them. Gambit helps you write prompts, run test
assistants that simulate conversation, and build graders that evaluate
performance.

## Concept overview script

Most teams start with one long prompt wired to tools and hope the model routes
correctly. Context arrives as one giant blob, costs climb, and hallucinations
slip in. Inputs and outputs are rarely typed, and debugging leans on provider
logs. When something fails, it is slow to reproduce.

Gambit changes that by treating each step as a deck with explicit inputs,
outputs, and guardrails. Decks combine model calls and compute steps in one
tree, so you can run offline with predictable traces.

Gambit answers one question: what happened, exactly, when this AI system ran. It
is open source, deterministic, stateless, and code-first. It produces ground
truth artifacts like runs, traces, and grades.

Gambit is not a system of record or a multi-user product. Bolt Foundry stores
and compares artifacts over time. Gambit executes and tells the truth.

If you can run it, you can inspect it. That is the core promise.

## Tactical walkthrough script

Start from a local checkout. In `packages/gambit`, run
`deno run -A src/cli.ts serve init/examples/advanced/voice_front_desk/decks/root.deck.md --port 8000`,
then open `http://localhost:8000/test-bot`.

In Test Bot, select the New patient intake persona. Fill the scenario
description, caller name, and date of birth. The init form comes from the deck
input schema, so this run stays reproducible.

Click Run and let a few turns stream. We now have a session id that ties
together the transcript, traces, and feedback.

Go to Calibrate, select that session, choose a grader, and run it. Calibrate
runs deck-defined grader decks against saved sessions and returns a score, a
reason, and the exact turn context that drove the result.

Go to Debug and inspect the run. The transcript shows every message, the trace
pane shows every deck and tool event, and timing is captured along the way.

From here the loop is simple. Edit the deck in code, rerun Test Bot, and regrade
until the behavior is correct.
