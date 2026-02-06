import * as path from "@std/path";
import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";

const INTERNAL_KNOWLEDGE_ROOT = path.resolve(
  path.dirname(path.fromFileUrl(import.meta.url)),
  "../gambit-bot",
);

export default defineDeck({
  label: "internal_knowledge_read",
  contextSchema: z.object({
    path: z.string().describe(
      "Relative file path under Gambit Bot internal knowledge root.",
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
    let resolved;
    try {
      resolved = await resolveInternalKnowledgePath(ctx.input.path);
    } catch (err) {
      return {
        status: 400,
        message: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      const stat = await Deno.stat(resolved.fullPath);
      if (!stat.isFile) {
        return { status: 409, message: "path is not a file" };
      }
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

async function resolveInternalKnowledgePath(inputPath: string): Promise<{
  fullPath: string;
  relativePath: string;
}> {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("path is required");
  }

  const root = await Deno.realPath(INTERNAL_KNOWLEDGE_ROOT);
  const normalizedInput = path.normalize(inputPath);
  const segments = normalizedInput.split(/\\|\//g);
  if (segments.includes("..")) {
    throw new Error("path traversal is not allowed");
  }

  const candidate = path.isAbsolute(normalizedInput)
    ? normalizedInput
    : path.resolve(root, normalizedInput);
  const relativePath = path.relative(root, candidate);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("path escapes internal knowledge root");
  }

  let candidateStat: Deno.FileInfo | null = null;
  try {
    const stat = await Deno.lstat(candidate);
    candidateStat = stat;
    if (stat.isSymlink) {
      throw new Error("symlinks are not allowed");
    }

    const realCandidate = await Deno.realPath(candidate);
    const realRelative = path.relative(root, realCandidate);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("path escapes internal knowledge root");
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
  }

  const parentAnchor = candidateStat?.isDirectory
    ? candidate
    : path.dirname(candidate);
  const parent = await resolveExistingParent(parentAnchor);
  const parentReal = await Deno.realPath(parent);
  const parentRelative = path.relative(root, parentReal);
  if (parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) {
    throw new Error("path escapes internal knowledge root");
  }

  return {
    fullPath: candidate,
    relativePath: relativePath.replaceAll("\\", "/"),
  };
}

async function resolveExistingParent(dir: string): Promise<string> {
  let current = dir;
  while (true) {
    try {
      const stat = await Deno.stat(current);
      if (!stat.isDirectory) {
        throw new Error("parent path is not a directory");
      }
      return current;
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        throw err;
      }
    }

    const next = path.dirname(current);
    if (next === current) {
      return current;
    }
    current = next;
  }
}
