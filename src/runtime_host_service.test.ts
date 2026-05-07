import { assertEquals } from "@std/assert";
import { assertThrows } from "@std/assert/throws";
import { join } from "@std/path";
import {
  callRuntimeHostServiceRaw,
  CREATE_WRITEBACK_PREVIEW_HOST_SERVICE_METHOD,
  validateRuntimeHostServiceMethodAndParams,
} from "./runtime_host_service.ts";

async function readJsonLine(conn: Deno.Conn): Promise<Record<string, unknown>> {
  const reader = conn.readable.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const newlineIndex = text.indexOf("\n");
      if (newlineIndex >= 0) {
        return JSON.parse(text.slice(0, newlineIndex));
      }
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error("expected JSON line");
}

Deno.test("runtime host-service raw calls return non-Codex host results unchanged", async () => {
  const root = await Deno.makeTempDir({ dir: "/tmp", prefix: "rhs-" });
  const socketPath = join(root, "host-services.sock");
  const listener = Deno.listen({ path: socketPath, transport: "unix" });
  const server = (async () => {
    const conn = await listener.accept();
    try {
      const request = await readJsonLine(conn);
      const writer = conn.writable.getWriter();
      await writer.write(
        new TextEncoder().encode(
          `${
            JSON.stringify({
              error: null,
              id: request.id,
              result: {
                payload: { writebackId: "preview-smoke" },
                status: 200,
              },
            })
          }\n`,
        ),
      );
      writer.releaseLock();
    } finally {
      conn.close();
      listener.close();
    }
  })();

  try {
    const result = await callRuntimeHostServiceRaw({
      method: CREATE_WRITEBACK_PREVIEW_HOST_SERVICE_METHOD,
      params: {
        changedPaths: ["README.md"],
        summary: "Preview smoke.",
        workspaceRoot: "/tmp/workspace",
      },
      socketPath,
      token: "test-token",
    });

    assertEquals(result, {
      payload: { writebackId: "preview-smoke" },
      status: 200,
    });
  } finally {
    await server;
    await Deno.remove(root, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("runtime host-service raw calls support TCP endpoints", async () => {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const address = listener.addr;
  if (address.transport !== "tcp") {
    throw new Error("expected TCP listener");
  }
  const server = (async () => {
    const conn = await listener.accept();
    try {
      const request = await readJsonLine(conn);
      const writer = conn.writable.getWriter();
      await writer.write(
        new TextEncoder().encode(
          `${
            JSON.stringify({
              error: null,
              id: request.id,
              result: {
                payload: { writebackId: "tcp-preview-smoke" },
                status: 200,
              },
            })
          }\n`,
        ),
      );
      writer.releaseLock();
    } finally {
      conn.close();
      listener.close();
    }
  })();

  try {
    const result = await callRuntimeHostServiceRaw({
      method: CREATE_WRITEBACK_PREVIEW_HOST_SERVICE_METHOD,
      params: {
        changedPaths: ["README.md"],
        summary: "TCP preview smoke.",
        workspaceRoot: "/tmp/workspace",
      },
      socketPath: `tcp://127.0.0.1:${address.port}`,
      token: "test-token",
    });

    assertEquals(result, {
      payload: { writebackId: "tcp-preview-smoke" },
      status: 200,
    });
  } finally {
    await server;
  }
});

Deno.test("runtime host-service validates create writeback preview params", () => {
  assertEquals(
    validateRuntimeHostServiceMethodAndParams({
      method: CREATE_WRITEBACK_PREVIEW_HOST_SERVICE_METHOD,
      params: {
        changedPaths: ["notes/smoke.md"],
        summary: "Preview the runtime note.",
        workspaceRoot:
          "/runtime/cache/chief-session-workspaces/session-123/merged/coworkers/agents/assistant-to-chief-of-staff",
      },
    }),
    {
      method: CREATE_WRITEBACK_PREVIEW_HOST_SERVICE_METHOD,
      params: {
        changedPaths: ["notes/smoke.md"],
        summary: "Preview the runtime note.",
        workspaceRoot:
          "/runtime/cache/chief-session-workspaces/session-123/merged/coworkers/agents/assistant-to-chief-of-staff",
      },
    },
  );

  assertThrows(
    () =>
      validateRuntimeHostServiceMethodAndParams({
        method: CREATE_WRITEBACK_PREVIEW_HOST_SERVICE_METHOD,
        params: {
          summary: "Preview the runtime note.",
        },
      }),
    Error,
    "workspaceRoot",
  );
});
