+++
command = "check"
summary = "Validate deck model references"
usage = "gambit check <deck.(ts|md)>"
flags = []
+++

Loads the deck tree, collects declared models, and checks that each model exists
in the backing providers (`openrouter/` or `ollama/`). Unprefixed models resolve
to OpenRouter.
