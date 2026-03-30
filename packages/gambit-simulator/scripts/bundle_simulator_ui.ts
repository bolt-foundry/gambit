import * as path from "@std/path";

const packageRoot = path.dirname(
  path.dirname(path.fromFileUrl(import.meta.url)),
);
const denoBin = Deno.execPath();
const bundleOutput = path.join("simulator-ui", "dist", "bundle.js");
const entryPath = path.join("simulator-ui", "src", "main.tsx");
const faviconSrc = path.join("simulator-ui", "src", "favicon.ico");
const faviconDest = path.join("simulator-ui", "dist", "favicon.ico");

const runBundle = async () => {
  const process = new Deno.Command(denoBin, {
    args: ["bundle", ...Deno.args, "--output", bundleOutput, entryPath],
    cwd: packageRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const result = await process.spawn().status;
  if (!result.success) {
    Deno.exit(result.code);
  }
};

const copyFavicon = async () => {
  try {
    await Deno.stat(faviconSrc);
  } catch {
    return;
  }
  await Deno.mkdir(path.join(packageRoot, "simulator-ui", "dist"), {
    recursive: true,
  });
  await Deno.copyFile(
    path.join(packageRoot, faviconSrc),
    path.join(packageRoot, faviconDest),
  );
};

await runBundle();
await copyFavicon();
