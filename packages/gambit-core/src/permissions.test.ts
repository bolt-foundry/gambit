import { assert, assertEquals, assertThrows } from "@std/assert";
import * as path from "@std/path";
import {
  canReadPath,
  canRunCommand,
  canRunPath,
  canWritePath,
  normalizePermissionDeclaration,
  normalizePermissionDeclarationToSet,
  type PermissionDeclarationInput,
  resolveEffectivePermissions,
} from "./permissions.ts";

Deno.test("permission declaration resolves path grants from owner base dir", () => {
  const base = path.resolve("/tmp/workspace/decks/root");
  const permissions = normalizePermissionDeclaration(
    {
      read: ["../shared/prompts", "./cards"],
      run: { paths: ["./bin/tool.sh"], commands: ["deno"] },
    },
    base,
  );

  assert(permissions, "expected permissions to normalize");
  assertEquals(permissions.read, [
    path.resolve("/tmp/workspace/decks/root/cards"),
    path.resolve("/tmp/workspace/decks/shared/prompts"),
  ]);
  assertEquals(permissions.run, {
    paths: [path.resolve("/tmp/workspace/decks/root/bin/tool.sh")],
    commands: ["deno"],
  });
});

Deno.test("root effective permissions apply workspace then declaration then session", () => {
  const resolved = resolveEffectivePermissions({
    baseDir: "/workspace/root",
    workspace: {
      baseDir: "/workspace",
      permissions: {
        read: ["./decks", "./shared"],
        run: { commands: ["deno", "bash"] },
      },
    },
    declaration: {
      baseDir: "/workspace/decks/root",
      permissions: {
        read: ["../../shared"],
        run: { commands: ["deno"] },
      },
    },
    session: {
      baseDir: "/workspace",
      permissions: {
        read: ["./shared"],
      },
    },
  });

  assertEquals(resolved.trace.effective.read, ["/workspace/shared"]);
  assertEquals(resolved.trace.effective.run, false);
  assertEquals(resolved.trace.layers.map((layer) => layer.name), [
    "host",
    "workspace",
    "declaration",
    "session",
  ]);
});

Deno.test("child permissions are monotonic across parent declaration and reference", () => {
  const parent = resolveEffectivePermissions({
    baseDir: "/workspace/decks/parent",
    workspace: {
      baseDir: "/workspace",
      permissions: {
        read: ["./shared", "./tools"],
        run: { commands: ["deno", "node"] },
      },
    },
    declaration: {
      baseDir: "/workspace/decks/parent",
      permissions: { read: ["../../shared"], run: { commands: ["deno"] } },
    },
  });

  const child = resolveEffectivePermissions({
    baseDir: "/workspace/decks/child",
    parent: parent.effective,
    declaration: {
      baseDir: "/workspace/decks/child",
      permissions: {
        read: ["../../shared", "./private"],
        run: { commands: ["deno", "python"] },
      },
    },
    reference: {
      baseDir: "/workspace/decks/parent",
      permissions: { read: ["../../shared"], run: { commands: ["deno"] } },
    },
  });

  assertEquals(child.trace.effective.read, ["/workspace/shared"]);
  assertEquals(child.trace.effective.run, { paths: [], commands: ["deno"] });
  assertEquals(child.trace.layers.map((layer) => layer.name), [
    "parent",
    "declaration",
    "reference",
  ]);
});

Deno.test("child-only inherited permissions use child baseDir for relative checks", () => {
  const parent = resolveEffectivePermissions({
    baseDir: "/workspace/decks/parent",
    declaration: {
      baseDir: "/workspace/decks/parent",
      permissions: {
        read: ["./local.txt"],
      },
    },
  });

  const child = resolveEffectivePermissions({
    baseDir: "/workspace/decks/child",
    parent: parent.effective,
  });

  assertEquals(
    canReadPath(child.effective, "./local.txt"),
    false,
    "child relative checks must resolve from child baseDir, not parent baseDir",
  );
});

