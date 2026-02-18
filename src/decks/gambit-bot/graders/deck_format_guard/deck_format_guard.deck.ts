import { defineDeck } from "jsr:@bolt-foundry/gambit";
import { z } from "npm:zod";

const toolCallSchema = z.object({
  function: z.object({
    name: z.string(),
    arguments: z.string().optional(),
  }),
});

const messageSchema = z.object({
  role: z.string(),
  content: z.any().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
});

const contextSchema = z.object({
  session: z.object({
    messages: z.array(messageSchema).optional(),
  }),
  messageToGrade: z.object({
    role: z.string(),
    content: z.any().optional(),
  }).optional(),
});

const responseSchema = z.object({
  score: z.number().int().min(-3).max(3),
  reason: z.string(),
  evidence: z.array(z.string()).optional(),
});

type WriteCall = {
  path: string;
  contents: string;
};

export default defineDeck({
  label: "deck_format_guard",
  contextSchema,
  responseSchema,
  run(ctx) {
    const messages = ctx.input.session.messages ?? [];
    const writeCalls = collectBotWriteCalls(messages);
    if (writeCalls.length === 0) {
      return {
        score: 0,
        reason: "No bot_write calls found for this turn.",
      };
    }

    const failures: Array<string> = [];

    // We enforce that Gambit Build Assistant should not invent ad-hoc .deck.md DSL files.
    for (const call of writeCalls) {
      if (call.path.endsWith(".deck.md")) {
        failures.push(
          `Wrote ad-hoc deck DSL file: ${call.path} (expected Deck Format v1.0 PROMPT.md workspace structure).`,
        );
      }
    }

    const rootPromptWrites = writeCalls.filter((call) =>
      call.path === "PROMPT.md"
    );
    for (const promptWrite of rootPromptWrites) {
      validateRootPrompt(promptWrite.contents, failures);
    }

    if (failures.length > 0) {
      return {
        score: -3,
        reason: failures[0],
        evidence: failures.slice(0, 5),
      };
    }

    return {
      score: 3,
      reason:
        "Writes are consistent with Deck Format v1.0 guardrails for root deck authoring.",
    };
  },
});

function collectBotWriteCalls(
  messages: Array<z.infer<typeof messageSchema>>,
): Array<WriteCall> {
  const calls: Array<WriteCall> = [];
  for (const msg of messages) {
    if (msg.role !== "assistant" || !msg.tool_calls?.length) continue;
    for (const tool of msg.tool_calls) {
      if (tool.function.name !== "bot_write") continue;
      const rawArgs = tool.function.arguments;
      if (!rawArgs) continue;
      try {
        const parsed = JSON.parse(rawArgs) as {
          path?: unknown;
          contents?: unknown;
        };
        if (
          typeof parsed.path !== "string" || typeof parsed.contents !== "string"
        ) {
          continue;
        }
        calls.push({ path: parsed.path, contents: parsed.contents });
      } catch {
        // Ignore malformed tool args; other validators can catch malformed calls.
      }
    }
  }
  return calls;
}

function validateRootPrompt(contents: string, failures: Array<string>) {
  if (!contents.trimStart().startsWith("+++")) {
    failures.push(
      "PROMPT.md is missing TOML frontmatter (expected leading +++).",
    );
  }

  if (!/\[modelParams\]/.test(contents) || !/model\s*=/.test(contents)) {
    failures.push("PROMPT.md is missing [modelParams].model.");
  }

  if (
    /\[contextSchema\]/.test(contents) || /\[responseSchema\]/.test(contents)
  ) {
    failures.push(
      "PROMPT.md uses inline [contextSchema]/[responseSchema] table blocks; Markdown decks must use schema path strings.",
    );
  }

  const contextSchemaMatch = contents.match(
    /^\s*contextSchema\s*=\s*"([^"]+)"/m,
  );
  if (contextSchemaMatch && !isSchemaPath(contextSchemaMatch[1])) {
    failures.push(
      `PROMPT.md has invalid contextSchema path: ${contextSchemaMatch[1]}.`,
    );
  }

  const responseSchemaMatch = contents.match(
    /^\s*responseSchema\s*=\s*"([^"]+)"/m,
  );
  if (responseSchemaMatch && !isSchemaPath(responseSchemaMatch[1])) {
    failures.push(
      `PROMPT.md has invalid responseSchema path: ${responseSchemaMatch[1]}.`,
    );
  }

  const scenarioPaths = extractDeckRefPaths(contents, "scenarios");
  for (const path of scenarioPaths) {
    if (!path.endsWith("PROMPT.md")) {
      failures.push(`Scenario path must end with PROMPT.md: ${path}`);
    }
  }

  const graderPaths = extractDeckRefPaths(contents, "graders");
  for (const path of graderPaths) {
    if (!path.endsWith("PROMPT.md")) {
      failures.push(`Grader path must end with PROMPT.md: ${path}`);
    }
  }
}

function extractDeckRefPaths(
  contents: string,
  blockName: "scenarios" | "graders",
): Array<string> {
  const lines = contents.split("\n");
  const paths: Array<string> = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== `[[${blockName}]]`) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j].trim();
      if (line.startsWith("[[") || line === "") break;
      const match = line.match(/^path\s*=\s*"([^"]+)"/);
      if (match) {
        paths.push(match[1]);
        break;
      }
    }
  }
  return paths;
}

function isSchemaPath(value: string): boolean {
  return value.endsWith(".zod.ts") || value.startsWith("gambit://schemas/");
}
