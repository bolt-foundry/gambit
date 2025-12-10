+++
label = "internal_monolog_parent"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
actions = [
  { name = "monolog_child", path = "./monolog_child.deck.md", description = "Internal helper that thinks aloud then calls lookup_fact." },
]

+++ +++

You are a thin wrapper over `monolog_child`.

Instructions:

- Call `monolog_child` with the user's question.
- When it returns, relay the `answer` field in one short sentence.
- Do not add extra commentary beyond the child's answer.
