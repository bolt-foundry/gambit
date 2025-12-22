# Example: cold_emailer

What it shows

- A schema-backed input for drafting cold emails.
- A follow-up research action that extracts safe personalization insights.
- Guardrails that keep outputs short, professional, and focused.

Key files

- `examples/cold_emailer/cold_emailer.deck.md` — root deck with formatting and
  tone constraints.
- `examples/cold_emailer/schemas/cold_emailer_input.zod.ts` — input schema with
  `name`, `details`, `sender`, `products`, and optional voice fields.
- `examples/cold_emailer/research_recipient.deck.md` — research action deck for
  personalization insights.
- `examples/cold_emailer/voice_critic.deck.md` — critique action deck for tone
  and voice.
- `examples/cold_emailer/send_email.deck.ts` — demo send action (TypeScript).
- `examples/cold_emailer/log_revision_plan.deck.ts` — demo logger for revision
  steps (TypeScript).
- `examples/cold_emailer/cards/assistant_persona.card.md` — assistant motivation
  and guidance for outreach.
- `examples/cold_emailer/cards/user_persona.card.md` — recipient motivations and
  response blockers.
- `examples/cold_emailer/cards/behavior.card.md` — behavior rules and output
  format guidance.
- `examples/cold_emailer/cards/send_email.card.md` — action card for sending the
  drafted email.
- `examples/cold_emailer/cards/log_revision_plan.card.md` — action card for
  logging the revision plan.
- `examples/cold_emailer/lookup_profile.deck.ts` — TypeScript action with
  hard-coded demo profile data.
- `examples/cold_emailer/schemas/research_input.zod.ts` — input schema for
  `research_recipient`.
- `examples/cold_emailer/schemas/research_output.zod.ts` — output schema for
  `research_recipient`.
- `examples/cold_emailer/schemas/voice_critic_input.zod.ts` — input schema for
  `voice_critic`.
- `examples/cold_emailer/schemas/voice_critic_output.zod.ts` — output schema for
  `voice_critic`.

Why it’s structured this way

- This keeps the first version minimal: a small schema plus a fixed output
  format.
- The research action isolates personalization logic and makes it reusable.
- The TypeScript lookup deck demonstrates how a real data lookup could plug in.
- The research deck returns a concise array of the most relevant information,
  plus optional trend context.
- The voice critic helps keep tone from sounding corporate or corny.
- The guardrails make it safe to use with sparse input and avoid spammy output.

How to run

- `deno run -A src/cli.ts run examples/cold_emailer/cold_emailer.deck.md --init '{"name":"Ava","details":"CTO at a fintech, cares about infra costs; pitching a cost monitoring tool","sender":"Riley","products":["Cost monitoring"],"voiceOptions":["founder-to-founder","casual concise","technical direct","warm consultative"]}' --stream`

Try this input

- `--init '{"name":"Jordan","details":"VP Marketing at a SaaS company; growth stalled; pitching analytics","sender":"Riley","products":["Attribution analytics"],"voice":"founder-to-founder"}'`
