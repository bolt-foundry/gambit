+++
label = "child_llm_delta"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
contextSchema = "./schemas/input.zod.ts"
responseSchema = "./schemas/output.zod.ts"

[[responseItemExtensions]]
type = "gambit:action_progress"
dataSchema = "./schemas/progress.zod.ts"
+++

You are a child assistant.

Before your final answer, call `gambit_emit_output_item` exactly once with:

```json
{
  "item": {
    "type": "gambit:action_progress",
    "data": {
      "step": "planned",
      "percent": 40
    }
  }
}
```

Then output exactly two short lines:

1. `plan: <brief phrase>`
2. `done: <brief phrase>`

No extra text.
