import { assertEquals } from "@std/assert";
import { joinTextParts } from "./text.ts";

Deno.test("joinTextParts preserves exact structured text parts", () => {
  assertEquals(
    joinTextParts([
      "The new coworker lives at ",
      "INTENT.md",
      " and ",
      "PROMPT.md.",
    ]),
    "The new coworker lives at INTENT.md and PROMPT.md.",
  );
  assertEquals(joinTextParts(["already ", "spaced"]), "already spaced");
  assertEquals(
    joinTextParts(["[OpenAI]", "(https://openai.com)", " inter", "national"]),
    "[OpenAI](https://openai.com) international",
  );
});
