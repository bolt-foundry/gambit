import * as path from "@std/path";

const GAMBIT_PACKAGE_SPECIFIER = "@bolt-foundry/gambit";
const GAMBIT_CORE_PACKAGE_SPECIFIER = "@bolt-foundry/gambit-core";

type McpDenoConfig = {
  unstable: Array<string>;
  nodeModulesDir: "auto";
  imports: Record<string, string>;
  compilerOptions: {
    skipLibCheck: boolean;
    types: Array<string>;
  };
};

let cachedTempConfigPath: string | null = null;

function moduleDir(): string {
  return path.dirname(path.fromFileUrl(import.meta.url));
}

function gambitPackageRoot(): string {
  return path.resolve(moduleDir(), "..");
}

function gambitCoreRoot(): string {
  return path.resolve(gambitPackageRoot(), "packages", "gambit-core");
}

function sharedEnvTypesPath(): string {
  return path.resolve(
    gambitPackageRoot(),
    "..",
    "env",
    "environment.shared.d.ts",
  );
}

export function buildMcpDenoConfig(): McpDenoConfig {
  const coreRoot = gambitCoreRoot();
  return {
    unstable: ["temporal", "net", "worker-options"],
    nodeModulesDir: "auto",
    imports: {
      [GAMBIT_PACKAGE_SPECIFIER]: path.join(gambitPackageRoot(), "mod.ts"),
      [`${GAMBIT_PACKAGE_SPECIFIER}/`]: `${gambitPackageRoot()}/`,
      [GAMBIT_CORE_PACKAGE_SPECIFIER]: path.join(coreRoot, "mod.ts"),
      [`${GAMBIT_CORE_PACKAGE_SPECIFIER}/`]: `${coreRoot}/`,
      "@openai/openai": "npm:openai@^4.78.1",
      "@std/assert": "jsr:@std/assert@^1.0.6",
      "@std/cli": "jsr:@std/cli@^1.0.7",
      "@std/dotenv": "jsr:@std/dotenv@^0.225.5",
      "@std/front-matter": "jsr:@std/front-matter@^1.0.9",
      "@std/front-matter/any": "jsr:@std/front-matter@^1.0.9/any",
      "@std/fs": "jsr:@std/fs@^1.0.20",
      "@std/jsonc": "jsr:@std/jsonc@^1.0.2",
      "@std/path": "jsr:@std/path@^1.0.6",
      "@std/streams": "jsr:@std/streams@^1.0.10",
      "@std/toml": "jsr:@std/toml@^1.0.9",
      "zod": "npm:zod@^3.23.8",
      "zod-to-json-schema": "npm:zod-to-json-schema@^3.23.0",
    },
    compilerOptions: {
      skipLibCheck: true,
      types: [sharedEnvTypesPath()],
    },
  };
}

export function writeMcpDenoConfigSync(outputPath: string): string {
  const resolvedOutput = path.resolve(outputPath);
  Deno.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  Deno.writeTextFileSync(
    resolvedOutput,
    `${JSON.stringify(buildMcpDenoConfig(), null, 2)}\n`,
  );
  return resolvedOutput;
}

export function ensureTempMcpDenoConfigSync(): string {
  if (cachedTempConfigPath) {
    return cachedTempConfigPath;
  }
  const dir = Deno.makeTempDirSync({ prefix: "gambit-mcp-deno-config-" });
  cachedTempConfigPath = writeMcpDenoConfigSync(
    path.join(dir, "deno.jsonc"),
  );
  return cachedTempConfigPath;
}

if (import.meta.main) {
  const outputPath = Deno.args[0]?.trim();
  if (!outputPath) {
    throw new Error("Usage: mcp_deno_config.ts <output-path>");
  }
  writeMcpDenoConfigSync(outputPath);
}
