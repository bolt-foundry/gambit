import { defineDeck } from "jsr:@molt-foundry/gambit";
import { z } from "npm:zod";
import { resolveBotPath } from "./bot_fs.ts";

export default defineDeck({
  label: "bot_write",
  contextSchema: z.object({
    path: z.string().describe("Relative path under the bot root."),
    contents: z.string().describe("Full file contents to write."),
  }),
  responseSchema: z.object({
    status: z.number().optional(),
    message: z.string().optional(),
    payload: z.object({
      path: z.string(),
      action: z.enum(["created", "updated"]),
      before: z.string().nullable().optional(),
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

    let action: "created" | "updated" = "created";
    let before: string | null = null;
    try {
      const stat = await Deno.stat(resolved.fullPath);
      if (stat.isDirectory) {
        return { status: 409, message: "path is a directory" };
      }
      action = "updated";
      try {
        before = await Deno.readTextFile(resolved.fullPath);
      } catch {
        before = null;
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        return {
          status: 500,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    try {
      await Deno.writeTextFile(resolved.fullPath, ctx.input.contents, {
        create: true,
      });
      return {
        status: 200,
        payload: { path: resolved.relativePath, action, before },
      };
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return { status: 404, message: "parent directory does not exist" };
      }
      return {
        status: 500,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
