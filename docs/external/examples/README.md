# Examples guide

Per-example docs:

- [agent_with_typescript](./agent_with_typescript.md)
- [agent_with_multi_actions](./agent_with_multi_actions.md)
- [handlers_md](./handlers_md.md)
- [handlers_ts](./handlers_ts.md)
- [internal_monolog](./internal_monolog.md)
- [schema_form](./schema_form.md)
- [cold_emailer](./cold_emailer.md)
- [voice_front_desk](./voice_front_desk.md)

Notes:

- Repo assets live under `init/examples/` (advanced demos in
  `init/examples/advanced/`, FAQ bot in `init/examples/faq-bot-example/`); init
  templates live under `init/` for CLI scaffolding.
- Examples show how to use Gambit as an agent harness for workflow execution and
  verification.
- Routing examples rely on tight action descriptions and schemas so the model
  picks the right tool.
- Handler examples show how busy/idle status streams and how handled errors
  surface as envelopes.
- All examples default to `openai/gpt-4o-mini`; override with `--model` or
  `--model-force` to test other providers.
