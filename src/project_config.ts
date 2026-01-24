import { parse as parseToml } from "@std/toml";
import * as path from "@std/path";

export type WorkspaceConfig = {
  decks?: string;
  actions?: string;
  graders?: string;
  tests?: string;
  schemas?: string;
};

export type ModelAliasConfig = {
  model?: string;
  description?: string;
  params?: Record<string, unknown>;
};

export type GambitConfig = {
  workspace?: WorkspaceConfig;
  models?: {
    aliases?: Record<string, ModelAliasConfig>;
  };
};

export type LoadedProjectConfig = {
  root: string;
  path: string;
  config: GambitConfig;
};

const CONFIG_FILENAME = "gambit.toml";
const configCache = new Map<string, LoadedProjectConfig | null>();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function resolveStartDir(target?: string): string {
  if (!target) return Deno.cwd();
  const resolved = path.resolve(target);
  try {
    const info = Deno.statSync(resolved);
    if (info.isDirectory) return resolved;
    return path.dirname(resolved);
  } catch {
    return path.dirname(resolved);
  }
}

function findConfigPath(startDir: string): string | null {
  let current = startDir;
  while (true) {
    const candidate = path.join(current, CONFIG_FILENAME);
    try {
      const info = Deno.statSync(candidate);
      if (info.isFile) return candidate;
    } catch {
      // ignore and continue walking up the tree
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export async function loadProjectConfig(
  startPath?: string,
): Promise<LoadedProjectConfig | null> {
  const startDir = resolveStartDir(startPath);
  const configPath = findConfigPath(startDir);
  if (!configPath) return null;
  const cached = configCache.get(configPath);
  if (cached !== undefined) {
    return cached;
  }
  const text = await Deno.readTextFile(configPath);
  const parsed = parseToml(text) as GambitConfig;
  const loaded: LoadedProjectConfig = {
    root: path.dirname(configPath),
    path: configPath,
    config: parsed ?? {},
  };
  configCache.set(configPath, loaded);
  return loaded;
}

export type ModelAliasResolution = {
  model?: string;
  params?: Record<string, unknown>;
  alias?: string;
  applied: boolean;
  missingAlias?: boolean;
};

export type ModelAliasResolver = (model?: string) => ModelAliasResolution;

export function createModelAliasResolver(
  config?: GambitConfig | null,
): ModelAliasResolver {
  const resolved = new Map<string, {
    model: string;
    params?: Record<
      string,
      unknown
    >;
  }>();
  const aliases = config?.models?.aliases;
  if (isPlainObject(aliases)) {
    for (const [name, raw] of Object.entries(aliases)) {
      if (!isPlainObject(raw)) continue;
      const model = typeof raw.model === "string" ? raw.model.trim() : "";
      if (!model) continue;
      const params = isPlainObject(raw.params)
        ? structuredClone(raw.params)
        : undefined;
      resolved.set(name, { model, params });
    }
  }
  const hasAliases = resolved.size > 0;
  return (model?: string): ModelAliasResolution => {
    if (!model) {
      return { model, applied: false };
    }
    const entry = resolved.get(model);
    if (entry) {
      return {
        model: entry.model,
        params: entry.params ? structuredClone(entry.params) : undefined,
        alias: model,
        applied: true,
      };
    }
    const missingAlias = hasAliases && !model.includes("/");
    return { model, applied: false, missingAlias };
  };
}
