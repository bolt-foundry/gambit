+++
label = "taxo_runtime_tools_mock"

[[tools]]
name = "taxo_lookup_account"
description = "Look up a customer account in the Taxo-style support system."
action = "./actions/taxo_lookup_account.mock.deck.ts"
+++

Mock runtime tools for local customer-deck chat verification. The deck stays
portable; the launcher supplies this tool surface at runtime.
