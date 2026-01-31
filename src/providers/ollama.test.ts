import { assertEquals } from "@std/assert";
import { fetchOllamaTags } from "./ollama.ts";

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL) => {
    const url = input instanceof URL
      ? input.toString()
      : typeof input === "string"
      ? input
      : input.url;
    return Promise.resolve(handler(url));
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

Deno.test("fetchOllamaTags uses baseURL origin when no path prefix", async () => {
  let seen: string | null = null;
  const restore = mockFetch((url) => {
    seen = url;
    return new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  try {
    await fetchOllamaTags("http://localhost:11434/v1");
  } finally {
    restore();
  }
  assertEquals(seen, "http://localhost:11434/api/tags");
});

Deno.test("fetchOllamaTags preserves baseURL path prefix", async () => {
  let seen: string | null = null;
  const restore = mockFetch((url) => {
    seen = url;
    return new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  try {
    await fetchOllamaTags("https://host.moltfoundry.bflocal:8017/ollama/v1");
  } finally {
    restore();
  }
  assertEquals(
    seen,
    "https://host.moltfoundry.bflocal:8017/ollama/api/tags",
  );
});
