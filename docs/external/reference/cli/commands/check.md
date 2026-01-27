+++
command = "check"
summary = "Validate deck model references"
usage = "gambit check <deck.(ts|md)>"
flags = ["--online    Check remote provider availability (requires API keys)."]
+++

Loads the deck tree, collects declared models, and checks that each model exists
in the backing providers. Ollama models are validated locally by default. Remote
providers (OpenRouter/Google) are only validated when `--online` is set.
Unprefixed models resolve to the configured `providers.fallback` (default:
OpenRouter).
