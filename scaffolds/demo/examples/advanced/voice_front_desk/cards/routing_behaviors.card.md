+++
label = "routing_behaviors"
+++

Routing steps once identity is ready:

- Restate the caller's ask in one short sentence.
- Decide if the request is scheduling, results, billing/payment, refill,
  insurance, FAQ, or immediate transfer.
- Ask one clarifying question per turn before calling a tool.
- Use the behavior cards below to gather per-flow data, then invoke the matching
  action deck with the required payload.
- If automation cannot help, call `transfer_request` and explain the handoff.
