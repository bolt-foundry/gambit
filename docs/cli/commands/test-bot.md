+++
command = "test-bot"
summary = "Run a persona/test-bot loop"
usage = "gambit test-bot <root-deck.(ts|md)> --test-deck <persona-deck.(ts|md)> [--init <json|string>] [--bot-input <json|string>] [--message <json|string>] [--max-turns <n>] [--state <file>] [--grade <grader-deck.(ts|md)> ...] [--trace <file>] [--verbose]"
flags = [
  "--test-deck <path>      Persona/test deck path",
  "--grade <path>          Grader deck path (repeatable)",
  "--init <json|string>    Init payload (when provided, sent via gambit_init)",
  "--bot-input <json|string> Input payload for the persona deck",
  "--message <json|string> Initial user message (sent before assistant speaks)",
  "--max-turns <n>         Max turns for test-bot (default: 12)",
  "--state <file>          Load/persist state",
  "--model <id>            Default model id",
  "--model-force <id>      Override model id",
  "--trace <file>          Write trace events to file (JSONL)",
  "--verbose               Print trace events to console",
]
+++

Runs a persona deck against a root deck to simulate conversations. Repeat
`--grade` to apply multiple graders.
