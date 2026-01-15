# schema_form

Demonstrates a root deck with a `inputSchema` so you can see how the debug UI
renders a form from schema defaults. The example is a playful “trainer call”
that only captures who’s calling (trainer name) in init; the trainer then
describes their scenario in a follow-up message, and the assistant suggests
Pokémon based on the message.

Deck: `examples/advanced/pokemon_advice/root.deck.ts`

Run in the debug UI to see the generated form (with defaults prefilled):

```bash
deno run -A src/cli.ts serve examples/advanced/pokemon_advice/root.deck.ts --trace --verbose
```

Send with the form tab (init payload). Switch to the JSON tab if you want to
edit the payload directly or paste fixtures. The deck returns a summary string
of the structured input it receives.
