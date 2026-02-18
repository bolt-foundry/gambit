import { assertEquals } from "@std/assert";
import * as path from "@std/path";
import { defaultSessionRoot } from "./cli_utils.ts";

Deno.test("defaultSessionRoot uses project root when available", () => {
  const root = path.resolve("/tmp/project");
  const deckPath = path.join(root, "apps", "foo", "PROMPT.md");
  const actual = defaultSessionRoot(deckPath);
  assertEquals(actual, path.join(root, "apps", "foo", ".gambit", "workspaces"));
});

Deno.test("defaultSessionRoot anchors restored artifact decks to workspace root", () => {
  const workspaceRoot = path.resolve("/tmp/woo/.gambit/workspaces");
  const deckPath = path.join(
    workspaceRoot,
    "a337dcb7-6d06-4b01-adb9-7154366d1ba1",
    "deck",
    "apps",
    "boltfoundry-com",
    "gambit",
    "faq",
    "decks",
    "PROMPT.md",
  );
  const actual = defaultSessionRoot(deckPath);
  assertEquals(actual, workspaceRoot);
});
