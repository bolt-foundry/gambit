export type CodexTurnInput = {
  userText: string;
  threadId?: string;
  systemPrompt?: string;
};

export type CodexTurnOutput = {
  threadId: string;
  assistantText: string;
};

type CodexEvent =
  | { type: "thread.started"; thread_id?: unknown }
  | {
    type: "item.completed";
    item?: { type?: unknown; text?: unknown };
  }
  | { type: string; [key: string]: unknown };

function runCwd(): string {
  const botRoot = Deno.env.get("GAMBIT_BOT_ROOT");
  if (typeof botRoot === "string" && botRoot.trim().length > 0) {
    return botRoot.trim();
  }
  return Deno.cwd();
}

function parseCodexEvents(stdout: string): {
  threadId?: string;
  assistantText?: string;
} {
  let threadId: string | undefined;
  let assistantText: string | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: CodexEvent | null = null;
    try {
      parsed = JSON.parse(trimmed) as CodexEvent;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    if (parsed.type === "thread.started") {
      if (typeof parsed.thread_id === "string" && parsed.thread_id.trim()) {
        threadId = parsed.thread_id.trim();
      }
      continue;
    }
    if (parsed.type === "item.completed") {
      const item = parsed.item;
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      if (rec.type !== "agent_message") continue;
      if (typeof rec.text !== "string") continue;
      const next = rec.text.trim();
      if (next) assistantText = next;
    }
  }

  return { threadId, assistantText };
}

export async function sendCodexTurn(
  input: CodexTurnInput,
): Promise<CodexTurnOutput> {
  const prompt = input.systemPrompt && input.systemPrompt.trim()
    ? `${input.systemPrompt.trim()}\n\n${input.userText}`
    : input.userText;

  const args = input.threadId
    ? [
      "exec",
      "resume",
      "--skip-git-repo-check",
      "--json",
      input.threadId,
      prompt,
    ]
    : ["exec", "--skip-git-repo-check", "--json", prompt];

  const out = await new Deno.Command("codex", {
    args,
    cwd: runCwd(),
    stdout: "piped",
    stderr: "piped",
  }).output();

  const stdout = new TextDecoder().decode(out.stdout);
  const stderr = new TextDecoder().decode(out.stderr);
  if (!out.success) {
    throw new Error(
      `codex exec failed (exit ${out.code}): ${stderr.trim() || stdout.trim()}`,
    );
  }

  const parsed = parseCodexEvents(stdout);
  const threadId = parsed.threadId ?? input.threadId;
  if (!threadId) {
    throw new Error(
      `codex exec succeeded but no thread id found in output: ${stdout.trim()}`,
    );
  }
  return {
    threadId,
    assistantText: parsed.assistantText ?? "",
  };
}
