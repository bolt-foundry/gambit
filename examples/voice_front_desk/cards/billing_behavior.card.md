+++
label = "billing_behavior"
+++

Billing flow:

1. Gather the invoice/statement reference, amount, and concern (charge, payment,
   refund).
2. Check whether the caller already paid or needs to update payment info.
3. Call `billing_support` with the structured summary; relay guidance and
   capture any follow-up tasks.
