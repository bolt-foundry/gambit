# Spec: Gambit Product Command Deck Format (v1.0)

Status: RFC (pre-1.0) Owner: Engineering (incl. Gambit-core engineering)

## Goals

- Define the 1.0 deck folder contract (required files, meanings, and
  boundaries).
- Define the canonical `PROMPT.md` TOML frontmatter keys.
- Make decks composable and fractal: actions/scenarios/graders are decks.

## Non-goals

- Fully define snippet/embed mechanics (beyond the built-in Gambit snippet
  namespace and its usage).
- Define migration UX, warning text, or exact deprecation timelines.

## Terms

- Deck: A runnable unit represented as a folder (identified by its `PROMPT.md`).
- Entrypoint: `PROMPT.md` inside a deck folder.
- Intent/Policy: Non-programmatic guidance used by humans and Gambit Bot to
  build, grade, calibrate, and update decks.
- Root deck: The deck invoked directly to start a run (top of the deck tree).
- Action deck: A deck invoked as a tool/action by another deck.
- Scenario deck: A deck used for synthetic/scripted runs (replaces “test”).
- Grader deck: A deck used to evaluate runs.
- Snippet: A reusable embed unit (what we previously called card embeds).
- Stdlib deck: A built-in deck resolved by Gambit from its stdlib deck bundle.

## Deck roles

Deck roles are determined by invocation:

- **Root deck**: started directly by the user/runner.
- **Action decks**: referenced via `[[actions]]`.
- **Scenario decks**: referenced via `[[scenarios]]`.
- **Grader decks**: referenced via `[[graders]]`.

Schema requirements:

- Root decks MAY omit `contextSchema` and `responseSchema`.
- Action/scenario/grader decks MUST declare `contextSchema` and `responseSchema`
  (these schemas define the IO contract visible to the parent deck).
  - For action and grader decks, include `gambit://snippets/respond.md` so the
    deck returns structured output via `gambit_respond`.
  - For scenario decks that need model-filled init inputs, include
    `gambit://snippets/init.md` so the model populates any missing required
    context fields before the run.
  - Scenario decks MAY omit the respond snippet if they are intended to produce
    plain chat output, but they MUST still declare schemas.
    - For plain chat output, `responseSchema` SHOULD be a string schema (for
      example, `gambit://schemas/scenarios/plain_chat_output.zod.ts`).
  - Grader decks MUST be compatible with the built-in grader schemas:
    `gambit://schemas/graders/contexts/turn.zod.ts` or
    `gambit://schemas/graders/contexts/conversation.zod.ts` (context) and
    `gambit://schemas/graders/grader_output.zod.ts` (response).
    - Compatibility rule (deep): base fields MUST be present and unchanged
      recursively. Extensions must not alter required/optional status or types
      of any existing fields.
    - Extension rule: graders MAY add additional fields to their context and
      response schemas, but extensions MUST be optional so downstream tooling
      remains compatible.
    - If graders want additional fields to be preserved by schema validation,
      they MUST include those fields in their `contextSchema`/`responseSchema`
      (for example by extending the built-in schemas).
  - Built-in schemas are listed below under "Schemas (built-in Gambit
    namespace)" and are the canonical compat surface for 1.0.

## Snippets (built-in Gambit namespace)

Snippets are embedded using Markdown image syntax. Built-in Gambit snippets use
the `gambit://snippets/*` namespace, for example:

```markdown
![respond](gambit://snippets/respond.md)
```

Built-in snippets (v1.0):

| URI                                        | Purpose                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `gambit://snippets/context.md`             | Context primer; explains the `gambit_context` tool result and how to treat seeded data.  |
| `gambit://snippets/init.md`                | Init-fill helper; instructs the model to populate missing required init/context fields.  |
| `gambit://snippets/respond.md`             | Respond instruction; tells the model to call `gambit_respond` with a structured payload. |
| `gambit://snippets/end.md`                 | Explicit end instruction; documents how/when to call `gambit_end`.                       |
| `gambit://snippets/generate-test-input.md` | Deprecated alias for `gambit://snippets/init.md` (legacy name).                          |

