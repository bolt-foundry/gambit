# Spec: Gambit Product Command Deck Format (v1.0)

Status: RFC (pre-1.0) Owner: Engineering (incl. Gambit-core engineering)

## Goals

- Define the 1.0 deck folder contract (required files, meanings, and
  boundaries).
- Define the canonical `PROMPT.md` TOML frontmatter keys.
- Make decks composable and fractal: scenarios/graders are decks, and actions
  are deck-first with optional direct compute targets.
- Define a first-class external tool surface (`[[tools]]`) and a reserved future
  deck MCP declaration surface (`[[mcpServers]]`) that is unsupported in the
  current runtime phase.

## Non-goals

- Fully define snippet/embed mechanics (beyond the built-in Gambit snippet
  namespace and its usage).
- Define migration UX, warning text, or exact deprecation timelines.

## Terms

- Deck: A runnable unit represented as a folder (identified by its `PROMPT.md`).
- Entrypoint: `PROMPT.md` inside a deck folder.
- Intent/Policy: Non-programmatic guidance used by humans and Gambit Build
  Assistant to build, grade, calibrate, and update decks.
- Root deck: The deck invoked directly to start a run (top of the deck tree).
- Action deck: A deck-based action target invoked as a tool/action by another
  deck.
- Action target: The executable target of an action. In v1.0 this is either a
  referenced deck via `[[actions]].path` or a direct compute module via
  `[[actions]].execute`.
- Scenario deck: A deck used for synthetic/scripted runs (replaces “test”).
- Grader deck: A deck used to evaluate runs.
- MCP server declaration: A named connection declaration under `[[mcpServers]]`
  reserved for future deck-managed MCP tool wiring.
- Tool declaration: A model-callable external tool declaration under `[[tools]]`
  that Gambit routes through runtime hook handling.
- Snippet: A reusable embed unit (what we previously called card embeds).
- Stdlib deck: A built-in deck resolved by Gambit from its stdlib deck bundle.

## Deck roles

Deck roles are determined by invocation:

- **Root deck**: started directly by the user/runner.
- **Action targets**: declared via `[[actions]]`.
- **Scenario decks**: referenced via `[[scenarios]]`.
- **Grader decks**: referenced via `[[graders]]`.

Schema requirements:

- Root decks MAY omit `contextSchema` and `responseSchema`.
- Action targets and scenario/grader decks MUST declare `contextSchema` and
  `responseSchema` (these schemas define the IO contract visible to the parent
  deck).
  - For action targets that resolve to decks, and for grader decks, include
    `gambit://snippets/respond.md` so the deck returns structured output via
    `gambit_respond`.
  - For scenario decks that need model-filled init inputs, include
    `gambit://snippets/init.md` so the model populates any missing required
    context fields before the run.
  - For scenario/persona decks that should stay in the synthetic participant
    role and terminate consistently, include
    `gambit://snippets/scenario-participant.md`.
  - Scenario decks MAY omit the respond snippet if they are intended to produce
    plain chat output, but they MUST still declare schemas.
    - For plain chat output, `responseSchema` SHOULD be a string schema (for
      example, `gambit://schemas/scenarios/plain_chat_output.zod.ts`).
  - Grader decks MUST be compatible with the built-in grader schemas:
    `gambit://schemas/graders/contexts/turn.zod.ts`,
    `gambit://schemas/graders/contexts/turn_tools.zod.ts`,
    `gambit://schemas/graders/contexts/conversation_tools.zod.ts`, or
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

Tool surface requirements:

- `[[actions]]` declares executable action targets.
- `[[tools]]` declares model-callable external tool contracts Gambit does not
  execute directly.
- External tool calls MUST dispatch through a runtime tool hook (`onTool`);
  `onTool` is a runtime API contract, not a `PROMPT.md` frontmatter key.
- The model-facing tool namespace is shared across `[[actions]]` and
  `[[tools]]`.
  - Collision rule: action names shadow tool names.
  - Shadowed tools MUST emit a load-time warning.
- `[[tools]].inputSchema` is optional but recommended. When present, it defines
  the local input validation contract before dispatching to `onTool`.
- If `[[tools]]` is omitted, only `[[actions]]` are exposed as model-callable
  tools.
- Deck-level `[[mcpServers]]` declarations are currently unsupported and MUST
  fail fast at parse/load time.

## Snippets (built-in Gambit namespace)

Snippets are embedded using Markdown image syntax. Built-in Gambit snippets use
the `gambit://snippets/*` namespace, for example:

```markdown
![respond](gambit://snippets/respond.md)
```

Built-in snippets (v1.0):

| URI                                         | Purpose                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `gambit://snippets/context.md`              | Context primer; explains the `gambit_context` tool result and how to treat seeded data.    |
| `gambit://snippets/init.md`                 | Init-fill helper; instructs the model to populate missing required init/context fields.    |
| `gambit://snippets/scenario-participant.md` | Scenario participant contract; keeps the deck in user role and ends via one empty message. |
| `gambit://snippets/respond.md`              | Respond instruction; tells the model to call `gambit_respond` with a structured payload.   |
| `gambit://snippets/end.md`                  | Explicit end instruction; documents how/when to call `gambit_end`.                         |
| `gambit://snippets/generate-test-input.md`  | Deprecated alias for `gambit://snippets/init.md` (legacy name).                            |

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

