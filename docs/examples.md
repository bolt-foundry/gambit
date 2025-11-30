# Examples

Each command assumes `./bin/gambit` from repo root and `OPENROUTER_API_KEY` set for live model calls.

- **Hello world** (`examples/hello_world/root.deck.ts`): minimal deck that calls an echo action.
  ```sh
  ./bin/gambit run examples/hello_world/root.deck.ts --input '"hi"'
  ```
- **Markdown decks** (`examples/markdown/hello.deck.md`): author decks in Markdown frontmatter + body.
  ```sh
  ./bin/gambit run examples/markdown/hello.deck.md --input '"hi"'
  ```
- **Suspense + streaming** (`examples/suspense/root.deck.ts`): demonstrates `onPing` handler and streaming UI.
  ```sh
  ./bin/gambit serve examples/suspense/root.deck.ts --port 8000
  open http://localhost:8000/
  ```
