import { build, emptyDir } from "@deno/dnt";
import { dirname, fromFileUrl, join } from "@std/path";

const packageRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const distDir = join(packageRoot, "dist", "npm");
const denoConfigPath = join(packageRoot, "deno.json");
const denoConfig = JSON.parse(await Deno.readTextFile(denoConfigPath)) as {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  exports?: Record<string, string>;
};
const pkg = {
  name: denoConfig.name,
  version: denoConfig.version,
  description: denoConfig.description,
  license: denoConfig.license,
};

if (!pkg.name || !pkg.version) {
  const message =
    `Missing name/version in ${denoConfigPath}; refusing to build.\n`;
  Deno.stderr.writeSync(new TextEncoder().encode(message));
  Deno.exit(1);
}

await emptyDir(distDir);

async function copyDir(src: string, dest: string) {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile) {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}

const entryPoints = Object.entries(denoConfig.exports ?? {})
  .filter(([, value]) => typeof value === "string")
  .map(([name, path]) => ({
    name,
    path,
  }));

await build({
  entryPoints: entryPoints.length > 0 ? entryPoints : ["./mod.ts"],
  outDir: distDir,
  importMap: denoConfigPath,
  shims: {
    deno: true,
  },
  test: false,
  package: {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description ?? "",
    license: pkg.license ?? "Apache-2.0",
    repository: {
      type: "git",
      url: "git+https://github.com/molt-foundry/gambit.git",
    },
    bugs: { url: "https://github.com/molt-foundry/gambit/issues" },
    homepage: "https://github.com/molt-foundry/gambit",
  },
  compilerOptions: {
    lib: ["ESNext"],
  },
});

for (const pathRel of ["node_modules", "package-lock.json"]) {
  const target = join(distDir, pathRel);
  try {
    await Deno.remove(target, { recursive: true });
  } catch {
    // ignore
  }
}

const gitkeep = join(distDir, ".gitkeep");
await Deno.writeTextFile(gitkeep, "");

for (const filename of ["README.md", "LICENSE"]) {
  const src = join(packageRoot, filename);
  try {
    await Deno.stat(src);
  } catch {
    continue;
  }
  const dest = join(distDir, filename);
  await Deno.copyFile(src, dest);
}

for (const assetDir of ["cards", "schemas"]) {
  const srcDir = join(packageRoot, assetDir);
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(srcDir);
  } catch {
    continue;
  }
  if (!info.isDirectory) continue;
  const destDir = join(distDir, assetDir);
  await copyDir(srcDir, destDir);
}