Notes:

- These are not files in your repo. They are resolved by Gambit from its
  built-in snippet registry/bundle.
- Use built-in snippets for standard, shared behaviors (for example, response
  envelopes, lifecycle hints, etc.). The exact list of built-in snippet names is
  defined by Gambit (the list above is the v1.0 set).
- `gambit://snippets/init.md` is distinct from the legacy `gambit://init` marker
  (deprecated). The init snippet is intended to prompt the model to populate
  missing required context fields for scenario/test flows.

## Snippets (local files)

Local snippets are allowed. They are embedded using the same Markdown image
syntax as built-in snippets, but the target is a file path instead of a
`gambit://` URI, for example:

```markdown
![](./snippets/my-snippet.md)
```

Local snippet expansion rules:

- Gambit resolves the path relative to the Markdown file that contains the embed
  (for example, `PROMPT.md` or another snippet).
- The referenced file is loaded as text and its body is inlined where the embed
  appeared (same behavior as legacy card embeds).
- Cycles are errors (a snippet cannot embed itself directly or indirectly).

## Schemas (built-in Gambit namespace)

Schemas are referenced by path strings in `PROMPT.md` frontmatter (for example
`contextSchema` and `responseSchema`). Built-in Gambit schemas use the
`gambit://schemas/*` namespace and are named to reflect their implementation
(Zod).

Built-in schemas (v1.0):

| URI                                                     | Purpose                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| `gambit://schemas/graders/respond.zod.ts`               | Shared respond-envelope schema used by decks and graders.       |
| `gambit://schemas/graders/grader_output.zod.ts`         | Canonical grader output schema (`score`, `reason`, `evidence`). |
| `gambit://schemas/graders/contexts/turn.zod.ts`         | Schema for per-turn grader context (single exchange).           |
| `gambit://schemas/graders/contexts/conversation.zod.ts` | Schema for full-conversation grader context.                    |
| `gambit://schemas/scenarios/plain_chat_output.zod.ts`   | Canonical string output for plain-chat scenario/test decks.     |

## Stdlib decks (built-in Gambit namespace)

Stdlib decks are referenced by URI and resolved by Gambit from its built-in deck
bundle (not from your repo). They exist to make it easy to connect external
agent runtimes/builders to Gambit decks.

Built-in stdlib decks (v1.0):

| URI                                            | Purpose                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `gambit://decks/openai/codex-sdk/PROMPT.md`    | Codex SDK bridge deck (link Codex to Gambit decks).                 |
| `gambit://decks/anthropic/agent-sdk/PROMPT.md` | Anthropic agent SDK bridge deck (link Claude Code to Gambit decks). |

## Deck folder contract

### Entrypoint file (required)

Every deck folder MUST include:

- `PROMPT.md`

### Recommended sibling docs (not enforced)

Deck folders SHOULD include:

- `INTENT.md`
- `policy/`

Notes (recommended behavior):

- Gambit tooling looks for `INTENT.md` and MAY scaffold it if missing.
- `INTENT.md` SHOULD follow the canonical intent headings from
  `policy/templates/INTENT.md`.
- `INTENT.md` explains **what** the deck should accomplish and why: goals,
  non-goals, constraints, tradeoffs, and escalation conditions. It is the source
  of truth for human alignment and for Gambit Bot decisions about what to build.
- `policy/*.md` explains **what must not happen** or what must always hold:
  guardrails, invariants, and lightweight acceptance tests. It is non-
  programmatic and keeps the bot and humans aligned on safe behavior.
- Neither `INTENT.md` nor policy docs are executable; do not treat them as a
  second prompt surface or as model instructions.
- Keep these files short and scannable (headings plus bullets). If they get
  long, move deeper background into `README.md` or split across `policy/*.md`.

### Optional files/folders

Deck folders MAY include:

- `README.md` (recommended)
- `samples/` (recommended)
- `snippets/` (recommended)
- `policy/` (optional policy docs)
- `reviews/` (optional AARs / retros)
- `actions/`, `scenarios/`, `graders/` (recommended organization only)

