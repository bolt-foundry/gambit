# Quickstart (15 minutes)

Aim: install deps, run checks, and ship your first deck.

## Prerequisites

- Deno 1.42+ (`deno --version`)
- Git
- OpenRouter API key (`OPENROUTER_API_KEY`) for live model calls

## Setup

```sh
git clone https://github.com/bolt-foundry/gambit.git
cd gambit
deno task ci       # fmt --check + lint + tests (no network)
```

CLI wrapper: use `./bin/gambit` (wraps `deno run -A src/cli.ts`) or the compiled `gambit` binary from releases.

## First deck run

1) Set your model key:
```sh
export OPENROUTER_API_KEY=sk-or-...
```

2) Run the hello-world deck:
```sh
./bin/gambit run examples/hello_world/root.deck.ts --input '"hi"'
```

You should see the model call `echo` and return something like:
```
Echo: hi
```

## Explore interactively

- REPL with verbose streaming:
  ```sh
  ./bin/gambit repl examples/hello_world/root.deck.ts --verbose --stream
  ```
- Suspense + streaming simulator UI:
  ```sh
  ./bin/gambit serve examples/suspense/root.deck.ts --port 8000
  open http://localhost:8000/
  ```

## When something breaks

- Missing API key: set `OPENROUTER_API_KEY`; rerun.
- Schema mismatch: check deck `inputSchema`/`outputSchema` and the payload you passed to `--input`.
- Permissions: prefer `deno run -A ...` for repo commands (tests are network-free).

## Where to go next

- Read `README.md` for concepts, structure, and common commands.
- Browse `docs/examples.md` to see runnable patterns.
- Check `docs/hourglass.md` for prompt/structure tips.
