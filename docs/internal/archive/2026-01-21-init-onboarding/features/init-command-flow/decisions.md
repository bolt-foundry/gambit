# Feature Decisions – Init Command Flow

1. `gambit init` drops directly into an init chat (REPL).
2. If `OPENROUTER_API_KEY` is missing in env and `<target>/.env`, prompt for a
   pasted key and write `<target>/.env` (skip if present).
3. Output files live under the target directory and are never overwritten.
4. Session ends when the user quits (Ctrl-C); resume deferred.
