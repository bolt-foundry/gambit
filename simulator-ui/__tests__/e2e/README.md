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
- `GAMBIT_DEMO_DURATION_SECONDS=300` to keep recording for a fixed duration.
- Default demo viewport follows the browser window size unless overridden.
- `GAMBIT_DEMO_VIEWPORT=1920x1080` to override the browser viewport (also sets
  the demo shell size unless `shell=` or `content=` is provided).
- `GAMBIT_DEMO_CONTENT=1280x720` to override the iframe content size (the shell
  adds chrome height unless `content=` is provided).
- `GAMBIT_DEMO_FPS=60` to request the CDP capture frame rate (default: 60).
- `GAMBIT_DEMO_OUTPUT_FPS=60` to override the muxed output FPS (defaults to the
  input FPS).
- `GAMBIT_DEMO_OUTPUT_FPS=30` to set the muxed MP4 frame rate (default: 30).
- `GAMBIT_DEMO_INTERPOLATE=mc` to enable motion-compensated frame interpolation
  during muxing. Leave unset for default (no interpolation).
- `GAMBIT_DEMO_RECORD_AUDIO=0` to disable tab audio (enabled by default, iframe
  shell only).
- `GAMBIT_DEMO_RECORD_MIC=1` to record mic audio (off by default, iframe shell
  only).
- `GAMBIT_DEMO_TRIM_AUDIO_DELAY=1` to trim the leading delay before audio starts
  (writes `video-trimmed.mp4`, `audio-trimmed.webm`, and
  `video-with-audio-trimmed.mp4` when possible).
- `GAMBIT_DEMO_MEDIARECORDER=1` to capture video via MediaRecorder instead of
  CDP screencast (iframe shell only, writes `mediarecorder.webm`).
- `GAMBIT_DEMO_MEDIARECORDER_CHUNK_MS=1000` to control MediaRecorder chunking.
- `GAMBIT_DEMO_MEDIARECORDER_TITLE="Gambit Demo Harness"` to set the tab title
  used by auto tab capture.
- When using `/demo/iframe-shell`, the demo runner now drives selectors inside
  the iframe automatically (leave `GAMBIT_DEMO_SKIP_AUTOMATION` unset to run).
- `GAMBIT_DEMO_WAIT=true` to keep the browser open and keep recording until you
  press Enter.
- When using host bridge + `GAMBIT_DEMO_VIEWPORT`, the runner restarts the host
  Chrome instance to apply the window size.
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
- `mediarecorder.webm`: MediaRecorder capture output (when enabled)

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
- For iframe-shell demos, use `ctx.viewportControl.zoomTo()` or
  `ctx.viewportControl.resetZoom()` to drive smooth zooming via the shell API.

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
