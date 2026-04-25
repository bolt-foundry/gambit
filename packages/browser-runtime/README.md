# Browser Runtime

Reusable Playwright/MediaRecorder browser automation runtime for demos, tests,
and live sessions.

It now also exposes the first shared browser-runtime facade used by:

- `bft browser demo ...`
- `bft browser test ...`
- `bft browser live ...`
- `bft-browser demo ...`
- `bft-browser test ...`
- `bft-browser live ...`

## Features

- Artifact scaffolding (`__latest__`, frames, screenshots, logs)
- MediaRecorder + CDP capture with optional tab/mic audio
- Host-bridge aware Chrome launch helpers
- Script-driven automation (wait/click/type/voiceover)
- iframe-shell utilities for zoom, subtitles, and viewport control
- Shared mode profiles for `demo`, `test`, and `live`
- A thin contract that supports ordered steps and direct page control
- GraphQL mock registry primitives for downstream runtime adoption

## Usage

```ts
import {
  createBrowserTestContext,
  getDemoPaths,
  prepareDemoPaths,
  runDemo,
} from "@bolt-foundry/browser-runtime";

const paths = getDemoPaths();
await prepareDemoPaths(paths);
await runDemo(runScenario, { baseUrl: "http://127.0.0.1:8000", paths });
```

Provide your own server lifecycle (start/stop) and scenario script; the runner
handles the rest.

## Installable CLI

You can now install the browser command as a standalone executable and use it
outside bfmono:

```bash
deno install -g -A --name bft-browser /path/to/bfmono/packages/gambit/packages/browser-runtime/bin/bft-browser.ts
```

Once installed, use it from any project:

```bash
bft-browser test ./tests/homepage.e2e.ts
bft-browser demo ./scripts/run-demo.ts
bft-browser live start https://example.com --no-host-bridge
```

The standalone CLI is generic by default:

- pass explicit test paths for `test`
- pass explicit scripts for `demo`
- use `live` against any URL

Inside bfmono, `bft browser ...` remains the repo-aware wrapper that adds named
flow aliases and managed `--app` targets.

## Browser runtime facade

Use the shared facade when you want one runtime contract across `demo`, `test`,
and `live`:

```ts
import {
  createBrowserTestContext,
  runBrowserScenario,
  runBrowserTimeline,
  withBrowserRuntimeProfile,
} from "@bolt-foundry/browser-runtime";
```

The facade provides:

- mode defaults for `demo`, `test`, and `live`
- shared artifact path handling
- ordered-step authoring via `runBrowserTimeline(...)`
- direct-control authoring via `runBrowserScenario(...)`
- shared test contexts via `createBrowserTestContext(...)`
- a consistent env/profile wrapper via `withBrowserRuntimeProfile(...)`

Mode defaults:

- `demo`: host bridge + MediaRecorder + artifact-heavy capture on
- `test`: host bridge on, recording off by default, lean correctness profile
- `live`: host bridge on, recording off by default, browser stays open

### Live control

The live surface now supports persistent background sessions with follow-up CLI
control:

```bash
bft browser live start https://example.com
bft browser live status
bft browser live mouse move --selector "#submit"
bft browser live click --x 120 --y 48
bft browser live type --selector "#search" "hello"
bft browser live screenshot after-click
bft browser live record start
bft browser live record stop
bft browser live stop
```

Use `--name <session>` to manage multiple live sessions, and `--no-host-bridge`
when you want local Chromium instead of the host bridge.

### Canonical migration stance

Active browser/demo surfaces should route through `bft browser ...` aliases.
Legacy repo-local browser/demo wrappers have been removed so the canonical
command family is the only supported entrypoint for active usage.

### Canonical demo

1. From repo root, run `deno task demo:canonical` inside
   `packages/gambit/packages/browser-runtime` (or `bft demo:canonical`).
2. The script boots the Gambit simulator demo and runs the canonical Build ->
   Test -> Grade walkthrough.
3. Artifacts land in `../shared/bft-e2e/gambit-canonical-demo/__latest__/`.

### Verify tab demo

Run:

```bash
cd packages/gambit/packages/browser-runtime
deno task demo:verify
```

This script enables the Verify tab flag, seeds deterministic verify fixtures,
then runs a live consistency batch (real `/api/calibrate/run` calls) before
recording a Verify -> Grade evidence drilldown with workbench access.

### GraphiQL setup demo

Run:

```bash
cd packages/gambit/packages/browser-runtime
deno task demo:graphiql
```

This script opens Gambit `/graphql` (Yoga GraphiQL), captures the GraphiQL
surface, then performs typed GraphQL checks against the same endpoint:

- typed workspace query succeeds (`gambitWorkspaces`)
- durable replay query succeeds (`gambitDurableStreamReplay`)
- removed proxy field check fails as expected (`apiGet`)

The check summary is rendered on-screen and captured as a second screenshot.

### Project Home (multiplayer UI) demo

This demo has been removed while we revisit product intent. If you still need
the script, check history for `run-project-home-demo.ts`.

### Gambit FAQ chat streaming demo

Use this to inspect real-world FAQ chat behavior, including:

- first assistant text render timing
- citation node visibility timing
- follow-up node visibility timing

Run:

```bash
cd packages/gambit/packages/browser-runtime
deno task demo:faq-chat
```

Optional env:

- `GAMBIT_FAQ_CHAT_DEMO_BASE_URL` (default:
  `https://buildless.boltfoundry.bflocal`)
- `GAMBIT_FAQ_CHAT_DEMO_PROMPT`
- `GAMBIT_FAQ_CHAT_DEMO_TIMEOUT_MS`
- `GAMBIT_DEMO_WAIT=true` to keep browser open for live collaboration
