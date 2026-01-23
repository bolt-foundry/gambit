# Gambit Init Onboarding – Decisions (Project-Level)

1. Audience: technical developers.
2. Default project dir when no path is provided: `./gambit/`.
3. Output v1: `<target>/root.deck.md` and `<target>/tests/first.test.deck.md`.
4. Hardcode output filenames in v1 to reduce decision surface.
5. Do not overwrite existing output files; exit with a clear message.
6. OpenRouter key handling: prompt only if missing in env and `<target>/.env`,
   then write `<target>/.env`.
7. Init-only file tool semantics: `write` fails if the path exists, `mkdir` is
   recursive, and paths are scoped to the target root with traversal and symlink
   escapes rejected.
