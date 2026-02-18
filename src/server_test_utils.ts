import * as path from "@std/path";

export function modImportPath() {
  const here = path.dirname(path.fromFileUrl(import.meta.url));
  const modPath = path.resolve(here, "..", "mod.ts");
  return path.toFileUrl(modPath).href;
}

export async function runSimulator(
  port: number,
  payload: Record<string, unknown>,
): Promise<{ runId?: string; workspaceId?: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/simulator/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof body?.error === "string" ? body.error : res.statusText,
    );
  }
  return body as { runId?: string; workspaceId?: string };
}

export async function readDurableStreamEvents(
  port: number,
  streamId: string,
  offset = 0,
) {
  const res = await fetch(
    `http://127.0.0.1:${port}/api/durable-streams/stream/${streamId}?offset=${offset}`,
  );
  if (!res.ok) {
    throw new Error(res.statusText);
  }
  const body = await res.json() as {
    events?: Array<{ offset?: number; data?: unknown }>;
  };
  return body.events ?? [];
}

export async function readStreamEvents(port: number, offset = 0) {
  return await readDurableStreamEvents(port, "gambit-simulator", offset);
}

export async function readJsonLines(filePath: string): Promise<Array<unknown>> {
  const text = await Deno.readTextFile(filePath);
  return text.split("\n").filter((line) => line.trim().length > 0).map((line) =>
    JSON.parse(line)
  );
}
