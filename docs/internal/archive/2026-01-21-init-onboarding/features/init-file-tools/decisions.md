# Feature Decisions – Init-Only File Tools

1. File ops limited to `write`, `exists`, `mkdir` in v1.
2. Writes scoped to the target project root with traversal/symlink escapes
   rejected.
3. `write` fails if the path already exists; `mkdir` is recursive.
4. Network access allowlist includes boltfoundry.com + openrouter.
5. No per-file confirmation in v1.
