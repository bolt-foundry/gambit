import { assertEquals } from "@std/assert";
import {
  buildDemoQuery,
  shouldShowDemoChrome,
  shouldShowDemoSubtitles,
  shouldUseSmoothMouse,
  shouldUseSmoothType,
} from "./config.ts";

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}

Deno.test("buildDemoQuery includes runtime shell toggles by default", () => {
  const query = withEnv({
    GAMBIT_DEMO_CHROME: "false",
    GAMBIT_DEMO_SUBTITLES: "false",
    GAMBIT_DEMO_SMOOTH_MOUSE: "false",
    GAMBIT_DEMO_SMOOTH_TYPE: "false",
  }, () =>
    buildDemoQuery("http://127.0.0.1:8000", {
      width: 1280,
      height: 720,
    }, null));

  assertEquals(
    query,
    "shell=1280x720&chrome=false&subtitles=false&smoothMouse=false&smoothType=false",
  );
});

Deno.test("runtime shell toggles default on when env is unset", () => {
  withEnv({
    GAMBIT_DEMO_CHROME: undefined,
    GAMBIT_DEMO_SUBTITLES: undefined,
    GAMBIT_DEMO_SMOOTH_MOUSE: undefined,
    GAMBIT_DEMO_SMOOTH_TYPE: undefined,
  }, () => {
    assertEquals(shouldShowDemoChrome(), true);
    assertEquals(shouldShowDemoSubtitles(), true);
    assertEquals(shouldUseSmoothMouse(), true);
    assertEquals(shouldUseSmoothType(), true);
  });
});
