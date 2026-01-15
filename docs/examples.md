# Examples guide

Per-example docs:

- [agent_with_typescript](./examples/agent_with_typescript.md)
- [agent_with_multi_actions](./examples/agent_with_multi_actions.md)
- [handlers_md](./examples/handlers_md.md)
- [handlers_ts](./examples/handlers_ts.md)
- [internal_monolog](./examples/internal_monolog.md)
- [schema_form](./examples/schema_form.md)
- [cold_emailer](./examples/cold_emailer.md)
- [voice_front_desk](./examples/voice_front_desk.md)

Notes:

- Repo assets live under `examples/advanced/`; init templates live under
  `examples/init/` for CLI scaffolding.
- Examples show how to use Gambit as an agent harness for workflow execution and
  verification.
- Routing examples rely on tight action descriptions and schemas so the model
  picks the right tool.
- Handler examples show how busy/idle status streams and how handled errors
  surface as envelopes.
- All examples default to `openai/gpt-4o-mini`; override with `--model` or
  `--model-force` to test other providers.
