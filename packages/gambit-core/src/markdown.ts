import { extract } from "@std/front-matter/any";
import * as path from "@std/path";
import {
  BUILTIN_TOOL_NAME_SET,
  GAMBIT_TOOL_CONTEXT,
  GAMBIT_TOOL_END,
  GAMBIT_TOOL_RESPOND,
  MAX_TOOL_NAME_LENGTH,
  RESERVED_TOOL_PREFIX,
  TOOL_NAME_PATTERN,
} from "./constants.ts";
import { isCardDefinition, isDeckDefinition } from "./definitions.ts";
import { loadCard } from "./loader.ts";
import { mergeZodObjects, toJsonSchema } from "./schema.ts";
import { resolveBuiltinSchemaPath } from "./builtins.ts";
import type {
  ActionDeckDefinition,
  DeckDefinition,
  GraderDeckDefinition,
  LoadedCard,
  LoadedDeck,
  TestDeckDefinition,
} from "./types.ts";
import type { ZodTypeAny } from "zod";

const logger = console;

type ParsedFrontmatter = Record<string, unknown>;
const RESPOND_MARKER = "gambit://respond";
const INIT_MARKER = "gambit://init";
const END_MARKER = "gambit://end";
const LEGACY_MARKER_WARNINGS: Record<"respond" | "init" | "end", boolean> = {
  respond: false,
  init: false,
  end: false,
};
const LEGACY_SCHEMA_WARNINGS = new Set<string>();
const LEGACY_FRAGMENT_WARNINGS = new Set<string>();

const INIT_TEXT = `
You will automatically receive a \`${GAMBIT_TOOL_CONTEXT}\` tool result at the start that provides run/context info.
`.trim();

const RESPOND_TEXT = `
When you are done, call the \`${GAMBIT_TOOL_RESPOND}\` tool with a JSON object that includes your \`payload\` (validated output) and optional \`status\`/ \`message\`/ \`code\`/ \`meta\`. Do not end with normal assistant text; always finish by calling \`${GAMBIT_TOOL_RESPOND}\`.
`.trim();

const END_TEXT = `
If the entire workflow is finished and no further user turns should be sent, call the \`${GAMBIT_TOOL_END}\` tool with optional \`message\` and \`payload\` fields to explicitly end the session.
`.trim();

function normalizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonSchema(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = normalizeJsonSchema(record[key]);
    }
    return out;
  }
  return value;
}

function schemasMatchDeep(a: ZodTypeAny, b: ZodTypeAny): boolean {
  const aJson = normalizeJsonSchema(toJsonSchema(a as never));
  const bJson = normalizeJsonSchema(toJsonSchema(b as never));
  return JSON.stringify(aJson) === JSON.stringify(bJson);
}

function warnLegacyMarker(
  marker: keyof typeof LEGACY_MARKER_WARNINGS,
  replacement: string,
) {
  if (LEGACY_MARKER_WARNINGS[marker]) return;
  LEGACY_MARKER_WARNINGS[marker] = true;
  logger.warn(
    `[gambit] "gambit://${marker}" is deprecated; use ${replacement} instead.`,
  );
}

function warnLegacySchema(
  resolvedPath: string,
  legacy: "inputSchema" | "outputSchema",
  replacement: "contextSchema" | "responseSchema",
) {
  const key = `${resolvedPath}:${legacy}`;
  if (LEGACY_SCHEMA_WARNINGS.has(key)) return;
  LEGACY_SCHEMA_WARNINGS.add(key);
  logger.warn(
    `[gambit] deck at ${resolvedPath} uses deprecated "${legacy}"; rename to "${replacement}"`,
  );
}

function warnLegacyFragment(
  resolvedPath: string,
  legacy: "inputSchema" | "outputSchema",
  replacement: "contextFragment" | "responseFragment",
) {
  const key = `${resolvedPath}:${legacy}`;
  if (LEGACY_FRAGMENT_WARNINGS.has(key)) return;
  LEGACY_FRAGMENT_WARNINGS.add(key);
  logger.warn(
    `[gambit] card at ${resolvedPath} uses deprecated "${legacy}"; rename to "${replacement}"`,
  );
}

function toFileUrl(p: string): string {
  const abs = path.resolve(p);
  return path.toFileUrl(abs).href;
}

async function maybeLoadSchema(
  schemaPath: unknown,
  basePath: string,
): Promise<ZodTypeAny | undefined> {
  if (!schemaPath || typeof schemaPath !== "string") return undefined;
  const builtin = resolveBuiltinSchemaPath(schemaPath);
  const resolved = builtin ??
    path.resolve(path.dirname(basePath), schemaPath);
  const mod = await import(toFileUrl(resolved));
  return mod.default as ZodTypeAny;
}

