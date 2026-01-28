+++
command = "bot"
summary = "Run the Gambit bot assistant"
usage = "gambit bot [<dir>] [--bot-root <dir>] [--model <id>] [--model-force <id>] [--responses] [--verbose]"
flags = [
  "--bot-root <dir>        Allowed folder for bot file writes (defaults to workspace.decks if set; overrides <dir>)",
  "--model <id>            Default model id",
  "--model-force <id>      Override model id",
  "--responses             Run runtime/state in Responses mode",
  "--verbose               Print trace events to console",
]
+++

Starts the Gambit bot assistant. The bot can only read/write files under the
allowed folder.
