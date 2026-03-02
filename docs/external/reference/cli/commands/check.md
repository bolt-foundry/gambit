+++
command = "check"
summary = "Validate deck model references"
usage = "gambit check <deck.(ts|md)>"
flags = [
  "--online    Check remote provider availability (enabled by default).",
  "--no-online Skip remote provider availability checks.",
  "--json      Emit machine-readable diagnostics and exit non-zero on failures.",
]
+++

Loads the deck tree, collects declared models, and checks that each model exists
in the backing providers. Ollama models are validated locally by default. Remote
providers (OpenRouter/Google) are validated by default; use `--no-online` to
skip remote checks. Unprefixed models resolve to the configured
`providers.fallback` (default: OpenRouter).