type DeckRef = {
  path: string;
  label?: string;
  description?: string;
  id?: string;
};

function normalizeDeckRefs<T extends DeckRef>(
  refs: unknown,
  basePath: string,
  opts?: { requirePrompt?: boolean; requireDescription?: boolean },
): Array<T> {
  if (!Array.isArray(refs)) return [];
  return refs
    .filter((a) => a && typeof a === "object")
    .map((a) => {
      const rec = a as Record<string, unknown>;
      const p = String(rec.path ?? "").trim();
      if (!p) {
        throw new Error("Deck reference must include a path");
      }
      if (opts?.requirePrompt && !p.endsWith("PROMPT.md")) {
        throw new Error(
          `Deck reference must point to PROMPT.md (${basePath})`,
        );
      }
      const normalized: Record<string, unknown> = { ...rec };
      normalized.path = p.startsWith("gambit://")
        ? p
        : path.resolve(path.dirname(basePath), p);
      if (typeof rec.description !== "string") delete normalized.description;
      if (typeof rec.label !== "string") delete normalized.label;
      if (typeof rec.id !== "string") delete normalized.id;
      if (opts?.requireDescription) {
        const desc = typeof rec.description === "string"
          ? rec.description.trim()
          : "";
        if (!desc) {
          throw new Error(
            `Action deck must include a description (${basePath})`,
          );
        }
      }
      return normalized as T;
    });
}

function mergeDeckRefs<T extends DeckRef>(
  ...lists: Array<ReadonlyArray<T>>
): Array<T> {
  const merged = new Map<string, T>();
  for (const list of lists) {
    for (const entry of list) {
      if (!entry?.path) continue;
      if (!merged.has(entry.path)) {
        merged.set(entry.path, entry);
      }
    }
  }
  return Array.from(merged.values());
}

function normalizeActionDecks(
  entries: unknown,
  basePath: string,
  opts?: { requirePrompt?: boolean; requireDescription?: boolean },
): Array<ActionDeckDefinition> {
  return normalizeDeckRefs<ActionDeckDefinition>(entries, basePath, opts).map(
    (entry) => {
      const name = "name" in entry ? String(entry.name ?? "").trim() : "";
      if (!name) {
        throw new Error(`Action deck must include a name (${basePath})`);
      }
      return { ...entry, name };
    },
  );
}

async function expandEmbedsInBody(args: {
  body: string;
  resolvedPath: string;
  stack: Array<string>;
}): Promise<{
  body: string;
  embeds: Array<LoadedCard>;
  respond: boolean;
  initHint: boolean;
  endHint: boolean;
}> {
  const { body, resolvedPath, stack } = args;
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  const embeds: Array<LoadedCard> = [];
  let respond = false;
  let initHint = false;
  let endHint = false;
  let out = "";
  let lastIndex = 0;

  for (const match of body.matchAll(regex)) {
    const matchIndex = match.index ?? 0;
    const target = match[1];
    out += body.slice(lastIndex, matchIndex);
    if (target === RESPOND_MARKER) {
      warnLegacyMarker("respond", "gambit://snippets/respond.md");
      respond = true;
      out += RESPOND_TEXT;
    } else if (target === INIT_MARKER) {
      warnLegacyMarker("init", "gambit://snippets/context.md");
      initHint = true;
      out += INIT_TEXT;
    } else if (target === END_MARKER) {
      warnLegacyMarker("end", "gambit://snippets/end.md");
      endHint = true;
      out += END_TEXT;
    } else {
      const card = await loadCard(target, resolvedPath, stack);
      embeds.push(card);
      if (card.body) out += card.body;
    }
    lastIndex = matchIndex + match[0].length;
  }

  out += body.slice(lastIndex);

  return { body: out, embeds, respond, initHint, endHint };
}

