import type { SavedState } from "@bolt-foundry/gambit-core";
import type { BuildChatProvider } from "./server_build_chat_provider.ts";

// LEGACY API QUARANTINE
// Do not add new routes or new behavior to this file.
// The only acceptable changes here are:
// - removing routes after callers have migrated away
// - deleting this file entirely once the legacy surface is gone
// If you need simulator/workspace behavior, implement it on the non-legacy
// request/GraphQL paths instead of extending this module.

type LegacyApiRouteDeps = {
  req: Request;
  url: URL;
  getWorkspaceIdFromBody: (
    body: Record<string, unknown> | null | undefined,
  ) => string | undefined;
  logWorkspaceBotRoot: (
    endpoint: string,
    workspaceId?: string | null,
  ) => Promise<void>;
  normalizeBuildChatProvider: (value: unknown) => BuildChatProvider | null;
  readSessionStateStrict: (
    workspaceId: string,
    opts?: { withTraces?: boolean },
  ) => SavedState | undefined;
  persistBuildChatProviderMeta: (
    state: SavedState,
    workspaceId: string,
    buildChatProvider: BuildChatProvider,
  ) => SavedState;
  persistSessionState: (state: SavedState) => SavedState;
};

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

const methodNotAllowed = (): Response =>
  new Response("Method not allowed", { status: 405 });

export const handleLegacyApiRoutes = async (
  deps: LegacyApiRouteDeps,
): Promise<Response | null> => {
  const { req, url } = deps;

  if (url.pathname === "/api/build/provider") {
    if (req.method !== "POST") return methodNotAllowed();
    try {
      const body = await req.json().catch(() => ({})) as Record<
        string,
        unknown
      >;
      const workspaceId = deps.getWorkspaceIdFromBody(body);
      if (!workspaceId) throw new Error("Missing workspaceId");
      const buildChatProvider = deps.normalizeBuildChatProvider(
        body.buildChatProvider,
      );
      if (!buildChatProvider) {
        throw new Error(
          "Invalid buildChatProvider; expected codex-cli or claude-code-cli",
        );
      }
      await deps.logWorkspaceBotRoot(url.pathname, workspaceId);
      const state = deps.readSessionStateStrict(workspaceId, {
        withTraces: true,
      });
      if (!state) throw new Error("Workspace not found");
      deps.persistSessionState(
        deps.persistBuildChatProviderMeta(
          state,
          workspaceId,
          buildChatProvider,
        ),
      );
      return jsonResponse({ ok: true, workspaceId, buildChatProvider });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonResponse({ error: message }, 400);
    }
  }

  if (url.pathname.startsWith("/api/")) {
    return new Response("Not found", { status: 404 });
  }

  return null;
};
