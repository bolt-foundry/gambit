import { promptSecret } from "@std/cli/prompt-secret";
import { parse as parseDotenv } from "@std/dotenv/parse";
import * as path from "@std/path";

const logger = console;

const HELLO_EXAMPLE_FILES = [
  "deno.json",
  "hello.deck.md",
  "hello.grader.deck.md",
  "hello.test.deck.md",
  "package.json",
  "schemas/grader_input_conversation.zod.ts",
  "schemas/grader_input_turns.zod.ts",
  "schemas/grader_output.zod.ts",
];

function resolveExamplePath(filename: string): string {
  const resolveCandidate = (specifier: string) => {
    const url = new URL(import.meta.resolve(specifier));
    if (url.protocol !== "file:") return undefined;
    const candidatePath = path.fromFileUrl(url);
    try {
      Deno.statSync(candidatePath);
      return candidatePath;
    } catch {
      return undefined;
    }
  };

  const initPath = resolveCandidate(`../../init/${filename}`);
  if (initPath) return initPath;
  throw new Error(`Unable to resolve example template: ${filename}`);
}

async function loadExampleTemplate(filename: string): Promise<string> {
  const templatePath = resolveExamplePath(filename);
  try {
    return await Deno.readTextFile(templatePath);
  } catch (err) {
    logger.error(
      `Failed to load example template ${filename} from ${templatePath}`,
    );
    throw err;
  }
}

async function ensureDirectory(dir: string) {
  try {
    const existing = await Deno.stat(dir);
    if (!existing.isDirectory) {
      logger.error(`Cannot create gambit: ${dir} already exists`);
      Deno.exit(1);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      await Deno.mkdir(dir, { recursive: true });
      return;
    }
    throw err;
  }
}

async function ensureExampleFile(
  destinationPath: string,
  filename: string,
): Promise<boolean> {
  try {
    await Deno.stat(destinationPath);
    return false;
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
    const parentDir = path.dirname(destinationPath);
    if (parentDir) {
      await Deno.mkdir(parentDir, { recursive: true });
    }
    const template = await loadExampleTemplate(filename);
    await Deno.writeTextFile(destinationPath, template);
    logger.log(`Created ${path.relative(Deno.cwd(), destinationPath)}`);
    return true;
  }
}

async function readDotenv(pathToFile: string): Promise<
  {
    raw: string;
    values: Record<string, string>;
  } | null
> {
  try {
    const raw = await Deno.readTextFile(pathToFile);
    return { raw, values: parseDotenv(raw) };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return null;
    }
    throw err;
  }
}

function formatEnvLine(key: string, value: string): string {
  const normalized = value.replace(/\r?\n/g, "");
  return `${key}=${normalized}\n`;
}

function resolveInvokePrefix(): string {
  const npmCommand = Deno.env.get("npm_command")?.toLowerCase();
  if (npmCommand === "exec" || npmCommand === "npx") {
    return "npx @bolt-foundry/gambit";
  }

  const execBase = path.basename(Deno.execPath()).toLowerCase();
  if (execBase === "deno" || execBase === "deno.exe") {
    const mainModule = Deno.mainModule;
    if (mainModule.startsWith("jsr:")) {
      return `deno run -A ${mainModule}`;
    }
    if (mainModule.startsWith("file:")) {
      const mainPath = path.fromFileUrl(mainModule);
      return `deno run -A ${path.relative(Deno.cwd(), mainPath)}`;
    }
    return "deno run -A <gambit-cli>";
  }

  return "gambit";
}

async function ensureOpenRouterEnv(envPath: string): Promise<boolean> {
  const envKey = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (envKey) {
    return false;
  }

  const existing = await readDotenv(envPath);
  const hasKey = Boolean(existing?.values.OPENROUTER_API_KEY?.trim());
  if (hasKey) {
    return false;
  }

  const key = promptSecret("Enter OpenRouter API key:");
  if (!key?.trim()) {
    logger.error("OpenRouter API key is required to populate gambit/.env.");
    Deno.exit(1);
  }

  if (existing) {
    const needsNewline = existing.raw.length > 0 &&
      !existing.raw.endsWith("\n");
    const prefix = needsNewline ? "\n" : "";
    await Deno.writeTextFile(
      envPath,
      `${existing.raw}${prefix}${formatEnvLine("OPENROUTER_API_KEY", key)}`,
    );
    logger.log(`Updated ${path.relative(Deno.cwd(), envPath)}`);
  } else {
    await Deno.writeTextFile(
      envPath,
      formatEnvLine("OPENROUTER_API_KEY", key),
    );
    logger.log(`Created ${path.relative(Deno.cwd(), envPath)}`);
  }
  return true;
}

export async function handleInitCommand() {
  const rootDir = path.resolve(Deno.cwd(), "gambit");
  await ensureDirectory(rootDir);

  const deckPath = path.join(rootDir, "hello.deck.md");
  let exampleCreated = false;
  for (const filename of HELLO_EXAMPLE_FILES) {
    const created = await ensureExampleFile(
      path.join(rootDir, filename),
      filename,
    );
    exampleCreated ||= created;
  }

  const envPath = path.join(rootDir, ".env");
  const envUpdated = await ensureOpenRouterEnv(envPath);

  if (!exampleCreated && !envUpdated) {
    logger.log("gambit already initialized; nothing to do.");
  }
  logger.log("Try it:");
  logger.log(
    `  ${resolveInvokePrefix()} repl ${path.relative(Deno.cwd(), deckPath)}`,
  );
}
