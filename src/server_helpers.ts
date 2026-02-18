import * as path from "@std/path";

export function randomId(prefix: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `${prefix}-${suffix}`;
}

function isWithinPath(basePath: string, targetPath: string): boolean {
  const rel = path.relative(basePath, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function assertSafeBuildBotRoot(
  root: string,
  gambitBotSourceDir: string,
): void {
  if (
    gambitBotSourceDir &&
    (isWithinPath(root, gambitBotSourceDir) ||
      isWithinPath(gambitBotSourceDir, root))
  ) {
    throw new Error(
      `Unsafe build bot root "${root}": overlaps Gambit Bot source directory "${gambitBotSourceDir}"`,
    );
  }

  // Protect against writing into a copied/source Gambit Bot workspace even when
  // the running CLI is sourced from a different install path.
  const promptPath = path.join(root, "PROMPT.md");
  try {
    const prompt = Deno.readTextFileSync(promptPath);
    const looksLikeGambitBotSourceDeck =
      prompt.includes('path = "../actions/bot_write/PROMPT.md"') &&
      prompt.includes('path = "./graders/deck_format_guard/PROMPT.md"');
    if (looksLikeGambitBotSourceDeck) {
      throw new Error(
        `Unsafe build bot root "${root}": appears to be the Gambit Bot source deck directory`,
      );
    }
  } catch (err) {
    if (
      err instanceof Deno.errors.NotFound ||
      err instanceof Deno.errors.IsADirectory
    ) {
      return;
    }
    throw err;
  }
}

export function resolveDefaultValue(raw: unknown): unknown {
  if (typeof raw === "function") {
    try {
      return raw();
    } catch {
      return undefined;
    }
  }
  return raw;
}