| URI                                                           | Purpose                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `gambit://schemas/graders/respond.zod.ts`                     | Shared respond-envelope schema used by decks and graders.           |
| `gambit://schemas/graders/grader_output.zod.ts`               | Canonical grader output schema (`score`, `reason`, `evidence`).     |
| `gambit://schemas/graders/contexts/turn.zod.ts`               | Schema for per-turn grader context (single exchange).               |
| `gambit://schemas/graders/contexts/turn_tools.zod.ts`         | Per-turn grader context including assistant `tool_calls`.           |
| `gambit://schemas/graders/contexts/conversation_tools.zod.ts` | Conversation-level grader context including assistant `tool_calls`. |
| `gambit://schemas/graders/contexts/conversation.zod.ts`       | Schema for full-conversation grader context.                        |
| `gambit://schemas/scenarios/plain_chat_output.zod.ts`         | Canonical string output for plain-chat scenario/scenario decks.     |

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
  of truth for human alignment and for Gambit Build Assistant decisions about
  what to build.
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

- Action decks referenced via `[[actions]].path`, plus all scenario/grader
  decks, follow the same folder contract.
- Any deck MAY contain its own actions/scenarios/graders.

## Entrypoint contract (`PROMPT.md`)

### Frontmatter format

- `PROMPT.md` frontmatter MUST be TOML using `+++` delimiters.
- All deck metadata lives in `PROMPT.md` frontmatter.

### Execution semantics

- In v1.0, top-level `execute` on `PROMPT.md` is removed from the user-authored
  deck contract and MUST be rejected.
- `PROMPT.md` entrypoints are prompt-driven: the deck body is model-visible and
  `[modelParams]` applies when present.
- Compute-oriented behavior for tool-like steps is modeled through
  `[[actions]].execute` (see action execution contract below), not a root-level
  `execute` key.

### Execution contract (v1.0)

The 1.0 execution contract locks how prompt-driven decks and action targets
behave, so bot and simulator surfaces can rely on stable semantics.

**Execution modes**

- **Prompt deck**: Gambit invokes the model using `PROMPT.md` as the canonical
  prompt body (after snippet interpolation), with `[modelParams]` applied when
  provided.
- **Action target via path**: `[[actions]].path` references a deck
  `.../PROMPT.md`; runtime behavior is delegated to that action deck.
- **Action target via execute**: `[[actions]].execute` references a compute
  module; runtime executes code directly for that action invocation.

**Action target consistency**

- Every action declaration MUST provide exactly one executable target:
  - `path` **or** `execute` (mutually exclusive).
- `name` and `description` remain required for all actions.
- Action IO contract (`contextSchema` and `responseSchema`) is always required
  at runtime:
  - `path` actions obtain schemas from the referenced action deck.
  - `execute` actions may declare schemas inline on `[[actions]]`, in the
    execute module, or both.
  - If schemas are declared in both places, they MUST match deeply:
    - object schemas must have the same recursive fields/types/requiredness.
    - non-object schemas must have the same top-level type.
- For scenario/grader decks, `contextSchema` and `responseSchema` remain
  required regardless of execution style.

**Tool exposure**

- For deck-backed actions and execute-backed actions, the resolved
  `contextSchema` + `responseSchema` define the tool signature exposed to parent
  decks.
- `[[actions]]` are always model-callable.
- `[[tools]]` add external model-callable tool declarations.
- Effective model-facing tools are `[[actions]]` plus non-shadowed `[[tools]]`.
  - On name collision, `[[actions]]` shadow `[[tools]]`.
  - Shadowed `[[tools]]` remain invalid for model dispatch and MUST emit a
    load-time warning.

**Runtime return**

- Action targets MUST return data that conforms to the resolved
  `responseSchema`.
- If the underlying action path includes the respond snippet (for example,
  `gambit://snippets/respond.md`) or returns an explicit envelope, callers
  SHOULD assume `gambit_respond`-compatible envelope semantics.

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
- If the action target returns an envelope (for example via `gambit_respond`),
  its `status`, `message`, `code`, and `meta` are preserved.

**External tool result envelope (`onTool`)**

- `onTool` receives external tool calls and returns either:
  - call input includes `name`, `args`, and stable run/action metadata (`runId`,
    `actionCallId`, optional `parentActionCallId`, `deckPath`),
  - envelope form: `{ payload, status?, message?, code?, meta? }`, or
  - bare payload (runtime wraps it as `payload`).
- If `onTool` is missing for an invoked external tool, runtime MUST fail the
  tool call with an explicit unsupported external-tool error.
- If `onTool` throws, runtime MUST return an error envelope for that tool call
  (status >= 400) and continue trace emission.

### Action Execute Module Interface

`[[actions]].execute` points to a TypeScript module that default-exports a
Gambit compute deck definition.

