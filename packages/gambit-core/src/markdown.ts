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
import { isCardDefinition } from "./definitions.ts";
import { loadCard } from "./loader.ts";
import {
  normalizePermissionDeclaration,
  type PermissionDeclarationInput,
} from "./permissions.ts";
import { mergeZodObjects } from "./schema.ts";
import { resolveBuiltinSchemaPath } from "./builtins.ts";
import type {
  ActionDeckDefinition,
  DeckDefinition,
  ExternalToolDefinition,
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

function startsWithFrontMatterDelimiter(raw: string): boolean {
  const normalized = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const trimmed = normalized.trimStart();
  return /^(\+\+\+|---)\s*(\r?\n|$)/.test(trimmed);
}

function parseFrontMatterOrRaw(
  raw: string,
  resolvedPath: string,
): { attrs: ParsedFrontmatter; body: string } {
  try {
    return extract(raw) as { attrs: ParsedFrontmatter; body: string };
  } catch (err) {
    if (!startsWithFrontMatterDelimiter(raw)) {
      return { attrs: {}, body: raw };
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse front matter in ${resolvedPath}: ${message}`,
    );
  }
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
  permissions?: PermissionDeclarationInput;
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
      if (rec.permissions !== undefined) {
        const parsed = normalizePermissionDeclaration(
          rec.permissions as PermissionDeclarationInput,
          path.dirname(basePath),
        );
        if (parsed) normalized.permissions = parsed;
      }
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

async function normalizeActionDecks(
  entries: unknown,
  basePath: string,
  opts?: { requirePrompt?: boolean; requireDescription?: boolean },
): Promise<Array<ActionDeckDefinition>> {
  if (!Array.isArray(entries)) return [];
  const out: Array<ActionDeckDefinition> = [];
  for (const rawEntry of entries) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const rec = rawEntry as Record<string, unknown>;
    const name = String(rec.name ?? "").trim();
    if (!name) {
      throw new Error(`Action deck must include a name (${basePath})`);
    }

    const desc = typeof rec.description === "string"
      ? rec.description.trim()
      : "";
    if (opts?.requireDescription && !desc) {
      throw new Error(
        `Action deck must include a description (${basePath})`,
      );
    }

    const rawPath = typeof rec.path === "string" ? rec.path.trim() : "";
    const rawExecute = typeof rec.execute === "string"
      ? rec.execute.trim()
      : "";
    const hasPath = rawPath.length > 0;
    const hasExecute = rawExecute.length > 0;
    if (hasPath === hasExecute) {
      throw new Error(
        `Action deck must include exactly one of path or execute (${basePath})`,
      );
    }
    if (hasPath && opts?.requirePrompt && !rawPath.endsWith("PROMPT.md")) {
      throw new Error(
        `Deck reference must point to PROMPT.md (${basePath})`,
      );
    }

    const actionContextSchema = await maybeLoadSchema(
      rec.contextSchema,
      basePath,
    );
    const actionResponseSchema = await maybeLoadSchema(
      rec.responseSchema,
      basePath,
    );
    if (hasExecute && (!actionContextSchema || !actionResponseSchema)) {
      throw new Error(
        `Action execute target must include contextSchema and responseSchema (${basePath})`,
      );
    }

    const selectedTarget = hasPath ? rawPath : rawExecute;
    const normalizedPath = selectedTarget.startsWith("gambit://")
      ? selectedTarget
      : path.resolve(path.dirname(basePath), selectedTarget);
    const normalized: ActionDeckDefinition = {
      name,
      path: normalizedPath,
      description: desc || undefined,
      label: typeof rec.label === "string" ? rec.label : undefined,
      id: typeof rec.id === "string" ? rec.id : undefined,
      execute: hasExecute ? normalizedPath : undefined,
      contextSchema: actionContextSchema,
      responseSchema: actionResponseSchema,
    };
    if (rec.permissions !== undefined) {
      const parsed = normalizePermissionDeclaration(
        rec.permissions as PermissionDeclarationInput,
        path.dirname(basePath),
      );
      if (parsed) normalized.permissions = parsed;
    }
    out.push(normalized);
  }
  return out;
}

async function normalizeExternalTools(
  refs: unknown,
  basePath: string,
): Promise<Array<ExternalToolDefinition>> {
  if (!Array.isArray(refs)) return [];
  const out: Array<ExternalToolDefinition> = [];
  for (const entry of refs) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const name = String(rec.name ?? "").trim();
    if (!name) {
      throw new Error(`External tool must include a name (${basePath})`);
    }
    if (name.startsWith(RESERVED_TOOL_PREFIX)) {
      throw new Error(
        `External tool name ${name} is reserved (prefix ${RESERVED_TOOL_PREFIX})`,
      );
    }
    if (
      !TOOL_NAME_PATTERN.test(name) || name.length > MAX_TOOL_NAME_LENGTH
    ) {
      throw new Error(
        `External tool name ${name} must match ${TOOL_NAME_PATTERN} and be <= ${MAX_TOOL_NAME_LENGTH} characters`,
      );
    }
    const inputSchema = await maybeLoadSchema(rec.inputSchema, basePath);
    out.push({
      name,
      description: typeof rec.description === "string"
        ? rec.description
        : undefined,
      inputSchema,
    });
  }
  return out;
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
  const { attrs, body } = parseFrontMatterOrRaw(raw, resolved);
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
  const actionDecks = await normalizeActionDecks(
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
  const permissions = normalizePermissionDeclaration(
    (attrs as { permissions?: PermissionDeclarationInput }).permissions,
    path.dirname(resolved),
  );

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
    permissions,
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
  const { attrs, body } = parseFrontMatterOrRaw(raw, resolved);
  const deckAttrs = attrs as { deck?: DeckDefinition } & DeckDefinition;
  const deckMeta: Partial<DeckDefinition> =
    (deckAttrs.deck ?? deckAttrs) as DeckDefinition;
  if ((deckMeta as { mcpServers?: unknown }).mcpServers !== undefined) {
    throw new Error(
      `Deck-level [[mcpServers]] is unsupported in this phase (${resolved})`,
    );
  }
  if ((deckMeta as { execute?: unknown }).execute !== undefined) {
    throw new Error(
      `Top-level execute in PROMPT.md is unsupported (${resolved})`,
    );
  }

  const hasNewActionDecks = (deckMeta as {
    actionDecks?: unknown;
  }).actionDecks;
  const canonicalActions = (deckMeta as { actions?: unknown }).actions;
  const actionDecks = await normalizeActionDecks(canonicalActions, resolved, {
    requirePrompt: true,
    requireDescription: true,
  });
  const legacyActionDecks = await normalizeActionDecks(
    hasNewActionDecks,
    resolved,
  );
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

  let mergedContextSchema = contextSchema;
  let mergedResponseSchema = responseSchema;
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
  const tools = await normalizeExternalTools(
    (deckMeta as { tools?: unknown }).tools,
    resolved,
  );
  const actionNameSet = new Set(mergedActionDecks.map((action) => action.name));
  for (const tool of tools) {
    if (actionNameSet.has(tool.name)) {
      logger.warn(
        `[gambit] tool ${tool.name} is shadowed by an action in ${resolved}`,
      );
    }
  }
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
  const permissions = normalizePermissionDeclaration(
    deckMeta.permissions,
    path.dirname(resolved),
  );

  return {
    kind: "gambit.deck",
    path: resolved,
    body: cleanedBody.trim(),
    allowEnd,
    actionDecks: mergedActionDecks,
    actions: mergedActionDecks,
    tools,
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
    modelParams: deckMeta.modelParams,
    guardrails: deckMeta.guardrails,
    contextSchema: mergedContextSchema,
    responseSchema: mergedResponseSchema,
    inputSchema: mergedInputSchema,
    outputSchema: mergedOutputSchema,
    executor: undefined,
    handlers,
    respond: Boolean(deckMeta.respond) ||
      replaced.respond ||
      allCards.some((c) => c.respond),
    inlineEmbeds: true,
    permissions,
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
