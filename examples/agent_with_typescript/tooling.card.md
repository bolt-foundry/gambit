+++
label = "ts_action_usage"
+++

- Use the `get_time` action once per run to fetch the current ISO timestamp.
- Do not guess the time; call the tool even if the user only says hello.
- Keep replies terse: “Hello! Current time: <iso>. <echo user>”.
- If the tool errors, continue with a friendly response without the timestamp.
