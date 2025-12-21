import { extract } from "@std/front-matter/any";
import * as path from "@std/path";
import type { ModelMessage, ModelProvider } from "./types.ts";

export const TEST_BOT_DEFAULT_PATH = path.resolve(
  Deno.cwd(),
  ".gambit",
  "test-bot.md",
);
const TEST_BOT_SCHEMA_FILENAME = "test-bot.input.zod.ts";
const TEST_BOT_SCHEMA_DEFAULT_PATH = path.resolve(
  Deno.cwd(),
  ".gambit",
  TEST_BOT_SCHEMA_FILENAME,
);
const DEFAULT_TEST_BOT_SCHEMA = `import { z } from "zod";

export default z.object({
  scenario: z.string().min(1).default(
    "Happy-path QA scenario: user chats through a simple request and the assistant responds clearly.",
  ).describe(
    "Scenario the QA bot should run (goal, user intent, constraints, or edge cases to probe).",
  ),
}).passthrough().describe("Test Bot scenario input");
`;

export const DEFAULT_TEST_BOT = `+++
model = "gpt-4o"
temperature = 0.2
maxTurns = 20
inputSchema = "./${TEST_BOT_SCHEMA_FILENAME}"
+++

You are a demanding QA user who probes the assistant for gaps, edge cases, and correctness.
Ask concise, natural questions and follow-ups.
Provide only the next user turn as plain text.`;

export type TestBotConfig = {
  model: string;
  temperature: number;
  maxTurns: number;
  input?: unknown;
  inputSchemaPath?: string;
  body: string;
  attrs: Record<string, unknown>;
  content: string;
  path: string;
};

function ensureDir(dir: string) {
  try {
    Deno.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
}

export function sanitizeNumber(
  value: unknown,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function loadTestBotConfig(
  opts: { path?: string; autoCreate?: boolean } = {},
): TestBotConfig {
  const filePath = opts.path ? path.resolve(opts.path) : TEST_BOT_DEFAULT_PATH;

  if (opts.autoCreate) {
    try {
      ensureDir(path.dirname(filePath));
      Deno.statSync(filePath);
    } catch {
      try {
        ensureDir(path.dirname(filePath));
        Deno.writeTextFileSync(filePath, DEFAULT_TEST_BOT);
      } catch {
        // ignore write failures; fall through to parsing defaults
      }
    }
    // Ensure default input schema exists for scenario input.
    try {
      ensureDir(path.dirname(TEST_BOT_SCHEMA_DEFAULT_PATH));
      Deno.statSync(TEST_BOT_SCHEMA_DEFAULT_PATH);
    } catch {
      try {
        ensureDir(path.dirname(TEST_BOT_SCHEMA_DEFAULT_PATH));
        Deno.writeTextFileSync(
          TEST_BOT_SCHEMA_DEFAULT_PATH,
          DEFAULT_TEST_BOT_SCHEMA,
        );
      } catch {
        // ignore
      }
    }
  }

  let raw: string;
  try {
    raw = Deno.readTextFileSync(filePath);
  } catch {
    raw = DEFAULT_TEST_BOT;
  }

  let attrs: Record<string, unknown> = {};
  let body = raw;
  try {
    const parsed = extract(raw) as {
      attrs?: Record<string, unknown>;
      body?: string;
    };
    attrs = parsed?.attrs ?? {};
    body = parsed?.body ?? raw;
  } catch {
    body = raw;
  }

  const model = typeof attrs.model === "string" && attrs.model
    ? attrs.model
    : "gpt-4o";
  const temperature = sanitizeNumber(attrs.temperature, 0.2, {
    min: 0,
    max: 2,
  });
  const maxTurns = sanitizeNumber(attrs.maxTurns, 20, { min: 1, max: 200 });
  const input = attrs.input;
  const inputSchemaPath = typeof attrs.inputSchema === "string"
    ? attrs.inputSchema
    : undefined;

  return {
    model,
    temperature,
    maxTurns,
    input,
    inputSchemaPath,
    body,
    attrs,
    content: raw,
    path: filePath,
  };
}

export function stringifyContent(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function generateTestBotUserMessage(
  cfg: TestBotConfig,
  history: Array<ModelMessage>,
  modelProvider: ModelProvider,
): Promise<string> {
  const recent = history
    .filter((m) => m && (m.role === "assistant" || m.role === "user"))
    .slice(-8)
    .map((m) => `${m.role.toUpperCase()}: ${stringifyContent(m.content ?? "")}`)
    .join("\n");

  const systemPrompt = [
    "You are a QA test user talking to an assistant. Generate the next user turn.",
    "Persona / goals:",
    cfg.body.trim(),
    "Rules:",
    "- Keep the message concise and natural.",
    "- Return only the user message text. No analysis or role labels.",
  ].join("\n\n");

  const messages: Array<ModelMessage> = [
    { role: "system", content: systemPrompt },
  ];
  if (recent) {
    messages.push({
      role: "user",
      content:
        `Conversation so far:\n${recent}\n\nRespond with the next user message.`,
    });
  } else {
    messages.push({
      role: "user",
      content: "Start the conversation with an opening question or request.",
    });
  }

  const result = await modelProvider.chat({
    model: cfg.model,
    messages,
    stream: false,
  });

  const text = stringifyContent(result.message?.content ?? "");
  return text.trim();
}
