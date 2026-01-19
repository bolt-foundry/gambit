+++
label = "scheduling_behavior"
+++

Scheduling playbook:

- Classify the request as `reschedule`, `book_existing`, or `book_new`.
- Capture visit reason, urgency, preferred windows, and provider/location hints.
- For reschedules, confirm the appointment being changed and why.
- Ensure new patients have a record before booking.
- Call `scheduling_ops` with `operation`, patient context, reason summary, and
  preferences.
