import * as path from "@std/path";
import { walk } from "@std/fs";
import { extract } from "@std/front-matter/any";
import { TarStream } from "@std/tar/tar-stream";
import { loadDeck } from "@bolt-foundry/gambit-core";
import { loadState } from "@bolt-foundry/gambit-core";
import type {
  HandlersConfig,
  ModelMessage,
  TraceEvent,
} from "@bolt-foundry/gambit-core";
import {
  extractContextInput,
  findLastAssistantMessage,
  slugifyDeckPath,
} from "../cli_utils.ts";

type ExportArgs = {
  statePath: string;
  outPath: string;
  deckPath?: string;
};

type GradingRunRecord = {
  id?: string;
  graderPath?: string;
  status?: string;
  input?: unknown;
  result?: unknown;
  error?: string;
};

const TRACE_EVENT_TYPES = new Set<string>([
  "run.start",
  "message.user",
  "run.end",
  "deck.start",
  "deck.end",
  "action.start",
  "action.end",
  "tool.call",
  "tool.result",
  "model.call",
  "model.result",
  "log",
  "monolog",
]);

function loadTraceEventsFromSession(
  statePath: string,
  state: { meta?: Record<string, unknown> },
): Array<TraceEvent> {
  const meta = state.meta ?? {};
  const eventsPath = typeof meta.sessionEventsPath === "string"
    ? meta.sessionEventsPath
    : path.join(path.dirname(statePath), "events.jsonl");
  try {
    const text = Deno.readTextFileSync(eventsPath);
    const traces: Array<TraceEvent> = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as Record<string, unknown>;
        const kind = typeof record.kind === "string" ? record.kind : "";
        const type = typeof record.type === "string" ? record.type : "";
        if (kind === "trace" || TRACE_EVENT_TYPES.has(type)) {
          traces.push(record as TraceEvent);
        }
      } catch {
        // ignore invalid lines
      }
    }
    return traces;
  } catch {
    return [];
  }
}

function normalizeId(prefix: string, raw?: string): string {
  const cleaned = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (cleaned && cleaned.startsWith(prefix)) {
    return cleaned;
  }
  if (cleaned) {
    return `${prefix}${cleaned}`;
  }
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  return `${prefix}${suffix}`;
}

