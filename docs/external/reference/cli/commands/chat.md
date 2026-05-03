+++
command = "chat"
summary = "Start a local deck chat server"
usage = "gambit chat <deck.(ts|md)> [--context <json|string>] [--model <id>] [--model-force <id>] [--port <n>] [--state <file>] [--trace <file>] [--runtime-tools <file.md> ...] [--repro-message <text>] [--responses] [--open] [--verbose] [-A|--allow-all|--allow-<kind>] [--worker-sandbox|--no-worker-sandbox|--legacy-exec]"
flags = [
  "--context <json|string> Context payload (seeds gambit_context; legacy --init still works)",
  "--model <id>            Default model id",
  "--model-force <id>      Override model id",
  "--port <n>              Port for chat (default: 8787)",
  "--state <file>          Load/persist state",
  "--trace <file>          Write trace events to file (JSONL)",
  "--runtime-tools <file>  Markdown/TOML runtime-tool definitions (repeatable)",
  "--repro-message <text>  Store a repeatable repro prompt in session state",
  "--responses             Run runtime/state in Responses mode",
  "--open                  Open the localhost chat URL in the browser",
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

Starts a focused localhost browser chat for a deck. The command prints the chat
URL and serves a transcript, session panel, tool summaries, and trace events.
Use `--repro-message` to attach a known user ask to the session payload for
repeatable repro flows. It does not send the message automatically.

Runtime tools are supplied by Markdown files with TOML frontmatter using
`[[tools]]`. Each tool may include `name`, `description`, `inputSchema`, and
`action`. Duplicate tool names fail fast. When a runtime tool is called and an
`action` is configured, the chat server runs that action deck with the tool
arguments as context and returns the action output as the tool result.
