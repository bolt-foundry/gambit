import * as path from "@std/path";

/**
 * Deno-native permission kinds supported by Gambit's permission contract.
 */
export const PERMISSION_KINDS = ["read", "write", "run", "net", "env"] as const;
export type PermissionKind = (typeof PERMISSION_KINDS)[number];

export type PathPermissionInput = boolean | Array<string>;
export type RunPermissionInput =
  | boolean
  | Array<string>
  | {
    paths?: Array<string>;
    commands?: Array<string>;
  };

export type PermissionDeclarationInput = Partial<{
  read: PathPermissionInput;
  write: PathPermissionInput;
  run: RunPermissionInput;
  net: PathPermissionInput;
  env: PathPermissionInput;
}>;

export type SerializedRunPermission = false | true | {
  paths: Array<string>;
  commands: Array<string>;
};

export type SerializedPermissionSet = {
  read: false | true | Array<string>;
  write: false | true | Array<string>;
  run: SerializedRunPermission;
  net: false | true | Array<string>;
  env: false | true | Array<string>;
};

export type PermissionDeclaration = SerializedPermissionSet;

type NormalizedScope = {
  all: boolean;
  values: Set<string>;
};

type NormalizedRunScope = {
  all: boolean;
  paths: Set<string>;
  commands: Set<string>;
};

export type NormalizedPermissionSet = {
  baseDir: string;
  read: NormalizedScope;
  write: NormalizedScope;
  run: NormalizedRunScope;
  net: NormalizedScope;
  env: NormalizedScope;
};

export type PermissionLayerName =
  | "parent"
  | "workspace"
  | "declaration"
  | "reference"
  | "session"
  | "host";

export type PermissionLayerTrace = {
  name: PermissionLayerName;
  baseDir: string;
  requested: SerializedPermissionSet;
  effective: SerializedPermissionSet;
};

export type PermissionTrace = {
  baseDir: string;
  effective: SerializedPermissionSet;
  layers: Array<PermissionLayerTrace>;
};

const DENY_SCOPE: NormalizedScope = { all: false, values: new Set<string>() };
const DENY_RUN_SCOPE: NormalizedRunScope = {
  all: false,
  paths: new Set<string>(),
  commands: new Set<string>(),
};

function cloneScope(scope: NormalizedScope): NormalizedScope {
  return {
    all: scope.all,
    values: new Set(scope.values),
  };
}

function cloneRunScope(scope: NormalizedRunScope): NormalizedRunScope {
  return {
    all: scope.all,
    paths: new Set(scope.paths),
    commands: new Set(scope.commands),
  };
}

export function cloneNormalizedPermissions(
  input: NormalizedPermissionSet,
): NormalizedPermissionSet {
  return {
    baseDir: input.baseDir,
    read: cloneScope(input.read),
    write: cloneScope(input.write),
    run: cloneRunScope(input.run),
    net: cloneScope(input.net),
    env: cloneScope(input.env),
  };
}

function normalizeList(
  input: unknown,
  kind: PermissionKind,
  baseDir: string,
  opts?: { resolvePaths?: boolean },
): NormalizedScope {
  if (input === true) return { all: true, values: new Set<string>() };
  if (input === false || input === undefined || input === null) {
    return cloneScope(DENY_SCOPE);
  }
  if (!Array.isArray(input)) {
    throw new Error(`permissions.${kind} must be boolean or array`);
  }
  const values = new Set<string>();
  for (const entry of input) {
    if (typeof entry !== "string") {
      throw new Error(`permissions.${kind} entries must be strings`);
    }
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const normalized = opts?.resolvePaths
      ? path.resolve(baseDir, trimmed)
      : trimmed;
    values.add(normalized);
  }
  return { all: false, values };
}

function normalizeRun(
  input: unknown,
  baseDir: string,
): NormalizedRunScope {
  if (input === true) {
    return {
      all: true,
      paths: new Set<string>(),
      commands: new Set<string>(),
    };
  }
  if (input === false || input === undefined || input === null) {
    return cloneRunScope(DENY_RUN_SCOPE);
  }
  if (Array.isArray(input)) {
    const commands = new Set<string>();
    for (const entry of input) {
      if (typeof entry !== "string") {
        throw new Error("permissions.run entries must be strings");
      }
      const trimmed = entry.trim();
      if (!trimmed) continue;
      commands.add(trimmed);
    }
    return { all: false, paths: new Set<string>(), commands };
  }
  if (typeof input !== "object") {
    throw new Error("permissions.run must be boolean, array, or object");
  }
  const record = input as {
    paths?: unknown;
    commands?: unknown;
  };
  if (typeof record.paths === "boolean") {
    throw new Error(
      "permissions.run.paths must be an array in object form; use permissions.run=true for full run access",
    );
  }
  if (typeof record.commands === "boolean") {
    throw new Error(
      "permissions.run.commands must be an array in object form; use permissions.run=true for full run access",
    );
  }
  const pathsScope = normalizeList(record.paths, "run", baseDir, {
    resolvePaths: true,
  });
  const commandsScope = normalizeList(record.commands, "run", baseDir, {
    resolvePaths: false,
  });
  return {
    all: false,
    paths: pathsScope.values,
    commands: commandsScope.values,
  };
}

