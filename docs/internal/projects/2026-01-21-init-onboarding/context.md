# Gambit Init Onboarding – Context

## Current Behavior

- `gambit init` scaffolds a static project from
  `packages/gambit/scaffolds/init/`.
- It ensures the target directory exists, copies files/folders, and prompts for
  `OPENROUTER_API_KEY` if missing.
- It does not start a REPL or any interactive flow.

## Relevant Code

- `packages/gambit/src/commands/init.ts` – current init command implementation.
- `packages/gambit/src/commands/scaffold_utils.ts` – scaffold helpers, env
  prompting.
- `packages/gambit/scaffolds/init/` – current init templates.

## Notes

- Gambit has no built-in FS tools today; init-specific file ops will be new.
- The REPL/serve tooling already supports tool calls and streaming.
