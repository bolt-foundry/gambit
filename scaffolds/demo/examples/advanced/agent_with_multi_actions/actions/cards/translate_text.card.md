+++
label = "translate_text_card"

[[actions]]
name = "translate_text"
path = "../decks/translate_text.deck.md"
description = "Translate text into a target language."
+++

Call `translate_text` whenever the user asks to translate or rephrase text into
another language (default to English if none is specified). Expect the action to
return the translated text; surface that result without extra commentary.