Minimum expectations:

- The module MUST `export default` a Gambit deck definition (i.e., created via
  `defineDeck({ ... })`).
- The deck MUST provide a compute entrypoint function: `run(ctx)` (canonical).
- The compute entrypoint MAY be sync or async and receives `ctx.input` (the
  validated input) plus helpers like `ctx.log(...)` and `ctx.spawnAndWait(...)`.

### Canonical keys (v1.0)

Top-level keys:

- `label` (string, optional)
- `startMode` (`"assistant" | "user"`, optional)
- `contextSchema` (string path, optional for root; required for
  action/scenario/grader decks)
- `responseSchema` (string path, optional for root; required for
  action/scenario/grader decks)
- `respond` (boolean, optional)
- `allowEnd` (boolean, optional)

Tables:

- `[modelParams]` (optional)
  - `model` (string or array of strings; if array, it is an ordered fallback
    list)
  - Supported keys in v1.0: `temperature`, `top_p`, `frequency_penalty`,
    `presence_penalty`, `max_tokens`, `reasoning`.
  - `reasoning` (object, optional)
    - `effort`: `none | low | medium | high | xhigh`
    - `summary`: `concise | detailed | auto`
  - `additionalParams` (object, optional) is reserved for provider-specific
    extensions. Keys outside the supported list MUST live under
    `additionalParams` to be passed through. Providers MAY ignore or warn on
    unknown extension keys.
    - Values in `additionalParams` MUST be JSON-serializable.
    - If a key is present both as a supported top-level field and inside
      `additionalParams`, the supported top-level field wins.
- `[guardrails]` (optional)
  - `maxDepth` (number)
  - `maxPasses` (number)
  - `timeoutMs` (number)
- `[permissions]` (optional)
  - `read`, `write`, `net`, `env` support boolean or string arrays.
  - `[permissions.run]` supports `commands` and `paths`.
- `[handlers.onBusy]`, `[handlers.onIdle]`, `[handlers.onError]` (optional)
  - `onBusy`/`onIdle` support `delayMs`, `repeatMs`, `label`, `path`.
  - `onError` supports `label`, `path`.

Arrays (canonical in v1.0):

- `[[actions]]` (optional)
  - `name` (string, required)
  - `description` (string, required; tells the model when/why to call the
    action)
  - exactly one of:
    - `path` (string; points directly to the referenced deck’s `PROMPT.md`)
    - `execute` (string; points to a compute module)
  - `contextSchema` (string, optional; primarily for `execute` actions)
  - `responseSchema` (string, optional; primarily for `execute` actions)
  - `permissions` (optional)
  - `label` (string, optional)
  - `id` (string, optional)

- `[[scenarios]]` (optional)
  - `path` (string, required; points directly to the referenced deck’s
    `PROMPT.md`)
  - `permissions` (optional)
  - `label` (string, optional)
  - `description` (string, optional)
  - `id` (string, optional)

- `[[graders]]` (optional)
  - `path` (string, required; points directly to the referenced deck’s
    `PROMPT.md`)
  - `permissions` (optional)
  - `label` (string, optional)
  - `description` (string, optional)
  - `id` (string, optional)

- `[[tools]]` (optional)
  - `name` (string, required; unique across effective model-facing tool names
    after action-shadowing)
  - `inputSchema` (string, optional; local pre-dispatch validation schema)
  - `description` (string, optional; model-facing description)
  - `label` (string, optional)
  - `id` (string, optional)

Reserved (future, not currently executable):

- `[[mcpServers]]` (reserved)
  - Declarations are parsed as reserved syntax only.
  - Any deck containing `[[mcpServers]]` MUST fail fast as unsupported in the
    current runtime phase.

### Path resolution

- `[[actions]].path`, `[[scenarios]].path`, and `[[graders]].path` MUST point
  directly to a `PROMPT.md` file.
- Deck folder paths are non-canonical in v1.0 for `path` fields.
- `[[actions]].execute` is resolved relative to the referencing `PROMPT.md`.
- `[[tools]].inputSchema` is resolved relative to the referencing `PROMPT.md`.
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
- Top-level `execute` in `PROMPT.md` is removed in v1.0 for user-authored decks.
- In v1.0, the canonical arrays are `[[actions]]`, `[[scenarios]]`,
  `[[graders]]`, and `[[tools]]`.
- `[[mcpServers]]` is reserved in v1.0 and MUST error as unsupported in the
  current runtime phase.
- Legacy built-in card/snippet URIs (`gambit://cards/*.card.md`) and legacy
  markers (`gambit://init`, `gambit://respond`, `gambit://end`) are deprecated;
  use `gambit://snippets/*.md`.
- Legacy schema URIs ending in `.ts` (for example
  `gambit://schemas/graders/respond.ts`) are deprecated; use `.zod.ts` (for
  example `gambit://schemas/graders/respond.zod.ts`).
- Stdlib deck URIs that omit the `PROMPT.md` suffix are non-canonical; use the
  `.../PROMPT.md` form.
