import { assert, assertEquals } from "@std/assert";
import * as path from "@std/path";
import {
  canReadPath,
  canRunCommand,
  canRunPath,
  normalizePermissionDeclaration,
  normalizePermissionDeclarationToSet,
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

Deno.test("run object-form booleans honor all-access semantics", () => {
  const pathsTrue = normalizePermissionDeclarationToSet(
    { run: { paths: true } },
    "/workspace",
  );
  assert(pathsTrue, "expected normalized permission set for paths=true");
  assertEquals(canRunPath(pathsTrue, "/workspace/bin/anything"), true);
  assertEquals(canRunCommand(pathsTrue, "anything"), true);

  const commandsTrue = normalizePermissionDeclarationToSet(
    { run: { commands: true } },
    "/workspace",
  );
  assert(commandsTrue, "expected normalized permission set for commands=true");
  assertEquals(canRunPath(commandsTrue, "/workspace/bin/anything"), true);
  assertEquals(canRunCommand(commandsTrue, "anything"), true);
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
