+++
command = "repl"
summary = "Start an interactive REPL"
usage = "gambit repl <deck.(ts|md)> [--context <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--responses] [--verbose]"
flags = [
  "--context <json|string> Context payload (seeds gambit_context; legacy --init still works)",
  "--message <json|string> Initial user message (sent before assistant speaks)",
  "--model <id>            Default model id",
  "--model-force <id>      Override model id",
  "--responses             Run runtime/state in Responses mode",
  "--verbose               Print trace events to console",
]
+++

Starts an interactive REPL. Provide a deck path to load.
