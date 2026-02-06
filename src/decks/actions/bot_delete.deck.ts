import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";
import { resolveBotPath } from "./bot_fs.ts";

export default defineDeck({
  label: "bot_delete",
  contextSchema: z.object({
    path: z.string().describe("Relative path under the bot root."),
    recursive: z.boolean().default(false).describe(
      "When true, allows deleting non-empty directories.",
    ),
  }),
  responseSchema: z.object({
    status: z.number().optional(),
    message: z.string().optional(),
    payload: z.object({
      path: z.string(),
      deleted: z.boolean(),
      type: z.enum(["file", "directory"]),
      recursive: z.boolean(),
    }).optional(),
  }),
  async run(ctx) {
    let resolved;
    try {
      resolved = await resolveBotPath(ctx.input.path);
    } catch (err) {
      return {
        status: 400,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(resolved.fullPath);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return { status: 404, message: "path not found" };
      }
      return {
        status: 500,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const recursive = Boolean(ctx.input.recursive);
    if (stat.isDirectory && !recursive) {
      try {
        for await (const _ of Deno.readDir(resolved.fullPath)) {
          return {
            status: 409,
            message:
              "directory is not empty; set recursive=true to delete recursively",
          };
        }
      } catch (err) {
        return {
          status: 500,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    try {
      await Deno.remove(resolved.fullPath, { recursive });
      return {
        status: 200,
        payload: {
          path: resolved.relativePath,
          deleted: true,
          type: stat.isDirectory ? "directory" : "file",
          recursive,
        },
      };
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return { status: 404, message: "path not found" };
      }
      return {
        status: 500,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
