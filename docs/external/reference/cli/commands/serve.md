+++
command = "serve"
summary = "Run the debug UI server"
usage = "gambit serve [<deck.(ts|md)>] [--model <id>] [--model-force <id>] [--port <n>] [--responses] [--verbose] [--watch] [--no-bundle] [--no-sourcemap]"
flags = [
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
  "--verbose               Print trace events to console",
]
+++

Starts the debug UI server (default at `http://localhost:8000/`).