function formatBundleTimestamp(date: Date): string {
  const iso = date.toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function normalizeTarPath(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

type TraceRunSummary = {
  runId: string;
  sourceRunId: string;
  deckPath?: string;
  input?: unknown;
  initialUserMessage?: unknown;
  lastMessage?: ModelMessage;
  traceEvents: Array<TraceEvent>;
};

function collectTraceRuns(
  traces: Array<TraceEvent>,
): Map<string, TraceRunSummary> {
  const runs = new Map<string, TraceRunSummary>();
  for (const event of traces) {
    const normalized = normalizeId("run_", event.runId);
    let entry = runs.get(normalized);
    if (!entry) {
      entry = {
        runId: normalized,
        sourceRunId: event.runId,
        traceEvents: [],
      };
      runs.set(normalized, entry);
    }
    entry.traceEvents.push(event);
    if (event.type === "run.start") {
      entry.deckPath = entry.deckPath ?? event.deckPath;
      entry.input = entry.input ?? event.input;
      entry.initialUserMessage = entry.initialUserMessage ??
        event.initialUserMessage;
    } else if (event.type === "model.result") {
      entry.deckPath = entry.deckPath ?? event.deckPath;
      entry.lastMessage = event.message;
    } else if ("deckPath" in event && typeof event.deckPath === "string") {
      entry.deckPath = entry.deckPath ?? event.deckPath;
    }
  }
  return runs;
}

function outputFromMessage(message?: ModelMessage): unknown {
  if (!message) return undefined;
  const content = message.content;
  if (typeof content === "string") return content;
  if (content !== null && content !== undefined) return content;
  return message;
}

async function writeBundleTarGz(
  rootDir: string,
  outPath: string,
): Promise<void> {
  const entries: Array<{
    type: "file";
    path: string;
    size: number;
    readable: ReadableStream<Uint8Array>;
  }> = [];

  for await (const entry of walk(rootDir, { includeDirs: false })) {
    if (!entry.isFile) continue;
    const rel = path.relative(rootDir, entry.path);
    if (!rel) continue;
    const data = await Deno.readFile(entry.path);
    entries.push({
      type: "file",
      path: normalizeTarPath(rel),
      size: data.byteLength,
      readable: new Blob([data]).stream(),
    });
  }

  const readable = ReadableStream.from(entries);
  const tarStream = readable.pipeThrough(new TarStream());
  const gzipStream = tarStream.pipeThrough(new CompressionStream("gzip"));
  await gzipStream.pipeTo((await Deno.create(outPath)).writable);
}

function handlerPaths(handlers?: HandlersConfig): Array<string> {
  if (!handlers) return [];
  const paths: Array<string> = [];
  if (handlers.onError?.path) paths.push(handlers.onError.path);
  if (handlers.onBusy?.path) paths.push(handlers.onBusy.path);
  if (handlers.onIdle?.path) paths.push(handlers.onIdle.path);
  if (handlers.onInterval?.path) paths.push(handlers.onInterval.path);
  return paths;
}

async function readMarkdownSchemaFiles(
  filePath: string,
): Promise<Array<string>> {
  if (!filePath.endsWith(".md")) return [];
  const { attrs, baseDir } = await readMarkdownFrontMatter(filePath);
  if (!attrs) return [];
  const out = new Set<string>();
  const contextSchema = attrs.contextSchema ?? attrs.contextFragment ??
    attrs.inputSchema;
  const responseSchema = attrs.responseSchema ?? attrs.responseFragment ??
    attrs.outputSchema;
  if (typeof contextSchema === "string") {
    out.add(path.resolve(baseDir, contextSchema));
  }
  if (typeof responseSchema === "string") {
    out.add(path.resolve(baseDir, responseSchema));
  }
  return Array.from(out);
}

async function readMarkdownFrontMatter(
  filePath: string,
): Promise<{ attrs?: Record<string, unknown>; baseDir: string }> {
  if (!filePath.endsWith(".md")) {
    return { attrs: undefined, baseDir: path.dirname(filePath) };
  }
  try {
    const raw = await Deno.readTextFile(filePath);
    const parsed = extract(raw) as { attrs?: Record<string, unknown> };
    return { attrs: parsed?.attrs ?? {}, baseDir: path.dirname(filePath) };
  } catch {
    return { attrs: undefined, baseDir: path.dirname(filePath) };
  }
}

async function readSchemaRefs(
  filePath: string,
): Promise<{ input?: string; output?: string }> {
  const { attrs, baseDir } = await readMarkdownFrontMatter(filePath);
  if (!attrs) return {};
  const out: { input?: string; output?: string } = {};
  if (typeof attrs.contextSchema === "string") {
    out.input = path.resolve(baseDir, attrs.contextSchema);
  } else if (typeof attrs.contextFragment === "string") {
    out.input = path.resolve(baseDir, attrs.contextFragment);
  } else if (typeof attrs.inputSchema === "string") {
    out.input = path.resolve(baseDir, attrs.inputSchema);
  }
  if (typeof attrs.responseSchema === "string") {
    out.output = path.resolve(baseDir, attrs.responseSchema);
  } else if (typeof attrs.responseFragment === "string") {
    out.output = path.resolve(baseDir, attrs.responseFragment);
  } else if (typeof attrs.outputSchema === "string") {
    out.output = path.resolve(baseDir, attrs.outputSchema);
  }
  return out;
}

async function collectDeckDependencyPaths(
  rootDeckPath: string,
  extraDeckPaths: Array<string> = [],
): Promise<Set<string>> {
  const files = new Set<string>();
  const visited = new Set<string>();

  const visitDeck = async (deckPath: string) => {
    const resolved = path.resolve(deckPath);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    files.add(resolved);

    for (const schemaPath of await readMarkdownSchemaFiles(resolved)) {
      files.add(schemaPath);
    }

    const deck = await loadDeck(resolved);
    for (const card of deck.cards ?? []) {
      files.add(card.path);
      for (const schemaPath of await readMarkdownSchemaFiles(card.path)) {
        files.add(schemaPath);
      }
      for (const action of card.actionDecks ?? []) {
        await visitDeck(action.path);
      }
      for (const testDeck of card.testDecks ?? []) {
        await visitDeck(testDeck.path);
      }
      for (const graderDeck of card.graderDecks ?? []) {
        await visitDeck(graderDeck.path);
      }
    }

    for (const action of deck.actionDecks ?? []) {
      await visitDeck(action.path);
    }
    for (const testDeck of deck.testDecks ?? []) {
      await visitDeck(testDeck.path);
    }
    for (const graderDeck of deck.graderDecks ?? []) {
      await visitDeck(graderDeck.path);
    }
    for (const handlerPath of handlerPaths(deck.handlers)) {
      await visitDeck(handlerPath);
    }
  };

  await visitDeck(rootDeckPath);
  for (const extra of extraDeckPaths) {
    await visitDeck(extra);
  }
  return files;
}

export async function exportBundle(
  args: ExportArgs,
): Promise<string> {
  const state = loadState(args.statePath);
  if (!state) {
    throw new Error(`State file not found or invalid: ${args.statePath}`);
  }
  const rootDeckPath = args.deckPath ??
    (typeof state.meta?.deck === "string" ? state.meta.deck : undefined);
  if (!rootDeckPath) {
    throw new Error("export requires --deck or state.meta.deck to be set.");
  }

  const tempDir = await Deno.makeTempDir({ prefix: "gambit-export-" });
  try {
    const traceEvents = Array.isArray(state.traces) && state.traces.length > 0
      ? state.traces
      : loadTraceEventsFromSession(args.statePath, state);
    const rawMeta = state.meta && typeof state.meta === "object"
      ? state.meta as Record<string, unknown>
      : undefined;
    const gradingRuns = Array.isArray(rawMeta?.gradingRuns)
      ? rawMeta?.gradingRuns as Array<GradingRunRecord>
      : Array.isArray(rawMeta?.calibrationRuns)
      ? rawMeta?.calibrationRuns as Array<GradingRunRecord>
      : [];
    const extraDeckPaths = new Set<string>();
    for (const event of traceEvents) {
      if ("deckPath" in event && typeof event.deckPath === "string") {
        extraDeckPaths.add(path.resolve(event.deckPath));
      }
    }
    for (const run of gradingRuns) {
      if (typeof run.graderPath === "string") {
        extraDeckPaths.add(path.resolve(run.graderPath));
      }
    }

    const deckFiles = await collectDeckDependencyPaths(
      rootDeckPath,
      Array.from(extraDeckPaths),
    );
    const deckPathMap = new Map<string, string>();
    const workspaceRoot = Deno.cwd();

    for (const filePath of deckFiles) {
      const rel = path.relative(workspaceRoot, filePath);
      let bundlePath: string;
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        const safe = filePath.replace(/[^a-zA-Z0-9]+/g, "_").replace(
          /^_+|_+$/g,
          "",
        );
        bundlePath = normalizeTarPath(
          path.join("deck", "external", safe || path.basename(filePath)),
        );
      } else {
        bundlePath = normalizeTarPath(path.join("deck", rel));
      }
      deckPathMap.set(filePath, bundlePath);
      const target = path.join(tempDir, ...bundlePath.split("/"));
      await Deno.mkdir(path.dirname(target), { recursive: true });
      const data = await Deno.readFile(filePath);
      await Deno.writeFile(target, data);
    }

    const resolvedRootDeckPath = path.resolve(rootDeckPath);
    const entryFile = deckPathMap.get(resolvedRootDeckPath);
    if (!entryFile) {
      throw new Error("Failed to map root deck path into bundle layout.");
    }
    const deckContents = await Deno.readTextFile(rootDeckPath);

    const rootRunId = normalizeId("run_", state.runId);
    const traceRuns = collectTraceRuns(traceEvents);
    if (!traceRuns.has(rootRunId)) {
      traceRuns.set(rootRunId, {
        runId: rootRunId,
        sourceRunId: state.runId,
        deckPath: resolvedRootDeckPath,
        traceEvents: [],
      });
    }
    const rootRun = traceRuns.get(rootRunId);
    const rootInput = rootRun?.input ?? rootRun?.initialUserMessage ??
      extractContextInput(state) ?? {};
    const rootResponse = findLastAssistantMessage(state.messages ?? []);

    const deckHash = `sha256:${await sha256Hex(deckContents)}`;
    const bundleId = normalizeId(
      "bundle_",
      `${formatBundleTimestamp(new Date())}_${slugifyDeckPath(rootDeckPath)}`,
    );

    const schemaCache = new Map<string, { input?: string; output?: string }>();
    const resolveSchemas = async (deckPath?: string) => {
      if (!deckPath) return undefined;
      const resolved = path.resolve(deckPath);
      const cached = schemaCache.get(resolved);
      if (cached) {
        return Object.keys(cached).length ? cached : undefined;
      }
      const refs = await readSchemaRefs(resolved);
      const inputSchemaPath = refs.input
        ? deckPathMap.get(refs.input)
        : undefined;
      const outputSchemaPath = refs.output
        ? deckPathMap.get(refs.output)
        : undefined;
      const schemas = (inputSchemaPath || outputSchemaPath)
        ? { input: inputSchemaPath, output: outputSchemaPath }
        : undefined;
      schemaCache.set(resolved, schemas ?? {});
      return schemas;
    };
    const mapDeckPath = (deckPath?: string) => {
      if (!deckPath) return entryFile;
      const resolved = path.resolve(deckPath);
      return deckPathMap.get(resolved) ?? entryFile;
    };
    const writeJsonFile = async (bundlePath: string, data: unknown) => {
      const target = path.join(tempDir, ...bundlePath.split("/"));
      await Deno.mkdir(path.dirname(target), { recursive: true });
      await Deno.writeTextFile(
        target,
        `${JSON.stringify(data, null, 2)}\n`,
      );
    };

    const runEntries: Array<Record<string, unknown>> = [];
    const usedRunIds = new Set<string>();
    const rootDeck = await loadDeck(resolvedRootDeckPath);
    const testDeckPaths = (rootDeck.testDecks ?? []).map((deck) =>
      path.resolve(deck.path)
    );
    const testDeckPathSet = new Set(testDeckPaths);
    const traceRunDeckPaths = new Set<string>();
    for (const run of traceRuns.values()) {
      if (run.deckPath) traceRunDeckPaths.add(path.resolve(run.deckPath));
    }
    let userDeckPath: string | undefined;
    for (const candidate of testDeckPaths) {
      if (traceRunDeckPaths.has(candidate)) {
        userDeckPath = candidate;
        break;
      }
    }
    if (!userDeckPath && testDeckPaths.length === 1) {
      userDeckPath = testDeckPaths[0];
    }
    const userDeckBundlePath = userDeckPath
      ? deckPathMap.get(userDeckPath)
      : undefined;
    const addRun = async (opts: {
      runId: string;
      deckPath?: string;
      input?: unknown;
      output?: unknown;
      status?: "succeeded" | "failed" | "timeout" | "cancelled";
      errorMessage?: string;
      traceEvents?: Array<TraceEvent>;
      schemas?: { input?: string; output?: string };
      meta?: Record<string, unknown>;
    }) => {
      if (usedRunIds.has(opts.runId)) return;
      usedRunIds.add(opts.runId);

      const inputValue = opts.input ?? {};
      const inputPath = normalizeTarPath(
        path.join("runs", opts.runId, "input.json"),
      );
      await writeJsonFile(inputPath, inputValue);

      let outputPath: string | undefined;
      let outputValue: unknown = undefined;
      if (opts.output !== undefined) {
        outputPath = normalizeTarPath(
          path.join("runs", opts.runId, "output.json"),
        );
        outputValue = opts.output;
        await writeJsonFile(outputPath, opts.output);
      }

      let attachments: Array<Record<string, unknown>> | undefined;
      if (opts.traceEvents && opts.traceEvents.length > 0) {
        const tracePath = normalizeTarPath(
          path.join("traces", `${opts.runId}.trace.jsonl`),
        );
        const traceTarget = path.join(tempDir, ...tracePath.split("/"));
        await Deno.mkdir(path.dirname(traceTarget), { recursive: true });
        const lines = opts.traceEvents.map((event) => JSON.stringify(event))
          .join("\n");
        await Deno.writeTextFile(traceTarget, `${lines}\n`);
        attachments = [{ kind: "trace", path: tracePath }];
      }

      let status = opts.status ?? (outputPath ? "succeeded" : "failed");
      if (status === "succeeded" && !outputPath) {
        status = "failed";
      }
      const errorMessage = status !== "succeeded"
        ? opts.errorMessage ?? (outputPath ? undefined : "No output found.")
        : undefined;
      const entry = {
        id: opts.runId,
        deck_path: mapDeckPath(opts.deckPath),
        status,
        input: inputValue,
        input_path: inputPath,
        output: outputValue,
        output_path: outputPath,
        schemas: opts.schemas,
        attachments,
        error: errorMessage ? { message: errorMessage } : undefined,
        meta: opts.meta,
      };
      runEntries.push(
        Object.fromEntries(
          Object.entries(entry).filter(([, value]) => value !== undefined),
        ),
      );
    };

    const sortedTraceRuns = Array.from(traceRuns.values()).sort((a, b) =>
      a.runId.localeCompare(b.runId)
    );
    for (const run of sortedTraceRuns) {
      if (
        run.deckPath &&
        testDeckPathSet.has(path.resolve(run.deckPath))
      ) {
        continue;
      }
      const isRoot = run.runId === rootRunId;
      const input = isRoot
        ? rootInput
        : run.input ?? run.initialUserMessage ?? {};
      const output = isRoot
        ? (rootResponse ?? outputFromMessage(run.lastMessage))
        : outputFromMessage(run.lastMessage);
      const errorMessage = output !== undefined
        ? undefined
        : (isRoot
          ? "No assistant output found in state file."
          : "No model output found for run.");
      const schemas = await resolveSchemas(
        run.deckPath ?? resolvedRootDeckPath,
      );
      await addRun({
        runId: run.runId,
        deckPath: run.deckPath ?? resolvedRootDeckPath,
        input,
        output,
        errorMessage,
        schemas,
        traceEvents: run.traceEvents,
        meta: isRoot && userDeckBundlePath
          ? { user_deck_path: userDeckBundlePath }
          : undefined,
      });
    }

    for (const gradingRun of gradingRuns) {
      if (!gradingRun || typeof gradingRun !== "object") continue;
      const runId = normalizeId("run_", gradingRun.id);
      const deckPath = typeof gradingRun.graderPath === "string"
        ? gradingRun.graderPath
        : undefined;
      if (!deckPath) continue;
      const status = gradingRun.status === "completed" ? "succeeded" : "failed";
      const errorMessage = status === "succeeded"
        ? undefined
        : gradingRun.error ?? "Grading run incomplete.";
      const schemas = await resolveSchemas(deckPath);
      await addRun({
        runId,
        deckPath,
        input: gradingRun.input ?? {},
        output: gradingRun.result,
        status,
        errorMessage,
        schemas,
      });
    }

    const manifest = {
      schema: { name: "gambit-bundle", version: "0.2.0" },
      bundle: {
        id: bundleId,
        deck_hash: deckHash,
      },
      deck: {
        entry_file: entryFile,
        files: Array.from(deckPathMap.values()).sort(),
      },
      runs: runEntries,
    };

    await Deno.writeTextFile(
      path.join(tempDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    await writeBundleTarGz(tempDir, args.outPath);
    return args.outPath;
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}
