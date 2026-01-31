import { build, emptyDir } from "@deno/dnt";
import { parse } from "@std/jsonc";
import { dirname, fromFileUrl, join, relative, toFileUrl } from "@std/path";

const packageRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const denoConfigPath = await (async () => {
  const candidates = ["deno.jsonc", "deno.json"].map((name) =>
    join(packageRoot, name)
  );
  for (const candidate of candidates) {
    try {
      await Deno.stat(candidate);
      return candidate;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `Missing Gambit config; looked for ${candidates.join(", ")}`,
  );
})();
const distDir = join(packageRoot, "dist", "npm");
const bundleDir = join(packageRoot, "simulator-ui", "dist");
const denoConfig = parse(await Deno.readTextFile(denoConfigPath)) as {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  imports?: Record<string, string>;
};
type SpecifierMappings = Record<
  string,
  { name: string; version?: string; subPath?: string }
>;
const pkg = {
  name: denoConfig.name,
  version: denoConfig.version,
  description: denoConfig.description,
  license: denoConfig.license,
};

if (!pkg.name || !pkg.version) {
  console.error(
    `Missing name/version in ${denoConfigPath}; refusing to build.`,
  );
  Deno.exit(1);
}

const run = async (cmd: string) => {
  const [bin, ...rest] = cmd.split(" ");
  const process = new Deno.Command(bin, {
    args: rest,
    cwd: packageRoot,
  });
  const res = await process.output();
  if (!res.success) {
    throw new Error(
      `${cmd} failed (${res.code}): ${new TextDecoder().decode(res.stderr)}`,
    );
  }
};

await run("deno task bundle:sim:web:sourcemap");
await emptyDir(distDir);

const coreDirCandidates = [
  join(packageRoot, "..", "gambit-core"),
  join(packageRoot, "packages", "gambit-core"),
];
const coreDir = await (async () => {
  for (const candidate of coreDirCandidates) {
    try {
      await Deno.stat(join(candidate, "deno.json"));
      return candidate;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `Unable to find gambit-core; looked in ${coreDirCandidates.join(", ")}`,
  );
})();
const coreConfigPath = join(coreDir, "deno.json");
const coreConfig = parse(await Deno.readTextFile(coreConfigPath)) as {
  name?: string;
  version?: string;
  exports?: Record<string, string>;
};
const corePackageName = coreConfig.name ?? "@molt-foundry/gambit-core";
const coreVersion = coreConfig.version ?? "";
const coreLocalOverride = Deno.env.get("GAMBIT_CORE_NPM_PATH");
let coreVersionRange = coreVersion ? `^${coreVersion}` : undefined;
if (coreLocalOverride) {
  const resolvedLocal = coreLocalOverride === "local"
    ? relative(distDir, join(coreDir, "dist", "npm"))
    : coreLocalOverride;
  coreVersionRange = resolvedLocal.startsWith("file:")
    ? resolvedLocal
    : `file:${resolvedLocal}`;
}
const coreExports = coreConfig.exports ?? {};
const coreRelativeDir = relative(packageRoot, coreDir);
const normalizeImportBase = (path: string) => {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || normalized === ".") return ".";
  if (normalized.startsWith(".")) return normalized;
  return `./${normalized}`;
};
const coreImportBase = normalizeImportBase(coreRelativeDir);
const makeCoreImportTarget = (rel: string) => {
  if (coreImportBase === ".") {
    return `./${rel}`;
  }
  return `${coreImportBase}/${rel}`;
};

const exportTargets = new Map<string, string>();
for (const [key, value] of Object.entries(coreExports)) {
  if (typeof value !== "string") continue;
  const suffix = key === "." ? "" : key.replace(/^\.\//, "/");
  const rel = value.startsWith("./") ? value.slice(2) : value;
  exportTargets.set(
    `${corePackageName}${suffix}`,
    makeCoreImportTarget(rel),
  );
}

const importsOverrides: Record<string, string> = {};
const currentImports = denoConfig.imports ?? {};
for (const [spec] of Object.entries(currentImports)) {
  if (!spec.startsWith(corePackageName)) continue;
  const target = exportTargets.get(spec);
  if (target) {
    importsOverrides[spec] = target;
  }
}

const dntImportMapPath = join(packageRoot, "deno.dnt.json");
const mergedImports = { ...currentImports, ...importsOverrides };
await Deno.writeTextFile(
  dntImportMapPath,
  JSON.stringify({ ...denoConfig, imports: mergedImports }, null, 2),
);

const specPattern = /["'`](@molt-foundry\/gambit-core[^"'`]*)["'`]/g;
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts"];
const testSuffixes = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];

const shouldScanFile = (name: string) =>
  sourceExtensions.some((ext) => name.endsWith(ext)) &&
  !testSuffixes.some((ext) => name.endsWith(ext));

const usedSpecifiers = new Set<string>();
const collectSpecifiersFromFile = async (path: string) => {
  let content: string;
  try {
    content = await Deno.readTextFile(path);
  } catch {
    return;
  }
  for (const match of content.matchAll(specPattern)) {
    const spec = match[1];
    if (spec?.startsWith(corePackageName)) {
      usedSpecifiers.add(spec);
    }
  }
};

const collectSpecifiersFromDir = async (dir: string) => {
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(dir)) {
      entries.push(entry);
    }
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory) {
      if (entry.name.startsWith(".")) continue;
      await collectSpecifiersFromDir(join(dir, entry.name));
    } else if (entry.isFile && shouldScanFile(entry.name)) {
      await collectSpecifiersFromFile(join(dir, entry.name));
    }
  }
};

await collectSpecifiersFromFile(join(packageRoot, "mod.ts"));
await collectSpecifiersFromDir(join(packageRoot, "src"));

if (usedSpecifiers.size === 0) {
  console.error("No gambit-core specifiers found; aborting build.");
  Deno.exit(1);
}

const normalizeSuffix = (suffix: string) => suffix.replace(/^\/+/, "");
const makeMapping = (suffix: string) => {
  const mapping: {
    name: string;
    version?: string;
    subPath?: string;
  } = { name: corePackageName };
  if (coreVersionRange) {
    mapping.version = coreVersionRange;
  }
  const cleaned = normalizeSuffix(suffix);
  if (cleaned) {
    mapping.subPath = cleaned;
  }
  return mapping;
};

const coreMappings: SpecifierMappings = {};
for (const spec of usedSpecifiers) {
  const target = exportTargets.get(spec);
  if (!target) {
    console.error(`Missing gambit-core export for ${spec}`);
    Deno.exit(1);
  }
  const suffix = spec.slice(corePackageName.length);
  const resolved = join(packageRoot, target);
  coreMappings[toFileUrl(resolved).toString()] = makeMapping(suffix);
}

try {
  await build({
    entryPoints: ["./mod.ts"],
    outDir: distDir,
    importMap: dntImportMapPath,
    shims: {
      deno: true,
    },
    mappings: coreMappings,
    test: false,
    compilerOptions: {
      lib: ["ESNext", "DOM"],
      noImplicitAny: false,
      skipLibCheck: true,
    },
    filterDiagnostic: (diagnostic) => diagnostic.code !== 2339,
    package: {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description ?? "",
      license: pkg.license ?? "Apache-2.0",
      bin: {
        gambit: "bin/gambit.cjs",
      },
      repository: {
        type: "git",
        url: "git+https://github.com/molt-foundry/gambit.git",
      },
      bugs: { url: "https://github.com/molt-foundry/gambit/issues" },
      homepage: "https://github.com/molt-foundry/gambit",
    },
  });
} finally {
  try {
    await Deno.remove(dntImportMapPath);
  } catch {
    // ignore
  }
}

for (const rel of ["node_modules", "package-lock.json"]) {
  const target = join(distDir, rel);
  try {
    await Deno.remove(target, { recursive: true });
  } catch {
    // ignore
  }
}

const gitkeep = join(distDir, ".gitkeep");
await Deno.writeTextFile(gitkeep, "");

const copyRecursive = async (src: string, dest: string) => {
  for await (const entry of Deno.readDir(src)) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory) {
      await Deno.mkdir(to, { recursive: true });
      await copyRecursive(from, to);
    } else if (entry.isFile) {
      await Deno.copyFile(from, to);
    }
  }
};

const npmStaticDirs = [
  join(distDir, "esm", "gambit", "simulator-ui", "dist"),
  join(distDir, "script", "gambit", "simulator-ui", "dist"),
];
for (const npmStaticDir of npmStaticDirs) {
  await Deno.mkdir(npmStaticDir, { recursive: true });
  await copyRecursive(bundleDir, npmStaticDir);
}

for (const filename of ["README.md", "LICENSE", "CHANGELOG.md"]) {
  const src = join(packageRoot, filename);
  try {
    await Deno.stat(src);
  } catch {
    continue;
  }
  const dest = join(distDir, filename);
  await Deno.copyFile(src, dest);
}

const binDir = join(distDir, "bin");
await Deno.mkdir(binDir, { recursive: true });
const binSrc = join(packageRoot, "bin", "gambit.cjs");
const binDest = join(binDir, "gambit.cjs");
await Deno.copyFile(binSrc, binDest);
