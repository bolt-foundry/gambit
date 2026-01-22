+++
command = "grade"
summary = "Grade a saved state file"
usage = "gambit grade <grader-deck.(ts|md)> --state <file> [--model <id>] [--model-force <id>] [--trace <file>] [--responses] [--verbose]"
flags = [
  "--grader <path>         Grader deck path (overrides positional)",
  "--state <file>          Load/persist state",
  "--model <id>            Default model id",
  "--model-force <id>      Override model id",
  "--trace <file>          Write trace events to file (JSONL)",
  "--responses             Run runtime/state in Responses mode",
  "--verbose               Print trace events to console",
]
+++

Grades a saved state file and appends results to `meta.gradingRuns`.
