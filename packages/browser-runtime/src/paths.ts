import * as path from "@std/path";

const moduleDir: string = path.dirname(path.fromFileUrl(import.meta.url));
const assetsDir: string = path.resolve(moduleDir, "../assets");
export const bfmonoRoot: string = path.resolve(moduleDir, "../../../../..");
export const sharedBftE2eRoot: string = path.resolve(
  bfmonoRoot,
  "..",
  "shared",
  "bft-e2e",
);
export const boltfoundryComAppRoot: string = path.join(
  bfmonoRoot,
  "apps",
  "boltfoundry-com",
);
export const iframeShellPath: string = path.resolve(
  assetsDir,
  "iframe-shell.html",
);
