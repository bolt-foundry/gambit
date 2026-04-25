const CODEX_AUTH0_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_AUTH0_TOKEN_URL = "https://auth.openai.com/oauth/token";

export const CODEX_HOST_AUTH_BUNDLE_ENV =
  "BOLT_FOUNDRY_DESKTOP_CODEX_AUTH_BUNDLE";

export type CodexChatgptAuthTokens = {
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType: string | null;
  idToken: string | null;
  lastRefresh: string | null;
  refreshToken: string;
};

type CodexRuntimeAuthFile = {
  auth_mode?: unknown;
  last_refresh?: unknown;
  lastRefresh?: unknown;
  tokens?: {
    access_token?: unknown;
    account_id?: unknown;
    id_token?: unknown;
    refresh_token?: unknown;
  } | null;
};

type JwtClaims = Record<string, unknown>;

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function decodeBase64Url(value: string): string | null {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  try {
    return atob(padded);
  } catch {
    return null;
  }
}

function decodeJwtClaims(token: string | null): JwtClaims {
  if (!token) return {};
  const [, payload] = token.split(".");
  if (!payload) return {};
  const decoded = decodeBase64Url(payload);
  if (!decoded) return {};
  try {
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JwtClaims
      : {};
  } catch {
    return {};
  }
}

function chatgptAccountIdFromClaims(
  ...claims: Array<JwtClaims>
): string | null {
  for (const claimSet of claims) {
    for (
      const key of [
        "chatgpt_account_id",
        "account_id",
        "https://api.openai.com/chatgpt_account_id",
      ]
    ) {
      const value = normalizeNonEmptyString(claimSet[key]);
      if (value) return value;
    }
  }
  return null;
}

function chatgptPlanTypeFromClaims(...claims: Array<JwtClaims>): string | null {
  for (const claimSet of claims) {
    for (
      const key of [
        "chatgpt_plan_type",
        "plan_type",
        "https://api.openai.com/chatgpt_plan_type",
      ]
    ) {
      const value = normalizeNonEmptyString(claimSet[key]);
      if (value) return value;
    }
  }
  return null;
}

export function summarizeCodexAuthBundle(
  bundle: CodexChatgptAuthTokens | null | undefined,
): {
  chatgptAccountId: string | null;
  chatgptPlanType: string | null;
  hasAccessToken: boolean;
  hasIdToken: boolean;
  hasRefreshToken: boolean;
  lastRefresh: string | null;
} {
  return {
    chatgptAccountId: bundle?.chatgptAccountId ?? null,
    chatgptPlanType: bundle?.chatgptPlanType ?? null,
    hasAccessToken: Boolean(bundle?.accessToken),
    hasIdToken: Boolean(bundle?.idToken),
    hasRefreshToken: Boolean(bundle?.refreshToken),
    lastRefresh: bundle?.lastRefresh ?? null,
  };
}

export function parseCodexAuthBundle(
  raw: string,
): CodexChatgptAuthTokens {
  const parsed = JSON.parse(raw) as Partial<CodexChatgptAuthTokens>;
  const accessToken = normalizeNonEmptyString(parsed.accessToken);
  const refreshToken = normalizeNonEmptyString(parsed.refreshToken);
  const idToken = normalizeNonEmptyString(parsed.idToken);
  const accessClaims = decodeJwtClaims(accessToken);
  const idClaims = decodeJwtClaims(idToken);
  const chatgptAccountId = normalizeNonEmptyString(parsed.chatgptAccountId) ??
    chatgptAccountIdFromClaims(idClaims, accessClaims);
  if (!accessToken || !refreshToken || !chatgptAccountId) {
    throw new Error(
      "Codex auth bundle is missing accessToken, refreshToken, or chatgptAccountId.",
    );
  }
  return {
    accessToken,
    refreshToken,
    idToken,
    chatgptAccountId,
    chatgptPlanType: normalizeNonEmptyString(parsed.chatgptPlanType) ??
      chatgptPlanTypeFromClaims(idClaims, accessClaims),
    lastRefresh: normalizeNonEmptyString(parsed.lastRefresh),
  };
}

export function parseCodexAuthBundleFromRuntimeAuthFile(
  raw: string,
): CodexChatgptAuthTokens {
  const parsed = JSON.parse(raw) as CodexRuntimeAuthFile;
  const accessToken = normalizeNonEmptyString(parsed.tokens?.access_token);
  const refreshToken = normalizeNonEmptyString(parsed.tokens?.refresh_token);
  const idToken = normalizeNonEmptyString(parsed.tokens?.id_token);
  const accessClaims = decodeJwtClaims(accessToken);
  const idClaims = decodeJwtClaims(idToken);
  const chatgptAccountId = normalizeNonEmptyString(parsed.tokens?.account_id) ??
    chatgptAccountIdFromClaims(idClaims, accessClaims);
  if (!accessToken || !refreshToken || !chatgptAccountId) {
    throw new Error(
      "Codex runtime auth file is missing tokens.access_token, tokens.refresh_token, or account metadata.",
    );
  }
  return {
    accessToken,
    refreshToken,
    idToken,
    chatgptAccountId,
    chatgptPlanType: chatgptPlanTypeFromClaims(idClaims, accessClaims),
    lastRefresh: normalizeNonEmptyString(parsed.last_refresh) ??
      normalizeNonEmptyString(parsed.lastRefresh),
  };
}

export function serializeCodexAuthBundle(
  bundle: CodexChatgptAuthTokens,
): string {
  return JSON.stringify(bundle);
}

export function readCodexAuthBundleFromEnv(): CodexChatgptAuthTokens | null {
  const raw = Deno.env.get(CODEX_HOST_AUTH_BUNDLE_ENV)?.trim();
  if (!raw) return null;
  return parseCodexAuthBundle(raw);
}

export async function refreshCodexChatgptAuthTokens(input: {
  bundle: CodexChatgptAuthTokens;
  previousAccountId?: string | null;
  reason: string;
}): Promise<CodexChatgptAuthTokens> {
  const body = new URLSearchParams({
    client_id: CODEX_AUTH0_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: input.bundle.refreshToken,
  });
  const response = await fetch(CODEX_AUTH0_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `Codex auth refresh failed (${response.status})${
        detail ? `: ${detail}` : ""
      }`,
    );
  }
  const parsed = await response.json() as {
    access_token?: unknown;
    id_token?: unknown;
    refresh_token?: unknown;
  };
  const accessToken = normalizeNonEmptyString(parsed.access_token);
  const refreshToken = normalizeNonEmptyString(parsed.refresh_token) ??
    input.bundle.refreshToken;
  const idToken = normalizeNonEmptyString(parsed.id_token) ??
    input.bundle.idToken;
  const accessClaims = decodeJwtClaims(accessToken);
  const idClaims = decodeJwtClaims(idToken);
  const chatgptAccountId = chatgptAccountIdFromClaims(idClaims, accessClaims) ??
    input.previousAccountId?.trim() ??
    input.bundle.chatgptAccountId;
  if (!accessToken || !refreshToken || !chatgptAccountId) {
    throw new Error(
      "Codex auth refresh did not return accessToken, refreshToken, and chatgptAccountId.",
    );
  }
  return {
    accessToken,
    refreshToken,
    idToken,
    chatgptAccountId,
    chatgptPlanType: chatgptPlanTypeFromClaims(idClaims, accessClaims) ??
      input.bundle.chatgptPlanType,
    lastRefresh: new Date().toISOString(),
  };
}
