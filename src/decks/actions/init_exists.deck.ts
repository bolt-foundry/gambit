import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";
import { resolveInitPath } from "./init_fs.ts";

export default defineDeck({
  label: "init_exists",
  contextSchema: z.object({
    path: z.string().describe("Relative path under the project root."),
  }),
  responseSchema: z.object({
    status: z.number().optional(),
    message: z.string().optional(),
    payload: z.object({
      exists: z.boolean(),
      isFile: z.boolean().optional(),
      isDirectory: z.boolean().optional(),
    }).optional(),
  }),
  async run(ctx) {
    let resolved;
    try {
      resolved = await resolveInitPath(ctx.input.path);
    } catch (err) {
      return {
        status: 400,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      const stat = await Deno.stat(resolved.fullPath);
      return {
        status: 200,
        payload: {
          exists: true,
          isFile: stat.isFile,
          isDirectory: stat.isDirectory,
        },
      };
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return { status: 200, payload: { exists: false } };
      }
      return {
        status: 500,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
