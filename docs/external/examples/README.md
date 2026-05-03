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
- [ollama](./ollama.md)

Notes:

- Source templates live under `packages/gambit/scaffolds/demo/examples/`
  (advanced demos in `.../advanced/`, FAQ bot in `.../faq-bot-example/`).
- When `gambit demo` seeds a workspace, generated copies live under
  `gambit/examples/`.
- Examples show how to author agents, run synthetic scenarios, grade behavior,
  inspect traces, and keep regressions reproducible.
- Routing examples rely on tight action descriptions and schemas so the model
  picks the right tool.
- Handler examples show how busy/idle status streams and how handled errors
  return structured envelopes.
- All examples default to `openai/gpt-4o-mini`; override with `--model` or
  `--model-force` to test other providers.
