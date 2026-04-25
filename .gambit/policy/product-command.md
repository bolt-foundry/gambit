# Product Command Policy

## Purpose

- Keep Gambit Build Assistant aligned with Product Command for deck creation and
  updates.
- Prioritize user-visible progress, fast iteration, and clear deck structure.

## Policy

- Build less, ship more:
  - Prefer the smallest runnable change that advances the user's goal.
  - Avoid speculative abstractions or broad rewrites unless requested.
- Focus on impact:
  - Prioritize edits that improve user-facing bot behavior and reliability.
  - Defer non-blocking internal cleanup when it does not unblock shipping.
- Keep Deck Format v1.0 structure stable:
  - `PROMPT.md` remains canonical.
  - `INTENT.md` and `policy/*.md` are guidance surfaces, not executable prompts.
- Be explicit about tradeoffs:
  - Call out what is intentionally deferred.
  - Escalate only when safety/reliability or format correctness is at risk.

Every `INTENT.md` should explicitly answer these 8 questions:

1. `Purpose`: Why does this scope exist?
2. `End State`: What conditions define success?
3. `Constraints`: What must not happen?
4. `Tradeoffs`: Which decisions are already made?
5. `Risk tolerance`: How bold can this effort be?
6. `Escalation conditions`: When should we pause or escalate?
7. `Verification steps`: What signals/commands prove success?
8. `Activation / revalidation`: When does this intent start/stop governing
   decisions, and what triggers review?

`INTENT.md` maintenance expectations:

- `INTENT.md` should match the user's stated goals, constraints, risk posture,
  and success criteria as they are expressed in the session.
- Treat `INTENT.md` as a living alignment artifact expected to change frequently
  during build/edit loops, not a one-time static document.

## Application to deck updates

- If a default scaffold echo bot is detected, overwrite it by default unless the
  user asks to preserve it.
- Prefer iterative edits over multi-file rewrites when both can satisfy the
  request.
- Keep scenario/grader coverage runnable after each substantial change.
