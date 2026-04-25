import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  getBrowserLiveSessionApiStatus,
  getBrowserLiveSessionMetadataPath,
  getBrowserLiveSessionStatus,
  normalizeBrowserLiveSessionName,
  readBrowserLiveSessionMetadata,
  sendBrowserLiveSessionCommandWithResult,
  writeBrowserLiveSessionMetadata,
} from "./liveControl.ts";

Deno.test("normalizeBrowserLiveSessionName defaults and slugifies", () => {
  assertEquals(normalizeBrowserLiveSessionName(), "default");
  assertEquals(normalizeBrowserLiveSessionName("QA Browser"), "qa-browser");
});

Deno.test("browser live session metadata round-trips", async () => {
  const sessionName = `test-${Date.now()}`;
  const metadataPath = getBrowserLiveSessionMetadataPath(sessionName);
  await Deno.remove(metadataPath).catch(() => {});

  await writeBrowserLiveSessionMetadata({
    sessionName,
    sessionSlug: sessionName,
    pid: 1234,
    port: 4567,
    apiBaseUrl: "http://127.0.0.1:4567",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "running",
    mode: "live",
    useHostBridge: false,
    headless: true,
    smoothMouse: true,
    smoothType: true,
    keepBrowserOpen: true,
    artifactRoot: "/tmp/artifacts",
    latestDir: "/tmp/artifacts/latest",
    logsDir: "/tmp/artifacts/logs",
    screenshotsDir: "/tmp/artifacts/screenshots",
    recordingActive: false,
    currentUrl: "about:blank",
  });

  const loaded = await readBrowserLiveSessionMetadata(sessionName);
  assertExists(loaded);
  assertEquals(loaded.sessionName, sessionName);
  assertEquals(loaded.port, 4567);
  assertEquals(loaded.status, "running");

  await Deno.remove(metadataPath).catch(() => {});
});

