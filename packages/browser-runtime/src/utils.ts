import { ensureDir } from "@std/fs";
import * as path from "@std/path";

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

export function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function buildDemoUrl(
  baseUrl: string,
  demoPath: string,
  extraQuery?: string | null,
): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const resolved = new URL(demoPath, normalizedBase);
  if (extraQuery) {
    const query = extraQuery.startsWith("?") ? extraQuery.slice(1) : extraQuery;
    if (query.length) {
      if (resolved.search) {
        resolved.search += `&${query}`;
      } else {
        resolved.search = `?${query}`;
      }
    }
  }
  return resolved.toString();
}

export async function screenshot(
  page: { screenshot(opts: { path: string }): Promise<unknown> },
  dir: string,
  label: string,
): Promise<string> {
  await ensureDir(dir);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const filename = `${ts}_${safeLabel}.png`;
  const filePath = path.join(dir, filename);
  await page.screenshot({ path: filePath });
  return filePath;
}

export async function appendIndexLine(rootDir: string, line: string) {
  await Deno.writeTextFile(path.join(rootDir, "index.txt"), line + "\n", {
    append: true,
  }).catch(() => {});
}