function intersectScope(
  a: NormalizedScope,
  b: NormalizedScope,
): NormalizedScope {
  if (a.all) return cloneScope(b);
  if (b.all) return cloneScope(a);
  const values = new Set<string>();
  for (const value of a.values) {
    if (b.values.has(value)) values.add(value);
  }
  return { all: false, values };
}

function intersectRun(
  a: NormalizedRunScope,
  b: NormalizedRunScope,
): NormalizedRunScope {
  if (a.all) return cloneRunScope(b);
  if (b.all) return cloneRunScope(a);

  const paths = new Set<string>();
  for (const value of a.paths) {
    if (b.paths.has(value)) paths.add(value);
  }
  const commands = new Set<string>();
  for (const value of a.commands) {
    if (b.commands.has(value)) commands.add(value);
  }

  return {
    all: false,
    paths,
    commands,
  };
}

/**
 * Returns an allow-all permission set anchored to `baseDir`.
 */
export function allowAllPermissions(baseDir: string): NormalizedPermissionSet {
  return {
    baseDir,
    read: { all: true, values: new Set<string>() },
    write: { all: true, values: new Set<string>() },
    run: { all: true, paths: new Set<string>(), commands: new Set<string>() },
    net: { all: true, values: new Set<string>() },
    env: { all: true, values: new Set<string>() },
  };
}

function normalizePermissionSet(
  input: PermissionDeclarationInput,
  baseDir: string,
): NormalizedPermissionSet {
  return {
    baseDir,
    read: normalizeList(input.read, "read", baseDir, { resolvePaths: true }),
    write: normalizeList(input.write, "write", baseDir, {
      resolvePaths: true,
    }),
    run: normalizeRun(input.run, baseDir),
    net: normalizeList(input.net, "net", baseDir),
    env: normalizeList(input.env, "env", baseDir),
  };
}

/**
 * Normalizes a permission declaration to a serializable, deterministic shape.
 *
 * Relative path grants are resolved against `baseDir`.
 */
export function normalizePermissionDeclaration(
  input: PermissionDeclarationInput | undefined,
  baseDir: string,
): PermissionDeclaration | undefined {
  if (!input) return undefined;
  return serializePermissions(normalizePermissionSet(input, baseDir));
}

/**
 * Normalizes a declaration to the internal set form used during intersection.
 */
export function normalizePermissionDeclarationToSet(
  input: PermissionDeclarationInput | undefined,
  baseDir: string,
): NormalizedPermissionSet | undefined {
  if (!input) return undefined;
  return normalizePermissionSet(input, baseDir);
}

/**
 * Serializes an internal normalized permission set for traces/persistence.
 */
export function serializePermissions(
  set: NormalizedPermissionSet,
): SerializedPermissionSet {
  const serializeScope = (
    scope: NormalizedScope,
  ): false | true | Array<string> => {
    if (scope.all) return true;
    if (scope.values.size === 0) return false;
    return Array.from(scope.values).sort();
  };

  const serializeRunScope = (
    scope: NormalizedRunScope,
  ): SerializedRunPermission => {
    if (scope.all) return true;
    if (scope.paths.size === 0 && scope.commands.size === 0) {
      return false;
    }
    return {
      paths: Array.from(scope.paths).sort(),
      commands: Array.from(scope.commands).sort(),
    };
  };

  return {
    read: serializeScope(set.read),
    write: serializeScope(set.write),
    run: serializeRunScope(set.run),
    net: serializeScope(set.net),
    env: serializeScope(set.env),
  };
}

/**
 * Computes the monotonic intersection between two permission sets.
 *
 * `baseDir` controls how relative checks (`canReadPath`/etc) are evaluated for
 * the returned set.
 */
export function intersectPermissions(
  parent: NormalizedPermissionSet,
  next: NormalizedPermissionSet,
  baseDir: string,
): NormalizedPermissionSet {
  return {
    baseDir,
    read: intersectScope(parent.read, next.read),
    write: intersectScope(parent.write, next.write),
    run: intersectRun(parent.run, next.run),
    net: intersectScope(parent.net, next.net),
    env: intersectScope(parent.env, next.env),
  };
}

/**
 * Resolves effective permissions and emits a layer-by-layer permission trace.
 *
 * Layer precedence:
 * 1. `parent` (or host allow-all for roots)
 * 2. `workspace` (root only)
 * 3. `declaration` (deck/card declaration)
 * 4. `reference` (parent reference override)
 * 5. `session` (root only)
 */
