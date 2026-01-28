import * as path from "@std/path";

const ROOT_ENV = "GAMBIT_BOT_ROOT";

export type ResolvedBotPath = {
  root: string;
  fullPath: string;
  relativePath: string;
};

export async function resolveBotPath(
  inputPath: string,
): Promise<ResolvedBotPath> {
  if (!inputPath || typeof inputPath !== "string") {
    throw new Error("path is required");
  }

  const rootRaw = Deno.env.get(ROOT_ENV);
  if (!rootRaw) {
    throw new Error(`${ROOT_ENV} is required`);
  }

  const root = await Deno.realPath(rootRaw);
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
    throw new Error("path escapes bot root");
  }

  try {
    const stat = await Deno.lstat(candidate);
    if (stat.isSymlink) {
      throw new Error("symlinks are not allowed");
    }
    const realCandidate = await Deno.realPath(candidate);
    const realRelative = path.relative(root, realCandidate);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("path escapes bot root");
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
  }

  const parent = await resolveExistingParent(path.dirname(candidate));
  const parentReal = await Deno.realPath(parent);
  const parentRelative = path.relative(root, parentReal);
  if (parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) {
    throw new Error("path escapes bot root");
  }

  return { root, fullPath: candidate, relativePath };
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
