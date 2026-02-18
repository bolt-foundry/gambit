import * as path from "@std/path";
import { existsSync } from "@std/fs";
import type { SavedState, TraceEvent } from "@bolt-foundry/gambit-core";

export type SessionArtifactsConfig = {
  rootDir: string;
  sessionId?: string;
  continueSession?: boolean;
  // When true (default), continueSession restores prior state.json into the
  // next run. Set false to keep append-only events while starting each run
  // from a fresh state.
  resumeState?: boolean;
};

export type SessionArtifactsRun = {
  state?: SavedState;
  trace: (event: TraceEvent) => void;
  onStateUpdate: (state: SavedState) => void;
  finalize: () => void;
  sessionId: string;
  sessionDir: string;
};

type SessionArtifactEnvelope = {
  offset: number;
  createdAt: string;
  type: string;
  _gambit?: Record<string, unknown>;
};

type PreparedSessionArtifacts = {
  config: Required<SessionArtifactsConfig>;
  sessionDir: string;
  statePath: string;
  eventsPath: string;
  lockPath: string;
};

function canonicalSessionEventType(type: string): string {
  if (type.startsWith("response.") || type.startsWith("gambit.")) {
    return type;
  }
  return `gambit.${type}`;
}

function randomId(prefix: string): string {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `${prefix}-${suffix}`;
}

function parseFiniteInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value)) return undefined;
  return value;
}

function normalizeConfig(
  config: SessionArtifactsConfig,
): Required<SessionArtifactsConfig> {
  const rootDir = path.resolve(config.rootDir);
  const sessionId = config.sessionId?.trim() || randomId("session");
  const continueSession = Boolean(config.continueSession);
  const resumeState = config.resumeState ?? true;
  if (!rootDir) {
    throw new Error("sessionArtifacts.rootDir is required.");
  }
  if (config.continueSession && !config.sessionId?.trim()) {
    throw new Error(
      "sessionArtifacts.sessionId is required when continueSession is true.",
    );
  }
  return { rootDir, sessionId, continueSession, resumeState };
}

function prepare(
  configInput: SessionArtifactsConfig,
): PreparedSessionArtifacts {
  const config = normalizeConfig(configInput);
  const sessionDir = path.join(config.rootDir, config.sessionId);
  const statePath = path.join(sessionDir, "state.json");
  const eventsPath = path.join(sessionDir, "events.jsonl");
  const lockPath = path.join(sessionDir, ".lock");
  return { config, sessionDir, statePath, eventsPath, lockPath };
}

function ensureMonotonicOffsets(
  records: Array<SessionArtifactEnvelope>,
  eventsPath: string,
): number {
  let expected = 0;
  let highest = -1;
  for (const record of records) {
    if (record.offset !== expected) {
      throw new Error(
        `Non-monotonic offset in ${eventsPath}: expected ${expected}, got ${record.offset}`,
      );
    }
    highest = record.offset;
    expected += 1;
  }
  return highest;
}

function readEvents(
  eventsPath: string,
): { records: Array<SessionArtifactEnvelope>; highestOffset: number } {
  if (!existsSync(eventsPath)) {
    return { records: [], highestOffset: -1 };
  }
  const text = Deno.readTextFileSync(eventsPath);
  const records: Array<SessionArtifactEnvelope> = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const offset = parseFiniteInteger(parsed.offset);
    const createdAt = typeof parsed.createdAt === "string"
      ? parsed.createdAt
      : null;
    const type = parsed.type;
    if (
      offset === undefined ||
      createdAt === null ||
      typeof type !== "string" ||
      type.trim().length === 0
    ) {
      throw new Error(`Invalid event record in ${eventsPath}`);
    }
    records.push({
      offset,
      createdAt,
      type,
      _gambit: parsed._gambit &&
          typeof parsed._gambit === "object" &&
          !Array.isArray(parsed._gambit)
        ? parsed._gambit as Record<string, unknown>
        : undefined,
    });
  }
  const highestOffset = records.length
    ? ensureMonotonicOffsets(records, eventsPath)
    : -1;
  return { records, highestOffset };
}

