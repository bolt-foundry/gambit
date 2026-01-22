+++
command = "run"
summary = "Run a deck once"
usage = "gambit run [<deck.(ts|md)>] [--context <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--trace <file>] [--state <file>] [--stream] [--responses] [--verbose]"
flags = [
  "--context <json|string> Context payload (seeds gambit_context; legacy --init still works)",
  "--message <json|string> Initial user message (sent before assistant speaks)",
  "--model <id>            Default model id",
  "--model-force <id>      Override model id",
  "--trace <file>          Write trace events to file (JSONL)",
  "--state <file>          Load/persist state",
  "--stream                Enable streaming responses",
  "--responses             Run runtime/state in Responses mode",
  "--verbose               Print trace events to console",
]
+++

Runs a deck once and exits. Use `--state` to persist or resume a run.