Deno.test("browser live api status requires a reachable control API", async () => {
  const sessionName = `test-api-${Date.now()}`;
  const metadataPath = getBrowserLiveSessionMetadataPath(sessionName);
  await Deno.remove(metadataPath).catch(() => {});

  await writeBrowserLiveSessionMetadata({
    sessionName,
    sessionSlug: sessionName,
    pid: 1234,
    port: 4567,
    apiBaseUrl: "http://127.0.0.1:4567",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "starting",
    mode: "live",
    useHostBridge: false,
    headless: true,
    smoothMouse: true,
    smoothType: true,
    keepBrowserOpen: true,
    artifactRoot: "/tmp/artifacts",
    latestDir: "/tmp/artifacts/latest",
    logsDir: "/tmp/artifacts/logs",
    screenshotsDir: "/tmp/artifacts/screenshots",
    recordingActive: false,
    currentUrl: "about:blank",
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    ((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            sessionName,
            sessionSlug: sessionName,
            pid: 1234,
            port: 4567,
            apiBaseUrl: "http://127.0.0.1:4567",
            startedAt: "2026-03-12T00:00:00.000Z",
            updatedAt: "2026-03-12T00:00:01.000Z",
            status: "running",
            mode: "live",
            useHostBridge: false,
            headless: true,
            smoothMouse: true,
            smoothType: true,
            keepBrowserOpen: true,
            artifactRoot: "/tmp/artifacts",
            latestDir: "/tmp/artifacts/latest",
            logsDir: "/tmp/artifacts/logs",
            screenshotsDir: "/tmp/artifacts/screenshots",
            recordingActive: false,
            currentUrl: "about:blank",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )) as typeof fetch;

  try {
    const status = await getBrowserLiveSessionApiStatus(sessionName);
    assertExists(status);
    assertEquals(status.status, "running");
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(metadataPath).catch(() => {});
  }
});

Deno.test("browser live status marks running metadata as error when control API is not reachable", async () => {
  const sessionName = `test-fallback-${Date.now()}`;
  const metadataPath = getBrowserLiveSessionMetadataPath(sessionName);
  await Deno.remove(metadataPath).catch(() => {});

  await writeBrowserLiveSessionMetadata({
    sessionName,
    sessionSlug: sessionName,
    pid: 1234,
    port: 4567,
    apiBaseUrl: "http://127.0.0.1:4567",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "running",
    mode: "live",
    useHostBridge: false,
    headless: true,
    smoothMouse: true,
    smoothType: true,
    keepBrowserOpen: true,
    artifactRoot: "/tmp/artifacts",
    latestDir: "/tmp/artifacts/latest",
    logsDir: "/tmp/artifacts/logs",
    screenshotsDir: "/tmp/artifacts/screenshots",
    recordingActive: false,
    currentUrl: "about:blank",
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    ((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.reject(new Error("connect failed"))) as typeof fetch;

  try {
    const status = await getBrowserLiveSessionStatus(sessionName);
    assertExists(status);
    assertEquals(status.status, "error");
    assertEquals(
      status.error?.startsWith(
        "Live browser session control API is unreachable: connect failed",
      ),
      true,
    );

    const persisted = await readBrowserLiveSessionMetadata(sessionName);
    assertExists(persisted);
    assertEquals(persisted.status, "error");
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(metadataPath).catch(() => {});
  }
});

Deno.test("browser live commands mark running metadata as error when control API is not reachable", async () => {
  const sessionName = `test-command-stale-${Date.now()}`;
  const metadataPath = getBrowserLiveSessionMetadataPath(sessionName);
  await Deno.remove(metadataPath).catch(() => {});

  await writeBrowserLiveSessionMetadata({
    sessionName,
    sessionSlug: sessionName,
    pid: 1234,
    port: 4567,
    apiBaseUrl: "http://127.0.0.1:4567",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "running",
    mode: "live",
    useHostBridge: false,
    headless: true,
    smoothMouse: true,
    smoothType: true,
    keepBrowserOpen: true,
    artifactRoot: "/tmp/artifacts",
    latestDir: "/tmp/artifacts/latest",
    logsDir: "/tmp/artifacts/logs",
    screenshotsDir: "/tmp/artifacts/screenshots",
    recordingActive: false,
    currentUrl: "https://example.com/",
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch =
    ((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.reject(new Error("connect failed"))) as typeof fetch;

  try {
    await assertRejects(
      () =>
        sendBrowserLiveSessionCommandWithResult(sessionName, {
          type: "screenshot",
        }),
      Error,
      "Live browser session control API is unreachable: connect failed",
    );

    const persisted = await readBrowserLiveSessionMetadata(sessionName);
    assertExists(persisted);
    assertEquals(persisted.status, "error");
    assertEquals(
      persisted.error?.startsWith(
        "Live browser session control API is unreachable: connect failed",
      ),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(metadataPath).catch(() => {});
  }
});

Deno.test("browser live metadata read retries after transient malformed JSON", async () => {
  const sessionName = `test-retry-${Date.now()}`;
  const metadataPath = getBrowserLiveSessionMetadataPath(sessionName);
  await Deno.remove(metadataPath).catch(() => {});

  await Deno.writeTextFile(metadataPath, "{");
  setTimeout(() => {
    void writeBrowserLiveSessionMetadata({
      sessionName,
      sessionSlug: sessionName,
      pid: 1234,
      port: 4567,
      apiBaseUrl: "http://127.0.0.1:4567",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "running",
      mode: "live",
      useHostBridge: false,
      headless: true,
      smoothMouse: true,
      smoothType: true,
      keepBrowserOpen: true,
      artifactRoot: "/tmp/artifacts",
      latestDir: "/tmp/artifacts/latest",
      logsDir: "/tmp/artifacts/logs",
      screenshotsDir: "/tmp/artifacts/screenshots",
      recordingActive: false,
      currentUrl: "about:blank",
    });
  }, 0);

  const loaded = await readBrowserLiveSessionMetadata(sessionName);
  assertExists(loaded);
  assertEquals(loaded.status, "running");

  await Deno.remove(metadataPath).catch(() => {});
});
