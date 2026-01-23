import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";
import { resolveInitPath } from "./init_fs.ts";

export default defineDeck({
  label: "init_mkdir",
  contextSchema: z.object({
    path: z.string().describe(
      "Relative directory path under the project root.",
    ),
  }),
  responseSchema: z.object({
    status: z.number().optional(),
    message: z.string().optional(),
    payload: z.object({
      created: z.boolean(),
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
      if (stat.isDirectory) {
        return { status: 200, payload: { created: false } };
      }
      return { status: 409, message: "path exists and is not a directory" };
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        return {
          status: 500,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    try {
      await Deno.mkdir(resolved.fullPath, { recursive: true });
      return { status: 201, payload: { created: true } };
    } catch (err) {
      return {
        status: 500,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
