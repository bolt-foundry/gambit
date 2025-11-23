import * as path from "@std/path";
import type { TraceEvent } from "./types.ts";

export function makeJsonlTracer(filePath: string): (event: TraceEvent) => void {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  Deno.mkdirSync(dir, { recursive: true });
  return (event: TraceEvent) => {
    const line = JSON.stringify(event);
    Deno.writeTextFileSync(resolved, line + "\n", { append: true });
  };
}
