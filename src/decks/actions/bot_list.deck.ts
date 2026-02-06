import * as path from "@std/path";
import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";
import { resolveBotPath } from "./bot_fs.ts";

const MAX_RECURSION_DEPTH = 6;

type BotListEntry = {
  path: string;
  type: "file" | "dir";
  size?: number;
  modifiedAt?: string;
};

export default defineDeck({
  label: "bot_list",
  contextSchema: z.object({
    path: z.string().default(".").describe(
      "Relative directory path under the bot root. Use '.' for root.",
    ),
    recursive: z.boolean().default(false).describe(
      "When true, include nested entries.",
    ),
    maxDepth: z.number().int().min(1).max(MAX_RECURSION_DEPTH).default(2)
      .describe(
        "Max nested directory depth when recursive is true.",
      ),
  }),
  responseSchema: z.object({
    status: z.number().optional(),
    message: z.string().optional(),
    payload: z.object({
      path: z.string(),
      recursive: z.boolean(),
      maxDepth: z.number().int(),
      entries: z.array(z.object({
        path: z.string(),
        type: z.enum(["file", "dir"]),
        size: z.number().optional(),
        modifiedAt: z.string().optional(),
      })),
    }).optional(),
  }),
  async run(ctx) {
    let resolved;
    try {
      resolved = await resolveBotPath(ctx.input.path || ".");
    } catch (err) {
      return {
        status: 400,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    let rootStat: Deno.FileInfo;
    try {
      rootStat = await Deno.stat(resolved.fullPath);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return { status: 404, message: "path not found" };
      }
      return {
        status: 500,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    if (!rootStat.isDirectory) {
      return { status: 409, message: "path is not a directory" };
    }

    const recursive = Boolean(ctx.input.recursive);
    const maxDepth = recursive
      ? Math.min(
        Math.max(1, Math.trunc(ctx.input.maxDepth ?? 2)),
        MAX_RECURSION_DEPTH,
      )
      : 1;
    const entries: Array<BotListEntry> = [];
    const baseRelativePath = normalizeRelativePath(resolved.relativePath);
    const walk = async (dir: string, prefix: string, depth: number) => {
      const dirEntries = [];
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isSymlink) continue;
        dirEntries.push(entry);
      }
      dirEntries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of dirEntries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = prefix === "."
          ? entry.name
          : path.join(prefix, entry.name);
        if (entry.isDirectory) {
          entries.push({ path: relativePath, type: "dir" });
          if (recursive && depth < maxDepth) {
            await walk(fullPath, relativePath, depth + 1);
          }
          continue;
        }
        if (entry.isFile) {
          const info = await Deno.stat(fullPath);
          entries.push({
            path: relativePath,
            type: "file",
            size: info.size,
            modifiedAt: info.mtime ? info.mtime.toISOString() : undefined,
          });
        }
      }
    };

    try {
      await walk(resolved.fullPath, baseRelativePath, 0);
    } catch (err) {
      return {
        status: 500,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      status: 200,
      payload: {
        path: baseRelativePath,
        recursive,
        maxDepth,
        entries,
      },
    };
  },
});

function normalizeRelativePath(relativePath: string): string {
  if (!relativePath || relativePath === ".") return ".";
  return relativePath.replaceAll("\\", "/");
}
