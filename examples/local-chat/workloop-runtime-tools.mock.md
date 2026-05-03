+++
label = "workloop_runtime_tools_mock"

[[tools]]
name = "complete_task"
description = "Mark the current Workloop task complete."
action = "./actions/complete_task.mock.deck.ts"

[[tools]]
name = "escalate_task"
description = "Escalate or block the current Workloop task."
action = "./actions/escalate_task.mock.deck.ts"
+++

Mock Workloop runtime tools for local Chief debugging. These tools are supplied
by the chat launcher so the Chief deck does not need Workloop-specific tool
definitions embedded in the deck source.
