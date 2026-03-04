const CLAUDE_CODE_BIN_ENV = "GAMBIT_CLAUDE_CODE_BIN";

export type ClaudeCodeLoginStatus = {
  claudeCodeLoggedIn: boolean;
  claudeCodeLoginStatus: string;
};

function parseAuthStatusOutput(stdout: string): {
  loggedIn: boolean;
  detail?: string;
} | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const loggedIn = parsed.loggedIn === true;
    const email = typeof parsed.email === "string" && parsed.email.trim()
      ? parsed.email.trim()
      : undefined;
    if (loggedIn && email) {
      return { loggedIn, detail: `Logged in as ${email}` };
    }
    if (loggedIn) return { loggedIn, detail: "Logged in" };
    return { loggedIn, detail: "Not logged in. Run `claude auth login`." };
  } catch {
    const normalized = trimmed.toLowerCase();
    if (
      normalized.includes("not logged in") || normalized.includes("logged out")
    ) {
      return { loggedIn: false, detail: trimmed };
    }
    if (normalized.includes("logged in")) {
      return { loggedIn: true, detail: trimmed };
    }
    return null;
  }
}

export async function readClaudeCodeLoginStatus(): Promise<
  ClaudeCodeLoginStatus
> {
  const claudeBin = Deno.env.get(CLAUDE_CODE_BIN_ENV)?.trim() || "claude";
  try {
    const output = await new Deno.Command(claudeBin, {
      args: ["auth", "status"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const stderr = new TextDecoder().decode(output.stderr).trim();
    const parsed = parseAuthStatusOutput(stdout) ??
      parseAuthStatusOutput(stderr);
    if (parsed) {
      return {
        claudeCodeLoggedIn: parsed.loggedIn,
        claudeCodeLoginStatus: parsed.detail ?? stdout ?? stderr ??
          "Unknown login status",
      };
    }
    if (!stdout && !stderr) {
      return {
        claudeCodeLoggedIn: false,
        claudeCodeLoginStatus:
          "Unable to determine Claude Code login status. Run `claude auth login`.",
      };
    }
    const detail = stdout || stderr || "Unknown login status";
    const normalized = detail.trim().toLowerCase();
    const looksLoggedOut = normalized.includes("not logged in") ||
      normalized.includes("logged out") ||
      normalized.includes("unauth");
    return {
      claudeCodeLoggedIn: output.success && !looksLoggedOut,
      claudeCodeLoginStatus: detail,
    };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return {
        claudeCodeLoggedIn: false,
        claudeCodeLoginStatus: "Claude Code CLI not found in PATH.",
      };
    }
    return {
      claudeCodeLoggedIn: false,
      claudeCodeLoginStatus: err instanceof Error ? err.message : String(err),
    };
  }
}
