import { parse as parseToml } from "@std/toml";
import * as path from "@std/path";
import type { ExternalToolDefinition } from "@bolt-foundry/gambit-core";

export type RuntimeToolBinding = {
  sourcePath: string;
  name: string;
  description?: string;
  inputSchemaPath?: string;
  actionPath?: string;
  tool: ExternalToolDefinition;
};

function parseTomlFrontMatter(
  text: string,
): { data: Record<string, unknown>; body: string } {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "+++") {
    throw new Error(
      "runtime-tools file must start with TOML frontmatter (+++)",
    );
  }
  const endIndex = lines.indexOf("+++", 1);
  if (endIndex === -1) {
    throw new Error("runtime-tools file is missing closing +++ frontmatter");
  }
  const tomlText = lines.slice(1, endIndex).join("\n");
  return {
    data: parseToml(tomlText) as Record<string, unknown>,
    body: lines.slice(endIndex + 1).join("\n"),
  };
}

async function loadSchema(schemaPath: string): Promise<unknown> {
  const imported = await import(path.toFileUrl(schemaPath).href);
  return imported.default ?? imported.schema;
}

type RuntimeToolInputSchema = ExternalToolDefinition["inputSchema"];

function normalizeToolRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

async function loadRuntimeToolsFile(
  filePath: string,
): Promise<Array<RuntimeToolBinding>> {
  const resolved = path.resolve(filePath);
  const text = await Deno.readTextFile(resolved);
  const parsed = parseTomlFrontMatter(text);
  const rows = normalizeToolRows(parsed.data.tools);
  const baseDir = path.dirname(resolved);
  const bindings: Array<RuntimeToolBinding> = [];

  for (const row of rows) {
    const rawName = row.name;
    if (typeof rawName !== "string" || !rawName.trim()) {
      throw new Error(`runtime tool in ${resolved} is missing name`);
    }
    const name = rawName.trim();
    const description = typeof row.description === "string"
      ? row.description
      : undefined;
    const inputSchemaPath = typeof row.inputSchema === "string"
      ? path.resolve(baseDir, row.inputSchema)
      : undefined;
    const actionPath = typeof row.action === "string"
      ? path.resolve(baseDir, row.action)
      : undefined;
    const tool: ExternalToolDefinition = {
      name,
      description,
      inputSchema: inputSchemaPath
        ? await loadSchema(inputSchemaPath) as RuntimeToolInputSchema
        : undefined,
    };
    bindings.push({
      sourcePath: resolved,
      name,
      description,
      inputSchemaPath,
      actionPath,
      tool,
    });
  }

  return bindings;
}

export async function loadRuntimeTools(
  filePaths: Array<string>,
): Promise<Array<RuntimeToolBinding>> {
  const bindings = (await Promise.all(filePaths.map(loadRuntimeToolsFile)))
    .flat();
  const seen = new Map<string, string>();
  for (const binding of bindings) {
    const previous = seen.get(binding.name);
    if (previous) {
      throw new Error(
        `Duplicate runtime tool "${binding.name}" in ${binding.sourcePath}; already declared in ${previous}`,
      );
    }
    seen.set(binding.name, binding.sourcePath);
  }
  return bindings;
}
