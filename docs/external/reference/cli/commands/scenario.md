+++
command = "scenario"
summary = "Run a scenario loop with a persona deck"
usage = "gambit scenario <root-deck.(ts|md)> --test-deck <persona-deck.(ts|md)> [--context <json|string>] [--bot-input <json|string>] [--message <json|string>] [--max-turns <n>] [--state <file>] [--grade <grader-deck.(ts|md)> ...] [--trace <file>] [--responses] [--verbose] [--worker-sandbox|--no-worker-sandbox|--legacy-exec]"
flags = [
  "--test-deck <path>      Persona/scenario deck path",
  "--grade <path>          Grader deck path (repeatable)",
  "--context <json|string> Context payload (seeds gambit_context; legacy --init still works)",
  "--bot-input <json|string> Input payload for the persona/scenario deck",
  "--message <json|string> Initial user message (sent before assistant speaks)",
  "--max-turns <n>         Max turns for scenario loop (default: 12)",
  "--state <file>          Load/persist state",
  "--model <id>            Default model id",
  "--model-force <id>      Override model id",
  "--trace <file>          Write trace events to file (JSONL)",
  "--responses             Run runtime/state in Responses mode",
  "--worker-sandbox        Force worker execution on",
  "--no-worker-sandbox     Force worker execution off",
  "--legacy-exec           Alias for --no-worker-sandbox",
  "--sandbox               Deprecated alias for --worker-sandbox",
  "--no-sandbox            Deprecated alias for --no-worker-sandbox",
  "--verbose               Print trace events to console",
]
+++

Runs a persona deck against a root deck to execute a scenario. Repeat `--grade`
to apply multiple graders.

If the root deck has required init fields that are missing, the persona deck is
asked to return JSON for only the missing fields before the run starts. The
filled init is merged without overwriting explicit values and validated against
the root init schema.
