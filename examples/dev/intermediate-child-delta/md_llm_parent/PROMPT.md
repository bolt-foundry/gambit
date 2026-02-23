+++
label = "parent_llm_to_llm_action"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
[[actions]]
name = "child_llm_delta"
path = "../md_llm_child/PROMPT.md"
description = "Child LLM deck used to exercise action-boundary deltas."
+++

You are the parent assistant.

Instructions:

- Call `child_llm_delta` exactly once.
- After it returns, respond with: `child said:` `<child output>`
- Do not call any other tools.
