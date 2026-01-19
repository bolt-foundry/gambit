import { promptSecret } from "@std/cli/prompt-secret";
import { parse as parseDotenv } from "@std/dotenv/parse";
import * as path from "@std/path";

const logger = console;

export type ScaffoldKind = "demo" | "init";

function resolveCandidate(specifier: string): string | undefined {
  const url = new URL(import.meta.resolve(specifier));
  if (url.protocol !== "file:") return undefined;
  const candidatePath = path.fromFileUrl(url);
  try {
    Deno.statSync(candidatePath);
    return candidatePath;
  } catch {
    return undefined;
  }
}

export function resolveScaffoldPath(
  kind: ScaffoldKind,
  relativePath: string,
): string {
  const resolved = resolveCandidate(
    `../../scaffolds/${kind}/${relativePath}`,
  );
  if (resolved) return resolved;
  throw new Error(
    `Unable to resolve scaffold template (${kind}/${relativePath})`,
  );
}

export async function loadScaffoldTemplate(
  kind: ScaffoldKind,
  filename: string,
): Promise<string> {
  const templatePath = resolveScaffoldPath(kind, filename);
  try {
    return await Deno.readTextFile(templatePath);
  } catch (err) {
    logger.error(
      `Failed to load scaffold template ${filename} from ${templatePath}`,
    );
    throw err;
  }
}

export async function ensureDirectory(dir: string) {
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

export async function ensureScaffoldFile(
  kind: ScaffoldKind,
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
    const template = await loadScaffoldTemplate(kind, filename);
    await Deno.writeTextFile(destinationPath, template);
    logger.log(`Created ${path.relative(Deno.cwd(), destinationPath)}`);
    return true;
  }
}

export async function copyDirectoryRecursive(
  sourceDir: string,
  destinationDir: string,
) {
  await Deno.mkdir(destinationDir, { recursive: true });
  for await (const entry of Deno.readDir(sourceDir)) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isFile) {
      await Deno.copyFile(sourcePath, destinationPath);
      logger.log(`Created ${path.relative(Deno.cwd(), destinationPath)}`);
      continue;
    }
    if (entry.isDirectory) {
      await copyDirectoryRecursive(sourcePath, destinationPath);
      continue;
    }
    throw new Error(`Unsupported entry type for ${sourcePath}`);
  }
}

export async function ensureScaffoldDirectory(
  kind: ScaffoldKind,
  destinationPath: string,
  sourceRelative: string,
): Promise<boolean> {
  try {
    const existing = await Deno.stat(destinationPath);
    if (!existing.isDirectory) {
      logger.error(
        `Cannot create ${path.relative(Deno.cwd(), destinationPath)}: ` +
          "path exists and is not a directory.",
      );
      Deno.exit(1);
    }
    return false;
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      throw err;
    }
  }

  const sourceDir = resolveScaffoldPath(kind, sourceRelative);
  await copyDirectoryRecursive(sourceDir, destinationPath);
  return true;
}

export async function readDotenv(pathToFile: string): Promise<
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

export function formatEnvLine(key: string, value: string): string {
  const normalized = value.replace(/\r?\n/g, "");
  return `${key}=${normalized}\n`;
}

export function resolveInvokePrefix(): string {
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

export async function ensureOpenRouterEnv(envPath: string): Promise<boolean> {
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
