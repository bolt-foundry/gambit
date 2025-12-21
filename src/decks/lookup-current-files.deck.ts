import * as path from "@std/path";
import { walk } from "@std/fs/walk";
import { defineDeck } from "../../mod.ts";
import { z } from "zod";

type FileEntry = {
  path: string;
  relative: string;
  kind: "dir" | "file";
};

const configPath = path.resolve(Deno.cwd(), ".gambit", "config.json");

const readConfigRoot = (): string | undefined => {
  try {
    const text = Deno.readTextFileSync(configPath);
    const data = JSON.parse(text) as { rootPath?: unknown };
    return typeof data.rootPath === "string" ? data.rootPath : undefined;
  } catch {
    return undefined;
  }
};

const resolveRoot = (rootParam?: string): string => {
  const fallbackRoot = readConfigRoot() ?? Deno.cwd();
  return path.resolve(rootParam ?? fallbackRoot);
};

export default defineDeck({
  label: "lookup_current_files",
  inputSchema: z.object({
    root: z.string().optional().describe(
      "Optional root path to scan instead of the configured workspace root.",
    ),
    limit: z.number().int().positive().optional().describe(
      "Maximum number of entries to return.",
    ),
    maxDepth: z.number().int().positive().optional().describe(
      "Maximum directory depth to traverse.",
    ),
  }),
  outputSchema: z.object({
    root: z.string(),
    files: z.array(
      z.object({
        path: z.string(),
        relative: z.string(),
        kind: z.enum(["dir", "file"]),
      }),
    ),
  }),
  async run(ctx) {
    const root = resolveRoot(ctx.input.root);
    const limit = ctx.input.limit ?? 500;
    const maxDepth = ctx.input.maxDepth ?? 10;
    const files: Array<FileEntry> = [];
    let count = 0;

    try {
      for await (
        const entry of walk(root, {
          includeDirs: true,
          followSymlinks: false,
          maxDepth,
        })
      ) {
        if (!entry.isFile && !entry.isDirectory) continue;
        const relative = path.relative(root, entry.path);
        if (!relative) continue;
        files.push({
          path: entry.path,
          relative,
          kind: entry.isDirectory ? "dir" : "file",
        });
        count++;
        if (count >= limit) break;
      }
    } catch (err) {
      ctx.fail({
        message: err instanceof Error ? err.message : String(err),
        code: "lookup_current_files_failed",
        details: { root },
      });
    }

    return { root, files };
  },
});
