const CODEX_BIN_ENV = "GAMBIT_CODEX_BIN";

export type CodexLoginStatus = {
  codexLoggedIn: boolean;
  codexLoginStatus: string;
};

export async function readCodexLoginStatus(): Promise<CodexLoginStatus> {
  const codexBin = Deno.env.get(CODEX_BIN_ENV)?.trim() || "codex";
  try {
    const output = await new Deno.Command(codexBin, {
      args: ["login", "status"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout).trim();
    const stderr = new TextDecoder().decode(output.stderr).trim();
    const detail = stdout || stderr || "Unknown login status";
    return {
      codexLoggedIn: output.success,
      codexLoginStatus: detail,
    };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return {
        codexLoggedIn: false,
        codexLoginStatus: "Codex CLI not found in PATH.",
      };
    }
    return {
      codexLoggedIn: false,
      codexLoginStatus: err instanceof Error ? err.message : String(err),
    };
  }
}
