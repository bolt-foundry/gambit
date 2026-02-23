# Intermediate Child Delta Demo

This demo is designed to exercise canonical intermediate child output-item
semantics (Project 08 delta path).

## Files

- `child_progress.deck.ts`: compute child deck emitting intermediate
  `gambit:action_progress` items via `ctx.emitOutputItem(...)`.
- `parent_compute_harness.deck.ts`: compute parent deck that calls the child via
  `ctx.spawnAndWait(...)`.
- `md_llm_parent/PROMPT.md`: markdown parent LLM deck that calls markdown child
  action deck.
- `md_llm_child/PROMPT.md`: markdown child LLM deck (with
  `schemas/input.zod.ts`, `schemas/output.zod.ts`, and
  `schemas/progress.zod.ts`) that emits `gambit:action_progress` via
  `gambit_emit_output_item`.

## Run (CLI)

From `packages/gambit`:

```bash
deno run -A src/cli.ts run \
  examples/dev/intermediate-child-delta/parent_compute_harness.deck.ts \
  --context '"exercise delta path"' \
  --trace /tmp/intermediate-child-delta.trace.jsonl \
  --no-worker-sandbox
```

Inspect canonical child response events:

```bash
rg '"type":"response\.(created|output_item.added|output_item.done|completed|failed)"' \
  /tmp/intermediate-child-delta.trace.jsonl
```

## Run Markdown LLM -> Action(LLM)

From `packages/gambit`:

```bash
deno run -A src/cli.ts run \
  examples/dev/intermediate-child-delta/md_llm_parent/PROMPT.md \
  --context '"exercise llm action deltas"' \
  --responses \
  --stream \
  --model openai/gpt-4o-mini \
  --trace /tmp/llm-to-llm-openai-md-clean.trace.jsonl \
  --no-worker-sandbox
```

Inspect child deck trace records:

```bash
rg 'md_llm_child/PROMPT.md|gambit_emit_output_item|response\.output_item\.(added|done)|response\.created|response\.completed' \
  /tmp/llm-to-llm-openai-md-clean.trace.jsonl
```
