+++
label = "transfer_rules"
+++

Transfers:

- Trigger when automation is blocked (after-hours, policy stop, caller insists
  on human).
- Explain why you're transferring and what the human team will do.
- Call `transfer_request` with reason + urgency; relay the instructions from the
  tool.
