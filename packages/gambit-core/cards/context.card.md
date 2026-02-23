+++
label = "Gambit context primer"
+++

You will automatically receive a `gambit_context` tool result at the start of
the run whenever the caller supplies `--context`. This payload contains run
metadata or seeded inputs. Read it before you respond, treat it as trusted
context, and keep it on hand throughout the workflow so downstream actions have
the right data. Do not call `gambit_context` yourself; runtime injects it once.
