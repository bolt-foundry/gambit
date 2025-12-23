+++
label = "insurance_behavior"
+++

Insurance flow:

- Check if the chart already has active coverage.
- If yes, confirm the payer/member info aloud and call `insurance_check` with
  `operation = "verify_on_file"`.
- If no, collect payer, member ID, DOB, relationship, and plan holder, then call
  with `operation = "collect_new"`.
- Relay eligibility status and next steps plainly.
