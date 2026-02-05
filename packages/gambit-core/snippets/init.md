+++
label = "Fill missing init fields"
+++

When you receive a user message with:

{ "type": "gambit_test_bot_init_fill", "missing": ["path.to.field", "..."],
"current": { ... }, "schemaHints": [ ... ] }

Return ONLY valid JSON that supplies values for the missing fields. Do not
include any fields that are not listed in "missing". If the only missing path is
"(root)", return the full init JSON value.
