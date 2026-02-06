import * as path from "@std/path";
import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";

const POLICY_ROOT = path.resolve(
  path.dirname(path.fromFileUrl(import.meta.url)),
  "../gambit-bot/policy",
);

export default defineDeck({
  label: "policy_read",
  contextSchema: z.object({
    path: z.string().optional().describe(
      "Policy file path under policy/. Defaults to policy/README.md.",
    ),
  }),
  responseSchema: z.object({
    status: z.number().optional(),
    message: z.string().optional(),
    payload: z.object({
      path: z.string(),
      contents: z.string(),
    }).optional(),
  }),
  async run(ctx) {
    const requestedPath = (ctx.input.path ?? "policy/README.md").trim();

    let resolved;
    try {
      resolved = await resolvePolicyPath(requestedPath);
    } catch (err) {
      return {
        status: 400,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      const stat = await Deno.stat(resolved.fullPath);
      if (!stat.isFile) return { status: 409, message: "path is not a file" };
      const contents = await Deno.readTextFile(resolved.fullPath);
      return {
        status: 200,
        payload: { path: resolved.relativePath, contents },
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

async function resolvePolicyPath(inputPath: string): Promise<{
  fullPath: string;
  relativePath: string;
}> {
  if (!inputPath) throw new Error("path is required");
  const root = await Deno.realPath(POLICY_ROOT);

  const normalized = inputPath.startsWith("policy/")
    ? inputPath.slice("policy/".length)
    : inputPath;
  const normalizedInput = path.normalize(normalized);
  const segments = normalizedInput.split(/\\|\//g);
  if (segments.includes("..")) throw new Error("path traversal is not allowed");

  const candidate = path.resolve(root, normalizedInput);
  const relativePath = path.relative(root, candidate);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("path escapes policy root");
  }
  if (!relativePath.endsWith(".md")) {
    throw new Error("policy_read only supports .md files under policy/");
  }

  return {
    fullPath: candidate,
    relativePath: `policy/${relativePath.replaceAll("\\", "/")}`,
  };
}