Deck folders MAY also include any other files/folders the author wants. The
conventions above exist to keep collaboration predictable, not to restrict
structure.

### Fractality

- Action/scenario/grader decks follow the same folder contract.
- Any deck MAY contain its own actions/scenarios/graders.

## Entrypoint contract (`PROMPT.md`)

### Frontmatter format

- `PROMPT.md` frontmatter MUST be TOML using `+++` delimiters.
- All deck metadata lives in `PROMPT.md` frontmatter.

### Execution semantics

- If `execute` is set in frontmatter, Gambit MUST run the code path (compute)
  instead of invoking the model with the `PROMPT.md` body.
- When `execute` is set, the `PROMPT.md` body is internal-only context and MUST
  NOT be shown to the model.
- The code path referenced by `execute` MAY declare `contextSchema` and
  `responseSchema` (Zod). These schemas are part of the deck’s IO contract and
  are visible to parent decks (for example, as action tool definitions).
- If `PROMPT.md` frontmatter declares `contextSchema` and/or `responseSchema`
  and the `execute` code path also declares schemas, they MUST match. Mismatches
  are warnings pre-1.0 and errors in 1.0+.

### Execution contract (v1.0)

The 1.0 execution contract locks how model-driven and code-driven decks behave,
so bot and simulator surfaces can rely on stable semantics.

**Execution modes**

- **Prompt-only deck**: `execute` is absent. Gambit executes by invoking the
  model using `PROMPT.md` as the canonical prompt body (after snippet
  interpolation), with `[modelParams]` applied when provided.
- **Execute deck**: `execute` is present. Gambit executes by running the module
  defined at `execute`; it does **not** invoke the model using `PROMPT.md`.

**Mutual exclusivity**

- `execute` and `[modelParams]` are mutually exclusive. If both are present,
  this is a warning pre-1.0 and an error in 1.0+.

**Schema consistency**

- If `execute` declares schemas and `PROMPT.md` declares schemas, they MUST
  match. “Match” is strict and **deep**:
  - If the schema is an object schema, it must have the exact same field set at
    every level, with the same required/optional status and types (no extra
    fields on either side).
  - If the schema is not an object schema, it must have the same top-level type
    (for example, both string schemas). Mismatches are warnings pre-1.0 and
    errors in 1.0+.
- For action/scenario/grader decks, `contextSchema` and `responseSchema` are
  required regardless of execution mode.

**What `PROMPT.md` does in execute mode**

- The body is **internal-only** and is not shown to the model.
- The body may include notes for humans or for Gambit Bot, but it does not alter
  runtime behavior directly.

**Tool exposure**

- For action decks, the resolved `contextSchema` + `responseSchema` define the
  tool signature exposed to parent decks, regardless of execution mode.

**Runtime return**

- Execute decks MUST return data that conforms to `responseSchema`.
- If the deck includes the respond snippet (for example,
  `gambit://snippets/respond.md`), callers SHOULD assume the deck returns a
  `gambit_respond`-compatible envelope.

**Action result envelope**

- When an action deck completes, the parent receives a tool result envelope:
  `{ payload, status?, message?, code?, meta? }`.
  - `status` is a number (HTTP-like).
  - `message` and `code` are strings.
  - `meta` is an object for extra structured metadata.
  - The runtime may include additional fields (for example `runId` or
    `actionCallId`), but those are implementation details and not guaranteed.
- `payload` is the deck output validated against the action deck’s
  `responseSchema`. If the action deck returns a bare value, it becomes
  `payload`.
- If the action deck returns an envelope (for example via `gambit_respond`), its
  `status`, `message`, `code`, and `meta` are preserved.

### Execute module interface

The `execute` path points to a TypeScript module that default-exports a Gambit
compute deck definition (same pattern as current TypeScript action decks).

Minimum expectations:

- The module MUST `export default` a Gambit deck definition (i.e., created via
  `defineDeck({ ... })`).
- The deck MUST provide a compute entrypoint function: `run(ctx)`.
- The compute entrypoint MAY be sync or async and receives `ctx.input` (the
  validated input) plus helpers like `ctx.log(...)` and `ctx.spawnAndWait(...)`.

