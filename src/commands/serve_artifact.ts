import * as path from "@std/path";
import { copy, ensureDir, existsSync } from "@std/fs";
import { UntarStream } from "@std/tar";

type RestoreServeArtifactArgs = {
  artifactPath: string;
  projectRoot: string;
};

type RestoreServeArtifactResult = {
  sessionId: string;
  sessionDir: string;
  rootDeckPath: string;
  restored: boolean;
};

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type ArtifactTarEntry = {
  header: { typeflag?: string };
  path: string;
  readable?: ReadableStream<Uint8Array>;
};

function isTarStreamEntry(value: unknown): value is ArtifactTarEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.path !== "string") return false;
  if (typeof entry.header !== "object" || entry.header === null) return false;
  const typeflag = (entry.header as Record<string, unknown>).typeflag;
  if (typeflag !== undefined && typeof typeflag !== "string") return false;
  if (
    entry.readable !== undefined && !(entry.readable instanceof ReadableStream)
  ) {
    return false;
  }
  return true;
}

function assertSafeSessionId(value: string): string {
  const trimmed = value.trim();
  if (!SESSION_ID_PATTERN.test(trimmed)) {
    throw new Error(`Invalid session id in artifact: ${value}`);
  }
  return trimmed;
}

function ensureSafeRelativeBundlePath(value: string): string {
  const raw = value.replaceAll("\\", "/").trim();
  if (!raw) {
    throw new Error("Artifact entry has an empty path.");
  }
  if (raw.startsWith("/")) {
    throw new Error(`Artifact entry path escapes root: ${value}`);
  }
  const outSegments: Array<string> = [];
  for (const segment of raw.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      throw new Error(`Artifact entry path contains traversal: ${value}`);
    }
    outSegments.push(segment);
  }
  if (outSegments.length === 0) {
    throw new Error("Artifact entry has an empty path.");
  }
  return outSegments.join("/");
}

function resolveWithin(root: string, relPath: string): string {
  const target = path.resolve(root, ...relPath.split("/"));
  const rootResolved = path.resolve(root);
  if (
    target !== rootResolved &&
    !target.startsWith(`${rootResolved}${path.SEPARATOR}`)
  ) {
    throw new Error(`Path escapes root: ${relPath}`);
  }
  return target;
}

async function drainEntry(
  readable: ReadableStream<Uint8Array>,
  filePath: string,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const file = await Deno.create(filePath);
  try {
    await readable.pipeTo(file.writable);
  } finally {
    try {
      file.close();
    } catch {
      // ignore close failures
    }
  }
}

async function sha256Hex(input: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(input));
  const bytes = new Uint8Array(hash);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

