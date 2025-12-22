# Examples guide

Per-example docs:

- [hello_world.deck.md](./examples/hello_world.md)
- [agent_with_typescript](./examples/agent_with_typescript.md)
- [agent_with_multi_actions](./examples/agent_with_multi_actions.md)
- [handlers_md](./examples/handlers_md.md)
- [handlers_ts](./examples/handlers_ts.md)
- [internal_monolog](./examples/internal_monolog.md)
- [schema_form](./examples/schema_form.md)
- [cold_emailer](./examples/cold_emailer.md)

Notes:

- Routing examples rely on tight action descriptions and schemas so the model
  picks the right tool.
- Handler examples show how busy/idle status streams and how handled errors
  surface as envelopes.
- All examples default to `openai/gpt-4o-mini`; override with `--model` or
  `--model-force` to test other providers.
