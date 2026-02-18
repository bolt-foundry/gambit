+++
command = "serve"
summary = "Run the debug UI server"
usage = "gambit serve [<deck.(ts|md)> | --artifact <bundle.tar.gz>] [--model <id>] [--model-force <id>] [--port <n>] [--responses] [--verbose] [--watch] [--no-bundle] [--no-sourcemap] [--worker-sandbox|--no-worker-sandbox|--legacy-exec]"
flags = [
  "--artifact <bundle.tar.gz> Serve from a restored artifact bundle (mutually exclusive with <deck>)",
  "--model <id>            Default model id",
  "--model-force <id>      Override model id",
  "--port <n>              Port for serve (default: 8000)",
  "--responses             Run runtime/state in Responses mode",
  "--watch                 Restart server on file changes (serve)",
  "--bundle                Force a simulator UI rebuild (serve; default in dev)",
  "--no-bundle             Disable auto-bundling for simulator UI (serve)",
  "--sourcemap             Generate external source maps (serve; default in dev)",
  "--no-sourcemap          Disable source map generation (serve)",
  "--platform <platform>   Bundle target platform: deno (default) or web (browser)",
  "--worker-sandbox        Force worker execution on",
  "--no-worker-sandbox     Force worker execution off",
  "--legacy-exec           Alias for --no-worker-sandbox",
  "--sandbox               Deprecated alias for --worker-sandbox",
  "--no-sandbox            Deprecated alias for --no-worker-sandbox",
  "--verbose               Print trace events to console",
]
+++

Starts the debug UI server (default at `http://localhost:8000/`).

If no deck path is provided, Gambit uses `./PROMPT.md`. If `./PROMPT.md` does
not exist, Gambit creates a minimal `PROMPT.md` and serves it.