export async function restoreServeArtifactBundle(
  args: RestoreServeArtifactArgs,
): Promise<RestoreServeArtifactResult> {
  const artifactPath = path.resolve(args.artifactPath);
  const projectRoot = path.resolve(args.projectRoot);
  const bytes = await Deno.readFile(artifactPath);
  const fingerprint = await sha256Hex(bytes);
  const stagingDir = await Deno.makeTempDir({
    prefix: "gambit-serve-artifact-staging-",
  });

  try {
    const untar = ReadableStream.from([bytes])
      .pipeThrough(new DecompressionStream("gzip"))
      .pipeThrough(new UntarStream());
    for await (const rawEntry of untar) {
      if (!isTarStreamEntry(rawEntry)) {
        throw new Error("Artifact contains malformed tar entry metadata.");
      }
      const entry = rawEntry;
      const typeflag = entry.header?.typeflag;
      if (typeflag && typeflag !== "0" && typeflag !== "") {
        const readable = entry.readable;
        if (!readable) continue;
        for await (const _ of readable) {
          // drain unsupported entries and ignore them
        }
        continue;
      }
      if (!entry.readable) {
        throw new Error(
          `Artifact entry is missing readable data: ${entry.path}`,
        );
      }
      const relPath = ensureSafeRelativeBundlePath(entry.path);
      const targetPath = resolveWithin(stagingDir, relPath);
      await drainEntry(entry.readable, targetPath);
    }

    const manifestPath = path.join(stagingDir, "manifest.json");
    const sessionStatePath = path.join(stagingDir, "session", "state.json");
    const sessionEventsPath = path.join(stagingDir, "session", "events.jsonl");
    if (
      !existsSync(manifestPath) || !existsSync(sessionStatePath) ||
      !existsSync(sessionEventsPath)
    ) {
      throw new Error(
        "Artifact is missing required files (manifest.json, session/state.json, session/events.jsonl).",
      );
    }

    const manifest = JSON.parse(await Deno.readTextFile(manifestPath)) as {
      deck?: { entry_file?: unknown };
    };
    const entryFile = typeof manifest.deck?.entry_file === "string"
      ? ensureSafeRelativeBundlePath(manifest.deck.entry_file)
      : "";
    if (!entryFile.startsWith("deck/")) {
      throw new Error("Artifact manifest deck.entry_file must be under deck/.");
    }

    const rootDeckStagedPath = resolveWithin(stagingDir, entryFile);
    if (!existsSync(rootDeckStagedPath)) {
      throw new Error(
        `Artifact root deck file is missing from bundle: ${entryFile}`,
      );
    }

    const rawState = JSON.parse(await Deno.readTextFile(sessionStatePath)) as {
      meta?: Record<string, unknown>;
    };
    const rawSessionId = typeof rawState.meta?.workspaceId === "string"
      ? rawState.meta.workspaceId
      : typeof rawState.meta?.sessionId === "string"
      ? rawState.meta.sessionId
      : `artifact-${fingerprint.slice(0, 12)}`;
    const sessionId = assertSafeSessionId(rawSessionId);

    const sessionsRoot = path.join(projectRoot, ".gambit", "workspaces");
    const sessionDir = resolveWithin(sessionsRoot, sessionId);
    const fingerprintPath = path.join(sessionDir, ".artifact.sha256");
    const rootDeckPath = resolveWithin(sessionDir, entryFile);
    const deckRoot = path.join(sessionDir, "deck");
    const stateTargetPath = path.join(sessionDir, "state.json");
    const eventsTargetPath = path.join(sessionDir, "events.jsonl");

    if (existsSync(fingerprintPath)) {
      const existing = (await Deno.readTextFile(fingerprintPath)).trim();
      if (existing !== fingerprint) {
        throw new Error(
          `Workspace ${sessionId} already exists from a different artifact.`,
        );
      }
      return {
        sessionId,
        sessionDir,
        rootDeckPath,
        restored: false,
      };
    }

    if (
      existsSync(sessionDir) &&
      (existsSync(stateTargetPath) || existsSync(eventsTargetPath) ||
        existsSync(deckRoot))
    ) {
      throw new Error(
        `Workspace ${sessionId} already exists and cannot be overwritten safely.`,
      );
    }

    await ensureDir(sessionDir);
    await copy(path.join(stagingDir, "deck"), deckRoot, { overwrite: true });
    await Deno.copyFile(sessionEventsPath, eventsTargetPath);

    const nextMeta = {
      ...(rawState.meta ?? {}),
      sessionId,
      workspaceId: sessionId,
      deck: rootDeckPath,
      workspaceRootDeckPath: rootDeckPath,
      workspaceRootDir: deckRoot,
      sessionDir,
      sessionStatePath: stateTargetPath,
      sessionEventsPath: eventsTargetPath,
    };
    const nextState = {
      ...(rawState as Record<string, unknown>),
      meta: nextMeta,
    };
    await Deno.writeTextFile(
      stateTargetPath,
      `${JSON.stringify(nextState, null, 2)}\n`,
    );
    await Deno.writeTextFile(fingerprintPath, `${fingerprint}\n`);

    return {
      sessionId,
      sessionDir,
      rootDeckPath,
      restored: true,
    };
  } finally {
    try {
      await Deno.remove(stagingDir, { recursive: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

export type { RestoreServeArtifactResult };
