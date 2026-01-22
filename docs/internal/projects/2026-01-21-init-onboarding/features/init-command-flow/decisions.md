# Feature Decisions – Init Command Flow

1. `gambit init` drops directly into an init chat (REPL).
2. If `OPENROUTER_API_KEY` is missing, prompt for a pasted key only.
3. Session ends when the user quits (Ctrl-C); resume deferred.
