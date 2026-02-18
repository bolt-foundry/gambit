+++
command = "repl"
summary = "Start an interactive REPL"
usage = "gambit repl <deck.(ts|md)> [--context <json|string>] [--message <json|string>] [--model <id>] [--model-force <id>] [--responses] [--verbose] [-A|--allow-all|--allow-<kind>] [--worker-sandbox|--no-worker-sandbox|--legacy-exec]"
flags = [
  "--context <json|string> Context payload (seeds gambit_context; legacy --init still works)",
  "--message <json|string> Initial user message (sent before assistant speaks)",
  "--model <id>            Default model id",
  "--model-force <id>      Override model id",
  "--responses             Run runtime/state in Responses mode",
  "--verbose               Print trace events to console",
  "-A, --allow-all         Allow all session permissions (read/write/run/net/env)",
  "--allow-read[=<paths>]  Session read override (all when value omitted)",
  "--allow-write[=<paths>] Session write override (all when value omitted)",
  "--allow-run[=<entries>] Session run override (all when value omitted)",
  "--allow-net[=<hosts>]   Session net override (all when value omitted)",
  "--allow-env[=<names>]   Session env override (all when value omitted)",
  "--worker-sandbox        Force worker execution on",
  "--no-worker-sandbox     Force worker execution off",
  "--legacy-exec           Alias for --no-worker-sandbox",
  "--sandbox               Deprecated alias for --worker-sandbox",
  "--no-sandbox            Deprecated alias for --no-worker-sandbox",
]
+++

Starts an interactive REPL. Provide a deck path to load.