export async function loadMarkdownCard(
  filePath: string,
  parentPath?: string,
  stack: Array<string> = [],
): Promise<LoadedCard> {
  const resolved = parentPath
    ? path.resolve(path.dirname(parentPath), filePath)
    : path.resolve(filePath);
  if (stack.includes(resolved)) {
    throw new Error(
      `Card/embed cycle detected: ${[...stack, resolved].join(" -> ")}`,
    );
  }
  const nextStack = [...stack, resolved];
  const raw = await Deno.readTextFile(resolved);
  let attrs: ParsedFrontmatter;
  let body: string;
  try {
    const parsed = extract(raw) as { attrs: ParsedFrontmatter; body: string };
    attrs = parsed.attrs;
    body = parsed.body;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse front matter in ${resolved}: ${message}`);
  }
  const candidate = attrs as unknown;
  if (isCardDefinition(candidate)) {
    // treat attrs as ts-shaped card
  }
  if ((candidate as { handlers?: unknown }).handlers) {
    throw new Error(
      `Card at ${resolved} cannot declare handlers (deck-only)`,
    );
  }
  const hasNewActionField = (attrs as { actionDecks?: unknown }).actionDecks;
  const legacyActions = (attrs as { actions?: unknown }).actions;
  const actionDecks = normalizeActionDecks(
    hasNewActionField ?? legacyActions,
    resolved,
  );
  if (!hasNewActionField && legacyActions) {
    logger.warn(
      `[gambit] card at ${resolved} uses deprecated "actions"; rename to "actionDecks"`,
    );
  }
  actionDecks.forEach((a) => {
    if (
      a.name.startsWith(RESERVED_TOOL_PREFIX) &&
      !BUILTIN_TOOL_NAME_SET.has(a.name)
    ) {
      throw new Error(`Action name ${a.name} is reserved`);
    }
    if (
      !TOOL_NAME_PATTERN.test(a.name) || a.name.length > MAX_TOOL_NAME_LENGTH
    ) {
      throw new Error(
        `Action name ${a.name} must match ${TOOL_NAME_PATTERN} and be <= ${MAX_TOOL_NAME_LENGTH} characters`,
      );
    }
  });
  const legacyInputSchema = (attrs as { inputSchema?: unknown }).inputSchema;
  const legacyOutputSchema = (attrs as { outputSchema?: unknown }).outputSchema;
  const contextFragment = await maybeLoadSchema(
    (attrs as { contextFragment?: unknown }).contextFragment ??
      legacyInputSchema,
    resolved,
  );
  const responseFragment = await maybeLoadSchema(
    (attrs as { responseFragment?: unknown }).responseFragment ??
      legacyOutputSchema,
    resolved,
  );
  if (legacyInputSchema !== undefined) {
    warnLegacyFragment(resolved, "inputSchema", "contextFragment");
  }
  if (legacyOutputSchema !== undefined) {
    warnLegacyFragment(resolved, "outputSchema", "responseFragment");
  }
  const replaced = await expandEmbedsInBody({
    body,
    resolvedPath: resolved,
    stack: nextStack,
  });
  const cleanedBody = replaced.body;
  const embeddedCards = replaced.embeds;
  const respondFlag = Boolean((attrs as { respond?: unknown }).respond);
  const allowEndFlag = Boolean((attrs as { allowEnd?: unknown }).allowEnd);

  return {
    kind: "gambit.card",
    path: resolved,
    body: cleanedBody.trim(),
    allowEnd: allowEndFlag || replaced.endHint,
    actionDecks,
    actions: actionDecks,
    testDecks: normalizeDeckRefs<TestDeckDefinition>(
      (attrs as { testDecks?: unknown }).testDecks,
      resolved,
    ),
    graderDecks: normalizeDeckRefs<GraderDeckDefinition>(
      (attrs as { graderDecks?: unknown }).graderDecks,
      resolved,
    ),
    cards: embeddedCards,
    contextFragment,
    responseFragment,
    inputFragment: contextFragment,
    outputFragment: responseFragment,
    respond: respondFlag || replaced.respond,
  };
}

export async function loadMarkdownDeck(
  filePath: string,
  parentPath?: string,
): Promise<LoadedDeck> {
  const resolved = parentPath
    ? path.resolve(path.dirname(parentPath), filePath)
    : path.resolve(filePath);
  const raw = await Deno.readTextFile(resolved);
  let attrs: ParsedFrontmatter;
  let body: string;
  try {
    const parsed = extract(raw) as { attrs: ParsedFrontmatter; body: string };
    attrs = parsed.attrs;
    body = parsed.body;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse front matter in ${resolved}: ${message}`);
  }
  const deckAttrs = attrs as { deck?: DeckDefinition } & DeckDefinition;
  const deckMeta: Partial<DeckDefinition> =
    (deckAttrs.deck ?? deckAttrs) as DeckDefinition;

  const hasNewActionDecks = (deckMeta as {
    actionDecks?: unknown;
  }).actionDecks;
  const canonicalActions = (deckMeta as { actions?: unknown }).actions;
  const actionDecks = normalizeActionDecks(canonicalActions, resolved, {
    requirePrompt: true,
    requireDescription: true,
  });
  const legacyActionDecks = normalizeActionDecks(hasNewActionDecks, resolved);
  if (hasNewActionDecks) {
    logger.warn(
      `[gambit] deck at ${resolved} uses deprecated "actionDecks"; use "[[actions]]" instead.`,
    );
  }
  if ((deckMeta as { testDecks?: unknown }).testDecks) {
    logger.warn(
      `[gambit] deck at ${resolved} uses deprecated "testDecks"; use "[[scenarios]]" instead.`,
    );
  }
  if ((deckMeta as { graderDecks?: unknown }).graderDecks) {
    logger.warn(
      `[gambit] deck at ${resolved} uses deprecated "graderDecks"; use "[[graders]]" instead.`,
    );
  }
  const scenarioDecks = normalizeDeckRefs<TestDeckDefinition>(
    (deckMeta as { scenarios?: unknown }).scenarios,
    resolved,
    { requirePrompt: true },
  );
  const graderDecks = normalizeDeckRefs<GraderDeckDefinition>(
    (deckMeta as { graders?: unknown }).graders,
    resolved,
    { requirePrompt: true },
  );
  const allActionDecks = [...actionDecks, ...legacyActionDecks];
  allActionDecks.forEach((a) => {
    if (
      a.name.startsWith(RESERVED_TOOL_PREFIX) &&
      !BUILTIN_TOOL_NAME_SET.has(a.name)
    ) {
      throw new Error(`Action name ${a.name} is reserved`);
    }
    if (
      !TOOL_NAME_PATTERN.test(a.name) || a.name.length > MAX_TOOL_NAME_LENGTH
    ) {
      throw new Error(
        `Action name ${a.name} must match ${TOOL_NAME_PATTERN} and be <= ${MAX_TOOL_NAME_LENGTH} characters`,
      );
    }
  });

  const replaced = await expandEmbedsInBody({
    body,
    resolvedPath: resolved,
    stack: [resolved],
  });
  const cards = replaced.embeds;

  const legacyInputSchema = (deckMeta as { inputSchema?: unknown }).inputSchema;
  const legacyOutputSchema =
    (deckMeta as { outputSchema?: unknown }).outputSchema;
  const contextSchema = await maybeLoadSchema(
    (deckMeta as { contextSchema?: unknown }).contextSchema ??
      legacyInputSchema,
    resolved,
  );
  const responseSchema = await maybeLoadSchema(
    (deckMeta as { responseSchema?: unknown }).responseSchema ??
      legacyOutputSchema,
    resolved,
  );
  if (legacyInputSchema !== undefined) {
    warnLegacySchema(resolved, "inputSchema", "contextSchema");
  }
  if (legacyOutputSchema !== undefined) {
    warnLegacySchema(resolved, "outputSchema", "responseSchema");
  }

  const executePath = (deckMeta as { execute?: unknown }).execute;
  let executor: DeckDefinition["run"] | DeckDefinition["execute"] | undefined;
  let executeContextSchema: ZodTypeAny | undefined;
  let executeResponseSchema: ZodTypeAny | undefined;
  if (typeof executePath === "string" && executePath.trim()) {
    const execResolved = path.resolve(path.dirname(resolved), executePath);
    const mod = await import(toFileUrl(execResolved));
    const executeDeck = mod.default;
    if (!isDeckDefinition(executeDeck)) {
      throw new Error(
        `Execute module at ${execResolved} did not export a valid deck definition`,
      );
    }
    executor = typeof executeDeck.run === "function"
      ? executeDeck.run
      : typeof executeDeck.execute === "function"
      ? executeDeck.execute
      : undefined;
    if (!executor) {
      throw new Error(
        `Execute module at ${execResolved} must export a deck with run(ctx)`,
      );
    }
    executeContextSchema = executeDeck.contextSchema ?? executeDeck.inputSchema;
    executeResponseSchema = executeDeck.responseSchema ??
      executeDeck.outputSchema;
  }
  if (executor && deckMeta.modelParams) {
    logger.warn(
      `[gambit] deck at ${resolved} sets execute + modelParams; modelParams will be ignored.`,
    );
  }

  if (
    contextSchema && executeContextSchema &&
    !schemasMatchDeep(contextSchema, executeContextSchema)
  ) {
    logger.warn(
      `[gambit] deck at ${resolved} has mismatched contextSchema between PROMPT.md and execute module (pre-1.0: warn; 1.0+: error)`,
    );
  }
  if (
    responseSchema && executeResponseSchema &&
    !schemasMatchDeep(responseSchema, executeResponseSchema)
  ) {
    logger.warn(
      `[gambit] deck at ${resolved} has mismatched responseSchema between PROMPT.md and execute module (pre-1.0: warn; 1.0+: error)`,
    );
  }

  const allCards = flattenCards(cards);
  const cleanedBody = replaced.body;
  const allowEnd = Boolean(deckMeta.allowEnd) ||
    replaced.endHint ||
    allCards.some((c) => c.allowEnd);

  const mergedActions: Record<string, ActionDeckDefinition> = {};
  for (const card of allCards) {
    for (const action of card.actionDecks ?? []) {
      mergedActions[action.name] = action;
    }
  }
  for (const action of allActionDecks) {
    mergedActions[action.name] = action;
  }

  let mergedContextSchema = contextSchema ?? executeContextSchema;
  let mergedResponseSchema = responseSchema ?? executeResponseSchema;
  for (const card of allCards) {
    mergedContextSchema = mergeZodObjects(
      mergedContextSchema,
      card.contextFragment,
    );
    mergedResponseSchema = mergeZodObjects(
      mergedResponseSchema,
      card.responseFragment,
    );
  }
  const mergedInputSchema = mergedContextSchema;
  const mergedOutputSchema = mergedResponseSchema;

  const normalizeHandler = <
    T extends { path: string; repeatMs?: number; intervalMs?: number },
  >(
    cfg: T | undefined,
    kind: "onBusy" | "onIdle" | "onInterval",
  ) => {
    if (!cfg) return undefined;
    const repeatMs = cfg.repeatMs ?? cfg.intervalMs;
    if (cfg.intervalMs !== undefined && cfg.repeatMs === undefined) {
      logger.warn(
        `[gambit] handlers.${kind}.intervalMs is deprecated; use repeatMs (${resolved})`,
      );
    }
    return {
      ...cfg,
      repeatMs,
      path: path.resolve(path.dirname(resolved), cfg.path),
    };
  };

  const intervalAlias = deckMeta.handlers?.onInterval;
  const onBusy = normalizeHandler(
    deckMeta.handlers?.onBusy ?? intervalAlias,
    intervalAlias ? "onInterval" : "onBusy",
  );
  if (!deckMeta.handlers?.onBusy && intervalAlias) {
    logger.warn(
      `[gambit] handlers.onInterval is deprecated; use handlers.onBusy (${resolved})`,
    );
  }
  const onIdle = normalizeHandler(deckMeta.handlers?.onIdle, "onIdle");

  const handlers = deckMeta.handlers
    ? {
      onError: deckMeta.handlers.onError
        ? {
          ...deckMeta.handlers.onError,
          path: path.resolve(
            path.dirname(resolved),
            deckMeta.handlers.onError.path,
          ),
        }
        : undefined,
      onBusy,
      onIdle,
    }
    : undefined;

  const mergedActionDecks = Object.values(mergedActions);
  const rootTestDecks = normalizeDeckRefs<TestDeckDefinition>(
    (deckMeta as { testDecks?: unknown }).testDecks,
    resolved,
  );
  const rootGraderDecks = normalizeDeckRefs<GraderDeckDefinition>(
    (deckMeta as { graderDecks?: unknown }).graderDecks,
    resolved,
  );
  const embeddedTestDecks = allCards.flatMap((card) => card.testDecks ?? []);
  const embeddedGraderDecks = allCards.flatMap((card) =>
    card.graderDecks ?? []
  );

  return {
    kind: "gambit.deck",
    path: resolved,
    body: cleanedBody.trim(),
    allowEnd,
    actionDecks: mergedActionDecks,
    actions: mergedActionDecks,
    testDecks: mergeDeckRefs(
      scenarioDecks,
      rootTestDecks,
      embeddedTestDecks,
    ),
    graderDecks: mergeDeckRefs(
      graderDecks,
      rootGraderDecks,
      embeddedGraderDecks,
    ),
    cards: allCards,
    label: deckMeta.label,
    startMode: deckMeta.startMode,
    modelParams: executor ? undefined : deckMeta.modelParams,
    guardrails: deckMeta.guardrails,
    contextSchema: mergedContextSchema,
    responseSchema: mergedResponseSchema,
    inputSchema: mergedInputSchema,
    outputSchema: mergedOutputSchema,
    executor,
    handlers,
    respond: Boolean(deckMeta.respond) ||
      replaced.respond ||
      allCards.some((c) => c.respond),
    inlineEmbeds: true,
  };
}

export function isMarkdownFile(filePath: string): boolean {
  return filePath.endsWith(".md");
}

function flattenCards(cards: Array<LoadedCard>): Array<LoadedCard> {
  const flat: Array<LoadedCard> = [];
  for (const card of cards) {
    flat.push(card);
    const nested = (card as { cards?: Array<LoadedCard> }).cards ?? [];
    if (nested.length) flat.push(...flattenCards(nested));
  }
  return flat;
}
