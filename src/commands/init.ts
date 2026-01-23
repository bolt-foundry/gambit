import { load as loadDotenv } from "@std/dotenv";
import * as path from "@std/path";
import { startTui } from "../tui.ts";
import { createOpenRouterProvider } from "../providers/openrouter.ts";
import { ensureDirectory, ensureOpenRouterEnv } from "./scaffold_utils.ts";

const logger = console;

const DEFAULT_PROJECT_DIR = "gambit";
const INIT_ROOT_ENV = "GAMBIT_INIT_ROOT";

type InitOptions = {
  interactive?: boolean;
};

export async function handleInitCommand(
  targetPath?: string,
  opts: InitOptions = {},
) {
  const normalizedTarget = targetPath?.trim();
  const projectPath = normalizedTarget && normalizedTarget.length > 0
    ? normalizedTarget
    : DEFAULT_PROJECT_DIR;
  const rootDir = path.resolve(Deno.cwd(), projectPath);
  await ensureDirectory(rootDir);

  const rootDeckPath = path.join(rootDir, "root.deck.md");
  const testDeckPath = path.join(rootDir, "tests", "first.test.deck.md");
  if (await exists(rootDeckPath) || await exists(testDeckPath)) {
    logger.error(
      "Init output files already exist. Remove them or choose a new target.",
    );
    Deno.exit(1);
  }

  const envPath = path.join(rootDir, ".env");
  await ensureOpenRouterEnv(envPath);
  if (!Deno.env.get("OPENROUTER_API_KEY")) {
    try {
      await loadDotenv({ envPath, export: true });
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) {
        throw err;
      }
    }
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    logger.error("OPENROUTER_API_KEY is required to run gambit init.");
    Deno.exit(1);
  }

  Deno.env.set(INIT_ROOT_ENV, rootDir);

  if (opts.interactive === false) {
    return;
  }

  if (!Deno.stdin.isTerminal()) {
    logger.error("gambit init requires an interactive TTY.");
    Deno.exit(1);
  }

  const chatFallback = Deno.env.get("GAMBIT_CHAT_FALLBACK") === "1";
  const responsesMode = !chatFallback &&
    Deno.env.get("GAMBIT_RESPONSES_MODE") !== "0";
  const provider = createOpenRouterProvider({
    apiKey,
    baseURL: Deno.env.get("OPENROUTER_BASE_URL") ?? undefined,
    enableResponses: !chatFallback &&
      Deno.env.get("GAMBIT_OPENROUTER_RESPONSES") !== "0",
  });

  await startTui({
    deckPath: resolveInitDeckPath(),
    model: undefined,
    modelForce: undefined,
    modelProvider: provider,
    responsesMode,
  });
}

function resolveInitDeckPath(): string {
  const url = new URL("../decks/gambit-init.deck.md", import.meta.url);
  if (url.protocol !== "file:") {
    throw new Error("Unable to resolve init deck path.");
  }
  return path.fromFileUrl(url);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await Deno.stat(filePath);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}