export function resolveEffectivePermissions(args: {
  baseDir: string;
  parent?: NormalizedPermissionSet;
  workspace?: { baseDir: string; permissions: PermissionDeclarationInput };
  declaration?: { baseDir: string; permissions: PermissionDeclarationInput };
  reference?: { baseDir: string; permissions: PermissionDeclarationInput };
  session?: { baseDir: string; permissions: PermissionDeclarationInput };
}): {
  effective: NormalizedPermissionSet;
  trace: PermissionTrace;
} {
  const layers: Array<PermissionLayerTrace> = [];
  let effective = args.parent
    ? {
      ...cloneNormalizedPermissions(args.parent),
      // Rebase relative-path checks to the current invocation scope.
      baseDir: args.baseDir,
    }
    : allowAllPermissions(args.baseDir);

  if (args.parent) {
    layers.push({
      name: "parent",
      baseDir: args.parent.baseDir,
      requested: serializePermissions(args.parent),
      effective: serializePermissions(effective),
    });
  } else {
    layers.push({
      name: "host",
      baseDir: args.baseDir,
      requested: serializePermissions(effective),
      effective: serializePermissions(effective),
    });
  }

  const applyLayer = (
    name: PermissionLayerName,
    input:
      | { baseDir: string; permissions: PermissionDeclarationInput }
      | undefined,
  ) => {
    if (!input) return;
    const requested = normalizePermissionSet(input.permissions, input.baseDir);
    effective = intersectPermissions(effective, requested, args.baseDir);
    layers.push({
      name,
      baseDir: input.baseDir,
      requested: serializePermissions(requested),
      effective: serializePermissions(effective),
    });
  };

  if (!args.parent) {
    applyLayer("workspace", args.workspace);
  }
  applyLayer("declaration", args.declaration);
  applyLayer("reference", args.reference);
  if (!args.parent) {
    applyLayer("session", args.session);
  }

  return {
    effective,
    trace: {
      baseDir: args.baseDir,
      effective: serializePermissions(effective),
      layers,
    },
  };
}

/**
 * Checks whether `target` is covered by `scope`, treating each value as either
 * an exact path grant or the root of an allowed directory tree.
 */
function matchScope(scope: NormalizedScope, target: string): boolean {
  if (scope.all) return true;
  const canonicalTarget = canonicalizePath(target);
  if (!canonicalTarget) return false;

  for (const root of scope.values) {
    const canonicalRoot = canonicalizePath(root);
    if (!canonicalRoot) continue;
    if (pathWithinRoot(canonicalRoot, canonicalTarget)) return true;
  }
  return false;
}

function pathWithinRoot(root: string, target: string): boolean {
  if (root === target) return true;
  const rel = path.relative(root, target);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function canonicalizePath(target: string): string | undefined {
  const resolved = path.resolve(target);
  try {
    return path.resolve(Deno.realPathSync(resolved));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return canonicalizeMissingPath(resolved);
    }
    return undefined;
  }
}

function canonicalizeMissingPath(target: string): string | undefined {
  const suffix: Array<string> = [];
  let probe = target;

  while (true) {
    try {
      const canonicalBase = path.resolve(Deno.realPathSync(probe));
      if (suffix.length === 0) return canonicalBase;
      return path.resolve(canonicalBase, ...suffix.reverse());
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        const parent = path.dirname(probe);
        if (parent === probe) return undefined;
        suffix.push(path.basename(probe));
        probe = parent;
        continue;
      }
      return undefined;
    }
  }
}

/**
 * Returns whether `targetPath` is readable under `set`.
 *
 * Relative paths are resolved against `set.baseDir`.
 */
export function canReadPath(
  set: NormalizedPermissionSet,
  targetPath: string,
): boolean {
  return matchScope(set.read, path.resolve(set.baseDir, targetPath));
}

/**
 * Returns whether `targetPath` is writable under `set`.
 *
 * Relative paths are resolved against `set.baseDir`.
 */
export function canWritePath(
  set: NormalizedPermissionSet,
  targetPath: string,
): boolean {
  return matchScope(set.write, path.resolve(set.baseDir, targetPath));
}

/**
 * Returns whether `targetPath` is executable via run-path grants.
 *
 * Relative paths are resolved against `set.baseDir`.
 */
export function canRunPath(
  set: NormalizedPermissionSet,
  targetPath: string,
): boolean {
  if (set.run.all) return true;
  const resolvedTarget = path.resolve(set.baseDir, targetPath);
  const canonicalTarget = canonicalizePath(resolvedTarget);
  if (!canonicalTarget) return false;
  // Run-path grants are exact binary grants; deny symlink-mediated execution.
  if (canonicalTarget !== resolvedTarget) return false;
  for (const allowedPath of set.run.paths) {
    const resolvedAllowed = path.resolve(set.baseDir, allowedPath);
    if (resolvedAllowed !== resolvedTarget) continue;
    const canonicalAllowed = canonicalizePath(
      resolvedAllowed,
    );
    if (!canonicalAllowed) continue;
    if (canonicalAllowed !== resolvedAllowed) continue;
    if (canonicalAllowed === canonicalTarget) return true;
  }
  return false;
}

/**
 * Returns whether `commandName` is executable via run-command grants.
 *
 * This check intentionally does not apply basename/path fallback semantics.
 */
export function canRunCommand(
  set: NormalizedPermissionSet,
  commandName: string,
): boolean {
  if (set.run.all) return true;
  return set.run.commands.has(commandName);
}
