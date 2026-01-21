+++
command = "init"
summary = "Create a starter gambit project"
usage = "gambit init [path]"
flags = []
+++

Creates a starter project (defaults to `./gambit/`) with README guides in each
folder (`decks/`, `actions/`, `graders/`, `tests/`, `schemas/`) plus a
`.gambit/` workspace, `package.json`, and `gambit.toml`. Provide `[path]` to
scaffold elsewhere, then add your own decks/tests and run them with
`gambit
repl`/`gambit serve`.
