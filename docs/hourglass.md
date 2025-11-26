# Hourglass prompting (Context Engineering)

Source:
[Context Engineering 101: The Hourglass](https://contexteng.ai/p/context-engineering-101-the-hourglass).

## Idea

Structure prompts like an hourglass: start wide with rich context, narrow into
precise instructions/constraints, then widen slightly to let the model respond
naturally. The “pinch” keeps the model anchored while the opening/closing holds
the needed context and tone.

## Core pieces

- Assistant persona: role, expertise, voice, and what to avoid.
- User persona: what the user is trying to achieve, constraints, success
  signals.
- Behavior: explicit steps/guardrails, I/O expectations, formatting, turn order,
  when to ask questions vs. act.

## Applying to Gambit

- Use separate cards for assistant persona, user persona, and behavior; embed
  them into the deck body to keep concerns isolated.
- Keep the “pinch” (behavior/constraints) closest to the model call, and keep
  personas above it so they influence style without diluting instructions.
- Make the behavior section concrete: steps, priorities, stopping conditions,
  and what to do when requirements are unclear.
- Keep schemas tight so actions/tools stay aligned with the narrow middle of the
  hourglass.

## Skeleton (deck + cards)

```
src/decks/
  gambit-assistant.deck.md     # root deck embeds the cards below
  cards/
    assistant_persona.card.md  # who the assistant is
    user_persona.card.md       # who the user is / goals / constraints
    behavior.card.md           # steps, guardrails, outputs, when to ask vs act
```

Deck body outline:

1. Assistant persona card content.
2. User persona card content.
3. Behavior card content: steps/constraints/output shape.
4. (Optional) Examples or edge cases.

## Tips

- Keep the behavior “pinch” short and specific; move narrative/tone into persona
  cards.
- Declare turn order explicitly (assistant-first vs. user-first).
- Use numbered steps and bullets; avoid long prose in the middle section.
- When adding tools/actions, restate when to call each and what to return after
  tools.