Deno.test("path grants cover descendant files within the directory tree", () => {
  const set = normalizePermissionDeclarationToSet(
    {
      read: ["./shared"],
      write: ["./shared", "./local.txt"],
    },
    "/workspace/decks/root",
  );
  assert(set, "expected normalized permission set");

  assertEquals(
    canReadPath(set, "./shared/prompts/prompt.txt"),
    true,
    "read grants must apply to files beneath a declared directory",
  );
  assertEquals(
    canReadPath(set, "./shared"),
    true,
    "read grants must apply to the directory itself",
  );
  assertEquals(
    canReadPath(set, "./other/path.txt"),
    false,
    "read grants must not leak into sibling directories",
  );
  assertEquals(
    canWritePath(set, "./shared/prompts/prompt.txt"),
    true,
    "write grants must apply to files beneath a declared directory",
  );
  assertEquals(
    canWritePath(set, "./local.txt"),
    true,
    "write grants must still allow file-specific declarations",
  );
  assertEquals(
    canWritePath(set, "./local.txt.bak"),
    false,
    "write grants must not allow unrelated files",
  );
});

Deno.test("canonical read checks deny symlink escapes outside granted roots", async () => {
  const dir = await Deno.makeTempDir();
  const allowedDir = path.join(dir, "allowed");
  const outsideDir = path.join(dir, "outside");
  await Deno.mkdir(allowedDir, { recursive: true });
  await Deno.mkdir(outsideDir, { recursive: true });

  const outsideFile = path.join(outsideDir, "secret.txt");
  await Deno.writeTextFile(outsideFile, "secret");

  const symlinkPath = path.join(allowedDir, "secret-link.txt");
  await Deno.symlink(outsideFile, symlinkPath);

  const set = normalizePermissionDeclarationToSet(
    { read: ["./allowed"] },
    dir,
  );
  assert(set, "expected normalized permission set");

  assertEquals(
    canReadPath(set, symlinkPath),
    false,
    "symlink traversal must not bypass read root",
  );
});

Deno.test("canonical write checks deny symlink parent escapes", async () => {
  const dir = await Deno.makeTempDir();
  const allowedDir = path.join(dir, "allowed");
  const outsideDir = path.join(dir, "outside");
  await Deno.mkdir(allowedDir, { recursive: true });
  await Deno.mkdir(outsideDir, { recursive: true });

  const symlinkDir = path.join(allowedDir, "linked");
  await Deno.symlink(outsideDir, symlinkDir);

  const set = normalizePermissionDeclarationToSet(
    { write: ["./allowed"] },
    dir,
  );
  assert(set, "expected normalized permission set");

  assertEquals(
    canWritePath(set, path.join(symlinkDir, "escaped.txt")),
    false,
    "symlink traversal must not bypass write root",
  );
  assertEquals(
    canWritePath(set, path.join(allowedDir, "safe.txt")),
    true,
    "writes inside granted root should remain allowed",
  );
});

Deno.test("run grants keep path vs command semantics separate", () => {
  const set = normalizePermissionDeclarationToSet(
    {
      run: {
        paths: ["./bin/tool"],
        commands: ["tool"],
      },
    },
    "/workspace",
  );
  assert(set, "expected normalized permission set");

  assertEquals(canRunPath(set, "/workspace/bin/tool"), true);
  assertEquals(canRunPath(set, "/other/tool"), false);
  assertEquals(canRunCommand(set, "tool"), true);
  assertEquals(canRunCommand(set, "bin/tool"), false);
});

Deno.test("run=true grants all run access", () => {
  const runAll = normalizePermissionDeclarationToSet(
    { run: true },
    "/workspace",
  );
  assert(runAll, "expected normalized permission set for run=true");
  assertEquals(canRunPath(runAll, "/workspace/bin/anything"), true);
  assertEquals(canRunCommand(runAll, "anything"), true);
});

Deno.test("run object-form booleans are rejected", () => {
  const invalidPaths = {
    run: { paths: true },
  } as unknown as PermissionDeclarationInput;
  const invalidCommands = {
    run: { commands: false },
  } as unknown as PermissionDeclarationInput;
  assertThrows(
    () => normalizePermissionDeclarationToSet(invalidPaths, "/workspace"),
    Error,
    "permissions.run.paths must be an array in object form",
  );
  assertThrows(
    () => normalizePermissionDeclarationToSet(invalidCommands, "/workspace"),
    Error,
    "permissions.run.commands must be an array in object form",
  );
});

Deno.test("unspecified kinds deny by default when a layer is provided", () => {
  const set = normalizePermissionDeclaration(
    { read: ["./one"] },
    "/workspace",
  );
  assert(set, "expected normalized permission declaration");
  assertEquals(set.write, false);
  assertEquals(set.net, false);
  assertEquals(set.env, false);
  assertEquals(set.run, false);
});
