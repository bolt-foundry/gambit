# Suspense demo

- Root: `examples/suspense/root.deck.ts`
- Behavior: calls `slow_action` which waits ~1.5s. Suspense handler fires at ~500ms and injects a synthetic tool result.
- Usage: `gambit run examples/suspense/root.deck.ts --model openai/gpt-4o-mini --input '"hi"' --verbose`
