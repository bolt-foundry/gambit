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