Note: In v1.0 we standardize on `run(ctx)` (not `execute(ctx)`) to avoid
confusion with the `execute = "..."` frontmatter key.

### Canonical keys (v1.0)

Top-level keys:

- `label` (string, optional)
- `contextSchema` (string path, optional for root; required for
  action/scenario/grader decks)
- `responseSchema` (string path, optional for root; required for
  action/scenario/grader decks)
- `execute` (string path, optional)

Tables:

- `[modelParams]` (optional)
  - `model` (string or array of strings; if array, it is an ordered fallback
    list)
  - Supported keys in v1.0: `temperature`, `top_p`, `frequency_penalty`,
    `presence_penalty`, `max_tokens`.
  - `additionalParams` (object, optional) is reserved for provider-specific
    extensions. Keys outside the supported list MUST live under
    `additionalParams` to be passed through. Providers MAY ignore or warn on
    unknown extension keys.
    - Values in `additionalParams` MUST be JSON-serializable.
    - If a key is present both as a supported top-level field and inside
      `additionalParams`, the supported top-level field wins.

Arrays (canonical in v1.0):

- `[[actions]]` (optional)
  - `name` (string, required)
  - `path` (string, required; points directly to the referenced deck’s
    `PROMPT.md`)
  - `description` (string, required; tells the model when/why to call the
    action)
  - `label` (string, optional)
  - `id` (string, optional)

- `[[scenarios]]` (optional)
  - `path` (string, required; points directly to the referenced deck’s
    `PROMPT.md`)
  - `label` (string, optional)
  - `description` (string, optional)
  - `id` (string, optional)

- `[[graders]]` (optional)
  - `path` (string, required; points directly to the referenced deck’s
    `PROMPT.md`)
  - `label` (string, optional)
  - `description` (string, optional)
  - `id` (string, optional)

### Path resolution

- `path` MUST point directly to a `PROMPT.md` file.
- Deck folder paths are non-canonical in v1.0.
- Relative file paths are resolved relative to the referencing deck’s
  `PROMPT.md`.
- Stdlib deck paths use `gambit://decks/.../PROMPT.md`.

### Simulator surfaces (Build/Test/Grade)

- Build tab scaffolding and deck discovery treat `PROMPT.md` as the canonical
  entrypoint. `root.deck.md` is legacy-only during the pre-1.0 window.
- Test tab discovery uses `[[scenarios]]` (or legacy `[[testDecks]]`) on the
  root deck. Grade tab discovery uses `[[graders]]` (or legacy
  `[[graderDecks]]`).
- Scenario and grader references SHOULD point to `.../PROMPT.md` to keep the 1.0
  contract intact, even if those decks are executed directly.

## Compatibility

### Deprecation enforcement

Versioning note: the `< 1.0.0` vs `>= 1.0.0` behavior refers to Gambit’s semver
version (CLI and `@bolt-foundry/gambit-core`). They are expected to stay in
sync, so in practice the enforcement boundary is the same.

- In versions `< 1.0.0`, deprecated keys/URIs MUST continue to work but MUST
  emit warnings.
- In versions `>= 1.0.0`, deprecated keys/URIs MUST be treated as errors.

- Legacy keys (`actionDecks`, `testDecks`, `graderDecks`) are deprecated.
- In v1.0, the canonical arrays are `[[actions]]`, `[[scenarios]]`, and
  `[[graders]]`.
- Legacy built-in card/snippet URIs (`gambit://cards/*.card.md`) and legacy
  markers (`gambit://init`, `gambit://respond`, `gambit://end`) are deprecated;
  use `gambit://snippets/*.md`.
- Legacy schema URIs ending in `.ts` (for example
  `gambit://schemas/graders/respond.ts`) are deprecated; use `.zod.ts` (for
  example `gambit://schemas/graders/respond.zod.ts`).
- Stdlib deck URIs that omit the `PROMPT.md` suffix are non-canonical; use the
  `.../PROMPT.md` form.
