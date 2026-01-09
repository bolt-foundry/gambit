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
      url: "git+https://github.com/bolt-foundry/gambit.git",
    },
    bugs: { url: "https://github.com/bolt-foundry/gambit/issues" },
    homepage: "https://github.com/bolt-foundry/gambit",
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
