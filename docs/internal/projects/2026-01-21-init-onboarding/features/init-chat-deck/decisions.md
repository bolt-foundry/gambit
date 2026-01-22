# Feature Decisions – Init Chat Deck

1. Init chat model: `openai/gpt-5-chat` via OpenRouter.
2. Minimal inputs: purpose + 2–3 example prompts.
3. Root deck is Markdown by default; action decks may be TypeScript later.
4. The init deck drives creation and writes files during the chat.
