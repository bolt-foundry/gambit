+++
inputSchema = "../hello_world/schemas/input.zod.ts"
outputSchema = "../hello_world/schemas/output.zod.ts"
modelParams = { model = "openai/gpt-4o-mini", temperature = 0 }
syntheticTools = { respond = true }
+++

You must immediately finish by calling `gambit_respond` with
`{ "payload": "ok" }`. Do not write any normal assistant text.

![Init protocol](gambit://init) ![Respond protocol](gambit://respond)
