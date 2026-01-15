+++
command = "repl"
summary = "Start an interactive REPL"
usage = "gambit repl <deck.(ts|md)> [--init <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--verbose]"
flags = [
  "--init <json|string>    Init payload (when provided, sent via gambit_init)",
  "--message <json|string> Initial user message (sent before assistant speaks)",
  "--model <id>            Default model id",
  "--model-force <id>      Override model id",
  "--verbose               Print trace events to console",
]
+++

Starts an interactive REPL. Provide a deck path to load.
