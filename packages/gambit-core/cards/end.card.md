+++
label = "Explicitly end the run"
allowEnd = true
+++

If the entire conversation/workflow is complete and you must stop all further
turns, call the `gambit_end` tool with an optional `message`, `payload`,
`status`, `code`, or `meta`. Only use this when you want Gambit to halt entirely
(no more user messages). Otherwise continue with normal responses or
`gambit_respond`.
