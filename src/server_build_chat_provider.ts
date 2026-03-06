import type { SavedState } from "@bolt-foundry/gambit-core";
import { readClaudeCodeLoginStatus } from "./claude_code_preflight.ts";
import { type CheckReport, handleCheckCommand } from "./commands/check.ts";
import { readCodexLoginStatus } from "./codex_preflight.ts";

export type BuildChatProvider = "codex-cli" | "claude-code-cli";

export function normalizeBuildChatProvider(
  value: unknown,
): BuildChatProvider | null {
  if (value === "claude-code-cli") return "claude-code-cli";
  if (value === "codex-cli") return "codex-cli";
  return null;
}

export function persistBuildChatProviderMeta(
  state: SavedState,
  workspaceId: string,
  provider: BuildChatProvider,
): SavedState {
  return {
    ...state,
    meta: {
      ...(state.meta ?? {}),
      workspaceId,
      buildChatProvider: provider,
    },
  };
}

type CodexStatusResult = {
  trustedPath: string;
  writeEnabled: boolean;
  codexLoggedIn: boolean;
  codexLoginStatus: string;
  check?: CheckReport;
};

export function createReadCodexWorkspaceStatus(input: {
  resolveBuildBotRoot: (workspaceId?: string | null) => Promise<string>;
  resolveWorkspaceDeckPath: (workspaceId?: string | null) => string;
}): (
  workspaceId?: string | null,
  online?: boolean,
) => Promise<CodexStatusResult> {
  return async (workspaceId?: string | null, online?: boolean) => {
    const trustedPath = await input.resolveBuildBotRoot(workspaceId);
    const deckPath = input.resolveWorkspaceDeckPath(workspaceId);
    const login = await readCodexLoginStatus();
    let check: CheckReport | undefined;
    try {
      check = await handleCheckCommand({
        deckPath,
        checkOnline: Boolean(online),
        openRouterApiKey: Deno.env.get("OPENROUTER_API_KEY")?.trim() ||
          undefined,
        googleApiKey: (Deno.env.get("GOOGLE_API_KEY") ??
          Deno.env.get("GEMINI_API_KEY"))?.trim() || undefined,
        ollamaBaseURL: Deno.env.get("OLLAMA_BASE_URL") ?? undefined,
        json: true,
      });
    } catch {
      // Keep status endpoint resilient even if check cannot run.
      check = undefined;
    }
    return { trustedPath, writeEnabled: true, ...login, check };
  };
}

export async function handleBuildProviderStatusRequest(input: {
  req: Request;
  url: URL;
  isLegacyCodexTrustEndpoint: boolean;
  getWorkspaceIdFromQuery: (url: URL) => string | undefined;
  logWorkspaceBotRoot: (
    endpoint: string,
    workspaceId?: string | null,
  ) => Promise<void>;
  readCodexWorkspaceStatus: (
    workspaceId?: string | null,
    online?: boolean,
  ) => Promise<CodexStatusResult>;
}): Promise<Response> {
  const {
    req,
    url,
    isLegacyCodexTrustEndpoint,
    getWorkspaceIdFromQuery,
    logWorkspaceBotRoot,
    readCodexWorkspaceStatus,
  } = input;
  let provider: BuildChatProvider = "codex-cli";
  let workspaceId: string | undefined;
  let online = true;
  if (req.method === "POST") {
    try {
      const body = await req.json() as {
        workspaceId?: unknown;
        online?: unknown;
        provider?: unknown;
      };
      if (typeof body.workspaceId === "string") {
        workspaceId = body.workspaceId;
      }
      if (!isLegacyCodexTrustEndpoint) {
        provider = normalizeBuildChatProvider(body.provider) ?? provider;
      }
      if (
        body.online === true ||
        body.online === "true" ||
        body.online === 1 ||
        body.online === "1"
      ) {
        online = true;
      } else if (
        body.online === false ||
        body.online === "false" ||
        body.online === 0 ||
        body.online === "0" ||
        body.online === "no"
      ) {
        online = false;
      }
    } catch {
      // Ignore malformed body and fall back to query/default workspace.
    }
  }
  if (!workspaceId) {
    workspaceId = getWorkspaceIdFromQuery(url);
  }
  if (!isLegacyCodexTrustEndpoint) {
    provider = normalizeBuildChatProvider(url.searchParams.get("provider")) ??
      provider;
  }
  const onlineQuery = url.searchParams.get("online");
  if (
    onlineQuery === "1" || onlineQuery === "true" ||
    onlineQuery === "yes"
  ) {
    online = true;
  } else if (
    onlineQuery === "0" || onlineQuery === "false" ||
    onlineQuery === "no"
  ) {
    online = false;
  }
  try {
    await logWorkspaceBotRoot(url.pathname, workspaceId);
    if (!isLegacyCodexTrustEndpoint && provider === "claude-code-cli") {
      const login = await readClaudeCodeLoginStatus();
      return new Response(
        JSON.stringify({
          ok: true,
          provider,
          loggedIn: login.claudeCodeLoggedIn,
          loginStatus: login.claudeCodeLoginStatus,
          writeEnabled: false,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    const result = await readCodexWorkspaceStatus(workspaceId, online);
    if (!isLegacyCodexTrustEndpoint) {
      return new Response(
        JSON.stringify({
          ok: true,
          provider,
          loggedIn: result.codexLoggedIn,
          loginStatus: result.codexLoginStatus,
          writeEnabled: result.writeEnabled,
          trustedPath: result.trustedPath,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        ok: true,
        ...result,
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
}