function writeJsonAtomic(filePath: string, payload: unknown) {
  const dir = path.dirname(filePath);
  Deno.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.tmp-${path.basename(filePath)}-${randomId("tmp")}`,
  );
  Deno.writeTextFileSync(tmpPath, JSON.stringify(payload, null, 2));
  Deno.renameSync(tmpPath, filePath);
}

function appendJsonl(filePath: string, payload: unknown) {
  Deno.mkdirSync(path.dirname(filePath), { recursive: true });
  const line = JSON.stringify(payload);
  Deno.writeTextFileSync(filePath, `${line}\n`, { append: true });
}

function archiveOrphanedEvents(eventsPath: string): string {
  const dir = path.dirname(eventsPath);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const archivedPath = path.join(dir, `events.orphaned.${stamp}.jsonl`);
  Deno.renameSync(eventsPath, archivedPath);
  return archivedPath;
}

function writeStateSnapshot(args: {
  statePath: string;
  state: SavedState;
  offset: number;
  sessionId: string;
  sessionDir: string;
  eventsPath: string;
}) {
  const nextMeta: Record<string, unknown> = {
    ...(args.state.meta ?? {}),
    sessionId: args.sessionId,
    sessionDir: args.sessionDir,
    sessionStatePath: args.statePath,
    sessionEventsPath: args.eventsPath,
    lastAppliedOffset: args.offset,
    lastAppliedEventSeq: args.offset,
  };
  const snapshot: SavedState = {
    ...args.state,
    meta: nextMeta,
  };
  writeJsonAtomic(args.statePath, snapshot);
}

export function withSessionArtifacts(args: {
  config: SessionArtifactsConfig;
  trace?: (event: TraceEvent) => void;
  onStateUpdate?: (state: SavedState) => void;
  state?: SavedState;
}): SessionArtifactsRun {
  const prepared = prepare(args.config);
  const {
    config,
    sessionDir,
    statePath,
    eventsPath,
    lockPath,
  } = prepared;

  Deno.mkdirSync(sessionDir, { recursive: true });
  if (
    !config.continueSession && (existsSync(statePath) || existsSync(eventsPath))
  ) {
    throw new Error(
      `Session artifact directory already exists at ${sessionDir}. Pass continueSession: true with the same sessionId to continue.`,
    );
  }
  try {
    Deno.writeTextFileSync(
      lockPath,
      JSON.stringify({
        pid: Deno.pid,
        acquiredAt: new Date().toISOString(),
      }),
      { createNew: true },
    );
  } catch (err) {
    if (err instanceof Deno.errors.AlreadyExists) {
      throw new Error(
        `Session artifact directory is already active: ${sessionDir}`,
      );
    }
    throw err;
  }

  let latestState = args.state;
  let highestOffset = -1;
  let lastStateOffset = -1;
  try {
    const loaded = readEvents(eventsPath);
    highestOffset = loaded.highestOffset;
    if (
      !latestState &&
      config.continueSession &&
      config.resumeState &&
      existsSync(statePath)
    ) {
      const parsed = JSON.parse(Deno.readTextFileSync(statePath)) as SavedState;
      latestState = parsed;
    }
    if (
      !latestState &&
      config.continueSession &&
      config.resumeState &&
      highestOffset >= 0
    ) {
      // Recovery path: preserve prior trace-only history, then start a fresh
      // append-only log so retries can continue without corrupting snapshot
      // boundaries.
      archiveOrphanedEvents(eventsPath);
      highestOffset = -1;
    }
    const meta = latestState?.meta as
      | { lastAppliedOffset?: unknown; lastAppliedEventSeq?: unknown }
      | undefined;
    lastStateOffset = parseFiniteInteger(meta?.lastAppliedOffset) ??
      parseFiniteInteger(meta?.lastAppliedEventSeq) ??
      -1;
  } catch (err) {
    try {
      Deno.removeSync(lockPath);
    } catch {
      // no-op
    }
    throw err;
  }

  const persistLatest = () => {
    if (!latestState) return;
    writeStateSnapshot({
      statePath,
      state: latestState,
      offset: lastStateOffset,
      sessionId: config.sessionId,
      sessionDir,
      eventsPath,
    });
  };

  const trace = (event: TraceEvent) => {
    highestOffset += 1;
    const createdAt = new Date().toISOString();
    const sourceType = typeof event?.type === "string" &&
        event.type.trim().length > 0
      ? event.type.trim()
      : "gambit.session.event";
    const payloadType = canonicalSessionEventType(sourceType);
    const rawMeta = (event as Record<string, unknown> | undefined)?._gambit;
    const meta =
      rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
        ? rawMeta as Record<string, unknown>
        : {};
    const record = {
      ...(event as Record<string, unknown>),
      type: payloadType,
      offset: highestOffset,
      createdAt,
      _gambit: {
        ...meta,
        ...(payloadType !== sourceType ? { source_type: sourceType } : {}),
        domain: "session",
        offset: highestOffset,
      },
    };
    appendJsonl(eventsPath, record);
    args.trace?.(event);
  };

  const onStateUpdate = (state: SavedState) => {
    latestState = state;
    lastStateOffset = highestOffset;
    persistLatest();
    args.onStateUpdate?.(state);
  };

  const finalize = () => {
    try {
      Deno.removeSync(lockPath);
    } catch {
      // no-op
    }
  };

  return {
    state: latestState,
    trace,
    onStateUpdate,
    finalize,
    sessionId: config.sessionId,
    sessionDir,
  };
}
