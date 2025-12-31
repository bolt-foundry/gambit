# Gambit Simulator UI E2E Tests

These tests exercise the Gambit simulator UI in a full browser environment. They
use a local context wrapper around Puppeteer, record artifacts, and
automatically start a Gambit server pointing at:
`examples/voice_front_desk/decks/root.deck.md`.

## Quick Start

From `packages/gambit`:

```bash
deno task e2e
```

## Demo Video Runner (Playwright)

The demo runner records a full Gambit UI walkthrough (Test Bot → Calibrate →
Debug) as a video artifact. It uses Playwright Core with a nix-managed browser.

From `packages/gambit`:

```bash
GAMBIT_PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chromium \
  deno task demo:ui-video
```

Artifacts are written under `../shared/bft-e2e/gambit-ui-demo/__latest__/`
(including `video.mp4`).

Optional env vars:

- `GAMBIT_E2E_SHOW_BROWSER=true` to run headed.
- `GAMBIT_E2E_RECORD_VIDEO=false` to skip video output.
- `GAMBIT_DEMO_INTERACT_DEBUG=true` to send a debug message (can be flaky).
- `GAMBIT_DEMO_WAIT=true` to keep the browser open and keep recording until you
  press Enter.
- `GAMBIT_USE_HOST_BRIDGE=true` to run Chrome on the host via codebot
  host-bridge.
- `GAMBIT_HOST_BRIDGE_URL=https://host.boltfoundry.bflocal:8017` to override the
  host-bridge URL.
- `GAMBIT_HOST_BRIDGE_PORT=9222` to request a specific remote-debugging port on
  the host.
- `GAMBIT_DEMO_BASE_URL=https://<workspace-id>.boltfoundry.bflocal` to override
  the base URL for host-driven runs (defaults to
  `https://$WORKSPACE_ID.boltfoundry.bflocal`).
- `GAMBIT_DEMO_PORT=8000` to override the simulator port (defaults to 8000 when
  using host bridge).

## Logs + Artifacts

Artifacts are written under `../shared/bft-e2e/<test-slug>/__latest__/`:

- `logs/`: `client.log`, `client.errors.log`, `dev-server.log`
- `screenshots/`: PNG screenshots
- `frames/`: PNG frames used to build `video.mp4`
- `video.mp4`: ffmpeg output (when available)

Tail logs live:

```bash
deno task e2e-logs
deno task e2e-logs gambit-simulator-smoke
deno task e2e-logs gambit-simulator-smoke --errors-only
```

## Notes

- Video recording is on by default. Disable with
  `GAMBIT_E2E_RECORD_VIDEO=false`.
- To show the browser, set `GAMBIT_E2E_SHOW_BROWSER=true`.

## Environment Variables

- `GAMBIT_E2E_URL`: Override base URL (defaults to auto-started server).
- `GAMBIT_E2E_RECORD_VIDEO`: `false` to disable recording.
- `GAMBIT_E2E_SHOW_BROWSER`: `true` to run headed.
- `PUPPETEER_EXECUTABLE_PATH`: Use a specific Chrome/Chromium binary.

## Adding a Test

- Place new tests in `simulator-ui/__tests__/e2e/` with a `.e2e.ts` suffix.
- Always initialize the context with:
  ```ts
  await using ctx = await createE2eTestContext(t.name);
  ```
- Prefer `ctx.navigate`, `ctx.click`, `ctx.type`, `ctx.exists`, `ctx.text`, and
  `ctx.screenshot` instead of raw Puppeteer APIs.

## Updating the Deck Path

The default deck is configured in: `simulator-ui/__tests__/e2e/utils/context.ts`
(`DEFAULT_SERVER_COMMAND`).

Update the path in that command to point at a different deck, then rerun:

```bash
deno task e2e
```

## Troubleshooting

- Server not starting: check `logs/dev-server.log` under `__latest__/logs`.
- Browser not found: install Chrome/Chromium or set `PUPPETEER_EXECUTABLE_PATH`.
- No video output: install `ffmpeg` or re-run with
  `GAMBIT_E2E_RECORD_VIDEO=false`.
